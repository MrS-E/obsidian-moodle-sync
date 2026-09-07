import { describe, expect, it } from "vitest";
import {
	legacyPathSegment,
	normalizePathSegment,
	resolvePathSegmentCollisions
} from "../../src/migration/pathNormalizer";

describe("path normalizer", () => {
	it("normalizes Unicode and characters that are unsafe in paths or Obsidian links", () => {
		expect(normalizePathSegment("  Cafe\u0301/[week] #1^|\u0000. ")).toBe("Café-week-1");
		expect(normalizePathSegment("...", "Resource")).toBe("Resource");
	});

	it("retains the legacy transformation for discovering existing managed paths", () => {
		expect(legacyPathSegment("[Week]/One")).toBe("[Week]-One");
	});

	it("uses Moodle IDs for colliding normalized names", () => {
		const resolved = resolvePathSegmentCollisions([
			{ key: "first", value: "Exam [final]", moodleId: 7 },
			{ key: "second", value: "Exam#final", moodleId: 3 },
			{ key: "third", value: "Lecture", moodleId: 4 }
		]);

		expect(resolved).toEqual(new Map([
			["first", "Exam-final (7)"],
			["second", "Exam-final (3)"],
			["third", "Lecture"]
		]));
	});

	it("keeps resource extensions when resolving collisions", () => {
		expect(resolvePathSegmentCollisions([
			{ key: "first", value: "slides#final.pdf", moodleId: 7 },
			{ key: "second", value: "slides^final.pdf", moodleId: 3 }
		])).toEqual(new Map([
			["first", "slides-final (7).pdf"],
			["second", "slides-final (3).pdf"]
		]));
	});
});