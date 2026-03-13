import { beforeEach } from "vitest";
import { resetObsidianMockState } from "./obsidian";

beforeEach(() => {
	resetObsidianMockState();
});

if (!("empty" in HTMLElement.prototype)) {
	Object.defineProperty(HTMLElement.prototype, "empty", {
		value(this: HTMLElement) {
			this.replaceChildren();
		}
	});
}
