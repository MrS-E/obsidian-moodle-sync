import { MoodleApi } from "./api/moodleApi";
import { CourseModule, QuizAttempt, QuizQuestion, QuizReview } from "./domain/models";

export type QuizModuleLike = Pick<CourseModule, "id" | "instance" | "name" | "modname" | "url" | "description">;

export interface QuizGeneratedFile {
	destPath: string;
	format: "text" | "pdf-from-html";
	text?: string;
	html?: string;
}

export interface QuizExportPlan {
	resourceLinks: string[];
	files: QuizGeneratedFile[];
}

type StringableValue = string | number | boolean | bigint;
type QuizApi = Pick<MoodleApi, "getFinishedQuizAttempts" | "getQuizAttemptReview">;

export async function planQuizExports(
	client: QuizApi,
	moduleResourceFolder: string,
	mod: QuizModuleLike,
	userId: number
): Promise<QuizExportPlan> {
	if (mod.modname !== "quiz" || !mod.instance) {
		return { resourceLinks: [], files: [] };
	}

	const attempts = await client.getFinishedQuizAttempts(mod.instance, userId);
	if (attempts.length === 0) {
		return { resourceLinks: [], files: [] };
	}

	const files: QuizGeneratedFile[] = [];
	const resourceLinks: string[] = [];

	for (const attempt of attempts) {
		const attemptId = attempt.id;

		const review = await client.getQuizAttemptReview(attemptId);
		const html = sanitizeQuizHtml(buildAttemptHtml(mod, attempt, review));

		const basePath = `${moduleResourceFolder}/attempt-${attemptId}`;
		const htmlPath = `${basePath}.html`;
		const pdfPath = `${basePath}.pdf`;

		files.push({ destPath: htmlPath, format: "text", text: html });
		files.push({ destPath: pdfPath, format: "pdf-from-html", html });

		resourceLinks.push(`- ![[${pdfPath}]]`);
		resourceLinks.push(`- [[${htmlPath}]]`);
	}

	return { resourceLinks, files };
}

function buildAttemptHtml(
	mod: QuizModuleLike,
	attempt: QuizAttempt,
	review: QuizReview
): string {
	const title = escapeHtml(mod.name ?? `Quiz ${mod.id}`);
	const metaLines = [
		renderMeta("Attempt ID", firstDefinedString(attempt.id)),
		renderMeta("State", firstDefinedString(attempt.state, attempt.status)),
		renderMeta("Finished", formatTimestamp(attempt.timefinish)),
		renderMeta("Started", formatTimestamp(attempt.timestart)),
		renderMeta("Grade", firstDefinedString(attempt.sumgrades, review.grade, review.sumgrades)),
		renderMeta("Review URL", mod.url ?? "")
	].filter(Boolean).join("");

	const introHtml = wrapSection("Quiz description", mod.description ?? "");
	const summaryHtml = wrapSection("Summary", firstHtmlString(review.summary, review.feedback, review.overallfeedback));
	const questionsHtml = renderQuestions(review.questions);
	const fallbackHtml = (!summaryHtml && !questionsHtml)
		? wrapSection("Attempt data", `<pre>${escapeHtml(JSON.stringify(review, null, 2))}</pre>`)
		: "";

	return [
		"<!doctype html>",
		"<html>",
		"<head>",
		"<meta charset=\"utf-8\">",
		`<title>${title}</title>`,
		"<style>",
		"@page{size:A4;margin:12mm;}",
		"body{font-family:Arial,sans-serif;line-height:1.5;margin:32px;color:#111;}",
		"h1,h2{line-height:1.2;}",
		".meta{margin:0 0 24px;padding:16px;background:#f4f4f4;border:1px solid #ddd;border-radius:8px;}",
		".meta p{margin:4px 0;}",
		".question{margin:0 0 24px;padding:16px;border:1px solid #ddd;border-radius:8px;}",
		".questionflagimage{display:none !important;}",
		"img{max-width:100%;height:auto;}",
		"pre{white-space:pre-wrap;word-break:break-word;background:#f8f8f8;padding:12px;border-radius:6px;}",
		".textarea-render{white-space:pre-wrap;word-break:break-word;min-height:3em;padding:12px;border:1px solid #bbb;border-radius:6px;background:#fff;}",
		"</style>",
		"</head>",
		"<body>",
		`<h1>${title}</h1>`,
		`<section class="meta">${metaLines}</section>`,
		introHtml,
		summaryHtml,
		questionsHtml,
		fallbackHtml,
		"</body>",
		"</html>"
	].join("");
}

function renderQuestions(value: QuizQuestion[] | undefined): string {
	if (!value || value.length === 0) return "";

	const items = value
		.map((question, index) => {
			const html = firstHtmlString(
				question.html,
				question.questionhtml,
				question.feedback
			);
			if (!html) return "";
			return `<section class="question"><h2>Question ${index + 1}</h2>${html}</section>`;
		})
		.filter(Boolean)
		.join("");

	return items ? `<section><h2>Questions</h2>${items}</section>` : "";
}

function renderMeta(label: string, value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "";
	return `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(trimmed)}</p>`;
}

function wrapSection(title: string, html: string): string {
	const trimmed = html.trim();
	if (!trimmed) return "";
	return `<section><h2>${escapeHtml(title)}</h2>${trimmed}</section>`;
}

function firstHtmlString(...values: unknown[]): string {
	for (const value of values) {
		if (typeof value !== "string") continue;
		const trimmed = value.trim();
		if (trimmed) return trimmed;
	}
	return "";
}

function firstDefinedString(...values: unknown[]): string {
	for (const value of values) {
		const trimmed = toDisplayString(value);
		if (trimmed) return trimmed;
	}
	return "";
}

function toDisplayString(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return String(value satisfies StringableValue).trim();
	}
	return "";
}

function formatTimestamp(value: unknown): string {
	const seconds = Number(value ?? 0);
	if (!Number.isFinite(seconds) || seconds <= 0) return "";
	return new Date(seconds * 1000).toISOString();
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function sanitizeQuizHtml(html: string): string {
	const doc = new DOMParser().parseFromString(html, "text/html");
	doc.querySelectorAll("img.questionflagimage").forEach((el) => el.remove());
	doc.querySelectorAll("textarea").forEach((el) => {
		const replacement = doc.createElement("div");
		replacement.className = "textarea-render";
		replacement.textContent = el.textContent ?? "";

		const labelledBy = el.getAttribute("aria-label")?.trim();
		if (labelledBy) replacement.setAttribute("aria-label", labelledBy);

		el.replaceWith(replacement);
	});
	return "<!doctype html>\n" + doc.documentElement.outerHTML;
}
