export {
	CURRENT_SYNC_STATE_VERSION,
	CURRENT_PATH_MIGRATION_VERSION,
	DEFAULT_SYNC_STATE,
	DEFAULT_SYNC_STATE as DEFAULT_STATE,
	decodeSyncState,
	encodeSyncState,
	normalizeBaseBlocks,
	normalizeFiles,
	normalizeNoteState,
	normalizeNotes
} from "./domain/syncState";
export type { FileState, NoteState, SyncState } from "./domain/syncState";
