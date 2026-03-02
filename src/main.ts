import { Notice, Plugin } from "obsidian";
import { MoodleSyncSettingTab, DEFAULT_SETTINGS, MoodleSyncSettings } from "./settings";
import { MoodleClient } from "./moodleClient";
import { DEFAULT_STATE, SyncState } from "./state";
import { runSyncV2, SyncMode, SyncProgress } from "./sync";

export default class MoodleSyncPoCv2 extends Plugin {
	settings: MoodleSyncSettings;
	private statusEl?: HTMLElement;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new MoodleSyncSettingTab(this.app, this));

		this.statusEl = this.addStatusBarItem();
		this.statusEl.setText("Moodle Sync: idle");

		this.addCommand({
			id: "moodle-sync-v2-test",
			name: "Moodle Sync v2: Test connection",
			callback: async () => {
				try {
					const client = this.makeClientOrThrow();
					const site = await client.call<any>("core_webservice_get_site_info");
					new Notice(`OK: ${site.sitename ?? "Moodle"} / ${site.username ?? site.userid}`);
				} catch (e: any) {
					console.error(e);
					new Notice(`Test failed: ${e?.message ?? e}`);
				}
			}
		});

		this.addCommand({
			id: "moodle-sync-v2-apply",
			name: "Moodle Sync v2: Sync now (apply)",
			callback: () => this.run("apply")
		});

		this.addCommand({
			id: "moodle-sync-v2-dryrun",
			name: "Moodle Sync v2: Sync now (dry-run)",
			callback: () => this.run("dry-run")
		});
	}

	onunload() {
		if (this.statusEl) this.statusEl.setText("Moodle Sync: unloaded");
	}

	private makeClientOrThrow(): MoodleClient {
		if (!this.settings.baseUrl || !this.settings.token) {
			throw new Error("Set base URL + token in plugin settings first.");
		}
		return new MoodleClient(this.settings.baseUrl, this.settings.token);
	}

	private async run(mode: SyncMode) {
		try {
			const client = this.makeClientOrThrow();
			const state = await this.loadSyncState();

			const progress: SyncProgress = {
				totalSteps: 0,
				setStatus: (t) => this.statusEl?.setText(t),
				tick: () => { /* reserved */ }
			};

			this.statusEl?.setText(`Moodle Sync: starting (${mode})…`);

			await runSyncV2(
				this.app,
				client,
				this.settings,
				state,
				(s) => this.saveSyncState(s),
				mode,
				progress
			);

			this.statusEl?.setText(`Moodle Sync: idle`);
		} catch (e: any) {
			console.error(e);
			this.statusEl?.setText(`Moodle Sync: error`);
			new Notice(`Sync failed: ${e?.message ?? e}`);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}
	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async loadSyncState(): Promise<SyncState> {
		const data = (await this.loadData()) as any;
		const s = (data?.syncState ?? DEFAULT_STATE) as any;

		// Migration: old schema had notes[path].lastSyncedHash
		if (s?.notes) {
			for (const [path, ns] of Object.entries(s.notes)) {
				if (!ns) continue;
				if ((ns as any).lastSyncedHash && !(ns as any).baseBlocks) {
					(s.notes as any)[path] = { baseBlocks: {}, lastSyncedManagedHash: String((ns as any).lastSyncedHash) };
				}
				if (!(s.notes as any)[path].baseBlocks) (s.notes as any)[path].baseBlocks = {};
				if (!(s.notes as any)[path].lastSyncedManagedHash) (s.notes as any)[path].lastSyncedManagedHash = "";
			}
		}

		return s as SyncState;
	}

	private async saveSyncState(state: SyncState): Promise<void> {
		const data = (await this.loadData()) as any ?? {};
		data.syncState = state;
		await this.saveData(data);
	}
}
