import { App, Notice, Plugin } from "obsidian";
import { MoodleApi, MoodleWebServiceApi } from "../api/moodleApi";
import { MoodleRestTransport } from "../api/moodleTransport";
import { SyncState } from "../domain/syncState";
import { SyncMode } from "../planning/actions";
import { MoodleSyncService, SyncServiceSettings } from "../sync/syncService";
import { ObsidianVaultGateway } from "../vault/obsidianVaultGateway";
import { SyncProgress } from "../execution/planExecutor";

export interface CommandHost {
	app: App;
	settings: SyncServiceSettings & { baseUrl: string; token: string };
	addCommand: Plugin["addCommand"];
	loadSyncState(): Promise<SyncState>;
	saveSyncState(state: SyncState): Promise<void>;
	setStatus(status: string): void;
}

export function registerCommands(host: CommandHost): void {
	host.addCommand({
		id: "test-connection",
		name: "Test connection",
		callback: async () => {
			try {
				const site = await createMoodleApi(host.settings).getSiteInfo();
				new Notice(`OK: ${site.sitename ?? "Moodle"} / ${site.username ?? site.userid}`);
			} catch (error: unknown) {
				console.error(error);
				new Notice(`Test failed: ${getErrorMessage(error)}`);
			}
		}
	});

	host.addCommand({
		id: "sync-now-apply",
		name: "Sync now (apply)",
		callback: async () => { await runSync(host, "apply"); }
	});

	host.addCommand({
		id: "sync-now-dry-run",
		name: "Sync now (dry-run)",
		callback: async () => { await runSync(host, "dry-run"); }
	});
}

export function createMoodleApi(settings: Pick<CommandHost["settings"], "baseUrl" | "token">): MoodleApi {
	if (!settings.baseUrl || !settings.token) {
		throw new Error("Set base URL + token in plugin settings first.");
	}
	return new MoodleWebServiceApi(new MoodleRestTransport(settings.baseUrl, settings.token));
}

async function runSync(host: CommandHost, mode: SyncMode): Promise<void> {
	try {
		host.setStatus(`Moodle sync: starting (${mode})...`);
		const service = new MoodleSyncService(createMoodleApi(host.settings), new ObsidianVaultGateway(host.app));
		const result = await service.run(host.settings, await host.loadSyncState(), state => host.saveSyncState(state), mode, createProgress(host));
		new Notice(result.summary, 8000);
		host.setStatus("Moodle sync: idle");
	} catch (error: unknown) {
		console.error(error);
		host.setStatus("Moodle sync: error");
		new Notice(`Sync failed: ${getErrorMessage(error)}`);
	}
}

function createProgress(host: CommandHost): SyncProgress {
	return {
		totalSteps: 0,
		setStatus: status => host.setStatus(status),
		tick: () => { /* Status is updated by setStatus. */ }
	};
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}