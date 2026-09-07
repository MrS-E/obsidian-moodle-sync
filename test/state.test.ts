import { describe, expect, it } from "vitest";
import {
	CURRENT_SYNC_STATE_VERSION,
	decodeSyncState,
	DEFAULT_STATE,
	encodeSyncState
} from "../src/state";

describe("state", () => {
	it("starts empty", () => {
		expect(DEFAULT_STATE).toEqual({ schemaVersion: CURRENT_SYNC_STATE_VERSION, pathMigrationVersion: 0, files: {}, notes: {} });
	});

	it("migrates an unversioned state and legacy managed hash", () => {
		expect(decodeSyncState({
			files: { "a.bin": { timemodified: 1, filesize: 2 } },
			notes: { "note.md": { lastSyncedHash: "legacy", baseBlocks: { meta: "hello", invalid: 3 } } }
		})).toEqual({
			schemaVersion: 1,
			pathMigrationVersion: 0,
			files: { "a.bin": { timemodified: 1, filesize: 2 } },
			notes: { "note.md": { lastSyncedManagedHash: "legacy", baseBlocks: { meta: "hello", invalid: "" } } }
		});
	});

	it("encodes only the current schema and refuses unknown future versions", () => {
		expect(encodeSyncState({ schemaVersion: 1, pathMigrationVersion: 0, files: {}, notes: {} })).toEqual({
			schemaVersion: 1,
			pathMigrationVersion: 0,
			files: {},
			notes: {}
		});
		expect(() => decodeSyncState({ schemaVersion: 2, files: {}, notes: {} })).toThrow(
			"Unsupported sync state schema version: 2"
		);
	});
});
