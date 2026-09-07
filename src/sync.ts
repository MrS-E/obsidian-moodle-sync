import { App, Notice, TFile, TFolder, normalizePath } from "obsidian";
import { MoodleApi } from "./api/moodleApi";
import { CourseModule, CourseSection } from "./domain/models";
import { SyncState } from "./domain/syncState";
import { createLimiter, formatBytes, isEmbeddableMedia, join, simpleHash } from "./util";
import { createManagedPathLayout, ManagedModulePath, ManagedResourcePath } from "./migration/managedPaths";
import { rewriteMarkdownLinks } from "./migration/linkRewriter";
import {
	createPathMigration,
	CURRENT_PATH_MIGRATION_VERSION,
	ManagedPathMapping,
	projectMigratedPath,
	remapSyncState
} from "./migration/pathMigration";
import { applyNoteMerge, NoteMergeAction, planNoteMerge } from "./merge/noteMergeActor";
import {
	ensureConflictTags as ensureConflictTagsFromEngine,
	keepBothBlock as keepBothBlockFromEngine,
	mergeManagedBlock
} from "./merge/mergeEngine";
import { renderCourseIndex, renderModuleNote } from "./rendering/markdownRenderer";
import { planQuizAttemptNotes } from "./rendering/quizRenderer";

export type SyncMode = "apply" | "dry-run";

export interface SyncProgress {
	setStatus(text: string): void;
	tick(): void;
	totalSteps: number;
}

type PlanAction =
	| { kind: "path-move"; from: string; to: string; pathKind: "file" | "folder" }
	| { kind: "links-rewrite"; path: string; text: string; expectedHash: string; count: number }
	| { kind: "state-remap"; mappings: ManagedPathMapping[]; migrationVersion: number }
	| { kind: "ensure-folder"; path: string }
	| NoteMergeAction
	| { kind: "file-download"; destPath: string; fileurl: string; timemodified?: number; filesize?: number }
	| { kind: "file-generate-text"; destPath: string; text: string }
	| { kind: "file-skip"; destPath: string };

type QuizApi = Pick<MoodleApi, "getFinishedQuizAttempts" | "getQuizAttemptReview">;

interface SyncPlan {
	mode: SyncMode;
	actions: PlanAction[];
	summary: {
		courses: number;
		pathMoves: number;
		linksRewrite: number;
		notesCreate: number;
		notesUpdate: number;
		noteConflicts: number;
		filesDownload: number;
		filesGenerate: number;
		filesSkip: number;
		bytesToDownload: number;
	};
	meta: {
		username?: string;
		userid?: number;
		sitename?: string;
	};
}

type SyncSettings = {
	rootFolder: string;
	resourcesFolder: string;
	concurrency: number;
	convertHtmlToMarkdown: boolean;
	writeLogFile: boolean;
	logFilePath: string;
};

export async function runSyncV2(
	app: App,
	client: MoodleApi,
	settings: SyncSettings,
	state: SyncState,
	saveState: (s: SyncState) => Promise<void>,
	mode: SyncMode,
	progress: SyncProgress
) {
	progress.setStatus("Moodle sync: planning...");
	const plan = await buildPlan(app, client, settings, state, mode);

	progress.setStatus(
		`Moodle sync: ${mode === "dry-run" ? "dry-run" : "apply"} - ` +
		`${plan.summary.filesDownload} downloads (${formatBytes(plan.summary.bytesToDownload)}), ` +
		`${plan.summary.notesCreate + plan.summary.notesUpdate} note writes, ` +
		`${plan.summary.noteConflicts} conflicts`
	);

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
	client: MoodleApi,
	settings: SyncSettings,
	state: SyncState,
	mode: SyncMode
): Promise<SyncPlan> {
	const actions: PlanAction[] = [];

	const site = await client.getSiteInfo();
	const userId = site.userid;
	const courses = await client.getEnrolledCourses(userId);
	const discoveredCourses: Array<{ course: typeof courses[number]; sections: CourseSection[] }> = [];
	for (const course of courses) {
		discoveredCourses.push({ course, sections: await client.getCourseContents(course.id) });
	}
	const layout = createManagedPathLayout(discoveredCourses, settings);

	let pathMoves = 0;
	let linksRewrite = 0;
	if (state.pathMigrationVersion < CURRENT_PATH_MIGRATION_VERSION) {
		const migration = createPathMigration(layout.mappings, path => app.vault.getAbstractFileByPath(path) !== null);
		const linkActions = await planLinkRewrites(app, migration.mappings);
		pathMoves = migration.moves.length;
		linksRewrite = linkActions.reduce((total, action) => total + action.count, 0);
		actions.push(...migration.moves.map(move => ({
			kind: "path-move" as const,
			from: move.from,
			to: move.to,
			pathKind: move.kind
		})));
		actions.push(...linkActions);
		actions.push({
			kind: "state-remap",
			mappings: migration.mappings,
			migrationVersion: CURRENT_PATH_MIGRATION_VERSION
		});
	}

	actions.push({ kind: "ensure-folder", path: settings.rootFolder });
	actions.push({ kind: "ensure-folder", path: settings.resourcesFolder });

	let notesCreate = 0, notesUpdate = 0, noteConflicts = 0;
	let filesDownload = 0, filesGenerate = 0, filesSkip = 0, bytesToDownload = 0;

	for (const course of layout.courses) {
		const courseId = String(course.course.id);
		actions.push({ kind: "ensure-folder", path: course.folder });
		actions.push({ kind: "ensure-folder", path: course.resourceFolder });

		// Course index note (managed block: index)
		{
			const indexPath = join(course.folder, `_index.md`);
			const rendered = renderCourseIndex(course.name, courseId, course.sections, moduleNames(course.modules));
			const noteDecision = await planNoteMerge(
				app,
				state,
				indexPath,
				rendered.text,
				rendered.blocks,
				legacyPathFor(indexPath, layout.mappings)
			);

			if (noteDecision.kind === "note-update" && noteDecision.noOp) {
				// nothing
			} else {
				if (noteDecision.kind === "note-create") notesCreate++;
				if (noteDecision.kind === "note-update") notesUpdate++;
				if (noteDecision.conflicted) noteConflicts++;
				actions.push(noteDecision);
			}
		}

		for (const modulePath of course.modules) {
			const { noteText, remoteBlocks, files, generatedFiles } = await planModule(
				client,
				modulePath.resourceFolder,
				modulePath.section,
				modulePath.module,
				modulePath.resources,
				userId
			);

			const noteDecision = await planNoteMerge(
				app,
				state,
				modulePath.notePath,
				noteText,
				remoteBlocks,
				modulePath.legacyNotePath
			);
			if (noteDecision.kind === "note-update" && noteDecision.noOp) {
				// nothing
			} else {
				if (noteDecision.kind === "note-create") notesCreate++;
				if (noteDecision.kind === "note-update") notesUpdate++;
				if (noteDecision.conflicted) noteConflicts++;
				actions.push(noteDecision);
			}

			for (const f of files) {
				const dir = parentDir(f.destPath);
				if (dir) actions.push({ kind: "ensure-folder", path: dir });

				if (shouldDownload(state, f.destPath, f.timemodified, f.filesize, app, f.legacyDestPath)) {
					filesDownload++;
					bytesToDownload += (f.filesize ?? 0);
					actions.push({ kind: "file-download", ...f });
				} else {
					filesSkip++;
					actions.push({ kind: "file-skip", destPath: f.destPath });
				}
			}

			for (const f of generatedFiles) {
				const dir = parentDir(f.destPath);
				if (dir) actions.push({ kind: "ensure-folder", path: dir });
				filesGenerate++;
				actions.push({ kind: "file-generate-text", destPath: f.destPath, text: f.text });
			}
		}
	}

	const deduped = dedupeEnsureFolder(actions);

	return {
		mode,
		actions: deduped,
		summary: {
			courses: courses.length,
			pathMoves,
			linksRewrite,
			notesCreate,
			notesUpdate,
			noteConflicts,
			filesDownload,
			filesGenerate,
			filesSkip,
			bytesToDownload
		},
		meta: { username: site.username, userid: site.userid, sitename: site.sitename }
	};
}

async function planModule(
	client: QuizApi,
	moduleResourceFolder: string,
	section: CourseSection,
	mod: CourseModule,
	resources: ManagedResourcePath[],
	userId: number
) {
	const files: Array<{
		destPath: string;
		legacyDestPath: string;
		fileurl: string;
		timemodified?: number;
		filesize?: number;
	}> = [];

	const links: string[] = [];
	for (const resource of resources) {
		const c = resource.content;
		const destPath = resource.path;
		const legacyDestPath = resource.legacyPath;
		const filename = destPath.split("/").pop() ?? c.filename;

		files.push({
			destPath,
			legacyDestPath,
			fileurl: c.fileurl,
			timemodified: c.timemodified,
			filesize: c.filesize
		});

		links.push(isEmbeddableMedia(filename) ? `- ![[${destPath}]]` : `- [[${destPath}]]`);
	}

	const quizExports = await planQuizAttemptNotes(client, moduleResourceFolder, mod, userId);
	links.push(...quizExports.resourceLinks);

	const rendered = renderModuleNote(section, mod, links);
	return { noteText: rendered.text, remoteBlocks: rendered.blocks, files, generatedFiles: quizExports.files };
}

/* ---------------- Apply ---------------- */

async function applyPlan(
	app: App,
	client: MoodleApi,
	settings: { concurrency: number },
	state: SyncState,
	saveState: (s: SyncState) => Promise<void>,
	plan: SyncPlan,
	progress: SyncProgress
) {
	const limiter = createLimiter(Math.max(1, settings.concurrency));
	let completed = 0;

	const setProgressText = () => {
		progress.setStatus(`Moodle sync: ${completed}/${progress.totalSteps}`);
	};

	const downloadActions: Array<Extract<PlanAction, { kind: "file-download" }>> = [];
	const appliedMoves: ManagedPathMapping[] = [];

	for (const a of plan.actions) {
		if (a.kind === "path-move") {
			await applyPathMove(app, a, appliedMoves);
			appliedMoves.push({ from: a.from, to: a.to, kind: a.pathKind });
			completed++; progress.tick(); setProgressText();
			continue;
		}
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

	await Promise.allSettled(downloadActions.map(a =>
		limiter(async () => {
			try {
				const buf = await client.downloadResource(a.fileurl);
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

		case "links-rewrite": {
			const file = app.vault.getAbstractFileByPath(a.path);
			if (!(file instanceof TFile)) {
				throw new Error(`Cannot rewrite links in ${a.path}: the file is no longer available.`);
			}
			const current = await app.vault.read(file);
			if (simpleHash(current) !== a.expectedHash) {
				throw new Error(`Cannot rewrite links in ${a.path}: the note changed after planning. Re-run sync.`);
			}
			if (current !== a.text) {
				await app.vault.modify(file, a.text);
			}
			return;
		}

		case "state-remap": {
			const remapped = remapSyncState(state, a.mappings);
			state.files = remapped.files;
			state.notes = remapped.notes;
			state.pathMigrationVersion = a.migrationVersion;
			return;
		}

		case "path-move":
			return;

		case "note-create":
			await applyNoteMerge(app, state, a);
			return;

		case "note-update":
			await applyNoteMerge(app, state, a);
			return;

		case "file-generate-text":
			await createOrUpdateTextFile(app, a.destPath, a.text);
			return;

	}
}

/* ---------------- Helpers ---------------- */

async function planLinkRewrites(
	app: App,
	mappings: ManagedPathMapping[]
): Promise<Array<Extract<PlanAction, { kind: "links-rewrite" }>>> {
	if (mappings.length === 0) {
		return [];
	}

	const actions: Array<Extract<PlanAction, { kind: "links-rewrite" }>> = [];
	for (const file of app.vault.getMarkdownFiles()) {
		const sourcePath = file.path;
		const text = await app.vault.read(file);
		const rewritten = rewriteMarkdownLinks(text, {
			sourcePath,
			outputSourcePath: projectMigratedPath(sourcePath, mappings),
			resolveLink: (source, linkPath) => app.metadataCache.getFirstLinkpathDest(linkPath, source)?.path ?? null,
			mapPath: path => projectMigratedPath(path, mappings)
		});
		if (rewritten.text !== text) {
			actions.push({
				kind: "links-rewrite",
				path: projectMigratedPath(sourcePath, mappings),
				text: rewritten.text,
				expectedHash: simpleHash(text),
				count: rewritten.count
			});
		}
	}
	return actions;
}

function legacyPathFor(path: string, mappings: ManagedPathMapping[]): string {
	return mappings.find(mapping => mapping.kind === "file" && mapping.to === path)?.from ?? path;
}

function moduleNames(modules: ManagedModulePath[]): Map<number, string> {
	return new Map(modules.map(modulePath => [modulePath.module.id, modulePath.name]));
}

function shouldDownload(
	state: SyncState,
	destPath: string,
	timemodified?: number,
	filesize?: number,
	app?: App,
	legacyDestPath = destPath
): boolean {
	const prev = state.files[destPath] ?? state.files[legacyDestPath];
	if (!prev) return true;

	if (timemodified && prev.timemodified && timemodified > prev.timemodified) return true;
	if (filesize && prev.filesize && filesize !== prev.filesize) return true;

	if (app) {
		const existing = app.vault.getAbstractFileByPath(destPath) ?? app.vault.getAbstractFileByPath(legacyDestPath);
		if (!existing) return true;
	}
	return false;
}

async function applyPathMove(
	app: App,
	action: Extract<PlanAction, { kind: "path-move" }>,
	appliedMoves: ManagedPathMapping[]
): Promise<void> {
	const from = projectMigratedPath(action.from, appliedMoves);
	const source = app.vault.getAbstractFileByPath(from);
	if (!source) {
		throw new Error(`Cannot migrate ${action.from}: the source is no longer available.`);
	}
	if (action.pathKind === "file" && !(source instanceof TFile)) {
		throw new Error(`Cannot migrate ${action.from}: expected a file.`);
	}
	if (action.pathKind === "folder" && !(source instanceof TFolder)) {
		throw new Error(`Cannot migrate ${action.from}: expected a folder.`);
	}
	if (app.vault.getAbstractFileByPath(action.to)) {
		throw new Error(`Cannot migrate ${action.from}: destination ${action.to} already exists.`);
	}
	await ensureFolder(app, parentDir(action.to));
	await app.vault.rename(source, action.to);
}

async function ensureFolder(app: App, folderPath: string) {
	if (!folderPath) return;
	const f = app.vault.getAbstractFileByPath(folderPath);
	if (!f) return app.vault.createFolder(folderPath);
	if (!(f instanceof TFolder)) throw new Error(`${folderPath} exists but is not a folder`);
	return;
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
	const head = dry ? "Moodle sync (dry-run) summary" : "Moodle sync summary";
	return [
		`${head}:`,
		`- Courses: ${s.courses}`,
		`- Migration: ${s.pathMoves} move, ${s.linksRewrite} link rewrite`,
		`- Notes: ${s.notesCreate} create, ${s.notesUpdate} update, ${s.noteConflicts} conflicts (#colition)`,
		`- Files: ${s.filesDownload} download (${formatBytes(s.bytesToDownload)}), ${s.filesGenerate} generated, ${s.filesSkip} skip`,
	].join("\n");
}

async function appendLog(app: App, logPath: string, text: string) {
	const ts = new Date().toISOString();
	const entry = `\n## ${ts}\n\n${text}\n`;
	const af = app.vault.getAbstractFileByPath(logPath);
	if (!af) {
		await ensureFolder(app, parentDir(logPath));
		await app.vault.create(logPath, `# Moodle sync log\n${entry}`);
		return;
	}
	if (af instanceof TFile) {
		const cur = await app.vault.read(af);
		await app.vault.modify(af, cur + entry);
	}
}

async function createOrUpdateTextFile(app: App, path: string, text: string) {
	const existing = app.vault.getAbstractFileByPath(path);

	if (!existing) {
		await ensureFolder(app, parentDir(path));
		await app.vault.create(path, text);
		return;
	}

	if (!(existing instanceof TFile)) {
		throw new Error(`${path} exists and is not a file.`);
	}

	const current = await app.vault.read(existing);
	if (current !== text) {
		await app.vault.modify(existing, text);
	}
}

function normalizeBlocks(blocks: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(blocks ?? {})) {
		out[k] = (v ?? "").replace(/\s+$/, "");
	}
	return out;
}

function hashBlocks(blocks: Record<string, string>): string {
	const keys = Object.keys(blocks ?? {}).sort();
	const joined = keys.map(k => `${k}\n${(blocks[k] ?? "").replace(/\s+$/, "")}`).join("\n\n");
	return simpleHash(joined);
}

function ensureConflictTags(noteText: string): string {
	return ensureConflictTagsFromEngine(noteText);
}

function keepBothBlock(local: string, remote: string): string {
	return keepBothBlockFromEngine(local, remote);
}

function mergeBlock(input: { name: string; base: string; local: string; remote: string }): { inner: string; conflicted: boolean } {
	return mergeManagedBlock(input);
}

// Keep empty lines stable
function toLinesPreserveEmpty(s: string): string[] {
	// Split preserving trailing empty line behavior:
	// If string ends with '\n', split will produce a last empty element. That's OK.
	return s.length ? s.split("\n") : [""];
}

function fromLines(lines: string[]): string {
	// Join exactly as lines
	return lines.join("\n");
}

export const __test__ = {
	buildPlan,
	planNoteMergeBlocks: planNoteMerge,
	planModule,
	shouldDownload,
	parentDir,
	renderCourseIndexManaged: renderCourseIndex,
	renderModuleNoteManaged: renderModuleNote,
	dedupeEnsureFolder,
	renderSummary,
	appendLog,
	normalizeBlocks,
	hashBlocks,
	ensureConflictTags,
	keepBothBlock,
	mergeBlock,
	toLinesPreserveEmpty,
	fromLines
};
