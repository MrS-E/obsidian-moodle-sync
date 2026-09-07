import { describe, expect, it, vi } from "vitest";
import { TFile } from "../obsidian";
import { applyNoteMerge, planNoteMerge } from "../../src/merge/noteMergeActor";
import { DEFAULT_SYNC_STATE } from "../../src/domain/syncState";

describe("note merge actor", () => {
	it("preserves unmanaged sections and rejects a file changed after planning", async () => {
		const file = new TFile("Moodle/Note.md");
		let text = "# Note\n\n%% moodle:content:begin %%\nOld\n%% moodle:content:end %%\n\n## My notes\nKeep\n";
		const app = {
			vault: {
				getAbstractFileByPath: vi.fn(() => file),
				read: vi.fn(async () => text),
				modify: vi.fn(async (_file, value) => { text = value; }),
				create: vi.fn()
			}
		};
		const state = structuredClone(DEFAULT_SYNC_STATE);
		const action = await planNoteMerge(app as never, state, "Moodle/Note.md", "# Note", { content: "New" });

		await applyNoteMerge(app as never, state, action);

		expect(text).toContain("New");
		expect(text).toContain("## My notes\nKeep");
		expect(state.notes["Moodle/Note.md"]?.baseBlocks.content).toBe("New");

		text = `${text}\nConcurrent edit`;
		await expect(applyNoteMerge(app as never, state, action)).rejects.toThrow("changed after planning");
	});
});