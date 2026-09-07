import { App, Notice } from "obsidian";
import { MoodleApi } from "./api/moodleApi";
import { SyncState } from "./domain/syncState";
import { SyncProgress } from "./execution/planExecutor";
import { SyncMode } from "./planning/actions";
import { createSyncPlan } from "./planning/syncPlanner";
import { ObsidianVaultGateway } from "./vault/obsidianVaultGateway";
import { MoodleSyncService, renderSyncSummary, SyncServiceSettings } from "./sync/syncService";

export type { SyncMode } from "./planning/actions";
export type { SyncProgress } from "./execution/planExecutor";

export async function runSyncV2(
	app: App,
	api: MoodleApi,
	settings: SyncServiceSettings,
	state: SyncState,
	saveState: (state: SyncState) => Promise<void>,
	mode: SyncMode,
	progress: SyncProgress
): Promise<void> {
	const service = new MoodleSyncService(api, new ObsidianVaultGateway(app));
	const result = await service.run(settings, state, saveState, mode, progress);
	new Notice(result.summary, 8000);
}

export const __test__ = { createSyncPlan, renderSyncSummary };