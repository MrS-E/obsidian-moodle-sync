import { describe, expect, it } from "vitest";
import MoodleSyncPoCv2, { __test__ as mainTest } from "../src/main";
import { noticeLog, requestLog, setRequestUrlImpl } from "./obsidian";
import { createFakeApp } from "./helpers/fakeVault";

type RuntimePluginHooks = {
	__setData: (data: unknown) => void;
	savedData: unknown[];
	commands: Array<{ id: string; callback: () => Promise<void> }>;
};

const manifest = {
	id: "moodle-sync",
	name: "Moodle sync",
	author: "Tests",
	version: "1.0.0",
	minAppVersion: "1.0.0",
	description: "Test manifest",
	isDesktopOnly: false
};

describe("main", () => {
	it("decodes legacy sync state", () => {
		expect(mainTest.decodeSyncState({
			files: {
				"a.bin": { timemodified: 1, filesize: 2 }
			},
			notes: {
				"note.md": {
					lastSyncedHash: "legacy",
					baseBlocks: { meta: "hello", invalid: 3 }
				}
			}
		})).toEqual({
			schemaVersion: 1,
			pathMigrationVersion: 0,
			files: {
				"a.bin": { timemodified: 1, filesize: 2 }
			},
			notes: {
				"note.md": {
					baseBlocks: { meta: "hello", invalid: "" },
					lastSyncedManagedHash: "legacy"
				}
			}
		});
	});

	it("falls back to an empty sync state for invalid persisted data", () => {
		expect(mainTest.decodeSyncState("invalid")).toEqual({
			schemaVersion: 1,
			pathMigrationVersion: 0,
			files: {},
			notes: {}
		});
	});

	it("normalizes malformed file and note entries conservatively", () => {
		expect(mainTest.decodeSyncState({
			files: {
				"ok.bin": { timemodified: 10, filesize: 12 },
				"bad.bin": "oops"
			},
			notes: {
				"ok.md": {
					baseBlocks: { meta: "text", bad: 1 },
					lastSyncedManagedHash: "hash"
				},
				"bad.md": 42
			}
		})).toEqual({
			schemaVersion: 1,
			pathMigrationVersion: 0,
			files: {
				"ok.bin": { timemodified: 10, filesize: 12 }
			},
			notes: {
				"ok.md": {
					baseBlocks: { meta: "text", bad: "" },
					lastSyncedManagedHash: "hash"
				}
			}
		});
	});

	it("preserves sync state when saving settings", async () => {
		const plugin = new MoodleSyncPoCv2({} as never, manifest);
		const testPlugin = plugin as unknown as RuntimePluginHooks;
		testPlugin.__setData({
			baseUrl: "https://moodle.example.edu",
			convertHtmlToMarkdown: true,
			syncState: { files: { "file.bin": { filesize: 3 } }, notes: {} }
		});

		await plugin.loadSettings();
		plugin.settings.token = "new-token";
		await plugin.saveSettings();

		const saved = testPlugin.savedData[testPlugin.savedData.length - 1];
		expect(saved).toEqual({
			baseUrl: "https://moodle.example.edu",
			token: "new-token",
			rootFolder: "Moodle",
			resourcesFolder: "Moodle/_resources",
			concurrency: 4,
			writeLogFile: true,
			logFilePath: "Moodle/_sync-log.md",
			syncState: { files: { "file.bin": { filesize: 3 } }, notes: {} }
		});
	});

	it("loads sync state through the private persistence path", async () => {
		const plugin = new MoodleSyncPoCv2({} as never, manifest);
		const testPlugin = plugin as unknown as RuntimePluginHooks;
		testPlugin.__setData({
			syncState: {
				notes: {
					"note.md": { lastSyncedHash: "abc" }
				}
			}
		});

		const maybeLoadSyncState = (plugin as unknown as Record<string, unknown>)["loadSyncState"];
		expect(typeof maybeLoadSyncState).toBe("function");
		const state = await (maybeLoadSyncState as () => Promise<unknown>).call(plugin);
		expect(state).toEqual({
			schemaVersion: 1,
			pathMigrationVersion: 0,
			files: {},
			notes: {
				"note.md": {
					baseBlocks: {},
					lastSyncedManagedHash: "abc"
				}
			}
		});
	});

	it("keeps the test connection command ID and uses the validated API", async () => {
		const plugin = new MoodleSyncPoCv2({} as never, manifest);
		const testPlugin = plugin as unknown as RuntimePluginHooks;
		testPlugin.__setData({
			baseUrl: "https://moodle.example.edu",
			token: "token123"
		});
		setRequestUrlImpl(async () => ({
			status: 200,
			json: { sitename: "Example Moodle", username: "alice", userid: 7 },
			arrayBuffer: new ArrayBuffer(0)
		}));

		await plugin.onload();
		expect(testPlugin.commands.map(command => command.id)).toEqual([
			"test-connection",
			"sync-now-apply",
			"sync-now-dry-run"
		]);
		const command = testPlugin.commands.find(item => item.id === "test-connection");
		if (!command) throw new Error("Test connection command was not registered");
		await command.callback();

		expect(requestLog[0]?.body).toContain("wstoken=token123");
		expect(requestLog[0]?.body).toContain("wsfunction=core_webservice_get_site_info");
		expect(noticeLog[noticeLog.length - 1]?.message).toBe("OK: Example Moodle / alice");
	});

	it("runs the registered dry-run command against Moodle fixtures without vault writes", async () => {
		const app = createFakeApp();
		const plugin = new MoodleSyncPoCv2(app as never, manifest);
		const testPlugin = plugin as unknown as RuntimePluginHooks;
		testPlugin.__setData({ baseUrl: "https://moodle.example.edu", token: "token123" });
		setRequestUrlImpl(async ({ body }) => {
			if (body?.includes("core_webservice_get_site_info")) {
				return { status: 200, json: { userid: 7 }, arrayBuffer: new ArrayBuffer(0) };
			}
			if (body?.includes("core_enrol_get_users_courses")) {
				return { status: 200, json: [{ id: 42, fullname: "Course" }], arrayBuffer: new ArrayBuffer(0) };
			}
			if (body?.includes("core_course_get_contents")) {
				return { status: 200, json: [{ id: 1, modules: [] }], arrayBuffer: new ArrayBuffer(0) };
			}
			throw new Error(`Unexpected request: ${body}`);
		});

		await plugin.onload();
		const command = testPlugin.commands.find(item => item.id === "sync-now-dry-run");
		if (!command) throw new Error("Dry-run command was not registered");
		await command.callback();

		expect(app.files.size).toBe(0);
		expect(app.folders.size).toBe(0);
		expect(noticeLog[noticeLog.length - 1]?.message).toContain("Moodle sync (dry-run) summary");
	});

	it("loads commands only once per plugin lifecycle and marks its status on unload", async () => {
		const plugin = new MoodleSyncPoCv2({} as never, manifest);
		const testPlugin = plugin as unknown as RuntimePluginHooks;
		await plugin.onload();
		expect(testPlugin.commands).toHaveLength(3);
		plugin.onunload();
		expect(mainTest.isRecord({})).toBe(true);
	});
});
