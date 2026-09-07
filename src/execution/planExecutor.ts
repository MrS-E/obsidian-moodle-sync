import { MoodleApi } from "../api/moodleApi";
import { SyncState } from "../domain/syncState";
import { applyNoteMerge } from "../merge/noteMergeActor";
import { ManagedPathMapping, projectMigratedPath, remapSyncState } from "../migration/pathMigration";
import { SyncPlan, SyncPlanAction } from "../planning/actions";
import { simpleHash } from "../util";
import { VaultGateway } from "../vault/vaultGateway";

export interface SyncProgress {
	setStatus(text: string): void;
	tick(): void;
	totalSteps: number;
}

export interface ExecutionResult {
	failedDownloads: Array<{ path: string; error: Error }>;
}

export class PlanExecutor {
	constructor(
		private readonly vault: VaultGateway,
		private readonly api: Pick<MoodleApi, "downloadResource">,
		private readonly concurrency: number
	) {}

	async execute(plan: SyncPlan, state: SyncState, saveState: (state: SyncState) => Promise<void>, progress: SyncProgress): Promise<ExecutionResult> {
		const downloads: Array<Extract<SyncPlanAction, { kind: "resource-download" }>> = [];
		const appliedMoves: ManagedPathMapping[] = [];
		let completed = 0;
		const tick = () => {
			completed++;
			progress.tick();
			progress.setStatus(`Moodle sync: ${completed}/${progress.totalSteps}`);
		};

		for (const action of plan.actions) {
			if (action.kind === "resource-download") {
				downloads.push(action);
				continue;
			}
			if (action.kind === "resource-skip") {
				tick();
				continue;
			}
			await this.apply(action, state, appliedMoves);
			if (action.kind === "path-move") appliedMoves.push({ from: action.from, to: action.to, kind: action.pathKind });
			tick();
		}

		const failures = await this.downloadAll(downloads, state, tick);
		await saveState(state);
		return { failedDownloads: failures };
	}

	async appendLog(path: string, text: string): Promise<void> {
		const existing = this.vault.getEntryKind(path);
		const entry = `\n## ${new Date().toISOString()}\n\n${text}\n`;
		if (!existing) {
			await this.vault.writeText(path, `# Moodle sync log\n${entry}`);
			return;
		}
		if (existing !== "file") throw new Error(`${path} exists and is not a file.`);
		await this.vault.writeText(path, `${await this.vault.readText(path)}${entry}`);
	}

	private async apply(action: Exclude<SyncPlanAction, { kind: "resource-download" | "resource-skip" }>, state: SyncState, appliedMoves: ManagedPathMapping[]): Promise<void> {
		switch (action.kind) {
			case "path-move":
				await this.vault.move(projectMigratedPath(action.from, appliedMoves), action.to, action.pathKind);
				return;
			case "links-rewrite": {
				if (this.vault.getEntryKind(action.path) !== "file") throw new Error(`Cannot rewrite links in ${action.path}: the file is no longer available.`);
				const current = await this.vault.readText(action.path);
				if (simpleHash(current) !== action.expectedHash) throw new Error(`Cannot rewrite links in ${action.path}: the note changed after planning. Re-run sync.`);
				await this.vault.writeText(action.path, action.text);
				return;
			}
			case "state-remap": {
				const remapped = remapSyncState(state, action.mappings);
				state.files = remapped.files;
				state.notes = remapped.notes;
				state.pathMigrationVersion = action.migrationVersion;
				return;
			}
			case "ensure-folder":
				await this.vault.ensureFolder(action.path);
				return;
			case "note-merge":
				await applyNoteMerge(this.vault, state, action);
				return;
			case "markdown-generate":
				await this.vault.writeText(action.destPath, action.text);
				return;
		}
	}

	private async downloadAll(
		actions: Array<Extract<SyncPlanAction, { kind: "resource-download" }>>,
		state: SyncState,
		tick: () => void
	): Promise<Array<{ path: string; error: Error }>> {
		const failures: Array<{ path: string; error: Error }> = [];
		let next = 0;
		const worker = async () => {
			while (next < actions.length) {
				const action = actions[next++];
				if (!action) return;
				try {
					await this.vault.writeBinary(action.destPath, await this.api.downloadResource(action.fileurl));
					state.files[action.destPath] = { timemodified: action.timemodified, filesize: action.filesize };
				} catch (error: unknown) {
					failures.push({ path: action.destPath, error: error instanceof Error ? error : new Error(String(error)) });
				} finally {
					tick();
				}
			}
		};
		await Promise.all(Array.from({ length: Math.min(Math.max(1, this.concurrency), actions.length) }, worker));
		return failures;
	}
}