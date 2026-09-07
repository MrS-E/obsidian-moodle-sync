export interface LinkRewriteOptions {
	sourcePath: string;
	outputSourcePath: string;
	resolveLink(sourcePath: string, linkPath: string): string | null;
	mapPath(path: string): string;
}

export interface LinkRewriteResult {
	text: string;
	count: number;
}

export function rewriteMarkdownLinks(text: string, options: LinkRewriteOptions): LinkRewriteResult {
	let count = 0;
	const replaceLink = (linkPath: string): string | null => {
		const resolved = options.resolveLink(options.sourcePath, linkPath);
		if (!resolved) {
			return null;
		}
		const mapped = options.mapPath(resolved);
		if (mapped === resolved) {
			return null;
		}
		const replacement = preserveLinkStyle(linkPath, mapped, options.outputSourcePath);
		if (replacement === linkPath) {
			return null;
		}
		count++;
		return replacement;
	};

	return {
		text: transformUnprotectedMarkdown(text, line => rewriteLine(line, replaceLink)),
		count
	};
}

function rewriteLine(line: string, replaceLink: (linkPath: string) => string | null): string {
	const inlineCodeParts = line.split(/(`+)/);
	let insideCode = false;
	return inlineCodeParts.map(part => {
		if (/^`+$/.test(part)) {
			insideCode = !insideCode;
			return part;
		}
		return insideCode ? part : rewriteLinks(part, replaceLink);
	}).join("");
}

function rewriteLinks(text: string, replaceLink: (linkPath: string) => string | null): string {
	const wikilinks = text.replace(/(!?)\[\[([^\n]*?)\]\]/g, (whole, embed: string, target: string) => {
		const { path, suffix, alias } = splitWikiTarget(target);
		const replacement = replaceLink(path);
		return replacement === null ? whole : `${embed}[[${replacement}${suffix}${alias}]]`;
	});

	return wikilinks.replace(/(!?\[[^\]\n]*\])\(([^()\s]+)(\s+(?:"[^"]*"|'[^']*'))?\)/g,
		(whole, label: string, target: string, title: string | undefined) => {
			const { path, suffix } = splitPathSuffix(target);
			if (isExternalTarget(path)) {
				return whole;
			}
			const replacement = replaceLink(path);
			return replacement === null ? whole : `${label}(${replacement}${suffix}${title ?? ""})`;
		}
	);
}

function splitWikiTarget(target: string): { path: string; suffix: string; alias: string } {
	const aliasIndex = target.indexOf("|");
	const pathAndSuffix = aliasIndex === -1 ? target : target.slice(0, aliasIndex);
	const { path, suffix } = splitPathSuffix(pathAndSuffix);
	return { path, suffix, alias: aliasIndex === -1 ? "" : target.slice(aliasIndex) };
}

function splitPathSuffix(target: string): { path: string; suffix: string } {
	const suffixIndex = target.search(/[#^]/);
	return suffixIndex === -1
		? { path: target, suffix: "" }
		: { path: target.slice(0, suffixIndex), suffix: target.slice(suffixIndex) };
}

function preserveLinkStyle(original: string, target: string, sourcePath: string): string {
	const withoutMarkdownExtension = original.toLowerCase().endsWith(".md") ? target : stripMarkdownExtension(target);
	if (original.startsWith("/")) {
		return `/${withoutMarkdownExtension}`;
	}
	if (original.startsWith("./") || original.startsWith("../")) {
		const relative = relativePath(parentPath(sourcePath), withoutMarkdownExtension);
		return original.startsWith("./") && !relative.startsWith(".") ? `./${relative}` : relative;
	}
	if (!original.includes("/")) {
		return fileName(withoutMarkdownExtension);
	}
	return withoutMarkdownExtension;
}

function transformUnprotectedMarkdown(text: string, transform: (line: string) => string): string {
	let fenced = false;
	return text.split("\n").map(line => {
		if (/^\s*(```|~~~)/.test(line)) {
			fenced = !fenced;
			return line;
		}
		return fenced ? line : transform(line);
	}).join("\n");
}

function stripMarkdownExtension(path: string): string {
	return path.toLowerCase().endsWith(".md") ? path.slice(0, -3) : path;
}

function parentPath(path: string): string {
	const separator = path.lastIndexOf("/");
	return separator === -1 ? "" : path.slice(0, separator);
}

function fileName(path: string): string {
	const separator = path.lastIndexOf("/");
	return separator === -1 ? path : path.slice(separator + 1);
}

function relativePath(fromDirectory: string, target: string): string {
	const fromParts = fromDirectory ? fromDirectory.split("/") : [];
	const targetParts = target.split("/");
	while (fromParts[0] && targetParts[0] && fromParts[0] === targetParts[0]) {
		fromParts.shift();
		targetParts.shift();
	}
	return [...fromParts.map(() => ".."), ...targetParts].join("/") || ".";
}

function isExternalTarget(path: string): boolean {
	return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(path);
}