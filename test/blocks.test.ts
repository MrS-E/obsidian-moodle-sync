import { describe, expect, it } from "vitest";
import { blockBegin, blockEnd, ensureUserSection, extractBlock, hasBlock, upsertBlock } from "../src/blocks";

describe("blocks", () => {
	it("creates and updates managed blocks", () => {
		const initial = "# Note";
		const created = upsertBlock(initial, "meta", "hello");
		expect(created).toContain(blockBegin("meta"));
		expect(created).toContain(blockEnd("meta"));
		expect(extractBlock(created, "meta")).toBe("hello");
		expect(hasBlock(created, "meta")).toBe(true);

		const updated = upsertBlock(created, "meta", "updated");
		expect(extractBlock(updated, "meta")).toBe("updated");
	});

	it("adds a user section once", () => {
		const note = ensureUserSection("# Title");
		expect(note).toContain("## My notes");
		expect(ensureUserSection(note).match(/## My notes/g)).toHaveLength(1);
	});
});
