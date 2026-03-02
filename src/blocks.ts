export type BlockName = string;

function escRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function blockBegin(name: BlockName): string {
	return `%% moodle:${name}:begin %%`;
}
export function blockEnd(name: BlockName): string {
	return `%% moodle:${name}:end %%`;
}

export function hasBlock(noteText: string, name: BlockName): boolean {
	const b = escRe(blockBegin(name));
	const e = escRe(blockEnd(name));
	const re = new RegExp(`${b}[\\s\\S]*?${e}`);
	return re.test(noteText);
}

/**
 * Returns the inner content of the block (without markers), or null if missing.
 */
export function extractBlock(noteText: string, name: BlockName): string | null {
	const b = escRe(blockBegin(name));
	const e = escRe(blockEnd(name));
	const re = new RegExp(`${b}\\r?\\n([\\s\\S]*?)\\r?\\n${e}`);
	const m = noteText.match(re);
	return m ? m[1] : null;
}

/**
 * Replace a block if present, otherwise append it (with a blank line).
 * Content is inserted as-is; caller controls trailing newline semantics.
 */
export function upsertBlock(noteText: string, name: BlockName, innerContent: string): string {
	const bLine = blockBegin(name);
	const eLine = blockEnd(name);

	const newBlock =
		`${bLine}\n` +
		`${innerContent.replace(/\s+$/, "")}\n` +
		`${eLine}`;

	const b = escRe(bLine);
	const e = escRe(eLine);
	const re = new RegExp(`${b}[\\s\\S]*?${e}`, "g");

	if (re.test(noteText)) {
		return noteText.replace(re, newBlock);
	}

	// Append at end with spacing
	const trimmed = noteText.replace(/\s+$/, "");
	return `${trimmed}\n\n${newBlock}\n`;
}

/**
 * Ensures a note has a user-owned section and returns a normalized note shell.
 * You can call this when creating notes.
 */
export function ensureUserSection(noteText: string): string {
	const marker = "## My notes";
	if (noteText.includes(marker)) return noteText;
	const trimmed = noteText.replace(/\s+$/, "");
	return `${trimmed}\n\n${marker}\n`;
}
