import { normalizePath } from "obsidian";

export function safeName(name: string): string {
	return (name ?? "Untitled")
		.replace(/[\\\/:*?"<>|]/g, "—")
		.replace(/\s+/g, " ")
		.trim();
}

export function join(...parts: string[]): string {
	return normalizePath(parts.join("/"));
}

export function isEmbeddableMedia(filename: string): boolean {
	const ext = filename.toLowerCase().split(".").pop() ?? "";
	return ["pdf","png","jpg","jpeg","gif","webp","svg","mp4","mov","mkv","webm","mp3","wav","m4a"].includes(ext);
}

export function nowStamp(): string {
	// YYYYMMDD-HHMMSS
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function simpleHash(text: string): string {
	// cheap stable hash
	let h = 0;
	for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
	return String(h);
}

/** Minimal concurrency limiter */
export function createLimiter(max: number) {
	let active = 0;
	const queue: Array<() => void> = [];

	const runNext = () => {
		if (active >= max) return;
		const job = queue.shift();
		if (!job) return;
		active++;
		job();
	};

	return async function limit<T>(fn: () => Promise<T>): Promise<T> {
		return await new Promise<T>((resolve, reject) => {
			queue.push(async () => {
				try {
					const res = await fn();
					resolve(res);
				} catch (e) {
					reject(e);
				} finally {
					active--;
					runNext();
				}
			});
			runNext();
		});
	};
}
