import { MoodleApi } from "../api/moodleApi";
import { RemoteDiscovery } from "../discovery/remoteDiscovery";
import { RemoteSyncData } from "../domain/models";
import { SyncState } from "../domain/syncState";
import { PlanExecutor, SyncProgress } from "../execution/planExecutor";
import { SyncMode, SyncPlan } from "../planning/actions";
import { createSyncPlan, SyncPlannerSettings } from "../planning/syncPlanner";
import { VaultSnapshotReader } from "../planning/vaultSnapshot";
import { formatBytes } from "../util";
import { VaultGateway } from "../vault/vaultGateway";

export interface SyncServiceSettings extends SyncPlannerSettings {
	concurrency: number;
	writeLogFile: boolean;
	logFilePath: string;
	includeActionsInLogDetails: boolean;
}

export interface SyncRunResult {
	plan: SyncPlan;
	summary: string;
	notice: string;
	failedDownloads: Array<{ path: string; error: Error }>;
}

export class MoodleSyncService {
	constructor(
		private readonly api: MoodleApi,
		private readonly vault: VaultGateway
	) {}

	async run(
		settings: SyncServiceSettings,
		state: SyncState,
		saveState: (state: SyncState) => Promise<void>,
		mode: SyncMode,
		progress: SyncProgress
	): Promise<SyncRunResult> {
		progress.setStatus("Moodle sync: discovering Moodle content...");
		const remote = await new RemoteDiscovery(this.api).discover();
		const reviewWarnings = collectQuizReviewWarnings(remote);
		const snapshot = await new VaultSnapshotReader(this.vault).read();
		const plan = createSyncPlan(remote, snapshot, state, settings, mode);
		progress.totalSteps = plan.actions.length;
		const executor = new PlanExecutor(this.vault, this.api, settings.concurrency);

		if (mode === "dry-run") {
			const summary = renderSyncSummary(plan, true, 0, reviewWarnings);
			const notice = renderSyncNotice(plan, mode, 0, reviewWarnings);
			if (settings.writeLogFile) {
				await executor.appendLog(settings.logFilePath, notice, renderSyncLogDetails(
					plan,
					summary,
					[],
					settings.includeActionsInLogDetails
				));
			}
			return { plan, summary, notice, failedDownloads: [] };
		}

		const result = await executor.execute(plan, state, saveState, progress);
		const summary = renderSyncSummary(plan, false, result.failedDownloads.length, reviewWarnings);
		const notice = renderSyncNotice(plan, mode, result.failedDownloads.length, reviewWarnings);
		if (settings.writeLogFile) {
			await executor.appendLog(settings.logFilePath, notice, renderSyncLogDetails(
				plan,
				summary,
				result.failedDownloads,
				settings.includeActionsInLogDetails
			));
		}
		return { plan, summary, notice, failedDownloads: result.failedDownloads };
	}
}

export function renderSyncSummary(plan: SyncPlan, dryRun: boolean, failedDownloads: number, reviewWarnings: string[] = []): string {
	const summary = plan.summary;
	const heading = dryRun ? "Moodle sync (dry-run) summary" : "Moodle sync summary";
	const lines = [
		`${heading}:`,
		`- Courses: ${summary.courses}`,
		`- Migration: ${summary.pathMoves} move, ${summary.linksRewrite} link rewrite`,
		`- Notes: ${summary.notesCreate} create, ${summary.notesUpdate} update, ${summary.noteConflicts} conflicts (#colition)`,
		`- Files: ${summary.resourcesDownload} download (${formatBytes(summary.bytesToDownload)}), ${summary.markdownGenerate} generated, ${summary.resourcesSkip} skip`
	];
	if (failedDownloads > 0) lines.push(`- Failures: ${failedDownloads} download${failedDownloads === 1 ? "" : "s"}`);
	if (summary.migrationWarnings.length > 0) {
		lines.push(`- Migration warnings: ${summary.migrationWarnings.length} unsafe legacy path${summary.migrationWarnings.length === 1 ? "" : "s"} left unchanged`);
		lines.push(...summary.migrationWarnings.map(path => `  - ${path}: maps to more than one normalized destination`));
	}
	if (reviewWarnings.length > 0) {
		lines.push(`- Warnings: ${reviewWarnings.length} quiz review${reviewWarnings.length === 1 ? "" : "s"} unavailable`);
		lines.push(...reviewWarnings.map(warning => `  - ${warning}`));
	}
	return lines.join("\n");
}

export function renderSyncNotice(plan: SyncPlan, mode: SyncMode, failedDownloads: number, reviewWarnings: string[] = []): string {
	const summary = plan.summary;
	const notes = summary.notesCreate + summary.notesUpdate;
	const files = summary.resourcesDownload + summary.markdownGenerate;
	const warnings = summary.migrationWarnings.length + reviewWarnings.length + failedDownloads;
	const heading = mode === "dry-run" ? "Moodle sync (dry-run)" : "Moodle sync";
	const parts = [
		`${summary.courses} course${summary.courses === 1 ? "" : "s"}`,
		`${notes} note${notes === 1 ? "" : "s"}`,
		`${files} file${files === 1 ? "" : "s"}`
	];
	if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
	return `${heading}: ${parts.join(", ")}.`;
}

export function renderSyncLogDetails(
	plan: SyncPlan,
	summary: string,
	failedDownloads: Array<{ path: string; error: Error }>,
	includeActions: boolean
): string {
	const sections = [renderHtmlSection("Summary", summary.split("\n").slice(1), summary.split("\n")[0])];
	if (includeActions) sections.push(renderHtmlSection("Planned actions", plan.actions.map(describeAction)));
	if (failedDownloads.length > 0) {
		sections.push(renderHtmlSection("Errors", failedDownloads
			.map(({ path, error }) => `${path}: ${error.message}`)));
	}
	return sections.join("\n\n");
}

function renderHtmlSection(title: string, items: string[], introduction?: string): string {
	const content = items.length > 0
		? `<ul>\n${items.map(item => `<li>${escapeHtml(item.replace(/^\s*-\s*/, ""))}</li>`).join("\n")}\n</ul>`
		: "<p>No items.</p>";
	return `<section>\n<h3>${escapeHtml(title)}</h3>${introduction ? `\n<p>${escapeHtml(introduction)}</p>` : ""}\n${content}\n</section>`;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, character => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;",
		"'": "&#39;"
	})[character] ?? character);
}

function collectQuizReviewWarnings(remote: RemoteSyncData): string[] {
	return remote.courses.flatMap(({ quizAttempts }) => [...quizAttempts.values()]
		.flatMap(attempts => attempts.flatMap(({ attempt, reviewError }) => reviewError
			? [`Attempt ${attempt.id}: ${reviewError}`]
			: [])));
}

function describeAction(action: SyncPlan["actions"][number]): string {
	switch (action.kind) {
		case "path-move":
			return `Move ${action.pathKind}: ${action.from} → ${action.to}`;
		case "links-rewrite":
			return `Rewrite ${action.count} link${action.count === 1 ? "" : "s"}: ${action.path}`;
		case "state-remap":
			return `Update sync-state migration to version ${action.migrationVersion}`;
		case "ensure-folder":
			return `Ensure folder: ${action.path}`;
		case "note-merge":
			return action.noOp
				? `Keep note: ${action.path}`
				: `${action.operation === "create" ? "Create" : "Update"} note: ${action.path}${action.conflicted ? " (conflict)" : ""}`;
		case "resource-download":
			return `Download resource: ${action.destPath}`;
		case "resource-skip":
			return `Keep resource: ${action.destPath}`;
		case "markdown-generate":
			return `Generate Markdown: ${action.destPath}`;
	}
}