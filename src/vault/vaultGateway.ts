export type VaultEntryKind = "file" | "folder";

export interface VaultGateway {
	getEntryKind(path: string): VaultEntryKind | null;
	listPaths(): string[];
	readText(path: string): Promise<string>;
	resolveLink(sourcePath: string, linkPath: string): string | null;
	ensureFolder(path: string): Promise<void>;
	move(path: string, destination: string, kind: VaultEntryKind): Promise<void>;
	writeText(path: string, text: string): Promise<void>;
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
}

export interface NoteMergeWriter {
	getEntryKind(path: string): VaultEntryKind | null;
	readText(path: string): Promise<string>;
	writeText(path: string, text: string): Promise<void>;
}