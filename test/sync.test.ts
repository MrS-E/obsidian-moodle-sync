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
});
