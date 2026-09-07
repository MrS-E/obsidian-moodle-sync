import { describe, expect, it } from "vitest";
import { MoodleApi } from "../src/api/moodleApi";
import { planQuizExports } from "../src/quizExport";

describe("quiz export", () => {
	it("exports finished attempts as html and pdf resources", async () => {
		const client: Pick<MoodleApi, "getFinishedQuizAttempts" | "getQuizAttemptReview"> = {
			getFinishedQuizAttempts: async (quizId, userId) => {
				expect({ quizId, userId }).toEqual({ quizId: 9, userId: 5 });
				return [{ id: 17, state: "finished", timefinish: 1700000000, timestart: 1699990000, sumgrades: 8.5 }];
			},
			getQuizAttemptReview: async (attemptId) => {
				expect(attemptId).toBe(17);
				return { grade: "8.5/10", summary: "<p>Passed</p>", questions: [{ html: "<div>Question body</div>" }] };
			}
		};

		const plan = await planQuizExports(
			client,
			"Moodle/_resources/Course (42)/Quiz 1",
			{
				id: 7,
				instance: 9,
				name: "Quiz 1",
				modname: "quiz",
				url: "https://example.com/quiz/9",
				description: "<p>Read carefully.</p>"
			},
			5
		);

		expect(plan.resourceLinks).toEqual([
			"- ![[Moodle/_resources/Course (42)/Quiz 1/attempt-17.pdf]]",
			"- [[Moodle/_resources/Course (42)/Quiz 1/attempt-17.html]]"
		]);
		expect(plan.files).toHaveLength(2);
		expect(plan.files[0]).toMatchObject({
			destPath: "Moodle/_resources/Course (42)/Quiz 1/attempt-17.html",
			format: "text"
		});
		expect(plan.files[0]?.text).toContain("<h1>Quiz 1</h1>");
		expect(plan.files[0]?.text).toContain("<h2>Questions</h2>");
		expect(plan.files[1]).toMatchObject({
			destPath: "Moodle/_resources/Course (42)/Quiz 1/attempt-17.pdf",
			format: "pdf-from-html"
		});
		expect(plan.files[1]?.html).toContain("<!doctype html>");
	});

	it("sanitizes textarea answers and ignores unfinished attempts", async () => {
		const client: Pick<MoodleApi, "getFinishedQuizAttempts" | "getQuizAttemptReview"> = {
			getFinishedQuizAttempts: async () => [{ id: 12, status: "finished", timefinish: 1700000000 }],
			getQuizAttemptReview: async () => ({
				questions: [{ html: "<textarea aria-label=\"Essay answer\">Final answer</textarea>" }]
			})
		};

		const plan = await planQuizExports(
			client,
			"Moodle/_resources/Course (42)/Essay quiz",
			{ id: 8, instance: 10, name: "Essay quiz", modname: "quiz" },
			5
		);

		expect(plan.resourceLinks).toEqual([
			"- ![[Moodle/_resources/Course (42)/Essay quiz/attempt-12.pdf]]",
			"- [[Moodle/_resources/Course (42)/Essay quiz/attempt-12.html]]"
		]);
		expect(plan.files[0]?.text).toContain("textarea-render");
		expect(plan.files[0]?.text).toContain("aria-label=\"Essay answer\"");
		expect(plan.files[0]?.text).toContain(">Final answer</div>");
		expect(plan.files[0]?.text).not.toContain("<textarea");
	});
});
