import { describe, expect, it, vi } from "vitest";
import { createdSettings, Plugin } from "./obsidian";
import { DEFAULT_SETTINGS, MoodleSyncSettingTab } from "../src/settings";

describe("settings", () => {
	it("renders Markdown-only fields and persists validated updates", async () => {
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
			"Write sync log file",
			"Log file path",
			"Include planned actions in log details"
		]);

		await createdSettings[0]?.text?.trigger("https://moodle.example.edu/");
		await createdSettings[2]?.text?.trigger("/Course notes/");
		await createdSettings[3]?.text?.trigger("   ");
		await createdSettings[4]?.slider?.trigger(7);
		await createdSettings[7]?.toggle?.trigger(true);
		await createdSettings[5]?.toggle?.trigger(false);

		expect(plugin.settings.baseUrl).toBe("https://moodle.example.edu");
		expect(plugin.settings.rootFolder).toBe("Course notes");
		expect(plugin.settings.resourcesFolder).toBe("Moodle/_resources");
		expect(plugin.settings.concurrency).toBe(7);
		expect(plugin.settings.includeActionsInLogDetails).toBe(true);
		expect(plugin.settings.writeLogFile).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(5);
		expect(createdSettings.slice(-6).map((setting) => setting.name)).not.toContain("Log file path");
	});
});
