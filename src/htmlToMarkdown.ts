function collapseWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function escapeMarkdown(text: string): string {
	return text.replace(/[[]\\`*_{}()#+.!|>\]-]/g, "\\$&");
}

function decodeHtml(html: string): Document {
	return new DOMParser().parseFromString(html, "text/html");
}

function textFromNode(node: Node): string {
	if (node.nodeType === Node.TEXT_NODE) {
		return escapeMarkdown((node.textContent ?? "").replace(/\u00a0/g, " "));
	}

	if (node.nodeType !== Node.ELEMENT_NODE) {
		return "";
	}

	const el = node as HTMLElement;
	const tag = el.tagName.toLowerCase();

	if (tag === "br") return "\n";
	if (tag === "hr") return "\n---\n";

	if (tag === "pre") {
		const code = el.textContent?.replace(/\n+$/, "") ?? "";
		return `\n\`\`\`\n${code}\n\`\`\`\n`;
	}

	if (tag === "code") {
		return `\`${collapseWhitespace(el.textContent ?? "")}\``;
	}

	if (tag === "strong" || tag === "b") {
		return `**${renderInlineChildren(el)}**`;
	}

	if (tag === "em" || tag === "i") {
		return `*${renderInlineChildren(el)}*`;
	}

	if (tag === "a") {
		const href = el.getAttribute("href")?.trim();
		const label = collapseWhitespace(renderInlineChildren(el));
		if (!href) return label;
		return `[${label || href}](${href})`;
	}

	if (tag === "img") {
		const src = el.getAttribute("src")?.trim();
		if (!src) return "";
		const alt = el.getAttribute("alt")?.trim() ?? "";
		return `![${escapeMarkdown(alt)}](${src})`;
	}

	return renderInlineChildren(el);
}

function renderInlineChildren(parent: ParentNode): string {
	return Array.from(parent.childNodes)
		.map(textFromNode)
		.join("")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function renderList(el: HTMLElement, depth: number): string {
	const ordered = el.tagName.toLowerCase() === "ol";
	const items = Array.from(el.children).filter((child): child is HTMLElement => child.tagName.toLowerCase() === "li");

	return items.map((item, index) => {
		const marker = ordered ? `${index + 1}. ` : "- ";
		const indent = "  ".repeat(depth);
		const content = renderFlowContent(item, depth + 1).trim() || collapseWhitespace(item.textContent ?? "");
		const lines = content.split("\n");
		const first = `${indent}${marker}${lines[0]}`;
		const rest = lines.slice(1).map(line => line ? `${indent}  ${line}` : "");
		return [first, ...rest].join("\n");
	}).join("\n");
}

function hasNestedBlockChildren(parent: ParentNode): boolean {
	return Array.from(parent.childNodes).some((node) => {
		if (node.nodeType !== Node.ELEMENT_NODE) {
			return false;
		}

		const tag = (node as HTMLElement).tagName.toLowerCase();
		return ["ul", "ol", "li", "blockquote", "pre", "hr", "p", "div", "section", "article"].includes(tag)
			|| /^h[1-6]$/.test(tag);
	});
}

function renderFlowContent(parent: ParentNode, depth: number): string {
	return hasNestedBlockChildren(parent) ? renderBlockChildren(parent, depth) : renderInlineChildren(parent);
}

function renderBlockChildren(parent: ParentNode, depth = 0): string {
	const blocks = Array.from(parent.childNodes).map(node => renderNode(node, depth)).filter(Boolean);
	return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function renderNode(node: Node, depth: number): string {
	if (node.nodeType === Node.TEXT_NODE) {
		return collapseWhitespace(node.textContent ?? "");
	}

	if (node.nodeType !== Node.ELEMENT_NODE) {
		return "";
	}

	const el = node as HTMLElement;
	const tag = el.tagName.toLowerCase();

	if (tag === "ul" || tag === "ol") return renderList(el, depth);
	if (tag === "li") return renderFlowContent(el, depth);
	if (tag === "blockquote") {
		return renderBlockChildren(el, depth)
			.split("\n")
			.map(line => line ? `> ${line}` : ">")
			.join("\n");
	}

	if (/^h[1-6]$/.test(tag)) {
		const level = Number(tag[1]);
		return `${"#".repeat(level)} ${renderInlineChildren(el)}`.trim();
	}

	if (tag === "p" || tag === "div" || tag === "section" || tag === "article") {
		return renderFlowContent(el, depth);
	}

	return renderInlineChildren(el);
}

export function convertHtmlToMarkdown(html: string): string {
	const doc = decodeHtml(html);
	const markdown = renderBlockChildren(doc.body)
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	return markdown || collapseWhitespace(doc.body.textContent ?? "");
}
