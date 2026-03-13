import { describe, expect, it, vi } from "vitest";
import { planQuizExports } from "../src/quizExport";

describe("quiz export", () => {
	it("exports finished attempts as html and pdf resources", async () => {
		const client = {
			call: vi.fn(async (method: string, args?: Record<string, unknown>) => {
				if (method === "mod_quiz_get_user_attempts") {
					expect(args).toMatchObject({ quizid: 9, userid: 5, status: "finished" });
					return {
						attempts: [
							{ id: 17, state: "finished", timefinish: 1700000000, timestart: 1699990000, sumgrades: 8.5 }
						]
					};
				}
				if (method === "mod_quiz_get_attempt_review") {
					expect(args).toMatchObject({ attemptid: 17 });
					return {
						grade: "8.5/10",
						summary: "<p>Passed</p>",
						questions: [
							{ html: "<div>Question body</div>" }
						]
					};
				}
				throw new Error(`Unexpected method ${method}`);
			})
		};

		const plan = await planQuizExports(
			client,
			"Moodle/_resources/Course (42)",
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
		const client = {
			call: vi.fn(async (method: string) => {
				if (method === "mod_quiz_get_user_attempts") {
					return {
						attempts: [
							{ id: 11, state: "inprogress", timefinish: 0 },
							{ id: 12, status: "finished", timefinish: 1700000000 }
						]
					};
				}
				if (method === "mod_quiz_get_attempt_review") {
					return {
						questions: [
							{ html: "<textarea aria-label=\"Essay answer\">Final answer</textarea>" }
						]
					};
				}
				throw new Error(`Unexpected method ${method}`);
			})
		};

		const plan = await planQuizExports(
			client,
			"Moodle/_resources/Course (42)",
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
