export const CURRENT_SYNC_STATE_VERSION = 1 as const;
export const CURRENT_PATH_MIGRATION_VERSION = 1 as const;

export interface FileState {
	timemodified?: number;
	filesize?: number;
}

export interface NoteState {
	/**
	 * Last synced remote-managed blocks ("base" for 3-way merge).
	 * Keys are block names like: meta, content, resources, index.
	 */
	baseBlocks: Record<string, string>;

	/**
	 * Optional: hash of concatenated baseBlocks to quickly detect "local unchanged since last sync".
	 */
	lastSyncedManagedHash: string;
}

export interface SyncState {
	schemaVersion: typeof CURRENT_SYNC_STATE_VERSION;
	pathMigrationVersion: number;
	files: Record<string, FileState>;
	notes: Record<string, NoteState>;
}

export const DEFAULT_SYNC_STATE: SyncState = {
	schemaVersion: CURRENT_SYNC_STATE_VERSION,
	pathMigrationVersion: 0,
	files: {},
	notes: {}
};

export function decodeSyncState(value: unknown): SyncState {
	if (!isRecord(value)) {
		return emptySyncState();
	}

	if (value.schemaVersion !== undefined && value.schemaVersion !== CURRENT_SYNC_STATE_VERSION) {
		throw new Error(`Unsupported sync state schema version: ${formatSchemaVersion(value.schemaVersion)}`);
	}

	return {
		schemaVersion: CURRENT_SYNC_STATE_VERSION,
		pathMigrationVersion: decodePathMigrationVersion(value.pathMigrationVersion),
		files: isRecord(value.files) ? normalizeFiles(value.files) : {},
		notes: isRecord(value.notes) ? normalizeNotes(value.notes) : {}
	};
}

export function encodeSyncState(state: SyncState): SyncState {
	return decodeSyncState(state);
}

export function normalizeFiles(value: Record<string, unknown>): SyncState["files"] {
	const files: SyncState["files"] = {};
	for (const [path, entry] of Object.entries(value)) {
		if (!isRecord(entry)) {
			continue;
		}

		files[path] = {
			timemodified: isFiniteNumber(entry.timemodified) ? entry.timemodified : undefined,
			filesize: isFiniteNumber(entry.filesize) ? entry.filesize : undefined
		};
	}
	return files;
}

export function normalizeNotes(value: Record<string, unknown>): SyncState["notes"] {
	const notes: SyncState["notes"] = {};
	for (const [path, entry] of Object.entries(value)) {
		const normalized = normalizeNoteState(entry);
		if (normalized) {
			notes[path] = normalized;
		}
	}
	return notes;
}

export function normalizeNoteState(value: unknown): NoteState | null {
	if (!isRecord(value)) {
		return null;
	}

	const baseBlocks = isRecord(value.baseBlocks) ? normalizeBaseBlocks(value.baseBlocks) : {};
	const lastSyncedManagedHash = typeof value.lastSyncedManagedHash === "string"
		? value.lastSyncedManagedHash
		: typeof value.lastSyncedHash === "string"
			? value.lastSyncedHash
			: "";

	return { baseBlocks, lastSyncedManagedHash };
}

export function normalizeBaseBlocks(value: Record<string, unknown>): Record<string, string> {
	const blocks: Record<string, string> = {};
	for (const [name, block] of Object.entries(value)) {
		blocks[name] = typeof block === "string" ? block : "";
	}
	return blocks;
}

function emptySyncState(): SyncState {
	return {
		schemaVersion: CURRENT_SYNC_STATE_VERSION,
		pathMigrationVersion: 0,
		files: {},
		notes: {}
	};
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function decodePathMigrationVersion(value: unknown): number {
	if (value === undefined) {
		return 0;
	}
	if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
		return 0;
	}
	if (value > CURRENT_PATH_MIGRATION_VERSION) {
		throw new Error(`Unsupported path migration version: ${value}`);
	}
	return value;
}

function formatSchemaVersion(value: unknown): string {
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return value === null ? "null" : "invalid";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}