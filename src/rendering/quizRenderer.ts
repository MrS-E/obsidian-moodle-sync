import { MoodleApi } from "../api/moodleApi";
import { CourseModule, MoodleDisplayValue, QuizAttempt, QuizQuestion, QuizReview } from "../domain/models";
import { renderMoodleHtml } from "./htmlToMarkdown";

export interface QuizMarkdownNote {
	destPath: string;
	text: string;
}

export interface QuizAttemptPlan {
	resourceLinks: string[];
	files: QuizMarkdownNote[];
}

type QuizApi = Pick<MoodleApi, "getFinishedQuizAttempts" | "getQuizAttemptReview">;
type QuizModule = Pick<CourseModule, "id" | "instance" | "name" | "modname" | "url" | "description">;

export async function planQuizAttemptNotes(client: QuizApi, moduleFolder: string, module: QuizModule, userId: number): Promise<QuizAttemptPlan> {
	if (module.modname !== "quiz" || !module.instance) return { resourceLinks: [], files: [] };
	const attempts = await client.getFinishedQuizAttempts(module.instance, userId);
	const files: QuizMarkdownNote[] = [];
	for (const attempt of attempts) {
		const review = await client.getQuizAttemptReview(attempt.id);
		files.push({ destPath: `${moduleFolder}/attempt-${attempt.id}.md`, text: renderQuizAttempt(module, attempt, review) });
	}
	return { resourceLinks: files.map(file => `- [[${file.destPath.slice(0, -3)}]]`), files };
}

export function renderQuizAttempt(module: QuizModule, attempt: QuizAttempt, review: QuizReview): string {
	const title = module.name ?? `Quiz ${module.id}`;
	const meta = [
		["Attempt ID", String(attempt.id)],
		["State", display(attempt.state ?? attempt.status)],
		["Finished", formatTimestamp(attempt.timefinish)],
		["Started", formatTimestamp(attempt.timestart)],
		["Grade", display(attempt.sumgrades ?? review.grade ?? review.sumgrades)],
		["Review URL", module.url ?? ""]
	].filter(([, value]) => value).map(([label, value]) => `- ${label}: ${value}`);
	const sections = [
		`# ${title} — attempt ${attempt.id}`,
		meta.join("\n"),
		renderHtmlSection("Quiz description", module.description),
		renderHtmlSection("Summary", review.summary ?? review.feedback ?? review.overallfeedback),
		renderQuestions(review.questions)
	].filter(Boolean);
	if (!review.summary && !review.feedback && !review.overallfeedback && !review.questions?.length) {
		sections.push("## Attempt data\n\nNo detailed review content was returned by Moodle.");
	}
	return sections.join("\n\n").replace(/\s+$/, "") + "\n";
}

function renderQuestions(questions: QuizQuestion[] | undefined): string {
	if (!questions?.length) return "";
	const rendered = questions.map((question, index) => {
		const html = question.html ?? question.questionhtml ?? question.feedback;
		return html?.trim() ? `### Question ${index + 1}\n\n${renderMoodleHtml(html)}` : "";
	}).filter(Boolean);
	return rendered.length ? `## Questions\n\n${rendered.join("\n\n")}` : "";
}

function renderHtmlSection(title: string, html: string | undefined): string {
	return html?.trim() ? `## ${title}\n\n${renderMoodleHtml(html)}` : "";
}

function display(value: MoodleDisplayValue | undefined): string {
	return value === undefined ? "" : String(value).trim();
}

function formatTimestamp(seconds: number | undefined): string {
	return seconds && seconds > 0 ? new Date(seconds * 1000).toISOString() : "";
}