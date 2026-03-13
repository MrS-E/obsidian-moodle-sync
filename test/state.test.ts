import { describe, expect, it } from "vitest";
import { DEFAULT_STATE } from "../src/state";

describe("state", () => {
	it("starts empty", () => {
		expect(DEFAULT_STATE).toEqual({ files: {}, notes: {} });
	});
});
