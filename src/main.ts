import { Notice, Plugin } from "obsidian";
import { MoodleSyncSettingTab, DEFAULT_SETTINGS, MoodleSyncSettings } from "./settings";
import { MoodleClient, MoodleSiteInfo } from "./moodleClient";
import { DEFAULT_STATE, NoteState, SyncState } from "./state";
import { runSyncV2, SyncMode, SyncProgress } from "./sync";

interface PersistedPluginData extends Partial<MoodleSyncSettings> {
	syncState?: unknown;
}

interface LegacyNoteState {
	lastSyncedHash?: unknown;
	baseBlocks?: unknown;
	lastSyncedManagedHash?: unknown;
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
					const client = this.makeClientOrThrow();
					const site = await client.call<MoodleSiteInfo>("core_webservice_get_site_info");
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
		return normalizeSyncState(data.syncState);
	}

	private async saveSyncState(state: SyncState): Promise<void> {
		const data = await this.loadPluginData();
		await this.saveData({
			...data,
			syncState: state
		});
	}

	private async loadPluginData(): Promise<PersistedPluginData> {
		const data: unknown = await this.loadData();
		return isRecord(data) ? data : {};
	}
}

function normalizeSyncState(value: unknown): SyncState {
	if (!isRecord(value)) {
		return structuredClone(DEFAULT_STATE);
	}

	const files = isRecord(value.files) ? normalizeFiles(value.files) : {};
	const notes = isRecord(value.notes) ? normalizeNotes(value.notes) : {};

	return { files, notes };
}

function normalizeFiles(value: Record<string, unknown>): SyncState["files"] {
	const files: SyncState["files"] = {};
	for (const [path, entry] of Object.entries(value)) {
		if (!isRecord(entry)) {
			continue;
		}

		files[path] = {
			timemodified: typeof entry.timemodified === "number" ? entry.timemodified : undefined,
			filesize: typeof entry.filesize === "number" ? entry.filesize : undefined
		};
	}
	return files;
}

function normalizeNotes(value: Record<string, unknown>): SyncState["notes"] {
	const notes: SyncState["notes"] = {};
	for (const [path, entry] of Object.entries(value)) {
		const normalized = normalizeNoteState(entry);
		if (normalized) {
			notes[path] = normalized;
		}
	}
	return notes;
}

function normalizeNoteState(value: unknown): NoteState | null {
	if (!isRecord(value)) {
		return null;
	}

	const legacy = value as LegacyNoteState;
	const baseBlocks = isRecord(legacy.baseBlocks) ? normalizeBaseBlocks(legacy.baseBlocks) : {};
	const lastSyncedManagedHash = typeof legacy.lastSyncedManagedHash === "string"
		? legacy.lastSyncedManagedHash
		: typeof legacy.lastSyncedHash === "string"
			? legacy.lastSyncedHash
			: "";

	return {
		baseBlocks,
		lastSyncedManagedHash
	};
}

function normalizeBaseBlocks(value: Record<string, unknown>): Record<string, string> {
	const blocks: Record<string, string> = {};
	for (const [name, block] of Object.entries(value)) {
		blocks[name] = typeof block === "string" ? block : "";
	}
	return blocks;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
