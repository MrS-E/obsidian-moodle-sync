import { SyncState } from "../domain/syncState";
import { simpleHash } from "../util";
import { NoteMergeWriter } from "../vault/vaultGateway";
import { ensureUserSection, extractBlock, upsertBlock } from "./managedBlocks";
import { ensureConflictTags, mergeManagedBlock } from "./mergeEngine";

export interface NoteMergeAction {
	kind: "note-merge";
	operation: "create" | "update";
	path: string;
	text: string;
	remoteBlocks: Record<string, string>;
	conflicted: boolean;
	expectedHash?: string;
	noOp?: boolean;
}

export interface NoteMergeSnapshot {
	path: string;
	text: string;
}

export function planNoteMerge(
	state: SyncState,
	path: string,
	renderedRemoteNoteText: string,
	remoteBlocks: Record<string, string>,
	current: NoteMergeSnapshot | undefined
): NoteMergeAction {
	if (!current) {
		return {
			kind: "note-merge",
			operation: "create",
			path,
			text: ensureUserSection(renderedRemoteNoteText),
			remoteBlocks,
			conflicted: false
		};
	}

	const localText = current.text;
	const noteState = state.notes[path] ?? state.notes[current.path];
	let mergedText = localText;
	let conflicted = false;
	for (const [name, remoteInner] of Object.entries(remoteBlocks)) {
		const local = (extractBlock(localText, name) ?? "").replace(/\s+$/, "");
		const base = (noteState?.baseBlocks[name] ?? local).replace(/\s+$/, "");
		const merged = mergeManagedBlock({ name, base, local, remote: (remoteInner ?? "").replace(/\s+$/, "") });
		mergedText = upsertBlock(mergedText, name, merged.inner);
		conflicted ||= merged.conflicted;
	}
	mergedText = ensureUserSection(mergedText);
	if (conflicted) mergedText = ensureConflictTags(mergedText);
	const currentHash = simpleHash(localText);
	const stateUpToDate = noteState?.lastSyncedManagedHash === hashBlocks(remoteBlocks);
	return {
		kind: "note-merge",
		operation: "update",
		path,
		text: mergedText,
		remoteBlocks,
		conflicted,
		expectedHash: currentHash,
		noOp: currentHash === simpleHash(mergedText) && stateUpToDate
	};
}

export async function applyNoteMerge(vault: NoteMergeWriter, state: SyncState, action: NoteMergeAction): Promise<void> {
	if (action.operation === "create") {
		if (vault.getEntryKind(action.path)) {
			throw new Error(`Cannot create ${action.path}: the file changed after planning. Re-run sync.`);
		}
		await vault.writeText(action.path, action.text);
	} else {
		if (vault.getEntryKind(action.path) !== "file") {
			throw new Error(`Cannot merge ${action.path}: the file changed after planning. Re-run sync.`);
		}
		const current = await vault.readText(action.path);
		if (simpleHash(current) !== action.expectedHash) {
			throw new Error(`Cannot merge ${action.path}: the file changed after planning. Re-run sync.`);
		}
		if (current !== action.text) {
			await vault.writeText(action.path, action.text);
		}
	}

	state.notes[action.path] = {
		baseBlocks: normalizeBlocks(action.remoteBlocks),
		lastSyncedManagedHash: hashBlocks(action.remoteBlocks)
	};
}

function normalizeBlocks(blocks: Record<string, string>): Record<string, string> {
	return Object.fromEntries(Object.entries(blocks).map(([name, value]) => [name, (value ?? "").replace(/\s+$/, "")]));
}

function hashBlocks(blocks: Record<string, string>): string {
	return simpleHash(Object.keys(blocks).sort().map(name => `${name}\n${(blocks[name] ?? "").replace(/\s+$/, "")}`).join("\n\n"));
}