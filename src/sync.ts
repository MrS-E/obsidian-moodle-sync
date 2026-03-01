import { App, Notice, TFile, TFolder, normalizePath } from "obsidian";
import { MoodleClient } from "./moodleClient";
import { SyncState } from "./state";
import { createLimiter, isEmbeddableMedia, join, nowStamp, safeName, simpleHash } from "./util";

type MoodleCourse = { id: number; fullname?: string; shortname?: string };
type MoodleSection = { id: number; name?: string; section?: number; modules?: MoodleModule[] };
type MoodleModule = {
	id: number;
	name?: string;
	modname?: string;
	url?: string;
	description?: string;
	contents?: MoodleContent[];
};
type MoodleContent = {
	type: string;        // "file"
	filename: string;
	fileurl: string;
	filepath?: string;
	timemodified?: number;
	filesize?: number;
};

export async function runSync(app: App, client: MoodleClient, settings: {
	rootFolder: string;
	resourcesFolder: string;
	concurrency: number;
}, state: SyncState, saveState: (s: SyncState) => Promise<void>) {
	const limiter = createLimiter(Math.max(1, settings.concurrency));

	await ensureFolder(app, settings.rootFolder);
	await ensureFolder(app, settings.resourcesFolder);

	const site = await client.call<any>("core_webservice_get_site_info");
	const userId = site.userid;

	new Notice(`Moodle Sync PoC: user ${site.username ?? userId}`);

	const courses = await client.call<MoodleCourse[]>("core_enrol_get_users_courses", { userid: userId });

	for (const course of courses) {
		await syncCourse(app, client, settings, state, saveState, limiter, course);
	}

	await saveState(state);
	new Notice("Moodle Sync PoC: done");
}

async function syncCourse(
	app: App,
	client: MoodleClient,
	settings: { rootFolder: string; resourcesFolder: string; concurrency: number },
	state: SyncState,
	saveState: (s: SyncState) => Promise<void>,
	limiter: <T>(fn: () => Promise<T>) => Promise<T>,
	course: MoodleCourse
) {
	const courseId = String(course.id);
	const courseName = safeName(course.fullname ?? course.shortname ?? `Course ${courseId}`);

	const courseFolder = join(settings.rootFolder, `${courseName} (${courseId})`);
	const courseResFolder = join(settings.resourcesFolder, `${courseName} (${courseId})`);

	await ensureFolder(app, courseFolder);
	await ensureFolder(app, courseResFolder);

	const sections = await client.call<MoodleSection[]>("core_course_get_contents", { courseid: course.id });

	// index note
	const indexPath = join(courseFolder, `_index.md`);
	const indexMd = renderCourseIndex(courseName, courseId, sections);
	await upsertNoteWithCrudeConflict(app, state, indexPath, indexMd);

	// collect downloads
	const downloadJobs: Array<Promise<void>> = [];

	for (const section of sections ?? []) {
		for (const mod of section.modules ?? []) {
			const modName = safeName(mod.name ?? `${mod.modname ?? "module"}-${mod.id}`);
			const modNotePath = join(courseFolder, `${modName}.md`);

			const { noteMd, filesToDownload } = planModule(courseResFolder, section, mod);

			await upsertNoteWithCrudeConflict(app, state, modNotePath, noteMd);

			for (const f of filesToDownload) {
				downloadJobs.push(limiter(async () => {
					const should = shouldDownload(state, f.destPath, f.timemodified, f.filesize);
					if (!should) return;

					const buf = await client.downloadFile(f.fileurl);
					await writeBinary(app, f.destPath, buf);

					state.files[f.destPath] = { timemodified: f.timemodified, filesize: f.filesize };
				}));
			}
		}
	}

	// Run downloads
	await Promise.allSettled(downloadJobs);
	await saveState(state);
}

function planModule(courseResFolder: string, section: MoodleSection, mod: MoodleModule) {
	const modName = safeName(mod.name ?? `${mod.modname ?? "module"}-${mod.id}`);
	const filesToDownload: Array<{
		destPath: string;
		fileurl: string;
		timemodified?: number;
		filesize?: number;
		filename: string;
	}> = [];

	const links: string[] = [];
	for (const c of mod.contents ?? []) {
		if (c.type !== "file") continue;

		const filepath = (c.filepath ?? "/").replace(/^\/+/, ""); // remove leading /
		const filename = safeName(c.filename);

		const destDir = join(courseResFolder, modName, filepath);
		const destPath = normalizePath(`${destDir}/${filename}`);

		filesToDownload.push({
			destPath,
			fileurl: c.fileurl,
			timemodified: c.timemodified,
			filesize: c.filesize,
			filename
		});

		links.push(isEmbeddableMedia(filename) ? `- ![[${destPath}]]` : `- [[${destPath}]]`);
	}

	const noteMd = renderModuleNote(section, mod, links);
	return { noteMd, filesToDownload };
}

function renderCourseIndex(courseName: string, courseId: string, sections: MoodleSection[]): string {
	const lines: string[] = [];
	lines.push(`# ${courseName}`);
	lines.push("");
	lines.push(`- Moodle course id: \`${courseId}\``);
	lines.push("");
	for (const s of sections ?? []) {
		lines.push(`## ${s.name ?? `Section ${s.section ?? ""}`}`.trim());
		for (const m of s.modules ?? []) {
			const n = safeName(m.name ?? `${m.modname ?? "module"}-${m.id}`);
			lines.push(`- [[${n}]]`);
		}
		lines.push("");
	}
	return lines.join("\n");
}

function renderModuleNote(section: MoodleSection, mod: MoodleModule, resourceLinks: string[]): string {
	const md: string[] = [];
	md.push(`# ${mod.name ?? "Untitled"}`);
	md.push("");
	md.push(`- Type: \`${mod.modname ?? "unknown"}\``);
	md.push(`- Section: ${section.name ?? section.section ?? ""}`);
	if (mod.url) md.push(`- URL: ${mod.url}`);
	md.push("");

	if (mod.description) {
		md.push(`## Content (raw HTML)`);
		md.push("");
		md.push("```html");
		md.push(mod.description);
		md.push("```");
		md.push("");
	}

	if (resourceLinks.length) {
		md.push(`## Resources`);
		md.push("");
		md.push(resourceLinks.join("\n"));
		md.push("");
	}

	md.push(`---`);
	md.push(`_Synced by Moodle Sync PoC_`);
	return md.join("\n");
}

async function upsertNoteWithCrudeConflict(app: App, state: SyncState, path: string, remoteText: string) {
	const af = app.vault.getAbstractFileByPath(path);

	if (!af) {
		await app.vault.create(path, remoteText);
		state.notes[path] = { lastSyncedHash: simpleHash(remoteText) };
		return;
	}
	if (!(af instanceof TFile)) return;

	const currentLocal = await app.vault.read(af);
	const localHash = simpleHash(currentLocal);
	const remoteHash = simpleHash(remoteText);

	const prev = state.notes[path];
	const lastSyncedHash = prev?.lastSyncedHash;

	// If remote equals current local, just update state
	if (localHash === remoteHash) {
		state.notes[path] = { lastSyncedHash: remoteHash };
		return;
	}

	// If local unchanged since last sync, overwrite with remote
	if (lastSyncedHash && localHash === lastSyncedHash) {
		await app.vault.modify(af, remoteText);
		state.notes[path] = { lastSyncedHash: remoteHash };
		return;
	}

	// Conflict: keep both (timestamped)
	const stamped = path.replace(/\.md$/, `.${nowStamp()}.md`);
	// Save the current local as stamped copy, then write remote to original
	await app.vault.create(stamped, currentLocal);
	await app.vault.modify(af, remoteText);

	state.notes[path] = { lastSyncedHash: remoteHash };
}

function shouldDownload(state: SyncState, destPath: string, timemodified?: number, filesize?: number): boolean {
	const prev = state.files[destPath];
	if (!prev) return true;

	if (timemodified && prev.timemodified && timemodified > prev.timemodified) return true;
	if (filesize && prev.filesize && filesize !== prev.filesize) return true;

	return false;
}

async function ensureFolder(app: App, folderPath: string) {
	const f = app.vault.getAbstractFileByPath(folderPath);
	if (!f) return app.vault.createFolder(folderPath);
	if (!(f instanceof TFolder)) throw new Error(`${folderPath} exists but is not a folder`);
}

async function writeBinary(app: App, path: string, data: ArrayBuffer) {
	// ensure parent folder exists
	const parts = path.split("/");
	parts.pop();
	const dir = parts.join("/");
	if (dir) await ensureFolder(app, dir);

	const existing = app.vault.getAbstractFileByPath(path);
	if (!existing) {
		await app.vault.createBinary(path, data);
		return;
	}
	if (existing instanceof TFile) {
		await app.vault.modifyBinary(existing, data);
	}
}
