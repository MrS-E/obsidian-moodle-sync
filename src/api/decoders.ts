import {
	Course,
	CourseContent,
	CourseModule,
	CourseSection,
	FileContent,
	MoodleDisplayValue,
	QuizAttempt,
	QuizQuestion,
	QuizReview,
	SiteInfo
} from "../domain/models";

export class MoodleResponseError extends Error {
	constructor(endpoint: string, detail: string) {
		super(`Invalid response from ${endpoint}: ${detail}`);
		this.name = "MoodleResponseError";
	}
}

export function decodeSiteInfo(value: unknown): SiteInfo {
	const endpoint = "core_webservice_get_site_info";
	const response = requiredRecord(value, endpoint, "expected an object");
	return {
		userid: requiredNumber(response.userid, endpoint, "userid must be a finite number"),
		sitename: optionalString(response.sitename),
		username: optionalString(response.username)
	};
}

export function decodeCourses(value: unknown): Course[] {
	const endpoint = "core_enrol_get_users_courses";
	if (!Array.isArray(value)) {
		throw invalid(endpoint, "expected an array of courses");
	}
	return value.map((course, index) => decodeCourse(course, endpoint, index));
}

export function decodeCourseContents(value: unknown): CourseSection[] {
	const endpoint = "core_course_get_contents";
	if (!Array.isArray(value)) {
		throw invalid(endpoint, "expected an array of sections");
	}
	return value.map((section, index) => decodeSection(section, endpoint, index));
}

export function decodeQuizAttempts(value: unknown): QuizAttempt[] {
	const endpoint = "mod_quiz_get_user_attempts";
	const attempts = Array.isArray(value)
		? value
		: isRecord(value) && Array.isArray(value.attempts)
			? value.attempts
			: null;
	if (!attempts) {
		throw invalid(endpoint, "expected an attempts array");
	}

	return attempts.map((attempt, index) => {
		const record = requiredRecord(attempt, endpoint, `attempt ${index} must be an object`);
		return {
			id: requiredNumber(record.id, endpoint, `attempt ${index}.id must be a finite number`),
			state: optionalString(record.state),
			status: optionalString(record.status),
			timefinish: optionalNumber(record.timefinish),
			timestart: optionalNumber(record.timestart),
			sumgrades: optionalDisplayValue(record.sumgrades)
		};
	});
}

export function decodeQuizReview(value: unknown): QuizReview {
	const endpoint = "mod_quiz_get_attempt_review";
	const response = requiredRecord(value, endpoint, "expected an object");
	return {
		grade: optionalDisplayValue(response.grade),
		sumgrades: optionalDisplayValue(response.sumgrades),
		summary: optionalString(response.summary),
		feedback: optionalString(response.feedback),
		overallfeedback: optionalString(response.overallfeedback),
		questions: Array.isArray(response.questions)
			? response.questions.reduce<QuizQuestion[]>((questions, question) => {
				questions.push(...decodeQuizQuestion(question));
				return questions;
			}, [])
			: undefined
	};
}

function decodeCourse(value: unknown, endpoint: string, index: number): Course {
	const course = requiredRecord(value, endpoint, `course ${index} must be an object`);
	return {
		id: requiredNumber(course.id, endpoint, `course ${index}.id must be a finite number`),
		fullname: optionalString(course.fullname),
		shortname: optionalString(course.shortname)
	};
}

function decodeSection(value: unknown, endpoint: string, index: number): CourseSection {
	const section = requiredRecord(value, endpoint, `section ${index} must be an object`);
	return {
		id: requiredNumber(section.id, endpoint, `section ${index}.id must be a finite number`),
		name: optionalString(section.name),
		section: optionalNumber(section.section),
		modules: Array.isArray(section.modules)
			? section.modules.map((module, moduleIndex) => decodeModule(module, endpoint, index, moduleIndex))
			: undefined
	};
}

function decodeModule(value: unknown, endpoint: string, sectionIndex: number, moduleIndex: number): CourseModule {
	const module = requiredRecord(value, endpoint, `section ${sectionIndex}.modules[${moduleIndex}] must be an object`);
	return {
		id: requiredNumber(module.id, endpoint, `section ${sectionIndex}.modules[${moduleIndex}].id must be a finite number`),
		instance: optionalNumber(module.instance),
		name: optionalString(module.name),
		modname: optionalString(module.modname),
		url: optionalString(module.url),
		description: optionalString(module.description),
		contents: Array.isArray(module.contents)
			? module.contents.map((content, contentIndex) => decodeContent(content, endpoint, sectionIndex, moduleIndex, contentIndex))
			: undefined
	};
}

function decodeContent(
	value: unknown,
	endpoint: string,
	sectionIndex: number,
	moduleIndex: number,
	contentIndex: number
): CourseContent {
	const location = `section ${sectionIndex}.modules[${moduleIndex}].contents[${contentIndex}]`;
	const content = requiredRecord(value, endpoint, `${location} must be an object`);
	const type = requiredString(content.type, endpoint, `${location}.type must be a non-empty string`);
	if (type !== "file") {
		return { type };
	}

	return {
		type: "file",
		id: optionalNumber(content.id),
		filename: requiredString(content.filename, endpoint, `${location}.filename must be a non-empty string`),
		fileurl: requiredString(content.fileurl, endpoint, `${location}.fileurl must be a non-empty string`),
		filepath: optionalString(content.filepath),
		timemodified: optionalNumber(content.timemodified),
		filesize: optionalNumber(content.filesize)
	} satisfies FileContent;
}

function decodeQuizQuestion(value: unknown): QuizQuestion[] {
	if (!isRecord(value)) {
		return [];
	}
	return [{
		html: optionalString(value.html),
		questionhtml: optionalString(value.questionhtml),
		feedback: optionalString(value.feedback)
	}];
}

function requiredRecord(value: unknown, endpoint: string, detail: string): Record<string, unknown> {
	if (!isRecord(value)) {
		throw invalid(endpoint, detail);
	}
	return value;
}

function requiredNumber(value: unknown, endpoint: string, detail: string): number {
	if (!isFiniteNumber(value)) {
		throw invalid(endpoint, detail);
	}
	return value;
}

function requiredString(value: unknown, endpoint: string, detail: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw invalid(endpoint, detail);
	}
	return value;
}

function optionalNumber(value: unknown): number | undefined {
	if (isFiniteNumber(value)) {
		return value;
	}
	if (typeof value === "string" && value.trim().length > 0) {
		const number = Number(value);
		return Number.isFinite(number) ? number : undefined;
	}
	return undefined;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function optionalDisplayValue(value: unknown): MoodleDisplayValue | undefined {
	return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
		? value
		: undefined;
}

function invalid(endpoint: string, detail: string): MoodleResponseError {
	return new MoodleResponseError(endpoint, detail);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}