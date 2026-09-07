import { Plugin } from "obsidian";
import { MoodleSyncSettingTab, DEFAULT_SETTINGS, MoodleSyncSettings } from "./settings";
import { decodeSyncState, encodeSyncState, SyncState } from "./domain/syncState";
import { registerCommands } from "./commands/registerCommands";

interface PersistedPluginData extends Partial<MoodleSyncSettings> {
	syncState?: unknown;
	convertHtmlToMarkdown?: unknown;
}

export default class MoodleSyncPoCv2 extends Plugin {
	settings: MoodleSyncSettings;
	private statusEl?: HTMLElement;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new MoodleSyncSettingTab(this.app, this));

		this.statusEl = this.addStatusBarItem();
		this.statusEl.setText("Moodle sync: idle");

		registerCommands({
			app: this.app,
			settings: this.settings,
			addCommand: command => this.addCommand(command),
			loadSyncState: () => this.loadSyncState(),
			saveSyncState: state => this.saveSyncState(state),
			setStatus: status => this.statusEl?.setText(status)
		});
	}

	onunload() {
		if (this.statusEl) this.statusEl.setText("Moodle sync: unloaded");
	}

	async loadSettings() {
		const data = await this.loadPluginData();
		const settings = { ...data };
		delete settings.syncState;
		delete settings.convertHtmlToMarkdown;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, settings);
	}
	async saveSettings() {
		const data = await this.loadPluginData();
		const syncState = data.syncState;
		const settings = { ...data };
		delete settings.syncState;
		delete settings.convertHtmlToMarkdown;
		await this.saveData({
			...settings,
			...this.settings,
			...(syncState === undefined ? {} : { syncState })
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export const __test__ = {
	decodeSyncState,
	encodeSyncState,
	isRecord
};
