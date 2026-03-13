import { describe, expect, it } from "vitest";
import MoodleSyncPoCv2, { __test__ as mainTest } from "../src/main";

type RuntimePluginHooks = {
	__setData: (data: unknown) => void;
	savedData: unknown[];
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
	it("normalizes legacy sync state", () => {
		expect(mainTest.normalizeSyncState({
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
		expect(mainTest.normalizeSyncState("invalid")).toEqual({
			files: {},
			notes: {}
		});
	});

	it("normalizes malformed file and note entries conservatively", () => {
		expect(mainTest.normalizeSyncState({
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
			convertHtmlToMarkdown: false,
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
			files: {},
			notes: {
				"note.md": {
					baseBlocks: {},
					lastSyncedManagedHash: "abc"
				}
			}
		});
	});

	it("formats unknown thrown values safely", () => {
		expect(mainTest.getErrorMessage(new Error("boom"))).toBe("boom");
		expect(mainTest.getErrorMessage("boom")).toBe("boom");
	});
});
