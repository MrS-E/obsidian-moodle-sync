import { Notice, Plugin } from "obsidian";
import { MoodleSyncSettingTab, DEFAULT_SETTINGS, MoodleSyncSettings } from "./settings";
import { MoodleClient } from "./moodleClient";
import { DEFAULT_STATE, SyncState } from "./state";
import { runSync } from "./sync";

export default class MoodleSyncPoC extends Plugin {
	settings: MoodleSyncSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new MoodleSyncSettingTab(this.app, this));

		this.addCommand({
			id: "moodle-sync-poc-now",
			name: "Moodle Sync PoC: Sync now",
			callback: async () => {
				try {
					if (!this.settings.baseUrl || !this.settings.token) {
						new Notice("Set base URL + token in plugin settings first.");
						return;
					}
					const client = new MoodleClient(this.settings.baseUrl, this.settings.token);
					const state = await this.loadSyncState();
					await runSync(this.app, client, this.settings, state, (s) => this.saveSyncState(s));
				} catch (e: any) {
					console.error(e);
					new Notice(`Sync failed: ${e?.message ?? e}`);
				}
			}
		});

		this.addCommand({
			id: "moodle-sync-poc-test-connection",
			name: "Moodle Sync PoC: Test connection",
			callback: async () => {
				try {
					if (!this.settings.baseUrl || !this.settings.token) {
						new Notice("Set base URL + token first.");
						return;
					}
					const client = new MoodleClient(this.settings.baseUrl, this.settings.token);
					const site = await client.call<any>("core_webservice_get_site_info");
					new Notice(`OK: ${site.sitename ?? "Moodle"} / ${site.username ?? site.userid}`);
				} catch (e: any) {
					console.error(e);
					new Notice(`Test failed: ${e?.message ?? e}`);
				}
			}
		});
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async loadSyncState(): Promise<SyncState> {
		const data = (await this.loadData()) as any;
		return (data?.syncState ?? DEFAULT_STATE) as SyncState;
	}

	private async saveSyncState(state: SyncState): Promise<void> {
		const data = (await this.loadData()) as any ?? {};
		data.syncState = state;
		await this.saveData(data);
	}
}
