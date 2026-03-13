import { Notice, Plugin } from "obsidian";
import { MoodleSyncSettingTab, DEFAULT_SETTINGS, MoodleSyncSettings } from "./settings";
import { MoodleClient, MoodleSiteInfo } from "./moodleClient";
import { DEFAULT_STATE, NoteState, SyncState } from "./state";
import { formatProgressStatus, runSyncV2, SuspendedSyncRun, SyncCancelledError, SyncMode, SyncProgress, SyncProgressSnapshot } from "./sync";

interface PersistedPluginData extends Partial<MoodleSyncSettings> {
	syncState?: unknown;
	suspendedRun?: unknown;
}

interface LegacyNoteState {
	lastSyncedHash?: unknown;
	baseBlocks?: unknown;
	lastSyncedManagedHash?: unknown;
}

export default class MoodleSyncPoCv2 extends Plugin {
	settings: MoodleSyncSettings;
	private statusEl?: HTMLElement;
	private suspendedRun: SuspendedSyncRun | null = null;
	private readonly taskQueue: QueueTask[] = [];
	private activeTask: QueueTask | null = null;
	private cancelRequested = false;
	private nextTaskId = 1;

	async onload() {
		await this.loadSettings();
		this.suspendedRun = await this.loadSuspendedRun();
		this.addSettingTab(new MoodleSyncSettingTab(this.app, this));

		this.statusEl = this.addStatusBarItem();
		this.setStatusText("Moodle sync: idle");

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
			callback: () => this.enqueueRun("apply")
		});

		this.addCommand({
			id: "sync-now-dry-run",
			name: "Sync now (dry-run)",
			callback: () => this.enqueueRun("dry-run")
		});

		this.addCommand({
			id: "cancel-sync",
			name: "Cancel sync",
			callback: () => this.cancelCurrentTask()
		});

		this.addCommand({
			id: "resume-sync",
			name: "Resume sync",
			callback: () => this.enqueueResume()
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

	private enqueueRun(mode: SyncMode) {
		const task: QueueTask = {
			id: this.nextTaskId++,
			kind: "run",
			mode
		};
		this.taskQueue.push(task);
		new Notice(this.activeTask ? `Sync queued (${mode}).` : `Sync started (${mode}).`);
		this.updateQueueStatus();
		void this.processQueue();
	}

	private enqueueResume() {
		if (!this.suspendedRun) {
			new Notice("No suspended sync is available to resume.");
			return;
		}
		const task: QueueTask = {
			id: this.nextTaskId++,
			kind: "resume",
			mode: this.suspendedRun.mode
		};
		this.taskQueue.push(task);
		new Notice(this.activeTask ? "Resume queued." : "Resuming sync.");
		this.updateQueueStatus();
		void this.processQueue();
	}

	private cancelCurrentTask() {
		if (!this.activeTask) {
			new Notice("No sync is currently running.");
			return;
		}
		this.cancelRequested = true;
		this.setStatusText("Moodle sync: cancel requested");
		new Notice("Sync cancellation requested.");
	}

	private async processQueue() {
		if (this.activeTask) {
			return;
		}

		const task = this.taskQueue.shift();
		if (!task) {
			this.updateQueueStatus();
			return;
		}

		this.activeTask = task;
		this.cancelRequested = false;
		this.updateQueueStatus();

		try {
			const client = this.makeClientOrThrow();
			const state = await this.loadSyncState();
			const resumeFrom = task.kind === "resume" ? this.suspendedRun : null;
			const mode = resumeFrom?.mode ?? task.mode;

			const progress: SyncProgress = {
				totalSteps: 0,
				setStatus: (text) => this.setStatusText(text),
				tick: (snapshot) => this.handleProgress(snapshot)
			};

			this.setStatusText(task.kind === "resume" ? "Moodle sync: resuming..." : `Moodle sync: starting (${mode})...`);

			await runSyncV2(
				this.app,
				client,
				this.settings,
				state,
				(s) => this.saveSyncState(s),
				mode,
				progress,
				{
					resumeFrom,
					shouldCancel: () => this.cancelRequested,
					onCheckpoint: async (run) => {
						this.suspendedRun = run;
						await this.saveSuspendedRun(run);
					}
				}
			);

			this.setStatusText("Moodle sync: idle");
			if (task.kind === "resume") {
				new Notice("Sync resumed and completed.");
			}
		} catch (e: unknown) {
			console.error(e);
			if (e instanceof SyncCancelledError) {
				this.setStatusText("Moodle sync: cancelled");
				new Notice("Sync cancelled. Use Resume sync to continue.");
			} else {
				this.setStatusText("Moodle sync: error");
				new Notice(`Sync failed: ${getErrorMessage(e)}`);
				if (this.suspendedRun) {
					new Notice("Resume sync is available for remaining work.");
				}
			}
		} finally {
			this.activeTask = null;
			this.cancelRequested = false;
			this.updateQueueStatus();
			void this.processQueue();
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

	private async loadSuspendedRun(): Promise<SuspendedSyncRun | null> {
		const data = await this.loadPluginData();
		return normalizeSuspendedRun(data.suspendedRun);
	}

	private async saveSuspendedRun(run: SuspendedSyncRun | null): Promise<void> {
		const data = await this.loadPluginData();
		await this.saveData({
			...data,
			suspendedRun: run ?? null
		});
	}

	private async loadPluginData(): Promise<PersistedPluginData> {
		const data: unknown = await this.loadData();
		return isRecord(data) ? data : {};
	}

	private handleProgress(snapshot?: SyncProgressSnapshot) {
		if (!snapshot) {
			return;
		}
		this.setStatusText(formatProgressStatus(snapshot));
	}

	private updateQueueStatus() {
		if (this.activeTask) {
			const queued = this.taskQueue.length;
			const suffix = queued > 0 ? ` (${queued} queued)` : "";
			if (!this.statusEl?.textContent?.trim()) {
				this.setStatusText(`Moodle sync: running${suffix}`);
			}
			return;
		}
		if (this.taskQueue.length > 0) {
			this.setStatusText(`Moodle sync: queued (${this.taskQueue.length})`);
			return;
		}
		if (this.statusEl?.textContent?.startsWith("Moodle sync: idle")) {
			return;
		}
		if (this.statusEl?.textContent?.startsWith("Moodle sync: cancelled")) {
			return;
		}
		if (this.statusEl?.textContent?.startsWith("Moodle sync: error")) {
			return;
		}
		this.setStatusText("Moodle sync: idle");
	}

	private setStatusText(text: string) {
		this.statusEl?.setText(text);
	}
}

type QueueTask = {
	id: number;
	kind: "run" | "resume";
	mode: SyncMode;
};

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

function normalizeSuspendedRun(value: unknown): SuspendedSyncRun | null {
	if (!isRecord(value)) {
		return null;
	}

	const mode = value.mode === "apply" || value.mode === "dry-run" ? value.mode : null;
	const plan = value.plan;
	const completedActions = Array.isArray(value.completedActions)
		? [...new Set(value.completedActions.filter((entry): entry is number => typeof entry === "number" && entry >= 0))]
		: [];

	if (!mode || !isSyncPlanLike(plan)) {
		return null;
	}

	return {
		mode,
		plan,
		completedActions
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isSyncPlanLike(value: unknown): value is SuspendedSyncRun["plan"] {
	return isRecord(value) && Array.isArray(value.actions) && isRecord(value.summary) && isRecord(value.meta);
}

export const __test__ = {
	normalizeSyncState,
	normalizeFiles,
	normalizeNotes,
	normalizeNoteState,
	normalizeBaseBlocks,
	normalizeSuspendedRun,
	getErrorMessage,
	isRecord,
	isSyncPlanLike
};
