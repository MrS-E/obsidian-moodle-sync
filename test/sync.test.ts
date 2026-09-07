import { describe, expect, it, vi } from "vitest";
import { MoodleApi } from "../src/api/moodleApi";
import { SyncState } from "../src/domain/syncState";
import { runSyncV2 } from "../src/sync";
import { DEFAULT_STATE } from "../src/state";
import { createFakeApp } from "./helpers/fakeVault";
import { noticeLog } from "./obsidian";

describe("sync service compatibility entry point", () => {
	it("keeps dry runs entirely read-only", async () => {
		const app = createFakeApp();
		const saveState = vi.fn(async () => undefined);
		await runSyncV2(app as never, createClient().client, syncSettings(), structuredClone(DEFAULT_STATE), saveState, "dry-run", progress());

		expect(app.files.size).toBe(0);
		expect(app.folders.size).toBe(0);
		expect(saveState).not.toHaveBeenCalled();
		expect(noticeLog.at(-1)?.message).toContain("Moodle sync (dry-run) summary");
	});

	it("migrates managed paths, rewrites resolved links, and remains idempotent", async () => {
		const app = createFakeApp();
		for (const folder of [
			"Moodle",
			"Moodle/_resources",
			"Moodle/Math [101] (42)",
			"Moodle/_resources/Math [101] (42)",
			"Moodle/_resources/Math [101] (42)/Week [1]",
			"Notes"
		]) await app.vault.createFolder(folder);
		await app.vault.create("Moodle/Math [101] (42)/Week [1].md", "# Week 1\n\n## My notes\n");
		await app.vault.createBinary("Moodle/_resources/Math [101] (42)/Week [1]/slides [1].pdf", new ArrayBuffer(1));
		await app.vault.create("Notes/references.md", "[[Moodle/Math [101] (42)/Week [1]|Week]]\n");
		app.metadataCache.getFirstLinkpathDest = (linkPath: string) => app.vault.getAbstractFileByPath(`${linkPath}.md`) as never;

		const { client, downloadResource } = createClient();
		const state: SyncState = {
			...structuredClone(DEFAULT_STATE),
			files: { "Moodle/_resources/Math [101] (42)/Week [1]/slides [1].pdf": { timemodified: 10, filesize: 1 } },
			notes: { "Moodle/Math [101] (42)/Week [1].md": { baseBlocks: {}, lastSyncedManagedHash: "" } }
		};

		await runSyncV2(app as never, client, syncSettings(), state, vi.fn(async () => undefined), "apply", progress());

		expect(app.files.has("Moodle/Math-101 (42)/Week-1.md")).toBe(true);
		expect(app.files.has("Moodle/_resources/Math-101 (42)/Week-1/slides-1.pdf")).toBe(true);
		expect(app.files.get("Notes/references.md")?.text).toBe("[[Moodle/Math-101 (42)/Week-1|Week]]\n");
		expect(state.pathMigrationVersion).toBe(1);
		expect(downloadResource).not.toHaveBeenCalled();

		await runSyncV2(app as never, client, syncSettings(), state, vi.fn(async () => undefined), "apply", progress());
		expect(app.files.get("Notes/references.md")?.text).toBe("[[Moodle/Math-101 (42)/Week-1|Week]]\n");
	});

	it("reports failed downloads without recording them as current", async () => {
		const app = createFakeApp();
		const { client } = createClient();
		client.downloadResource = vi.fn(async () => { throw new Error("offline"); });
		const state = structuredClone(DEFAULT_STATE);

		await runSyncV2(app as never, client, syncSettings(), state, vi.fn(async () => undefined), "apply", progress());

		expect(state.files).toEqual({});
		expect(noticeLog.at(-1)?.message).toContain("Failures: 1 download");
	});
});

function createClient(): { client: MoodleApi; downloadResource: ReturnType<typeof vi.fn> } {
	const downloadResource = vi.fn(async () => new ArrayBuffer(0));
	return { client: {
		getSiteInfo: vi.fn(async () => ({ userid: 7 })),
		getEnrolledCourses: vi.fn(async () => [{ id: 42, fullname: "Math [101]" }]),
		getCourseContents: vi.fn(async () => [{
			id: 1,
			name: "Week 1",
			modules: [{
				id: 9,
				name: "Week [1]",
				modname: "resource",
				description: "<p>Intro</p>",
				contents: [{
					type: "file",
					filename: "slides [1].pdf",
					fileurl: "https://example.com/slides.pdf",
					timemodified: 10,
					filesize: 1
				}]
			}]
		}]),
		getFinishedQuizAttempts: vi.fn(async () => []),
		getQuizAttemptReview: vi.fn(async () => ({})),
		downloadResource
	}, downloadResource };
}

function syncSettings() {
	return {
		rootFolder: "Moodle",
		resourcesFolder: "Moodle/_resources",
		concurrency: 2,
		writeLogFile: false,
		logFilePath: "Moodle/_sync-log.md"
	};
}

function progress() {
	return { totalSteps: 0, setStatus: vi.fn(), tick: vi.fn() };
}