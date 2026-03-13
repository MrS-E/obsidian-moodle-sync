import { normalizePath } from "obsidian";

export function safeName(name: string): string {
	return (name ?? "Untitled")
		.replace(/[\\/:*?"<>|]/g, "-")
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
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function simpleHash(text: string): string {
	let h = 0;
	for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
	return String(h);
}

export function formatBytes(n: number): string {
	if (!Number.isFinite(n) || n <= 0) return "0 B";
	const units = ["B","KB","MB","GB","TB"];
	let i = 0;
	let v = n;
	while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
	return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
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
			queue.push(() => {
				void (async () => {
				try {
					resolve(await fn());
				} catch (e) {
					reject(e instanceof Error ? e : new Error(String(e)));
				} finally {
					active--;
					runNext();
				}
				})();
			});
			runNext();
		});
	};
}
