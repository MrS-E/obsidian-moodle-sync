type PrintableWebview = HTMLElement & {
	src: string;
	printToPDF(options: Record<string, unknown>): Promise<Uint8Array | ArrayBuffer>;
	executeJavaScript<T>(code: string, userGesture?: boolean): Promise<T>;
	addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
	removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
};

export async function renderPdfFromHtml(html: string): Promise<ArrayBuffer> {
	const webview = document.createElement("webview") as PrintableWebview;
	if (typeof webview.printToPDF !== "function") {
		throw new Error("Electron webview.printToPDF is not available in this Obsidian build.");
	}

	const objectUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
	webview.style.position = "fixed";
	webview.style.width = "1024px";
	webview.style.height = "1440px";
	webview.style.left = "-10000px";
	webview.style.top = "0";
	webview.src = objectUrl;

	document.body.appendChild(webview);

	try {
		await waitForLoad(webview);
		await waitForRenderStability(webview);

		const pdf = await webview.printToPDF({
			printBackground: true,
			preferCSSPageSize: true,
			pageSize: "A4",
			margins: {
				top: 0.4,
				bottom: 0.4,
				left: 0.4,
				right: 0.4
			}
		});

		if (pdf instanceof ArrayBuffer) return pdf;
		return pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength);
	} finally {
		webview.remove();
		URL.revokeObjectURL(objectUrl);
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

async function waitForRenderStability(webview: PrintableWebview): Promise<void> {
	await webview.executeJavaScript(`
		(async () => {
			const images = Array.from(document.images || []);
			await Promise.all(images.map((img) => {
				if (img.complete) return Promise.resolve();
				return new Promise((resolve) => {
					const done = () => resolve();
					img.addEventListener("load", done, { once: true });
					img.addEventListener("error", done, { once: true });
					setTimeout(done, 5000);
				});
			}));

			if (document.fonts?.ready) {
				try {
					await document.fonts.ready;
				} catch {
					// Ignore font readiness failures and continue printing.
				}
			}

			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			return true;
		})()
	`, true);
}
