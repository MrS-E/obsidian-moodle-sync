import { MoodleApi } from "../api/moodleApi";
import { RemoteCourse, RemoteQuizAttempt, RemoteSyncData } from "../domain/models";

export class RemoteDiscovery {
	constructor(private readonly api: MoodleApi) {}

	async discover(): Promise<RemoteSyncData> {
		const site = await this.api.getSiteInfo();
		const courses = await this.api.getEnrolledCourses(site.userid);
		const discoveredCourses: RemoteCourse[] = [];

		for (const course of courses) {
			const sections = await this.api.getCourseContents(course.id);
			const quizAttempts = new Map<number, RemoteQuizAttempt[]>();
			for (const section of sections) {
				for (const module of section.modules ?? []) {
					if (module.modname !== "quiz" || !module.instance) continue;
					const attempts = await this.api.getFinishedQuizAttempts(module.instance, site.userid);
					const reviews = await Promise.all(attempts.map(async attempt => ({
						attempt,
						review: await this.api.getQuizAttemptReview(attempt.id)
					})));
					quizAttempts.set(module.id, reviews);
				}
			}
			discoveredCourses.push({ course, sections, quizAttempts });
		}

		return { site, courses: discoveredCourses };
	}
}