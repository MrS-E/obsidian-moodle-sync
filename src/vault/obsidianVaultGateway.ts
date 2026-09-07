import { App, TFile, TFolder } from "obsidian";
import { parentPath } from "../planning/pathUtils";
import { VaultEntryKind, VaultGateway } from "./vaultGateway";

export class ObsidianVaultGateway implements VaultGateway {
	constructor(private readonly app: App) {}

	getEntryKind(path: string): VaultEntryKind | null {
		const entry = this.app.vault.getAbstractFileByPath(path);
		if (entry instanceof TFile) return "file";
		if (entry instanceof TFolder) return "folder";
		return null;
	}

	listPaths(): string[] {
		return this.app.vault.getAllLoadedFiles().map(entry => entry.path);
	}

	async readText(path: string): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			throw new Error(`Cannot read ${path}: the file is no longer available.`);
		}
		return await this.app.vault.read(file);
	}

	resolveLink(sourcePath: string, linkPath: string): string | null {
		return this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath)?.path ?? null;
	}

	async ensureFolder(path: string): Promise<void> {
		if (!path || this.getEntryKind(path) === "folder") return;
		if (this.getEntryKind(path) === "file") {
			throw new Error(`${path} exists but is not a folder.`);
		}
		await this.ensureFolder(parentPath(path));
		await this.app.vault.createFolder(path);
	}

	async move(path: string, destination: string, kind: VaultEntryKind): Promise<void> {
		const entry = this.app.vault.getAbstractFileByPath(path);
		if (!entry) throw new Error(`Cannot migrate ${path}: the source is no longer available.`);
		if (kind === "file" && !(entry instanceof TFile)) throw new Error(`Cannot migrate ${path}: expected a file.`);
		if (kind === "folder" && !(entry instanceof TFolder)) throw new Error(`Cannot migrate ${path}: expected a folder.`);
		if (this.app.vault.getAbstractFileByPath(destination)) {
			throw new Error(`Cannot migrate ${path}: destination ${destination} already exists.`);
		}
		await this.ensureFolder(parentPath(destination));
		await this.app.vault.rename(entry, destination);
	}

	async writeText(path: string, text: string): Promise<void> {
		const entry = this.app.vault.getAbstractFileByPath(path);
		if (!entry) {
			await this.ensureFolder(parentPath(path));
			await this.app.vault.create(path, text);
			return;
		}
		if (!(entry instanceof TFile)) throw new Error(`${path} exists and is not a file.`);
		const current = await this.app.vault.read(entry);
		if (current !== text) await this.app.vault.modify(entry, text);
	}

	async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
		const entry = this.app.vault.getAbstractFileByPath(path);
		if (!entry) {
			await this.ensureFolder(parentPath(path));
			await this.app.vault.createBinary(path, data);
			return;
		}
		if (!(entry instanceof TFile)) throw new Error(`${path} exists and is not a file.`);
		await this.app.vault.modifyBinary(entry, data);
	}
}