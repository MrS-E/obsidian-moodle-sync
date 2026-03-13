import { App, Notice, TFile, TFolder, normalizePath } from "obsidian";
import { MoodleClient, MoodleSiteInfo } from "./moodleClient";
import { SyncState } from "./state";
import { createLimiter, formatBytes, isEmbeddableMedia, join, safeName, simpleHash } from "./util";
import { ensureUserSection, extractBlock, upsertBlock } from "./blocks";
import { diff3Merge } from "node-diff3";
import { convertHtmlToMarkdown } from "./htmlToMarkdown";
import { planQuizExports } from "./quizExport";
import { renderPdfFromHtml } from "./pdf";

type MoodleCourse = { id: number; fullname?: string; shortname?: string };
type MoodleSection = { id: number; name?: string; section?: number; modules?: MoodleModule[] };
type MoodleModule = {
	id: number;
	instance?: number;
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
	tick(snapshot?: SyncProgressSnapshot): void;
	totalSteps: number;
}

export interface SyncProgressSnapshot {
	completed: number;
	total: number;
	remaining: number;
	activeDownloads: number;
	failed: number;
	currentAction?: string;
}

export type PlanAction =
	| { kind: "ensure-folder"; path: string }
	| { kind: "note-create"; path: string; text: string; remoteBlocks: Record<string, string>; conflicted: boolean }
	| { kind: "note-update"; path: string; text: string; remoteBlocks: Record<string, string>; conflicted: boolean; noOp?: boolean }
	| { kind: "file-download"; destPath: string; fileurl: string; timemodified?: number; filesize?: number }
	| { kind: "file-generate-text"; destPath: string; text: string }
	| { kind: "file-generate-pdf"; destPath: string; html: string }
	| { kind: "file-skip"; destPath: string };

export interface SyncPlan {
	mode: SyncMode;
	actions: PlanAction[];
	summary: {
		courses: number;
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

export interface SuspendedSyncRun {
	mode: SyncMode;
	plan: SyncPlan;
	completedActions: number[];
}

export interface RunSyncOptions {
	resumeFrom?: SuspendedSyncRun | null;
	shouldCancel?: () => boolean;
	onCheckpoint?: (run: SuspendedSyncRun | null) => Promise<void> | void;
}

export class SyncCancelledError extends Error {
	constructor(message = "Sync cancelled.") {
		super(message);
		this.name = "SyncCancelledError";
	}
}

export async function runSyncV2(
	app: App,
	client: MoodleClient,
	settings: {
		rootFolder: string;
		resourcesFolder: string;
		concurrency: number;
		convertHtmlToMarkdown: boolean;
		writeLogFile: boolean;
		logFilePath: string;
	},
	state: SyncState,
	saveState: (s: SyncState) => Promise<void>,
	mode: SyncMode,
	progress: SyncProgress,
	options: RunSyncOptions = {}
) {
	const plan = options.resumeFrom?.plan ?? await (async () => {
		progress.setStatus("Moodle sync: planning...");
		return await buildPlan(app, client, settings, state, mode);
	})();
	const effectiveMode = options.resumeFrom?.mode ?? mode;

	progress.setStatus(
		`Moodle sync: ${effectiveMode === "dry-run" ? "dry-run" : "apply"} - ` +
		`${plan.summary.filesDownload} downloads (${formatBytes(plan.summary.bytesToDownload)}), ` +
		`${plan.summary.notesCreate + plan.summary.notesUpdate} note writes, ` +
		`${plan.summary.noteConflicts} conflicts`
	);

	progress.totalSteps = plan.actions.length;

	if (effectiveMode === "dry-run") {
		const msg = renderSummary(plan, true);
		new Notice(msg, 8000);
		if (settings.writeLogFile) await appendLog(app, settings.logFilePath, msg);
		await options.onCheckpoint?.(null);
		return;
	}

	await applyPlan(app, client, settings, state, saveState, plan, progress, {
		mode: effectiveMode,
		resumeFrom: options.resumeFrom,
		shouldCancel: options.shouldCancel,
		onCheckpoint: options.onCheckpoint
	});

	const msg = renderSummary(plan, false);
	new Notice(msg, 8000);
	if (settings.writeLogFile) await appendLog(app, settings.logFilePath, msg);
}

/* ---------------- Planning ---------------- */

async function buildPlan(
	app: App,
	client: MoodleClient,
	settings: {
		rootFolder: string;
		resourcesFolder: string;
		concurrency: number;
		convertHtmlToMarkdown: boolean;
		writeLogFile: boolean;
		logFilePath: string;
	},
	state: SyncState,
	mode: SyncMode
): Promise<SyncPlan> {
	const htmlOptions = { convertHtmlToMarkdown: settings.convertHtmlToMarkdown };
	const actions: PlanAction[] = [];

	actions.push({ kind: "ensure-folder", path: settings.rootFolder });
	actions.push({ kind: "ensure-folder", path: settings.resourcesFolder });

	const site = await client.call<MoodleSiteInfo>("core_webservice_get_site_info");
	const userId = site.userid;
	if (typeof userId !== "number") {
		throw new Error("Moodle did not return a numeric user ID.");
	}

	const courses = await client.call<MoodleCourse[]>("core_enrol_get_users_courses", { userid: userId });

	let notesCreate = 0, notesUpdate = 0, noteConflicts = 0;
	let filesDownload = 0, filesGenerate = 0, filesSkip = 0, bytesToDownload = 0;

	for (const course of courses) {
		const courseId = String(course.id);
		const courseName = safeName(course.fullname ?? course.shortname ?? `Course ${courseId}`);

		const courseFolder = join(settings.rootFolder, `${courseName} (${courseId})`);
		const courseResFolder = join(settings.resourcesFolder, `${courseName} (${courseId})`);

		actions.push({ kind: "ensure-folder", path: courseFolder });
		actions.push({ kind: "ensure-folder", path: courseResFolder });

		const sections = await client.call<MoodleSection[]>("core_course_get_contents", { courseid: course.id });

		// Course index note (managed block: index)
		{
			const indexPath = join(courseFolder, `_index.md`);
			const rendered = renderCourseIndexManaged(courseName, courseId, sections);
			const noteDecision = await planNoteMergeBlocks(app, state, indexPath, rendered.text, rendered.blocks);

			if (noteDecision.kind === "note-update" && noteDecision.noOp) {
				// nothing
			} else {
				if (noteDecision.kind === "note-create") notesCreate++;
				if (noteDecision.kind === "note-update") notesUpdate++;
				if (noteDecision.conflicted) noteConflicts++;
				actions.push(noteDecision);
			}
		}

		for (const section of sections ?? []) {
			for (const mod of section.modules ?? []) {
				const modName = safeName(mod.name ?? `${mod.modname ?? "module"}-${mod.id}`);
				const modNotePath = join(courseFolder, `${modName}.md`);

				const { noteText, remoteBlocks, files, generatedFiles } = await planModule(
					client,
					courseResFolder,
					section,
					mod,
					userId,
					htmlOptions
				);

				const noteDecision = await planNoteMergeBlocks(app, state, modNotePath, noteText, remoteBlocks);
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

					if (shouldDownload(state, f.destPath, f.timemodified, f.filesize, app)) {
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
					if (f.format === "text") {
						actions.push({ kind: "file-generate-text", destPath: f.destPath, text: f.text ?? "" });
					} else {
						actions.push({ kind: "file-generate-pdf", destPath: f.destPath, html: f.html ?? "" });
					}
				}
			}
		}
	}

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
			filesGenerate,
			filesSkip,
			bytesToDownload
		},
		meta: { username: site.username, userid: site.userid, sitename: site.sitename }
	};
}

async function planNoteMergeBlocks(
	app: App,
	state: SyncState,
	path: string,
	renderedRemoteNoteText: string,
	remoteBlocks: Record<string, string>
): Promise<Extract<PlanAction, { kind: "note-create" | "note-update" }>> {
	const af = app.vault.getAbstractFileByPath(path);

	if (!af) {
		const noteText = ensureUserSection(renderedRemoteNoteText);
		return { kind: "note-create", path, text: noteText, remoteBlocks, conflicted: false };
	}

	if (!(af instanceof TFile)) {
		const noteText = ensureUserSection(renderedRemoteNoteText);
		return { kind: "note-update", path, text: noteText, remoteBlocks, conflicted: false };
	}

	const localText = await app.vault.read(af);
	const baseBlocks = state.notes[path]?.baseBlocks ?? {};
	const remoteBlocksHash = hashBlocks(remoteBlocks);
	const stateUpToDate = (state.notes[path]?.lastSyncedManagedHash === remoteBlocksHash);

	let mergedText = localText;
	let conflicted = false;

	for (const [name, remoteInner] of Object.entries(remoteBlocks)) {
		const L = (extractBlock(localText, name) ?? "").replace(/\s+$/, "");
		const R = (remoteInner ?? "").replace(/\s+$/, "");
		// If we don't have a base yet, treat current local block as base.
		const B = (baseBlocks[name] ?? L ?? "").replace(/\s+$/, "");

		const merged = mergeBlock({ name, base: B, local: L, remote: R });
		mergedText = upsertBlock(mergedText, name, merged.inner);
		if (merged.conflicted) conflicted = true;
	}

	mergedText = ensureUserSection(mergedText);
	if (conflicted) mergedText = ensureConflictTags(mergedText);

	const needsWrite = simpleHash(mergedText) !== simpleHash(localText);
	const needsStateRefresh = !stateUpToDate;

	return {
		kind: "note-update",
		path,
		text: mergedText,
		remoteBlocks,
		conflicted,
		noOp: (!needsWrite && !needsStateRefresh)
	};
}

async function planModule(
	client: MoodleClient,
	courseResFolder: string,
	section: MoodleSection,
	mod: MoodleModule,
	userId: number,
	options: { convertHtmlToMarkdown: boolean }
) {
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

	const quizExports = await planQuizExports(client, courseResFolder, mod, userId);
	links.push(...quizExports.resourceLinks);

	const rendered = renderModuleNoteManaged(section, mod, links, options);
	return { noteText: rendered.text, remoteBlocks: rendered.blocks, files, generatedFiles: quizExports.files };
}

/* ---------------- Apply ---------------- */

async function applyPlan(
	app: App,
	client: MoodleClient,
	settings: { concurrency: number },
	state: SyncState,
	saveState: (s: SyncState) => Promise<void>,
	plan: SyncPlan,
	progress: SyncProgress,
	options: {
		mode: SyncMode;
		resumeFrom?: SuspendedSyncRun | null;
		shouldCancel?: () => boolean;
		onCheckpoint?: (run: SuspendedSyncRun | null) => Promise<void> | void;
	}
) {
	const limiter = createLimiter(Math.max(1, settings.concurrency));
	const completedActions = new Set(options.resumeFrom?.completedActions ?? []);
	let completed = completedActions.size;
	let failed = 0;
	let activeDownloads = 0;
	let checkpointWrite = Promise.resolve();
	let stateWrite = Promise.resolve();
	const downloadPromises: Promise<void>[] = [];
	const errors: Error[] = [];
	let cancellationError: SyncCancelledError | null = null;

	const updateProgress = (currentAction?: string) => {
		const snapshot: SyncProgressSnapshot = {
			completed,
			total: progress.totalSteps,
			remaining: Math.max(progress.totalSteps - completed, 0),
			activeDownloads,
			failed,
			currentAction
		};
		progress.tick(snapshot);
		progress.setStatus(formatProgressStatus(snapshot));
	};

	const persistCheckpoint = async () => {
		checkpointWrite = checkpointWrite.then(async () => {
			await options.onCheckpoint?.({
				mode: options.mode,
				plan,
				completedActions: [...completedActions].sort((a, b) => a - b)
			});
		});
		await checkpointWrite;
	};

	const persistState = async () => {
		stateWrite = stateWrite.then(async () => {
			await saveState(state);
		});
		await stateWrite;
	};

	const markCompleted = async (index: number, currentAction?: string) => {
		if (completedActions.has(index)) {
			return;
		}
		completedActions.add(index);
		completed++;
		await persistState();
		updateProgress(currentAction);
		await persistCheckpoint();
	};

	const ensureNotCancelled = () => {
		if (options.shouldCancel?.()) {
			throw new SyncCancelledError();
		}
	};

	await persistCheckpoint();
	updateProgress(options.resumeFrom ? "Resuming sync" : "Starting sync");

	for (const [index, action] of plan.actions.entries()) {
		if (completedActions.has(index)) {
			continue;
		}

		try {
			ensureNotCancelled();
		} catch (error) {
			cancellationError = error as SyncCancelledError;
			break;
		}

		if (action.kind === "file-download") {
			const currentAction = describeAction(action);
			activeDownloads++;
			updateProgress(currentAction);
			downloadPromises.push(limiter(async () => {
				try {
					ensureNotCancelled();
					const buf = await client.downloadFile(action.fileurl);
					await writeBinary(app, action.destPath, buf);
					state.files[action.destPath] = { timemodified: action.timemodified, filesize: action.filesize };
					await markCompleted(index, currentAction);
				} catch (error) {
					if (error instanceof SyncCancelledError) {
						cancellationError ??= error;
						return;
					}
					failed++;
					updateProgress(currentAction);
					errors.push(error instanceof Error ? error : new Error(String(error)));
				} finally {
					activeDownloads = Math.max(0, activeDownloads - 1);
					updateProgress(currentAction);
				}
			}));
			continue;
		}

		if (action.kind === "file-skip") {
			await markCompleted(index, describeAction(action));
			continue;
		}

		try {
			await applyNonDownloadAction(app, state, action);
			await markCompleted(index, describeAction(action));
		} catch (error) {
			errors.push(error instanceof Error ? error : new Error(String(error)));
			break;
		}
	}

	await Promise.allSettled(downloadPromises);
	await checkpointWrite;
	await stateWrite;

	if (cancellationError) {
		updateProgress("Sync cancelled");
		throw cancellationError;
	}

	if (errors.length > 0) {
		updateProgress("Sync paused after errors");
		if (errors.length === 1) {
			throw errors[0];
		}
		throw new Error(`Sync failed with ${errors.length} errors. Resume the sync to retry remaining work.`);
	}

	await saveState(state);
	await options.onCheckpoint?.(null);
	updateProgress("Sync complete");
}

async function applyNonDownloadAction(app: App, state: SyncState, a: PlanAction) {
	switch (a.kind) {
		case "ensure-folder":
			await ensureFolder(app, a.path);
			return;

		case "note-create":
			await createOrOverwrite(app, a.path, a.text);
			state.notes[a.path] = {
				baseBlocks: normalizeBlocks(a.remoteBlocks),
				lastSyncedManagedHash: hashBlocks(a.remoteBlocks)
			};
			return;

		case "note-update": {
			const af = app.vault.getAbstractFileByPath(a.path);
			if (!af) {
				await createOrOverwrite(app, a.path, a.text);
				state.notes[a.path] = {
					baseBlocks: normalizeBlocks(a.remoteBlocks),
					lastSyncedManagedHash: hashBlocks(a.remoteBlocks)
				};
				return;
			}
			if (!(af instanceof TFile)) return;

			const current = await app.vault.read(af);
			const curHash = simpleHash(current);
			const newHash = simpleHash(a.text);

			if (curHash !== newHash) {
				await app.vault.modify(af, a.text);
			}

			// Always refresh base blocks (remote-managed base) even if file didn't change.
			state.notes[a.path] = {
				baseBlocks: normalizeBlocks(a.remoteBlocks),
				lastSyncedManagedHash: hashBlocks(a.remoteBlocks)
			};

			return;
		}

		case "file-generate-text":
			await createOrUpdateTextFile(app, a.destPath, a.text);
			return;

		case "file-generate-pdf":
			await writeBinary(app, a.destPath, await renderPdfFromHtml(a.html));
			return;
	}
}

/* ---------------- Helpers ---------------- */

function shouldDownload(state: SyncState, destPath: string, timemodified?: number, filesize?: number, app?: App): boolean {
	const prev = state.files[destPath];
	if (!prev) return true;

	if (timemodified && prev.timemodified && timemodified > prev.timemodified) return true;
	if (filesize && prev.filesize && filesize !== prev.filesize) return true;

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

function renderCourseIndexManaged(courseName: string, courseId: string, sections: MoodleSection[]): { text: string; blocks: Record<string, string> } {
	const lines: string[] = [];
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
	const indexInner = lines.join("\n").replace(/\s+$/, "");

	let note = `# ${courseName}\n\n`;
	note = upsertBlock(note, "index", indexInner);
	note = ensureUserSection(note);

	return { text: note, blocks: { index: indexInner } };
}

function renderModuleNoteManaged(
	section: MoodleSection,
	mod: MoodleModule,
	resourceLinks: string[],
	options: { convertHtmlToMarkdown: boolean }
): { text: string; blocks: Record<string, string> } {
	const title = mod.name ?? "Untitled";

	const metaLines: string[] = [];
	metaLines.push(`- Type: \`${mod.modname ?? "unknown"}\``);
	metaLines.push(`- Section: ${section.name ?? section.section ?? ""}`);
	if (mod.url) metaLines.push(`- URL: ${mod.url}`);
	const metaInner = metaLines.join("\n").replace(/\s+$/, "");

	const contentInner = (mod.description && mod.description.trim().length > 0)
		? renderModuleContent(mod.description, options)
		: "";

	const resourcesInner = resourceLinks.join("\n").replace(/\s+$/, "");

	let note = `# ${title}\n\n`;
	note = upsertBlock(note, "meta", metaInner);
	note = upsertBlock(note, "content", contentInner);
	note = upsertBlock(note, "resources", resourcesInner);
	note = ensureUserSection(note);

	return { text: note, blocks: { meta: metaInner, content: contentInner, resources: resourcesInner } };
}

function renderModuleContent(html: string, options: { convertHtmlToMarkdown: boolean }): string {
	if (!options.convertHtmlToMarkdown) {
		return ["```html", html, "```"].join("\n");
	}

	return convertHtmlToMarkdown(html);
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
		`- Notes: ${s.notesCreate} create, ${s.notesUpdate} update, ${s.noteConflicts} conflicts (#colition)`,
		`- Files: ${s.filesDownload} download (${formatBytes(s.bytesToDownload)}), ${s.filesGenerate} generated, ${s.filesSkip} skip`,
	].join("\n");
}

export function formatProgressStatus(snapshot: SyncProgressSnapshot): string {
	const parts = [
		`Moodle sync: ${snapshot.completed}/${snapshot.total} complete`,
		`${snapshot.remaining} remaining`
	];
	if (snapshot.activeDownloads > 0) {
		parts.push(`${snapshot.activeDownloads} active download${snapshot.activeDownloads === 1 ? "" : "s"}`);
	}
	if (snapshot.failed > 0) {
		parts.push(`${snapshot.failed} failed`);
	}
	if (snapshot.currentAction) {
		parts.push(snapshot.currentAction);
	}
	return parts.join(" | ");
}

function describeAction(action: PlanAction): string {
	switch (action.kind) {
		case "ensure-folder":
			return `Ensuring ${action.path}`;
		case "note-create":
			return `Creating ${action.path}`;
		case "note-update":
			return `Updating ${action.path}`;
		case "file-download":
			return `Downloading ${action.destPath}`;
		case "file-generate-text":
		case "file-generate-pdf":
			return `Generating ${action.destPath}`;
		case "file-skip":
			return `Skipping ${action.destPath}`;
	}
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
	const tagLine = "#colition #conflict";
	const trimmed = noteText.replace(/^\s+/, "");
	if (trimmed.startsWith("#colition") || trimmed.startsWith("#conflict")) return trimmed;
	return `${tagLine}\n\n${trimmed}`;
}

function keepBothBlock(local: string, remote: string): string {
	return [
		"#colition",
		"",
		"### Local",
		"```md",
		(local ?? "").replace(/\s+$/, ""),
		"```",
		"",
		"### Remote",
		"```md",
		(remote ?? "").replace(/\s+$/, ""),
		"```",
	].join("\n");
}

function mergeBlock(input: { name: string; base: string; local: string; remote: string }): { inner: string; conflicted: boolean } {
	const B = (input.base ?? "").replace(/\s+$/, "");
	const L = (input.local ?? "").replace(/\s+$/, "");
	const R = (input.remote ?? "").replace(/\s+$/, "");

	// Fast paths (same as before)
	if (L === R) return { inner: R, conflicted: false };
	if (L === B) return { inner: R, conflicted: false };
	if (R === B) return { inner: L, conflicted: false };

	// Diff3 expects arrays of lines
	const baseLines = toLinesPreserveEmpty(B);
	const localLines = toLinesPreserveEmpty(L);
	const remoteLines = toLinesPreserveEmpty(R);

	// Try auto merge; excludeFalseConflicts=true reduces spurious conflicts
	const merged = diff3Merge(localLines, baseLines, remoteLines, true);

	let out: string[] = [];
	let hasConflict = false;

	for (const part of merged) {
		if ("ok" in part) {
			out.push(...part.ok);
		} else {
			hasConflict = true;
			// If you want "best-effort" even with conflicts:
			// you could still append one side; but per your Option B,
			// we treat this as unresolved and fall back to keepBothBlock.
			break;
		}
	}

	if (!hasConflict) {
		const mergedText = fromLines(out).replace(/\s+$/, "");
		return { inner: mergedText, conflicted: false };
	}

	// Unresolved conflict => keep both inside the block
	return { inner: keepBothBlock(L, R), conflicted: true };
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
	planNoteMergeBlocks,
	planModule,
	shouldDownload,
	parentDir,
	renderCourseIndexManaged,
	renderModuleNoteManaged,
	renderModuleContent,
	dedupeEnsureFolder,
	renderSummary,
	formatProgressStatus,
	describeAction,
	appendLog,
	normalizeBlocks,
	hashBlocks,
	ensureConflictTags,
	keepBothBlock,
	mergeBlock,
	toLinesPreserveEmpty,
	fromLines
};
