import { describe, expect, it } from "vitest";
import { renderQuizAttemptNotes } from "../../src/rendering/quizRenderer";

describe("quiz Markdown renderer", () => {
	it("writes each finished attempt as a linked Markdown note", async () => {
		const plan = renderQuizAttemptNotes("Moodle/_resources/Course (42)/Quiz 1", {
			id: 7,
			instance: 9,
			name: "Quiz 1",
			modname: "quiz",
			description: "<p>Read carefully.</p>"
		}, [{
			attempt: { id: 17, state: "finished", timefinish: 1700000000, sumgrades: 8.5 },
			review: {
				summary: "<p>Passed</p>",
				questions: [{ html: "<table><tr><td>Question body</td></tr></table>" }]
			}
		}]);

		expect(plan.resourceLinks).toEqual(["- [[Moodle/_resources/Course (42)/Quiz 1/attempt-17]]"]);
		expect(plan.files).toEqual([expect.objectContaining({
			destPath: "Moodle/_resources/Course (42)/Quiz 1/attempt-17.md"
		})]);
		expect(plan.files[0]?.text).toContain("# Quiz 1 — attempt 17");
		expect(plan.files[0]?.text).toContain("Read carefully.");
		expect(plan.files[0]?.text).toContain("<table>");
	});

	it("renders an explicit fallback when Moodle provides no detailed review fields", async () => {
		const plan = renderQuizAttemptNotes("Moodle/_resources/Course (42)/Quiz", {
			id: 7,
			instance: 9,
			modname: "quiz"
		}, [{ attempt: { id: 18, status: "finished" }, review: {} }]);

		expect(plan.files[0]?.destPath).toBe("Moodle/_resources/Course (42)/Quiz/attempt-18.md");
		expect(plan.files[0]?.text).toContain("No detailed review content was returned by Moodle.");
	});

	it("renders a Moodle review error inside the attempt note", () => {
		const plan = renderQuizAttemptNotes("Moodle/_resources/Course (42)/Quiz", {
			id: 7,
			instance: 9,
			modname: "quiz"
		}, [{
			attempt: { id: 18, status: "finished" },
			review: {},
			reviewError: "Moodle API mod_quiz_get_attempt_review failed: You may not review this quiz."
		}]);

		expect(plan.files[0]?.text).toContain("## Review unavailable");
		expect(plan.files[0]?.text).toContain("You may not review this quiz.");
		expect(plan.files[0]?.text).not.toContain("No detailed review content was returned by Moodle.");
	});
});