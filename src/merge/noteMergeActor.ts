import { App, TFile } from "obsidian";
import { SyncState } from "../domain/syncState";
import { simpleHash } from "../util";
import { ensureUserSection, extractBlock, upsertBlock } from "./managedBlocks";
import { ensureConflictTags, mergeManagedBlock } from "./mergeEngine";

export type NoteMergeAction =
	| { kind: "note-create"; path: string; text: string; remoteBlocks: Record<string, string>; conflicted: boolean }
	| { kind: "note-update"; path: string; text: string; remoteBlocks: Record<string, string>; conflicted: boolean; expectedHash: string; noOp?: boolean };

export async function planNoteMerge(
	app: App,
	state: SyncState,
	path: string,
	renderedRemoteNoteText: string,
	remoteBlocks: Record<string, string>,
	legacyPath = path
): Promise<NoteMergeAction> {
	const abstractFile = app.vault.getAbstractFileByPath(legacyPath) ?? app.vault.getAbstractFileByPath(path);
	if (!abstractFile) {
		return { kind: "note-create", path, text: ensureUserSection(renderedRemoteNoteText), remoteBlocks, conflicted: false };
	}
	if (!(abstractFile instanceof TFile)) {
		throw new Error(`Cannot merge ${path}: the destination is not a file.`);
	}

	const localText = await app.vault.read(abstractFile);
	const noteState = state.notes[path] ?? state.notes[legacyPath];
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
		kind: "note-update",
		path,
		text: mergedText,
		remoteBlocks,
		conflicted,
		expectedHash: currentHash,
		noOp: currentHash === simpleHash(mergedText) && stateUpToDate
	};
}

export async function applyNoteMerge(app: App, state: SyncState, action: NoteMergeAction): Promise<void> {
	if (action.kind === "note-create") {
		if (app.vault.getAbstractFileByPath(action.path)) {
			throw new Error(`Cannot create ${action.path}: the file changed after planning. Re-run sync.`);
		}
		await app.vault.create(action.path, action.text);
	} else {
		const file = app.vault.getAbstractFileByPath(action.path);
		if (!(file instanceof TFile)) {
			throw new Error(`Cannot merge ${action.path}: the file changed after planning. Re-run sync.`);
		}
		const current = await app.vault.read(file);
		if (simpleHash(current) !== action.expectedHash) {
			throw new Error(`Cannot merge ${action.path}: the file changed after planning. Re-run sync.`);
		}
		if (current !== action.text) {
			await app.vault.modify(file, action.text);
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