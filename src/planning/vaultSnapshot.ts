import { simpleHash } from "../util";
import { collectMarkdownLinkTargets } from "../migration/linkRewriter";
import { VaultGateway } from "../vault/vaultGateway";

export interface VaultFileSnapshot {
	path: string;
	text: string;
	hash: string;
}

export class VaultSnapshot {
	constructor(
		private readonly paths: Set<string>,
		private readonly files: Map<string, VaultFileSnapshot>,
		private readonly links: Map<string, string | null>
	) {}

	hasPath(path: string): boolean {
		return this.paths.has(path);
	}

	getFile(path: string): VaultFileSnapshot | undefined {
		return this.files.get(path);
	}

	getMarkdownFiles(): VaultFileSnapshot[] {
		return [...this.files.values()];
	}

	resolveLink(sourcePath: string, linkPath: string): string | null {
		return this.links.get(linkKey(sourcePath, linkPath)) ?? null;
	}
}

export class VaultSnapshotReader {
	constructor(private readonly vault: VaultGateway) {}

	async read(): Promise<VaultSnapshot> {
		const paths = this.vault.listPaths();
		const markdownPaths = paths.filter(path => path.toLowerCase().endsWith(".md"));
		const files = new Map<string, VaultFileSnapshot>();
		const links = new Map<string, string | null>();

		for (const path of markdownPaths) {
			const text = await this.vault.readText(path);
			files.set(path, { path, text, hash: simpleHash(text) });
			for (const linkPath of collectMarkdownLinkTargets(text)) {
				links.set(linkKey(path, linkPath), this.vault.resolveLink(path, linkPath));
			}
		}

		return new VaultSnapshot(new Set(paths), files, links);
	}
}

function linkKey(sourcePath: string, linkPath: string): string {
	return `${sourcePath}\u0000${linkPath}`;
}