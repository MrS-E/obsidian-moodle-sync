export interface SiteInfo {
	userid: number;
	sitename?: string;
	username?: string;
}

export interface Course {
	id: number;
	fullname?: string;
	shortname?: string;
}

export interface CourseSection {
	id: number;
	name?: string;
	section?: number;
	modules?: CourseModule[];
}

export interface CourseModule {
	id: number;
	instance?: number;
	name?: string;
	modname?: string;
	url?: string;
	description?: string;
	contents?: CourseContent[];
}

export interface FileContent {
	type: "file";
	id?: number;
	filename: string;
	fileurl: string;
	filepath?: string;
	timemodified?: number;
	filesize?: number;
}

export interface OtherContent {
	type: string;
}

export type CourseContent = FileContent | OtherContent;

export function isFileContent(content: CourseContent): content is FileContent {
	return content.type === "file";
}

export type MoodleDisplayValue = string | number | boolean;

export interface QuizAttempt {
	id: number;
	state?: string;
	status?: string;
	timefinish?: number;
	timestart?: number;
	sumgrades?: MoodleDisplayValue;
}

export interface QuizQuestion {
	html?: string;
	questionhtml?: string;
	feedback?: string;
}

export interface QuizReview {
	grade?: MoodleDisplayValue;
	sumgrades?: MoodleDisplayValue;
	summary?: string;
	feedback?: string;
	overallfeedback?: string;
	questions?: QuizQuestion[];
}

export interface RemoteQuizAttempt {
	attempt: QuizAttempt;
	review: QuizReview;
	reviewError?: string;
}

export interface RemoteCourse {
	course: Course;
	sections: CourseSection[];
	quizAttempts: Map<number, RemoteQuizAttempt[]>;
}

export interface RemoteSyncData {
	site: SiteInfo;
	courses: RemoteCourse[];
}