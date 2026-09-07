import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MoodleApi, MoodleWebServiceApi } from "../src/api/moodleApi";
import { MoodleArgs, MoodleTransport } from "../src/api/contracts";

function fixture(name: string): unknown {
	return JSON.parse(readFileSync(resolve("test", "fixtures", "moodle", name), "utf8")) as unknown;
}

function transportFor(responses: Record<string, unknown>): MoodleTransport {
	return {
		call: vi.fn(async (functionName: string) => responses[functionName]),
		download: vi.fn(async () => new ArrayBuffer(0))
	};
}

describe("MoodleWebServiceApi", () => {
	it("decodes endpoint fixtures into domain models", async () => {
		const api = new MoodleWebServiceApi(transportFor({
			core_webservice_get_site_info: fixture("site-info.json"),
			core_enrol_get_users_courses: fixture("courses.json"),
			core_course_get_contents: fixture("course-contents.json"),
			mod_quiz_get_user_attempts: fixture("quiz-attempts.json"),
			mod_quiz_get_attempt_review: fixture("quiz-review.json")
		}));

		await expect(api.getSiteInfo()).resolves.toEqual({ userid: 7, sitename: "Example Moodle", username: "alice" });
		await expect(api.getEnrolledCourses(7)).resolves.toEqual([{ id: 42, fullname: "Databases", shortname: "DB" }]);
		await expect(api.getCourseContents(42)).resolves.toMatchObject([{
			id: 1,
			modules: [{ id: 9, contents: [{ type: "file", filename: "slides.pdf", filesize: 12 }, { type: "folder" }] }]
		}]);
		await expect(api.getFinishedQuizAttempts(10, 7)).resolves.toEqual([{
			id: 17,
			state: "finished",
			timefinish: 1700000000,
			timestart: 1699990000,
			sumgrades: 8.5
		}]);
		await expect(api.getQuizAttemptReview(17)).resolves.toEqual({
			grade: "8.5/10",
			summary: "<p>Passed</p>",
			questions: [{ html: "<div>Question body</div>" }]
		});
	});

	it("uses documented quiz signature fallbacks and response variants", async () => {
		const call = vi.fn(async (_functionName: string, args: MoodleArgs = {}) => {
			if (args.attemptid === 17) {
				if (args.page === -1) throw new Error("invalid parameter");
				return { questions: [] };
			}
			if (args.includepreviews === 0) throw new Error("invalid parameter");
			return [{ id: 17, status: "overdue", timefinish: "3" }];
		});
		const api = new MoodleWebServiceApi({ call, download: async () => new ArrayBuffer(0) });

		await expect(api.getFinishedQuizAttempts(10, 7)).resolves.toMatchObject([{ id: 17, status: "overdue", timefinish: 3 }]);
		await expect(api.getQuizAttemptReview(17)).resolves.toEqual({ questions: [] });
		expect(call.mock.calls).toEqual([
			["mod_quiz_get_user_attempts", { quizid: 10, userid: 7, status: "finished", includepreviews: 0 }],
			["mod_quiz_get_user_attempts", { quizid: 10, userid: 7, status: "finished" }],
			["mod_quiz_get_attempt_review", { attemptid: 17, page: -1 }],
			["mod_quiz_get_attempt_review", { attemptid: 17, page: 0 }]
		]);
	});

	it("rejects malformed required endpoint data with endpoint context", async () => {
		const api = new MoodleWebServiceApi(transportFor({
			core_course_get_contents: fixture("malformed-course-contents.json")
		}));

		await expect(api.getCourseContents(42)).rejects.toThrow(
			"Invalid response from core_course_get_contents: section 0.modules[0].contents[0].fileurl must be a non-empty string"
		);
	});

	it("adds endpoint context to Moodle transport failures and download failures", async () => {
		const transport: MoodleTransport = {
			call: async () => {
				throw new Error("Bad token");
			},
			download: async () => {
				throw new Error("Download failed HTTP 404");
			}
		};
		const api: MoodleApi = new MoodleWebServiceApi(transport);

		await expect(api.getSiteInfo()).rejects.toThrow("Moodle API core_webservice_get_site_info failed: Bad token");
		await expect(api.downloadResource("https://moodle.example.edu/file.pdf")).rejects.toThrow(
			"Moodle resource download failed: Download failed HTTP 404"
		);
	});

	it("reports a contextual failure after every quiz fallback is rejected", async () => {
		const api = new MoodleWebServiceApi({
			call: async () => {
				throw new Error("unsupported signature");
			},
			download: async () => new ArrayBuffer(0)
		});

		await expect(api.getFinishedQuizAttempts(10, 7)).rejects.toThrow(
			"Moodle API mod_quiz_get_user_attempts failed for quiz 10 and user 7 after signature fallbacks"
		);
	});
});