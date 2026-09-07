import { describe, expect, it } from "vitest";
import { rewriteMarkdownLinks } from "../../src/migration/linkRewriter";

describe("Markdown link rewriting", () => {
	it("rewrites resolved internal targets while preserving embeds, aliases, suffixes, and Markdown link style", () => {
		const source = "Moodle/Old Course (1)/References.md";
		const rewritten = rewriteMarkdownLinks(
			[
				"[[Moodle/Old [Course] (1)/Old note#Summary|Read this]]",
				"![[Moodle/Old [Course] (1)/slides.pdf#page=2|Slides]]",
				"[Download](./slides.pdf \"Deck\")",
				"![Preview](./slides.pdf)",
				"`[[Moodle/Old Course (1)/Old note]]`",
				"```md",
				"[[Moodle/Old Course (1)/Old note]]",
				"```",
				"[External](https://example.com/Old.md)"
			].join("\n"),
			{
				sourcePath: source,
				outputSourcePath: "Moodle/New Course (1)/References.md",
				resolveLink: (_source, link) => ({
					"Moodle/Old [Course] (1)/Old note": "Moodle/Old [Course] (1)/Old note.md",
					"Moodle/Old [Course] (1)/slides.pdf": "Moodle/Old [Course] (1)/slides.pdf",
					"./slides.pdf": "Moodle/Old Course (1)/slides.pdf"
				})[link] ?? null,
				mapPath: (path) => path
					.replace("Moodle/Old [Course] (1)/Old note.md", "Moodle/New Course (1)/New note.md")
					.replace("Moodle/Old [Course] (1)", "Moodle/New Course (1)")
			}
		);

		expect(rewritten.text).toContain("[[Moodle/New Course (1)/New note#Summary|Read this]]");
		expect(rewritten.text).toContain("![[Moodle/New Course (1)/slides.pdf#page=2|Slides]]");
		expect(rewritten.text).toContain("[Download](./slides.pdf \"Deck\")");
		expect(rewritten.text).toContain("![Preview](./slides.pdf)");
		expect(rewritten.text).toContain("`[[Moodle/Old Course (1)/Old note]]`");
		expect(rewritten.text).toContain("```md\n[[Moodle/Old Course (1)/Old note]]\n```");
		expect(rewritten.text).toContain("[External](https://example.com/Old.md)");
		expect(rewritten.count).toBe(2);
	});
});