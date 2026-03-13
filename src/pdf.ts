function escapePdfText(text: string): string {
	return text
		.replace(/\\/g, "\\\\")
		.replace(/\(/g, "\\(")
		.replace(/\)/g, "\\)");
}

function toPdfAscii(text: string): string {
	return text.replace(/[^\x20-\x7E]/g, (char) => {
		if (char === "\n" || char === "\r" || char === "\t") return char;
		return "?";
	});
}

function chunkLines(text: string, maxChars = 95): string[] {
	const normalized = text.replace(/\r\n/g, "\n");
	const sourceLines = normalized.split("\n");
	const out: string[] = [];

	for (const rawLine of sourceLines) {
		const line = rawLine.replace(/\t/g, "    ");
		if (!line) {
			out.push("");
			continue;
		}

		let remaining = line;
		while (remaining.length > maxChars) {
			let splitAt = remaining.lastIndexOf(" ", maxChars);
			if (splitAt <= 0) splitAt = maxChars;
			out.push(remaining.slice(0, splitAt).trimEnd());
			remaining = remaining.slice(splitAt).trimStart();
		}
		out.push(remaining);
	}

	return out;
}

function htmlToPlainText(html: string): string {
	const doc = new DOMParser().parseFromString(html, "text/html");
	const lines: string[] = [];

	const pushLine = (value: string) => {
		const trimmed = value.replace(/\s+/g, " ").trim();
		if (trimmed) lines.push(trimmed);
	};

	const visit = (node: Node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			pushLine(node.textContent ?? "");
			return;
		}

		if (node.nodeType !== Node.ELEMENT_NODE) return;

		const el = node as HTMLElement;
		const tag = el.tagName.toLowerCase();

		if (tag === "script" || tag === "style") return;

		if (tag === "br") {
			lines.push("");
			return;
		}

		if (/^h[1-6]$/.test(tag) || tag === "p" || tag === "div" || tag === "section" || tag === "article" || tag === "li") {
			const text = el.textContent ?? "";
			pushLine(text);
			lines.push("");
			return;
		}

		Array.from(el.childNodes).forEach(visit);
	};

	Array.from(doc.body.childNodes).forEach(visit);

	return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function renderSimplePdfFromHtml(html: string): ArrayBuffer {
	return renderSimplePdfFromText(htmlToPlainText(html));
}

export function renderSimplePdfFromText(text: string): ArrayBuffer {
	const pageWidth = 612;
	const pageHeight = 792;
	const margin = 48;
	const fontSize = 11;
	const lineHeight = 14;
	const usableHeight = pageHeight - margin * 2;
	const linesPerPage = Math.max(1, Math.floor(usableHeight / lineHeight));
	const lines = chunkLines(toPdfAscii(text || ""));

	if (lines.length === 0) lines.push("");

	const pages: string[] = [];
	for (let i = 0; i < lines.length; i += linesPerPage) {
		const pageLines = lines.slice(i, i + linesPerPage);
		const commands: string[] = [
			"BT",
			`/F1 ${fontSize} Tf`,
			`${margin} ${pageHeight - margin} Td`,
			`${lineHeight} TL`
		];

		pageLines.forEach((line, index) => {
			if (index > 0) commands.push("T*");
			commands.push(`(${escapePdfText(line)}) Tj`);
		});

		commands.push("ET");
		pages.push(commands.join("\n"));
	}

	const objects: string[] = [];
	const addObject = (content: string) => {
		objects.push(content);
		return objects.length;
	};

	const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
	const pageIds: number[] = [];
	const contentIds: number[] = [];

	for (const pageContent of pages) {
		contentIds.push(addObject(`<< /Length ${pageContent.length} >>\nstream\n${pageContent}\nendstream`));
		pageIds.push(0);
	}

	const kidsRefs = pageIds.map((_, index) => `${index + 1} 0 R`);
	const pagesId = addObject(`<< /Type /Pages /Kids [${kidsRefs.join(" ")}] /Count ${pages.length} >>`);

	for (let i = 0; i < pages.length; i++) {
		const pageObjectId = addObject(
			`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`
		);
		pageIds[i] = pageObjectId;
	}

	const pagesIndex = pagesId - 1;
	const updatedKidsRefs = pageIds.map(id => `${id} 0 R`);
	objects[pagesIndex] = `<< /Type /Pages /Kids [${updatedKidsRefs.join(" ")}] /Count ${pages.length} >>`;

	const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

	let output = "%PDF-1.4\n";
	const offsets: number[] = [0];

	for (let i = 0; i < objects.length; i++) {
		offsets.push(output.length);
		output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
	}

	const xrefOffset = output.length;
	output += `xref\n0 ${objects.length + 1}\n`;
	output += "0000000000 65535 f \n";
	for (let i = 1; i < offsets.length; i++) {
		output += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
	}
	output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

	return new TextEncoder().encode(output).buffer;
}
