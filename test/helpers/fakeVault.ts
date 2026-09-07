import { TFile, TFolder } from "../obsidian";

type FileEntry = {
	file: TFile;
	text?: string;
	binary?: ArrayBuffer;
};

export function createFakeApp() {
	const folders = new Map<string, TFolder>();
	const files = new Map<string, FileEntry>();

	const vault = {
		getAbstractFileByPath(path: string): TFile | TFolder | null {
			return files.get(path)?.file ?? folders.get(path) ?? null;
		},
		async createFolder(path: string): Promise<TFolder> {
			const folder = new TFolder(path);
			folders.set(path, folder);
			return folder;
		},
		async create(path: string, text: string): Promise<TFile> {
			const file = new TFile(path);
			files.set(path, { file, text });
			return file;
		},
		async createBinary(path: string, binary: ArrayBuffer): Promise<TFile> {
			const file = new TFile(path);
			files.set(path, { file, binary });
			return file;
		},
		async modify(file: TFile, text: string): Promise<void> {
			files.set(file.path, { file, text });
		},
		async modifyBinary(file: TFile, binary: ArrayBuffer): Promise<void> {
			files.set(file.path, { file, binary });
		},
		async read(file: TFile): Promise<string> {
			return files.get(file.path)?.text ?? "";
		},
		getMarkdownFiles(): TFile[] {
			return [...files.values()]
				.filter(entry => entry.file.path.endsWith(".md"))
				.map(entry => entry.file);
		},
		async rename(file: TFile | TFolder, path: string): Promise<void> {
			if (file instanceof TFolder) {
				const sourcePath = file.path;
				const movedFolders = [...folders.entries()].filter(([oldPath]) => oldPath === sourcePath || oldPath.startsWith(`${sourcePath}/`));
				const movedFiles = [...files.entries()].filter(([oldPath]) => oldPath.startsWith(`${sourcePath}/`));
				for (const [oldPath, folder] of movedFolders) {
					folders.delete(oldPath);
					folder.path = `${path}${oldPath.slice(sourcePath.length)}`;
					folders.set(folder.path, folder);
				}
				for (const [oldPath, entry] of movedFiles) {
					files.delete(oldPath);
					entry.file.path = `${path}${oldPath.slice(sourcePath.length)}`;
					files.set(entry.file.path, entry);
				}
				return;
			}
			const entry = files.get(file.path);
			if (!entry) return;
			files.delete(file.path);
			file.path = path;
			files.set(path, entry);
		}
	};
	const metadataCache = {
		getFirstLinkpathDest(linkpath: string): TFile | null {
			const direct = files.get(linkpath)?.file ?? files.get(`${linkpath}.md`)?.file;
			return direct ?? null;
		}
	};

	return {
		vault,
		metadataCache,
		files,
		folders
	};
}
