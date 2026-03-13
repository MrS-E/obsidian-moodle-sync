import { describe, expect, it } from "vitest";
import { convertHtmlToMarkdown } from "../src/htmlToMarkdown";

describe("htmlToMarkdown", () => {
	it("converts common inline and block elements", () => {
		const html = "<h2>Title</h2><p>Hello <strong>world</strong> <a href='https://example.com'>link</a></p>";
		expect(convertHtmlToMarkdown(html)).toBe("## Title\n\nHello **world** [link](https://example.com)");
	});

	it("renders lists and images", () => {
		const html = "<ul><li>One</li><li><img src='a.png' alt='A'> Two</li></ul>";
		expect(convertHtmlToMarkdown(html)).toBe("- One\n- ![A](a.png) Two");
	});

	it("renders code blocks and blockquotes", () => {
		const html = "<blockquote><p>Quoted</p></blockquote><pre><code>const x = 1;\n</code></pre>";
		expect(convertHtmlToMarkdown(html)).toBe("> Quoted\n\n```\nconst x = 1;\n```");
	});

	it("falls back to collapsed text for unsupported markup", () => {
		const html = "<table><tr><td>One</td><td>Two</td></tr></table>";
		expect(convertHtmlToMarkdown(html)).toBe("OneTwo");
	});
});
