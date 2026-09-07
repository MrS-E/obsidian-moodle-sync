import { describe, expect, it } from "vitest";
import { renderMoodleHtml } from "../../src/rendering/htmlToMarkdown";
import { renderCourseIndex, renderModuleNote } from "../../src/rendering/markdownRenderer";

describe("Markdown renderer", () => {
	it("renders managed course and module Markdown", () => {
		const index = renderCourseIndex("Course", "42", [{
			id: 1,
			name: "Week 1",
			modules: [{ id: 2, name: "Overview" }]
		}], new Map([[2, "Overview"]]));
		const module = renderModuleNote(
			{ id: 1, name: "Week 1" },
			{ id: 2, name: "Overview", modname: "label", description: "<p>Hello <strong>world</strong></p>" },
			["- [[Moodle/_resources/Course (42)/Overview/file.pdf]]"]
		);

		expect(index.text).toContain("- [[Overview]]");
		expect(module.text).toContain("Hello **world**");
		expect(module.blocks.resources).toContain("file.pdf");
	});

	it("sanitizes unsafe Moodle HTML while preserving complex safe structures inline", () => {
		const rendered = renderMoodleHtml("<p>Intro</p><table onclick='bad()'><tr><td>Score</td></tr></table><script>alert(1)</script>");

		expect(rendered).toContain("Intro");
		expect(rendered).toContain("<table><tbody><tr><td>Score</td></tr></tbody></table>");
		expect(rendered).not.toContain("script");
		expect(rendered).not.toContain("onclick");
	});
});