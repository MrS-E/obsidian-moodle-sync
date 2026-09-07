import { describe, expect, it } from "vitest";
import { mergeManagedBlock } from "../../src/merge/mergeEngine";

describe("managed block merge engine", () => {
	it.each([
		["takes remote content when the local block is unchanged", "base", "base", "remote", "remote", false],
		["keeps local content when the remote block is unchanged", "base", "local", "base", "local", false],
		["merges non-overlapping line changes", "one\ntwo\nthree", "one local\ntwo\nthree", "one\ntwo\nthree remote", "one local\ntwo\nthree remote", false]
	])("%s", (_name, base, local, remote, expected, conflicted) => {
		const merged = mergeManagedBlock({ name: "content", base, local, remote });

		expect(merged).toEqual({ inner: expected, conflicted });
	});

	it("keeps both edits when the same managed content conflicts", () => {
		const merged = mergeManagedBlock({ name: "content", base: "base", local: "local", remote: "remote" });

		expect(merged.conflicted).toBe(true);
		expect(merged.inner).toContain("### Local");
		expect(merged.inner).toContain("### Remote");
	});
});