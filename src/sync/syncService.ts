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
}

export interface SyncRunResult {
	plan: SyncPlan;
	summary: string;
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

		if (mode === "dry-run") {
			return { plan, summary: renderSyncSummary(plan, true, 0, reviewWarnings), failedDownloads: [] };
		}

		const executor = new PlanExecutor(this.vault, this.api, settings.concurrency);
		const result = await executor.execute(plan, state, saveState, progress);
		const summary = renderSyncSummary(plan, false, result.failedDownloads.length, reviewWarnings);
		if (settings.writeLogFile) {
			await executor.appendLog(settings.logFilePath, summary);
		}
		return { plan, summary, failedDownloads: result.failedDownloads };
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
	if (reviewWarnings.length > 0) {
		lines.push(`- Warnings: ${reviewWarnings.length} quiz review${reviewWarnings.length === 1 ? "" : "s"} unavailable`);
		lines.push(...reviewWarnings.map(warning => `  - ${warning}`));
	}
	return lines.join("\n");
}

function collectQuizReviewWarnings(remote: RemoteSyncData): string[] {
	return remote.courses.flatMap(({ quizAttempts }) => [...quizAttempts.values()]
		.flatMap(attempts => attempts.flatMap(({ attempt, reviewError }) => reviewError
			? [`Attempt ${attempt.id}: ${reviewError}`]
			: [])));
}