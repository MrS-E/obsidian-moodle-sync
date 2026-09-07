import { describe, expect, it, vi } from "vitest";
import { MoodleApi } from "../src/api/moodleApi";
import { SyncState } from "../src/domain/syncState";
import { MoodleSyncService } from "../src/sync/syncService";
import { DEFAULT_STATE } from "../src/state";
import { ObsidianVaultGateway } from "../src/vault/obsidianVaultGateway";
import { createFakeApp } from "./helpers/fakeVault";

describe("sync service", () => {
	it("keeps dry runs entirely read-only", async () => {
		const app = createFakeApp();
		const saveState = vi.fn(async () => undefined);
		const result = await runService(app, createClient().client, structuredClone(DEFAULT_STATE), saveState, "dry-run");

		expect(app.files.size).toBe(0);
		expect(app.folders.size).toBe(0);
		expect(saveState).not.toHaveBeenCalled();
		expect(result.summary).toContain("Moodle sync (dry-run) summary");
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

		await runService(app, client, state, vi.fn(async () => undefined), "apply");

		expect(app.files.has("Moodle/Math-101 (42)/Week-1.md")).toBe(true);
		expect(app.files.has("Moodle/_resources/Math-101 (42)/Week-1/slides-1.pdf")).toBe(true);
		expect(app.files.get("Notes/references.md")?.text).toBe("[[Moodle/Math-101 (42)/Week-1|Week]]\n");
		expect(state.pathMigrationVersion).toBe(1);
		expect(downloadResource).not.toHaveBeenCalled();

		await runService(app, client, state, vi.fn(async () => undefined), "apply");
		expect(app.files.get("Notes/references.md")?.text).toBe("[[Moodle/Math-101 (42)/Week-1|Week]]\n");
	});

	it("reports failed downloads without recording them as current", async () => {
		const app = createFakeApp();
		const { client } = createClient();
		client.downloadResource = vi.fn(async () => { throw new Error("offline"); });
		const state = structuredClone(DEFAULT_STATE);

		const result = await runService(
			app,
			client,
			state,
			vi.fn(async () => undefined),
			"apply",
			{ ...syncSettings(), writeLogFile: true }
		);

		expect(state.files).toEqual({});
		expect(result.summary).toContain("Failures: 1 download");
		expect(app.files.get("Moodle/_sync-log.md")?.text).toContain("<h3>Errors</h3>");
		expect(app.files.get("Moodle/_sync-log.md")?.text).toContain("offline");
	});

	it("appends detailed dry-run and apply entries to the sync log", async () => {
		const app = createFakeApp();
		await app.vault.createFolder("Moodle");
		await app.vault.create("Moodle/_sync-log.md", "# Moodle sync log\n\nPrevious entry\n");
		const state = structuredClone(DEFAULT_STATE);
		const settings = { ...syncSettings(), writeLogFile: true, includeActionsInLogDetails: true };

		await runService(app, createClient().client, state, vi.fn(async () => undefined), "dry-run", settings);
		await runService(app, createClient().client, state, vi.fn(async () => undefined), "apply", settings);

		const log = app.files.get("Moodle/_sync-log.md")?.text ?? "";
		expect(log).toContain("Previous entry");
		expect(log).toContain("Moodle sync (dry-run) summary:");
		expect(log).toContain("Moodle sync summary:");
		expect(log).toContain("<h3>Planned actions</h3>");
		expect(log).toContain("<li>Ensure folder: Moodle</li>");
		expect(log).toContain("<li>Download resource: Moodle/_resources/Math-101 (42)/Week-1/slides-1.pdf</li>");
		expect(log).not.toContain("### Planned actions");
		expect(log.match(/<details>/g)).toHaveLength(2);
		expect(log.match(/<\/details>/g)).toHaveLength(2);
	});

	it("writes a denied quiz-review error to the attempt note and sync log", async () => {
		const app = createFakeApp();
		const { client } = createClient();
		client.getCourseContents = vi.fn(async () => [{
			id: 1,
			name: "Week 1",
			modules: [{ id: 9, instance: 19, name: "Quiz", modname: "quiz" }]
		}]);
		client.getFinishedQuizAttempts = vi.fn(async () => [{ id: 12, state: "finished" }]);
		client.getQuizAttemptReview = vi.fn(async () => {
			throw new Error("Moodle API mod_quiz_get_attempt_review failed: You may not review this quiz.");
		});

		const result = await runService(
			app,
			client,
			structuredClone(DEFAULT_STATE),
			vi.fn(async () => undefined),
			"apply",
			{ ...syncSettings(), writeLogFile: true }
		);

		expect(app.files.get("Moodle/_resources/Math-101 (42)/Quiz/attempt-12.md")?.text)
			.toContain("You may not review this quiz.");
		expect(result.summary).toContain("Warnings: 1 quiz review unavailable");
		expect(app.files.get("Moodle/_sync-log.md")?.text).toContain("Attempt 12: Moodle API mod_quiz_get_attempt_review failed");
		expect(app.files.get("Moodle/_sync-log.md")?.text).not.toContain("<h3>Planned actions</h3>");
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
		logFilePath: "Moodle/_sync-log.md",
		includeActionsInLogDetails: false
	};
}

function progress() {
	return { totalSteps: 0, setStatus: vi.fn(), tick: vi.fn() };
}

async function runService(
	app: ReturnType<typeof createFakeApp>,
	client: MoodleApi,
	state: SyncState,
	saveState: (state: SyncState) => Promise<void>,
	mode: "apply" | "dry-run",
	settings = syncSettings()
) {
	return await new MoodleSyncService(client, new ObsidianVaultGateway(app as never))
		.run(settings, state, saveState, mode, progress());
}