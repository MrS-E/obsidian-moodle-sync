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
	files: Record<string, FileState>;   // keyed by vault path
	notes: Record<string, NoteState>;   // keyed by vault path
}

export const DEFAULT_STATE: SyncState = {
	files: {},
	notes: {}
};
