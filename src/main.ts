import { Notice, Plugin } from "obsidian";
import { MoodleSyncSettingTab, DEFAULT_SETTINGS, MoodleSyncSettings } from "./settings";
import { MoodleApi, MoodleWebServiceApi } from "./api/moodleApi";
import { MoodleRestTransport } from "./api/moodleTransport";
import { decodeSyncState, encodeSyncState, SyncState } from "./domain/syncState";
import { runSyncV2, SyncMode, SyncProgress } from "./sync";

interface PersistedPluginData extends Partial<MoodleSyncSettings> {
	syncState?: unknown;
}

export default class MoodleSyncPoCv2 extends Plugin {
	settings: MoodleSyncSettings;
	private statusEl?: HTMLElement;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new MoodleSyncSettingTab(this.app, this));

		this.statusEl = this.addStatusBarItem();
		this.statusEl.setText("Moodle sync: idle");

		this.addCommand({
			id: "test-connection",
			name: "Test connection",
			callback: async () => {
				try {
					const client = this.makeApiOrThrow();
					const site = await client.getSiteInfo();
					new Notice(`OK: ${site.sitename ?? "Moodle"} / ${site.username ?? site.userid}`);
				} catch (e: unknown) {
					console.error(e);
					new Notice(`Test failed: ${getErrorMessage(e)}`);
				}
			}
		});

		this.addCommand({
			id: "sync-now-apply",
			name: "Sync now (apply)",
			callback: () => this.run("apply")
		});

		this.addCommand({
			id: "sync-now-dry-run",
			name: "Sync now (dry-run)",
			callback: () => this.run("dry-run")
		});
	}

	onunload() {
		if (this.statusEl) this.statusEl.setText("Moodle sync: unloaded");
	}

	private makeApiOrThrow(): MoodleApi {
		if (!this.settings.baseUrl || !this.settings.token) {
			throw new Error("Set base URL + token in plugin settings first.");
		}
		return new MoodleWebServiceApi(new MoodleRestTransport(this.settings.baseUrl, this.settings.token));
	}

	private async run(mode: SyncMode) {
		try {
			const client = this.makeApiOrThrow();
			const state = await this.loadSyncState();

			const progress: SyncProgress = {
				totalSteps: 0,
				setStatus: (t) => this.statusEl?.setText(t),
				tick: () => { /* reserved */ }
			};

			this.statusEl?.setText(`Moodle sync: starting (${mode})...`);

			await runSyncV2(
				this.app,
				client,
				this.settings,
				state,
				(s) => this.saveSyncState(s),
				mode,
				progress
			);

			this.statusEl?.setText("Moodle sync: idle");
		} catch (e: unknown) {
			console.error(e);
			this.statusEl?.setText("Moodle sync: error");
			new Notice(`Sync failed: ${getErrorMessage(e)}`);
		}
	}

	async loadSettings() {
		const data = await this.loadPluginData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	}
	async saveSettings() {
		const data = await this.loadPluginData();
		await this.saveData({
			...data,
			...this.settings
		});
	}

	private async loadSyncState(): Promise<SyncState> {
		const data = await this.loadPluginData();
		return decodeSyncState(data.syncState);
	}

	private async saveSyncState(state: SyncState): Promise<void> {
		const data = await this.loadPluginData();
		await this.saveData({
			...data,
			syncState: encodeSyncState(state)
		});
	}

	private async loadPluginData(): Promise<PersistedPluginData> {
		const data: unknown = await this.loadData();
		return isRecord(data) ? data : {};
	}
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export const __test__ = {
	decodeSyncState,
	encodeSyncState,
	getErrorMessage,
	isRecord
};
