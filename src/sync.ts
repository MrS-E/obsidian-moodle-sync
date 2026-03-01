import { App, Notice, TFile, TFolder, normalizePath } from "obsidian";
import { MoodleClient } from "./moodleClient";
import { SyncState } from "./state";
import { createLimiter, formatBytes, isEmbeddableMedia, join, nowStamp, safeName, simpleHash } from "./util";

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

export type SyncMode = "apply" | "dry-run";

export interface SyncProgress {
	setStatus(text: string): void;
	tick(): void;
	totalSteps: number;
}

type PlanAction =
	| { kind: "ensure-folder"; path: string }
	| { kind: "note-create"; path: string; text: string }
	| { kind: "note-update"; path: string; text: string }
	| { kind: "note-conflict-keep-both"; path: string; remoteText: string }
	| { kind: "file-download"; destPath: string; fileurl: string; timemodified?: number; filesize?: number }
	| { kind: "file-skip"; destPath: string };

interface SyncPlan {
	mode: SyncMode;
	actions: PlanAction[];
	summary: {
		courses: number;
		notesCreate: number;
		notesUpdate: number;
		noteConflicts: number;
		filesDownload: number;
		filesSkip: number;
		bytesToDownload: number;
	};
	meta: {
		username?: string;
		userid?: number;
		sitename?: string;
	};
}

export async function runSyncV2(
	app: App,
	client: MoodleClient,
	settings: {
		rootFolder: string;
		resourcesFolder: string;
		concurrency: number;
		writeLogFile: boolean;
		logFilePath: string;
	},
	state: SyncState,
	saveState: (s: SyncState) => Promise<void>,
	mode: SyncMode,
	progress: SyncProgress
) {
	progress.setStatus(`Moodle Sync: planning…`);
	const plan = await buildPlan(app, client, settings, state, mode);

	progress.setStatus(
		`Moodle Sync: ${mode === "dry-run" ? "dry-run" : "apply"} — ` +
		`${plan.summary.filesDownload} downloads (${formatBytes(plan.summary.bytesToDownload)}), ` +
		`${plan.summary.notesCreate + plan.summary.notesUpdate} note writes, ` +
		`${plan.summary.noteConflicts} conflicts`
	);

	// steps = actions + downloads (downloads count as actions already)
	progress.totalSteps = plan.actions.length;

	if (mode === "dry-run") {
		const msg = renderSummary(plan, true);
		new Notice(msg, 8000);
		if (settings.writeLogFile) await appendLog(app, settings.logFilePath, msg);
		return;
	}

	await applyPlan(app, client, settings, state, saveState, plan, progress);

	const msg = renderSummary(plan, false);
	new Notice(msg, 8000);
	if (settings.writeLogFile) await appendLog(app, settings.logFilePath, msg);
}

/* ---------------- Planning ---------------- */

async function buildPlan(
	app: App,
	client: MoodleClient,
	settings: { rootFolder: string; resourcesFolder: string; concurrency: number; writeLogFile: boolean; logFilePath: string; },
	state: SyncState,
	mode: SyncMode
): Promise<SyncPlan> {
	const actions: PlanAction[] = [];

	actions.push({ kind: "ensure-folder", path: settings.rootFolder });
	actions.push({ kind: "ensure-folder", path: settings.resourcesFolder });

	const site = await client.call<any>("core_webservice_get_site_info");
	const userId = site.userid;

	const courses = await client.call<MoodleCourse[]>("core_enrol_get_users_courses", { userid: userId });

	let notesCreate = 0, notesUpdate = 0, noteConflicts = 0;
	let filesDownload = 0, filesSkip = 0, bytesToDownload = 0;

	for (const course of courses) {
		const courseId = String(course.id);
		const courseName = safeName(course.fullname ?? course.shortname ?? `Course ${courseId}`);

		const courseFolder = join(settings.rootFolder, `${courseName} (${courseId})`);
		const courseResFolder = join(settings.resourcesFolder, `${courseName} (${courseId})`);

		actions.push({ kind: "ensure-folder", path: courseFolder });
		actions.push({ kind: "ensure-folder", path: courseResFolder });

		const sections = await client.call<MoodleSection[]>("core_course_get_contents", { courseid: course.id });

		// Course index note
		{
			const indexPath = join(courseFolder, `_index.md`);
			const indexMd = renderCourseIndex(courseName, courseId, sections);

			const noteDecision = await planNoteUpsert(app, state, indexPath, indexMd);
			if (noteDecision.kind === "note-create") notesCreate++;
			if (noteDecision.kind === "note-update") notesUpdate++;
			if (noteDecision.kind === "note-conflict-keep-both") noteConflicts++;
			actions.push(noteDecision);
		}

		for (const section of sections ?? []) {
			for (const mod of section.modules ?? []) {
				const modName = safeName(mod.name ?? `${mod.modname ?? "module"}-${mod.id}`);
				const modNotePath = join(courseFolder, `${modName}.md`);

				const { noteMd, files } = planModule(courseResFolder, section, mod);

				// Note
				const noteDecision = await planNoteUpsert(app, state, modNotePath, noteMd);
				if (noteDecision.kind === "note-create") notesCreate++;
				if (noteDecision.kind === "note-update") notesUpdate++;
				if (noteDecision.kind === "note-conflict-keep-both") noteConflicts++;
				actions.push(noteDecision);

				// Files
				for (const f of files) {
					// ensure parent dir for file
					const dir = parentDir(f.destPath);
					if (dir) actions.push({ kind: "ensure-folder", path: dir });

					if (shouldDownload(state, f.destPath, f.timemodified, f.filesize, app)) {
						filesDownload++;
						bytesToDownload += (f.filesize ?? 0);
						actions.push({ kind: "file-download", ...f });
					} else {
						filesSkip++;
						actions.push({ kind: "file-skip", destPath: f.destPath });
					}
				}
			}
		}
	}

	// Remove no-op note updates/creates? (planNoteUpsert never emits no-op)
	// Remove duplicate ensure-folder actions (keep first occurrence)
	const deduped = dedupeEnsureFolder(actions);

	return {
		mode,
		actions: deduped,
		summary: {
			courses: courses.length,
			notesCreate,
			notesUpdate,
			noteConflicts,
			filesDownload,
			filesSkip,
			bytesToDownload
		},
		meta: { username: site.username, userid: site.userid, sitename: site.sitename }
	};
}

async function planNoteUpsert(app: App, state: SyncState, path: string, remoteText: string): Promise<PlanAction> {
	const af = app.vault.getAbstractFileByPath(path);

	if (!af) return { kind: "note-create", path, text: remoteText };
	if (!(af instanceof TFile)) return { kind: "note-update", path, text: remoteText }; // weird but proceed

	const currentLocal = await app.vault.read(af);
	const localHash = simpleHash(currentLocal);
	const remoteHash = simpleHash(remoteText);
	const lastSyncedHash = state.notes[path]?.lastSyncedHash;

	// no-op: remote equals local -> treat as update? better: do nothing
	if (localHash === remoteHash) {
		// Keep state fresh when applying; in plan we skip writing.
		// We'll update state during apply if needed (we don’t need an action).
		// But to keep progress consistent, emit a "note-update" only if applying? We'll just skip.
		return { kind: "note-update", path, text: currentLocal }; // will be ignored by apply as no-op via hashes
	}

	// local unchanged since last sync -> update in place
	if (lastSyncedHash && localHash === lastSyncedHash) {
		return { kind: "note-update", path, text: remoteText };
	}

	// otherwise conflict
	return { kind: "note-conflict-keep-both", path, remoteText };
}

function planModule(courseResFolder: string, section: MoodleSection, mod: MoodleModule) {
	const modName = safeName(mod.name ?? `${mod.modname ?? "module"}-${mod.id}`);
	const files: Array<{
		destPath: string;
		fileurl: string;
		timemodified?: number;
		filesize?: number;
	}> = [];

	const links: string[] = [];
	for (const c of mod.contents ?? []) {
		if (c.type !== "file") continue;

		const filepath = (c.filepath ?? "/").replace(/^\/+/, "");
		const filename = safeName(c.filename);
		const destDir = join(courseResFolder, modName, filepath);
		const destPath = normalizePath(`${destDir}/${filename}`);

		files.push({
			destPath,
			fileurl: c.fileurl,
			timemodified: c.timemodified,
			filesize: c.filesize
		});

		links.push(isEmbeddableMedia(filename) ? `- ![[${destPath}]]` : `- [[${destPath}]]`);
	}

	const noteMd = renderModuleNote(section, mod, links);
	return { noteMd, files };
}

/* ---------------- Apply ---------------- */

async function applyPlan(
	app: App,
	client: MoodleClient,
	settings: { concurrency: number },
	state: SyncState,
	saveState: (s: SyncState) => Promise<void>,
	plan: SyncPlan,
	progress: SyncProgress
) {
	const limiter = createLimiter(Math.max(1, settings.concurrency));
	let completed = 0;

	const setProgressText = () => {
		progress.setStatus(`Moodle Sync: ${completed}/${progress.totalSteps}`);
	};

	// We apply sequentially for folder/note actions, but download actions with concurrency.
	// Strategy:
	// 1) Run all ensure-folder and note actions sequentially (stable ordering)
	// 2) Collect downloads and run with limiter
	const downloadActions: Array<Extract<PlanAction, { kind: "file-download" }>> = [];

	for (const a of plan.actions) {
		if (a.kind === "file-download") {
			downloadActions.push(a);
			continue;
		}
		if (a.kind === "file-skip") {
			completed++; progress.tick(); setProgressText();
			continue;
		}

		await applyNonDownloadAction(app, state, a);
		completed++; progress.tick(); setProgressText();
	}

	// downloads in parallel
	await Promise.allSettled(downloadActions.map(a =>
		limiter(async () => {
			try {
				const buf = await client.downloadFile(a.fileurl);
				await writeBinary(app, a.destPath, buf);
				state.files[a.destPath] = { timemodified: a.timemodified, filesize: a.filesize };
			} finally {
				completed++; progress.tick(); setProgressText();
			}
		})
	));

	await saveState(state);
}

async function applyNonDownloadAction(app: App, state: SyncState, a: PlanAction) {
	switch (a.kind) {
		case "ensure-folder":
			await ensureFolder(app, a.path);
			return;

		case "note-create":
			await createOrOverwrite(app, a.path, a.text);
			state.notes[a.path] = { lastSyncedHash: simpleHash(a.text) };
			return;

		case "note-update": {
			const af = app.vault.getAbstractFileByPath(a.path);
			if (!af) {
				await createOrOverwrite(app, a.path, a.text);
				state.notes[a.path] = { lastSyncedHash: simpleHash(a.text) };
				return;
			}
			if (!(af instanceof TFile)) return;

			const current = await app.vault.read(af);
			const curHash = simpleHash(current);
			const newHash = simpleHash(a.text);

			if (curHash === newHash) {
				// still update lastSyncedHash (keeps future conflict logic sane)
				state.notes[a.path] = { lastSyncedHash: newHash };
				return;
			}

			await app.vault.modify(af, a.text);
			state.notes[a.path] = { lastSyncedHash: newHash };
			return;
		}

		case "note-conflict-keep-both": {
			const af = app.vault.getAbstractFileByPath(a.path);
			if (!af || !(af instanceof TFile)) {
				// if missing, just create it
				await createOrOverwrite(app, a.path, a.remoteText);
				state.notes[a.path] = { lastSyncedHash: simpleHash(a.remoteText) };
				return;
			}

			const localText = await app.vault.read(af);
			const stamped = uniqueTwinPath(app, a.path);
			await safeCreateText(app, stamped, markTwin(localText));

			await app.vault.modify(af, a.remoteText);

			state.notes[a.path] = { lastSyncedHash: simpleHash(a.remoteText) };
			return;
		}
	}
}

/* ---------------- Helpers ---------------- */

function shouldDownload(state: SyncState, destPath: string, timemodified?: number, filesize?: number, app?: App): boolean {
	const prev = state.files[destPath];
	if (!prev) return true;

	if (timemodified && prev.timemodified && timemodified > prev.timemodified) return true;
	if (filesize && prev.filesize && filesize !== prev.filesize) return true;

	// if file is missing in vault, download
	if (app) {
		const existing = app.vault.getAbstractFileByPath(destPath);
		if (!existing) return true;
	}
	return false;
}

async function ensureFolder(app: App, folderPath: string) {
	if (!folderPath) return;
	const f = app.vault.getAbstractFileByPath(folderPath);
	if (!f) return app.vault.createFolder(folderPath);
	if (!(f instanceof TFolder)) throw new Error(`${folderPath} exists but is not a folder`);
}

function parentDir(path: string): string {
	const parts = normalizePath(path).split("/");
	parts.pop();
	return parts.join("/");
}

async function writeBinary(app: App, path: string, data: ArrayBuffer) {
	await ensureFolder(app, parentDir(path));
	const existing = app.vault.getAbstractFileByPath(path);
	if (!existing) {
		await app.vault.createBinary(path, data);
		return;
	}
	if (existing instanceof TFile) {
		await app.vault.modifyBinary(existing, data);
	}
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
	md.push(`_Synced by Moodle Sync PoC v2_`);
	return md.join("\n");
}

function dedupeEnsureFolder(actions: PlanAction[]): PlanAction[] {
	const seen = new Set<string>();
	const out: PlanAction[] = [];
	for (const a of actions) {
		if (a.kind !== "ensure-folder") { out.push(a); continue; }
		if (seen.has(a.path)) continue;
		seen.add(a.path);
		out.push(a);
	}
	return out;
}

function renderSummary(plan: SyncPlan, dry: boolean): string {
	const s = plan.summary;
	const head = dry ? "Moodle Sync (dry-run) summary" : "Moodle Sync summary";
	return [
		`${head}:`,
		`- Courses: ${s.courses}`,
		`- Notes: ${s.notesCreate} create, ${s.notesUpdate} update, ${s.noteConflicts} conflicts (keep-both)`,
		`- Files: ${s.filesDownload} download (${formatBytes(s.bytesToDownload)}), ${s.filesSkip} skip`,
	].join("\n");
}

async function appendLog(app: App, logPath: string, text: string) {
	const ts = new Date().toISOString();
	const entry = `\n## ${ts}\n\n${text}\n`;
	const af = app.vault.getAbstractFileByPath(logPath);
	if (!af) {
		await ensureFolder(app, parentDir(logPath));
		await app.vault.create(logPath, `# Moodle Sync Log\n${entry}`);
		return;
	}
	if (af instanceof TFile) {
		const cur = await app.vault.read(af);
		await app.vault.modify(af, cur + entry);
	}
}

async function createOrOverwrite(app: App, path: string, text: string) {
	const existing = app.vault.getAbstractFileByPath(path);

	if (!existing) {
		await ensureFolder(app, parentDir(path));
		await app.vault.create(path, text);
		return;
	}

	if (existing instanceof TFile) {
		await app.vault.modify(existing, text);
		return;
	}

	throw new Error(`${path} exists and is not a file.`);
}

function uniqueTwinPath(app: App, originalMdPath: string): string {
	const base = originalMdPath.replace(/\.md$/i, "");
	const stamp = new Date().toISOString().replace(/[:.]/g, "-"); // includes ms
	let candidate = `${base}.${stamp}.md`;

	let i = 1;
	while (app.vault.getAbstractFileByPath(candidate)) {
		candidate = `${base}.${stamp}.${i}.md`;
		i++;
	}
	return candidate;
}

async function safeCreateText(app: App, path: string, text: string) {
	try {
		await ensureFolder(app, parentDir(path));
		await app.vault.create(path, text);
	} catch (e: any) {
		console.error("CREATE FAILED (already exists?)", path, e);
		throw e;
	}
}

function markTwin(text: string): string {
	// Put the tag at the very top so it’s easy to find/search in Obsidian.
	// Keep a blank line after for readability.
	const tag = "#conflict";
	if (text.startsWith(tag)) return text;
	return `${tag}\n\n${text}`;
}
