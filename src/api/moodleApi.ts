import { MoodleArgs, MoodleTransport } from "./contracts";
import {
	decodeCourseContents,
	decodeCourses,
	decodeQuizAttempts,
	decodeQuizReview,
	decodeSiteInfo,
	MoodleResponseError
} from "./decoders";
import { Course, CourseSection, QuizAttempt, QuizReview, SiteInfo } from "../domain/models";

export interface MoodleApi {
	getSiteInfo(): Promise<SiteInfo>;
	getEnrolledCourses(userId: number): Promise<Course[]>;
	getCourseContents(courseId: number): Promise<CourseSection[]>;
	getFinishedQuizAttempts(quizId: number, userId: number): Promise<QuizAttempt[]>;
	getQuizAttemptReview(attemptId: number): Promise<QuizReview>;
	downloadResource(url: string): Promise<ArrayBuffer>;
}

export class MoodleWebServiceApi implements MoodleApi {
	constructor(private readonly transport: MoodleTransport) {}

	async getSiteInfo(): Promise<SiteInfo> {
		return this.call("core_webservice_get_site_info", {}, decodeSiteInfo);
	}

	async getEnrolledCourses(userId: number): Promise<Course[]> {
		return this.call("core_enrol_get_users_courses", { userid: userId }, decodeCourses);
	}

	async getCourseContents(courseId: number): Promise<CourseSection[]> {
		return this.call("core_course_get_contents", { courseid: courseId }, decodeCourseContents);
	}

	async getFinishedQuizAttempts(quizId: number, userId: number): Promise<QuizAttempt[]> {
		const calls: MoodleArgs[] = [
			{ quizid: quizId, userid: userId, status: "finished", includepreviews: 0 },
			{ quizid: quizId, userid: userId, status: "finished" },
			{ quizid: quizId, status: "finished", includepreviews: 0 },
			{ quizid: quizId, status: "finished" }
		];
		const attempts = await this.callWithFallback(
			"mod_quiz_get_user_attempts",
			calls,
			decodeQuizAttempts,
			`quiz ${quizId} and user ${userId}`
		);
		return attempts.filter(isFinishedAttempt);
	}

	async getQuizAttemptReview(attemptId: number): Promise<QuizReview> {
		return this.callWithFallback(
			"mod_quiz_get_attempt_review",
			[
				{ attemptid: attemptId, page: -1 },
				{ attemptid: attemptId, page: 0 },
				{ attemptid: attemptId }
			],
			decodeQuizReview,
			`attempt ${attemptId}`
		);
	}

	async downloadResource(url: string): Promise<ArrayBuffer> {
		try {
			return await this.transport.download(url);
		} catch (error) {
			throw new Error(`Moodle resource download failed: ${errorMessage(error)}`);
		}
	}

	private async call<T>(endpoint: string, args: MoodleArgs, decoder: (value: unknown) => T): Promise<T> {
		try {
			return decoder(await this.transport.call(endpoint, args));
		} catch (error) {
			if (error instanceof MoodleResponseError) {
				throw error;
			}
			throw new Error(`Moodle API ${endpoint} failed: ${errorMessage(error)}`);
		}
	}

	private async callWithFallback<T>(
		endpoint: string,
		calls: MoodleArgs[],
		decoder: (value: unknown) => T,
		context: string
	): Promise<T> {
		let lastError: unknown;
		for (const args of calls) {
			try {
				return await this.call(endpoint, args, decoder);
			} catch (error) {
				lastError = error;
			}
		}
		throw new Error(`Moodle API ${endpoint} failed for ${context} after signature fallbacks: ${errorMessage(lastError)}`);
	}
}

function isFinishedAttempt(attempt: QuizAttempt): boolean {
	const state = (attempt.state ?? attempt.status ?? "").toLowerCase();
	return state.includes("finished") || state.includes("overdue") || (attempt.timefinish ?? 0) > 0;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}