import { CourseModule, MoodleDisplayValue, QuizAttempt, QuizQuestion, QuizReview, RemoteQuizAttempt } from "../domain/models";
import { renderMoodleHtml } from "./htmlToMarkdown";

export interface QuizMarkdownNote {
	destPath: string;
	text: string;
}

export interface QuizAttemptPlan {
	resourceLinks: string[];
	files: QuizMarkdownNote[];
}

type QuizModule = Pick<CourseModule, "id" | "instance" | "name" | "modname" | "url" | "description">;

export function renderQuizAttemptNotes(
	moduleFolder: string,
	module: QuizModule,
	attempts: RemoteQuizAttempt[]
): QuizAttemptPlan {
	const files: QuizMarkdownNote[] = [];
	for (const { attempt, review, reviewError } of attempts) {
		files.push({ destPath: `${moduleFolder}/attempt-${attempt.id}.md`, text: renderQuizAttempt(module, attempt, review, reviewError) });
	}
	return { resourceLinks: files.map(file => `- [[${file.destPath.slice(0, -3)}]]`), files };
}

export function renderQuizAttempt(module: QuizModule, attempt: QuizAttempt, review: QuizReview, reviewError?: string): string {
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
		renderQuestions(review.questions),
		reviewError ? renderReviewError(reviewError) : ""
	].filter(Boolean);
	if (!reviewError && !review.summary && !review.feedback && !review.overallfeedback && !review.questions?.length) {
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

function renderReviewError(error: string): string {
	const message = error.trim() || "Moodle did not provide an error message.";
	const longestBacktickRun = Math.max(2, ...(message.match(/`+/g) ?? []).map(match => match.length));
	const fence = "`".repeat(longestBacktickRun + 1);
	return `## Review unavailable\n\nMoodle did not return the detailed review for this attempt.\n\n${fence}text\n${message}\n${fence}`;
}

function display(value: MoodleDisplayValue | undefined): string {
	return value === undefined ? "" : String(value).trim();
}

function formatTimestamp(seconds: number | undefined): string {
	return seconds && seconds > 0 ? new Date(seconds * 1000).toISOString() : "";
}