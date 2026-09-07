import { FileState, NoteState, SyncState } from "../domain/syncState";

export { CURRENT_PATH_MIGRATION_VERSION } from "../domain/syncState";

export type ManagedPathKind = "file" | "folder";

export interface ManagedPathMapping {
	from: string;
	to: string;
	kind: ManagedPathKind;
}

export interface PathMigration {
	mappings: ManagedPathMapping[];
	moves: ManagedPathMapping[];
}

export function createPathMigration(
	mappings: ManagedPathMapping[],
	exists: (path: string) => boolean
): PathMigration {
	const uniqueMappings = uniquePathMappings(mappings);
	assertUnambiguousTargets(uniqueMappings);

	const candidates = uniqueMappings
		.filter(mapping => mapping.from !== mapping.to && exists(mapping.from))
		.sort(compareMoves);
	const moves: ManagedPathMapping[] = [];
	for (const candidate of candidates) {
		if (projectMigratedPath(candidate.from, moves) !== candidate.to) {
			moves.push(candidate);
		}
	}

	for (const move of moves) {
		if (exists(move.to)) {
			throw new Error(`Cannot migrate ${move.from}: destination ${move.to} already exists.`);
		}
	}

	return { mappings: uniqueMappings, moves };
}

export function projectMigratedPath(path: string, mappings: ManagedPathMapping[]): string {
	let projected = path;
	const ordered = [...mappings].sort((left, right) => right.from.length - left.from.length);
	for (const mapping of ordered) {
		if (projected === mapping.from) {
			return mapping.to;
		}
		if (projected.startsWith(`${mapping.from}/`)) {
			return `${mapping.to}${projected.slice(mapping.from.length)}`;
		}
	}
	return projected;
}

export function remapSyncState(state: SyncState, mappings: ManagedPathMapping[]): SyncState {
	return {
		...state,
		files: remapStateEntries(state.files, mappings),
		notes: remapStateEntries(state.notes, mappings)
	};
}

function uniquePathMappings(mappings: ManagedPathMapping[]): ManagedPathMapping[] {
	const bySource = new Map<string, ManagedPathMapping>();
	for (const mapping of mappings) {
		if (mapping.from === mapping.to) {
			continue;
		}
		const existing = bySource.get(mapping.from);
		if (existing && (existing.to !== mapping.to || existing.kind !== mapping.kind)) {
			throw new Error(`Cannot migrate ${mapping.from}: it maps to more than one destination.`);
		}
		bySource.set(mapping.from, mapping);
	}
	return [...bySource.values()];
}

function assertUnambiguousTargets(mappings: ManagedPathMapping[]): void {
	const sourcesByTarget = new Map<string, string>();
	for (const mapping of mappings) {
		const source = sourcesByTarget.get(mapping.to);
		if (source && source !== mapping.from) {
			throw new Error(`Cannot migrate ${mapping.to}: multiple managed paths target the same destination.`);
		}
		sourcesByTarget.set(mapping.to, mapping.from);
	}
}

function compareMoves(left: ManagedPathMapping, right: ManagedPathMapping): number {
	const leftDepth = pathDepth(left.from);
	const rightDepth = pathDepth(right.from);
	return leftDepth - rightDepth || (left.kind === right.kind ? 0 : left.kind === "folder" ? -1 : 1) || left.from.localeCompare(right.from);
}

function pathDepth(path: string): number {
	return path.split("/").length;
}

function remapStateEntries<T extends FileState | NoteState>(
	entries: Record<string, T>,
	mappings: ManagedPathMapping[]
): Record<string, T> {
	const remapped: Record<string, T> = {};
	for (const [path, entry] of Object.entries(entries)) {
		const target = projectMigratedPath(path, mappings);
		if (remapped[target]) {
			throw new Error(`Cannot remap sync state: multiple entries target ${target}.`);
		}
		remapped[target] = entry;
	}
	return remapped;
}