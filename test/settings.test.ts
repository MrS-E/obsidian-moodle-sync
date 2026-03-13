import { describe, expect, it, vi } from "vitest";
import { createdSettings, Plugin } from "./obsidian";
import { DEFAULT_SETTINGS, MoodleSyncSettingTab } from "../src/settings";

describe("settings", () => {
	it("renders fields and persists updates", async () => {
		const plugin = Object.assign(new Plugin({}, {}), {
			settings: { ...DEFAULT_SETTINGS },
			saveSettings: vi.fn(async () => undefined)
		}) as Plugin & {
			settings: typeof DEFAULT_SETTINGS;
			saveSettings: ReturnType<typeof vi.fn>;
		};

		const tab = new MoodleSyncSettingTab({} as never, plugin as never);
		tab.display();

		expect(createdSettings.map((setting) => setting.name)).toEqual([
			"Moodle base URL",
			"Web service token",
			"Root folder",
			"Resources folder",
			"Concurrency",
			"Convert descriptions",
			"Write sync log file",
			"Show file in progress",
			"Log file path"
		]);

		await createdSettings[0]?.text?.trigger("https://moodle.example.edu/");
		await createdSettings[4]?.slider?.trigger(7);
		await createdSettings[5]?.toggle?.trigger(true);
		await createdSettings[7]?.toggle?.trigger(false);

		expect(plugin.settings.baseUrl).toBe("https://moodle.example.edu");
		expect(plugin.settings.concurrency).toBe(7);
		expect(plugin.settings.convertHtmlToMarkdown).toBe(true);
		expect(plugin.settings.showFileInProgress).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(4);
	});
});
