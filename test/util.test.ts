import { describe, expect, it } from "vitest";
import { createLimiter, formatBytes, isEmbeddableMedia, join, safeName, simpleHash } from "../src/util";

describe("util", () => {
	it("normalizes names and joins paths", () => {
		expect(safeName("A/B:C")).toBe("A-B-C");
		expect(join("Moodle", "Course", "Note.md")).toBe("Moodle/Course/Note.md");
	});

	it("formats bytes and recognizes embeddable media", () => {
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(isEmbeddableMedia("lecture.PDF")).toBe(true);
		expect(isEmbeddableMedia("archive.zip")).toBe(false);
	});

	it("produces stable hashes", () => {
		expect(simpleHash("abc")).toBe(simpleHash("abc"));
		expect(simpleHash("abc")).not.toBe(simpleHash("abd"));
	});

	it("limits concurrency and wraps non-error rejections", async () => {
		const limit = createLimiter(1);
		const order: string[] = [];

		const first = limit(async () => {
			order.push("start-1");
			await Promise.resolve();
			order.push("end-1");
			return 1;
		});

		const second = limit(async () => {
			order.push("start-2");
			throw new Error("boom");
		});

		await expect(first).resolves.toBe(1);
		await expect(second).rejects.toEqual(new Error("boom"));
		expect(order).toEqual(["start-1", "end-1", "start-2"]);
	});
});
