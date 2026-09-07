import { describe, expect, it } from "vitest";
import { MoodleApi } from "../../src/api/moodleApi";
import { planQuizAttemptNotes } from "../../src/rendering/quizRenderer";

describe("quiz Markdown renderer", () => {
	it("writes each finished attempt as a linked Markdown note", async () => {
		const client: Pick<MoodleApi, "getFinishedQuizAttempts" | "getQuizAttemptReview"> = {
			getFinishedQuizAttempts: async () => [{ id: 17, state: "finished", timefinish: 1700000000, sumgrades: 8.5 }],
			getQuizAttemptReview: async () => ({
				summary: "<p>Passed</p>",
				questions: [{ html: "<table><tr><td>Question body</td></tr></table>" }]
			})
		};

		const plan = await planQuizAttemptNotes(client, "Moodle/_resources/Course (42)/Quiz 1", {
			id: 7,
			instance: 9,
			name: "Quiz 1",
			modname: "quiz",
			description: "<p>Read carefully.</p>"
		}, 5);

		expect(plan.resourceLinks).toEqual(["- [[Moodle/_resources/Course (42)/Quiz 1/attempt-17]]"]);
		expect(plan.files).toEqual([expect.objectContaining({
			destPath: "Moodle/_resources/Course (42)/Quiz 1/attempt-17.md"
		})]);
		expect(plan.files[0]?.text).toContain("# Quiz 1 — attempt 17");
		expect(plan.files[0]?.text).toContain("Read carefully.");
		expect(plan.files[0]?.text).toContain("<table>");
	});

	it("renders an explicit fallback when Moodle provides no detailed review fields", async () => {
		const client: Pick<MoodleApi, "getFinishedQuizAttempts" | "getQuizAttemptReview"> = {
			getFinishedQuizAttempts: async () => [{ id: 18, status: "finished" }],
			getQuizAttemptReview: async () => ({})
		};

		const plan = await planQuizAttemptNotes(client, "Moodle/_resources/Course (42)/Quiz", {
			id: 7,
			instance: 9,
			modname: "quiz"
		}, 5);

		expect(plan.files[0]?.destPath).toBe("Moodle/_resources/Course (42)/Quiz/attempt-18.md");
		expect(plan.files[0]?.text).toContain("No detailed review content was returned by Moodle.");
	});
});