export interface FileState {
	timemodified?: number;
	filesize?: number;
}

export interface NoteState {
	lastSyncedHash: string;
}

export interface SyncState {
	files: Record<string, FileState>;   // keyed by vault path
	notes: Record<string, NoteState>;   // keyed by vault path
}

export const DEFAULT_STATE: SyncState = {
	files: {},
	notes: {}
};
