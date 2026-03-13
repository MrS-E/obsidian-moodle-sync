type PrintableWebview = HTMLElement & {
	src: string;
	printToPDF(options: Record<string, unknown>): Promise<Uint8Array | ArrayBuffer>;
	addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
	removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
};

export async function renderPdfFromHtml(html: string): Promise<ArrayBuffer> {
	const webview = document.createElement("webview") as PrintableWebview;
	if (typeof webview.printToPDF !== "function") {
		throw new Error("Electron webview.printToPDF is not available in this Obsidian build.");
	}

	const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
	webview.setCssProps({
		position: "fixed",
		width: "1024px",
		height: "1440px",
		left: "-10000px",
		top: "0"
	});
	webview.src = dataUrl;

	document.body.appendChild(webview);

	try {
		await withTimeout(waitForLoad(webview), 15000, "Timed out while loading quiz HTML into Chromium PDF renderer.");
		await delay(500);

		const pdf = await withTimeout(webview.printToPDF({
			printBackground: true,
			preferCSSPageSize: true,
			pageSize: "A4",
			margins: {
				top: 0.4,
				bottom: 0.4,
				left: 0.4,
				right: 0.4
			}
		}), 20000, "Timed out while printing quiz HTML to PDF.");

		if (pdf instanceof ArrayBuffer) return pdf;
		return pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength);
	} finally {
		webview.remove();
	}
}

function waitForLoad(webview: PrintableWebview): Promise<void> {
	return new Promise((resolve, reject) => {
		let settled = false;

		const cleanup = () => {
			webview.removeEventListener("did-finish-load", onLoad);
			webview.removeEventListener("did-fail-load", onFail as EventListener);
		};

		const onLoad = () => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve();
		};

		const onFail = (event: Event) => {
			if (settled) return;
			settled = true;
			cleanup();
			const details = event as Event & { errorDescription?: string };
			reject(new Error(details.errorDescription ?? "Failed to load HTML into webview."));
		};

		webview.addEventListener("did-finish-load", onLoad);
		webview.addEventListener("did-fail-load", onFail as EventListener);
	});
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return await new Promise<T>((resolve, reject) => {
		const timer = window.setTimeout(() => reject(new Error(message)), ms);
		promise.then(
			(value) => {
				window.clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				window.clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		);
	});
}

async function delay(ms: number): Promise<void> {
	await new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}
