import { describe, expect, it, vi } from "vitest";
import { noticeLog } from "./obsidian";
import { runSyncV2, __test__ as syncTest } from "../src/sync";
import { DEFAULT_STATE } from "../src/state";
import { createFakeApp } from "./helpers/fakeVault";

describe("sync", () => {
	it("plans module notes and resource links", () => {
		const planned = syncTest.planModule(
			"Moodle/_resources/Course (42)",
			{ id: 1, name: "Week 1" },
			{
				id: 7,
				name: "Slides",
				modname: "resource",
				description: "<p>Hello</p>",
				contents: [
					{
						type: "file",
						filename: "slides.pdf",
						fileurl: "https://example.com/slides.pdf",
						filepath: "/week1/",
						filesize: 12
					}
				]
			},
			{ convertHtmlToMarkdown: true }
		);

		expect(planned.files).toEqual([
			expect.objectContaining({
				destPath: "Moodle/_resources/Course (42)/Slides/week1/slides.pdf"
			})
		]);
		expect(planned.noteText).toContain("Hello");
		expect(planned.noteText).toContain("![[Moodle/_resources/Course (42)/Slides/week1/slides.pdf]]");
	});

	it("marks unresolved merges as conflicts", () => {
		const merged = syncTest.mergeBlock({
			name: "content",
			base: "start",
			local: "local change",
			remote: "remote change"
		});

		expect(merged.conflicted).toBe(true);
		expect(merged.inner).toContain("### Local");
		expect(merged.inner).toContain("### Remote");
	});

	it("runs a dry-run sync and writes a log note", async () => {
		const app = createFakeApp();
		const client = {
			call: vi.fn(async (method: string) => {
				if (method === "core_webservice_get_site_info") {
					return { userid: 7, username: "alice", sitename: "Moodle" };
				}
				if (method === "core_enrol_get_users_courses") {
					return [{ id: 42, fullname: "Databases" }];
				}
				if (method === "core_course_get_contents") {
					return [{
						id: 1,
						name: "Week 1",
						modules: [{
							id: 9,
							name: "Overview",
							modname: "label",
							description: "<p>Intro</p>"
						}]
					}];
				}
				throw new Error(`Unexpected method ${method}`);
			})
		};

		const progress = {
			totalSteps: 0,
			setStatus: vi.fn(),
			tick: vi.fn()
		};

		await runSyncV2(
			app as never,
			client as never,
			{
				rootFolder: "Moodle",
				resourcesFolder: "Moodle/_resources",
				concurrency: 2,
				convertHtmlToMarkdown: true,
				writeLogFile: true,
				logFilePath: "Moodle/_sync-log.md"
			},
			structuredClone(DEFAULT_STATE),
			vi.fn(async () => undefined),
			"dry-run",
			progress
		);

		expect(progress.setStatus).toHaveBeenCalled();
		expect(noticeLog[noticeLog.length - 1]?.message).toContain("Moodle sync (dry-run) summary");
		expect(app.files.get("Moodle/_sync-log.md")?.text).toContain("Moodle sync (dry-run) summary");
	});

	it("skips downloads when file metadata is unchanged and file exists", () => {
		const app = createFakeApp();
		void app.vault.createBinary("Moodle/file.pdf", new Uint8Array([1]).buffer);

		expect(syncTest.shouldDownload(
			{
				files: { "Moodle/file.pdf": { timemodified: 10, filesize: 100 } },
				notes: {}
			},
			"Moodle/file.pdf",
			10,
			100,
			app as never
		)).toBe(false);
	});

	it("renders summaries and conflict tags consistently", () => {
		const summary = syncTest.renderSummary({
			mode: "dry-run",
			actions: [],
			summary: {
				courses: 2,
				notesCreate: 1,
				notesUpdate: 2,
				noteConflicts: 3,
				filesDownload: 4,
				filesSkip: 5,
				bytesToDownload: 2048
			},
			meta: {}
		}, true);

		expect(summary).toContain("Moodle sync (dry-run) summary:");
		expect(summary).toContain("4 download (2.0 KB)");
		expect(syncTest.ensureConflictTags("content")).toBe("#colition #conflict\n\ncontent");
		expect(syncTest.ensureConflictTags("#conflict\n\ncontent")).toBe("#conflict\n\ncontent");
	});

	it("deduplicates ensure-folder actions and hashes normalized blocks", () => {
		expect(syncTest.dedupeEnsureFolder([
			{ kind: "ensure-folder", path: "A" },
			{ kind: "ensure-folder", path: "A" },
			{ kind: "file-skip", destPath: "B" }
		])).toEqual([
			{ kind: "ensure-folder", path: "A" },
			{ kind: "file-skip", destPath: "B" }
		]);

		expect(syncTest.normalizeBlocks({ a: "x  ", b: "y\n" })).toEqual({ a: "x", b: "y" });
		expect(syncTest.hashBlocks({ b: "2", a: "1" })).toBe(syncTest.hashBlocks({ a: "1", b: "2" }));
	});

	it("preserves empty lines when converting to and from line arrays", () => {
		const lines = syncTest.toLinesPreserveEmpty("a\nb\n");
		expect(lines).toEqual(["a", "b", ""]);
		expect(syncTest.fromLines(lines)).toBe("a\nb\n");
	});
});
