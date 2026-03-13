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
		}
	};

	return {
		vault,
		files,
		folders
	};
}
