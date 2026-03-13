import { convertHtmlToMarkdown } from "./htmlToMarkdown";
import { renderSimplePdf } from "./pdf";
import { join, safeName } from "./util";

export interface QuizModuleLike {
	id: number;
	instance?: number;
	name?: string;
	modname?: string;
	url?: string;
	description?: string;
}

export interface QuizGeneratedFile {
	destPath: string;
	format: "text" | "binary";
	text?: string;
	data?: ArrayBuffer;
}

export interface QuizExportPlan {
	resourceLinks: string[];
	files: QuizGeneratedFile[];
}

interface MoodleClientLike {
	call<T>(wsfunction: string, args?: Record<string, unknown>): Promise<T>;
}

type QuizAttempt = Record<string, unknown>;

export async function planQuizExports(
	client: MoodleClientLike,
	courseResFolder: string,
	mod: QuizModuleLike,
	userId: number
): Promise<QuizExportPlan> {
	if (mod.modname !== "quiz" || !mod.instance) {
		return { resourceLinks: [], files: [] };
	}

	const attempts = await loadFinishedAttempts(client, mod.instance, userId);
	if (attempts.length === 0) {
		return { resourceLinks: [], files: [] };
	}

	const modFolder = join(courseResFolder, safeName(mod.name ?? `quiz-${mod.id}`));
	const files: QuizGeneratedFile[] = [];
	const resourceLinks: string[] = [];

	for (const attempt of attempts) {
		const attemptId = Number(attempt.id);
		if (!Number.isFinite(attemptId)) continue;

		const review = await loadAttemptReview(client, attemptId);
		const html = buildAttemptHtml(mod, attempt, review);
		const text = convertHtmlToMarkdown(html);

		const basePath = join(modFolder, `attempt-${attemptId}`);
		const htmlPath = `${basePath}.html`;
		const pdfPath = `${basePath}.pdf`;

		files.push({ destPath: htmlPath, format: "text", text: html });
		files.push({ destPath: pdfPath, format: "binary", data: renderSimplePdf(text) });

		resourceLinks.push(`- ![[${pdfPath}]]`);
		resourceLinks.push(`- [[${htmlPath}]]`);
	}

	return { resourceLinks, files };
}

async function loadFinishedAttempts(
	client: MoodleClientLike,
	quizId: number,
	userId: number
): Promise<QuizAttempt[]> {
	const calls: Array<Record<string, unknown>> = [
		{ quizid: quizId, userid: userId, status: "finished", includepreviews: 0 },
		{ quizid: quizId, userid: userId, status: "finished" },
		{ quizid: quizId, status: "finished", includepreviews: 0 },
		{ quizid: quizId, status: "finished" }
	];

	for (const args of calls) {
		try {
			const response = await client.call<Record<string, unknown> | QuizAttempt[]>("mod_quiz_get_user_attempts", args);
			const attempts = normalizeAttempts(response);
			if (attempts.length > 0) return attempts.filter(isFinishedAttempt);
			return [];
		} catch {
			// Try the next signature variant.
		}
	}

	return [];
}

async function loadAttemptReview(client: MoodleClientLike, attemptId: number): Promise<Record<string, unknown>> {
	const calls: Array<Record<string, unknown>> = [
		{ attemptid: attemptId, page: -1 },
		{ attemptid: attemptId, page: 0 },
		{ attemptid: attemptId }
	];

	for (const args of calls) {
		try {
			return await client.call<Record<string, unknown>>("mod_quiz_get_attempt_review", args);
		} catch {
			// Try the next signature variant.
		}
	}

	return {};
}

function normalizeAttempts(response: Record<string, unknown> | QuizAttempt[]): QuizAttempt[] {
	if (Array.isArray(response)) return response;
	const nested = response.attempts;
	return Array.isArray(nested) ? nested.filter((item): item is QuizAttempt => !!item && typeof item === "object") : [];
}

function isFinishedAttempt(attempt: QuizAttempt): boolean {
	const state = String(attempt.state ?? attempt.status ?? "").toLowerCase();
	const timeFinish = Number(attempt.timefinish ?? 0);
	return state.includes("finished") || state.includes("overdue") || timeFinish > 0;
}

function buildAttemptHtml(
	mod: QuizModuleLike,
	attempt: QuizAttempt,
	review: Record<string, unknown>
): string {
	const title = escapeHtml(mod.name ?? `Quiz ${mod.id}`);
	const metaLines = [
		renderMeta("Attempt ID", String(attempt.id ?? "")),
		renderMeta("State", String(attempt.state ?? attempt.status ?? "")),
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
		"body{font-family:Arial,sans-serif;line-height:1.5;margin:32px;color:#111;}",
		"h1,h2{line-height:1.2;}",
		".meta{margin:0 0 24px;padding:16px;background:#f4f4f4;border:1px solid #ddd;border-radius:8px;}",
		".meta p{margin:4px 0;}",
		".question{margin:0 0 24px;padding:16px;border:1px solid #ddd;border-radius:8px;}",
		"img{max-width:100%;height:auto;}",
		"pre{white-space:pre-wrap;word-break:break-word;background:#f8f8f8;padding:12px;border-radius:6px;}",
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

function renderQuestions(value: unknown): string {
	if (!Array.isArray(value) || value.length === 0) return "";

	const items = value
		.map((question, index) => {
			if (!question || typeof question !== "object") return "";
			const html = firstHtmlString(
				(question as Record<string, unknown>).html,
				(question as Record<string, unknown>).questionhtml,
				(question as Record<string, unknown>).feedback
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
		if (value === undefined || value === null) continue;
		const trimmed = String(value).trim();
		if (trimmed) return trimmed;
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
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
