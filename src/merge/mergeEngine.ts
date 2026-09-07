import { diff3Merge } from "node-diff3";

export interface ManagedBlockMerge {
	inner: string;
	conflicted: boolean;
}

export function mergeManagedBlock(input: { name: string; base: string; local: string; remote: string }): ManagedBlockMerge {
	const base = (input.base ?? "").replace(/\s+$/, "");
	const local = (input.local ?? "").replace(/\s+$/, "");
	const remote = (input.remote ?? "").replace(/\s+$/, "");
	if (local === remote) return { inner: remote, conflicted: false };
	if (local === base) return { inner: remote, conflicted: false };
	if (remote === base) return { inner: local, conflicted: false };

	const merged = diff3Merge(toLines(local), toLines(base), toLines(remote), true);
	const output: string[] = [];
	for (const part of merged) {
		if (!("ok" in part)) {
			return { inner: keepBothBlock(local, remote), conflicted: true };
		}
		output.push(...part.ok);
	}
	return { inner: output.join("\n").replace(/\s+$/, ""), conflicted: false };
}

export function ensureConflictTags(noteText: string): string {
	const tagLine = "#colition #conflict";
	const trimmed = noteText.replace(/^\s+/, "");
	return trimmed.startsWith("#colition") || trimmed.startsWith("#conflict") ? trimmed : `${tagLine}\n\n${trimmed}`;
}

export function keepBothBlock(local: string, remote: string): string {
	return [
		"#colition",
		"",
		"### Local",
		"```md",
		(local ?? "").replace(/\s+$/, ""),
		"```",
		"",
		"### Remote",
		"```md",
		(remote ?? "").replace(/\s+$/, ""),
		"```"
	].join("\n");
}

function toLines(text: string): string[] {
	return text.length ? text.split("\n") : [""];
}