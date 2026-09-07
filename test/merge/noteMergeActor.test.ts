import { describe, expect, it, vi } from "vitest";
import { applyNoteMerge, planNoteMerge } from "../../src/merge/noteMergeActor";
import { DEFAULT_SYNC_STATE } from "../../src/domain/syncState";

describe("note merge actor", () => {
	it("preserves unmanaged sections and rejects a file changed after planning", async () => {
		let text = "# Note\n\n%% moodle:content:begin %%\nOld\n%% moodle:content:end %%\n\n## My notes\nKeep\n";
		const vault = {
			getEntryKind: vi.fn(() => "file" as const),
			readText: vi.fn(async () => text),
			writeText: vi.fn(async (_path: string, value: string) => { text = value; })
		};
		const state = structuredClone(DEFAULT_SYNC_STATE);
		const action = planNoteMerge(state, "Moodle/Note.md", "# Note", { content: "New" }, { path: "Moodle/Note.md", text });

		await applyNoteMerge(vault, state, action);

		expect(text).toContain("New");
		expect(text).toContain("## My notes\nKeep");
		expect(state.notes["Moodle/Note.md"]?.baseBlocks.content).toBe("New");

		text = `${text}\nConcurrent edit`;
		await expect(applyNoteMerge(vault, state, action)).rejects.toThrow("changed after planning");
	});
});