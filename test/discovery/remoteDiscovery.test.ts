import { describe, expect, it, vi } from "vitest";
import { MoodleApi } from "../../src/api/moodleApi";
import { RemoteDiscovery } from "../../src/discovery/remoteDiscovery";

describe("remote discovery", () => {
	it("collects course content and finished quiz reviews before planning", async () => {
		const getFinishedQuizAttempts = vi.fn(async () => [{ id: 12, state: "finished" }]);
		const getQuizAttemptReview = vi.fn(async () => ({ summary: "<p>Passed</p>" }));
		const api: MoodleApi = {
			getSiteInfo: vi.fn(async () => ({ userid: 4 })),
			getEnrolledCourses: vi.fn(async () => [{ id: 10, fullname: "Course" }]),
			getCourseContents: vi.fn(async () => [{ id: 2, modules: [
				{ id: 3, instance: 8, modname: "quiz" },
				{ id: 4, modname: "resource" }
			] }]),
			getFinishedQuizAttempts,
			getQuizAttemptReview,
			downloadResource: vi.fn()
		};

		const remote = await new RemoteDiscovery(api).discover();

		expect(getFinishedQuizAttempts).toHaveBeenCalledWith(8, 4);
		expect(getQuizAttemptReview).toHaveBeenCalledWith(12);
		expect(remote.courses[0]?.quizAttempts.get(3)).toEqual([{
			attempt: { id: 12, state: "finished" },
			review: { summary: "<p>Passed</p>" }
		}]);
	});

	it("keeps an attempt when Moodle denies access to its detailed review", async () => {
		const reviewError = new Error("Moodle API mod_quiz_get_attempt_review failed for attempt 12 after signature fallbacks: You may not review this quiz.");
		const api: MoodleApi = {
			getSiteInfo: vi.fn(async () => ({ userid: 4 })),
			getEnrolledCourses: vi.fn(async () => [{ id: 10, fullname: "Course" }]),
			getCourseContents: vi.fn(async () => [{ id: 2, modules: [{ id: 3, instance: 8, modname: "quiz" }] }]),
			getFinishedQuizAttempts: vi.fn(async () => [{ id: 12, state: "finished" }]),
			getQuizAttemptReview: vi.fn(async () => { throw reviewError; }),
			downloadResource: vi.fn()
		};

		const remote = await new RemoteDiscovery(api).discover();

		expect(remote.courses[0]?.quizAttempts.get(3)).toEqual([{
			attempt: { id: 12, state: "finished" },
			review: {},
			reviewError: reviewError.message
		}]);
	});
});