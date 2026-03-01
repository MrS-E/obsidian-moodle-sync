import { App, PluginSettingTab, Setting } from "obsidian";

export interface MoodleSyncSettings {
	baseUrl: string;             // https://moodle.example.edu
	token: string;               // wstoken
	rootFolder: string;          // Moodle
	resourcesFolder: string;     // Moodle/_resources
	concurrency: number;         // 1..10
}

export const DEFAULT_SETTINGS: MoodleSyncSettings = {
	baseUrl: "",
	token: "",
	rootFolder: "Moodle",
	resourcesFolder: "Moodle/_resources",
	concurrency: 4
};

export class MoodleSyncSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: { settings: MoodleSyncSettings; saveSettings: () => Promise<void> }) {
		super(app, plugin as any);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Moodle Base URL")
			.setDesc("Example: https://moodle.example.edu (no trailing slash preferred)")
			.addText(t => t
				.setPlaceholder("https://moodle.example.edu")
				.setValue(this.plugin.settings.baseUrl)
				.onChange(async (value) => {
					this.plugin.settings.baseUrl = value.trim().replace(/\/$/, "");
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Web service token")
			.setDesc("User token for Moodle Web Services.")
			.addText(t => t
				.setPlaceholder("wstoken...")
				.setValue(this.plugin.settings.token)
				.onChange(async (value) => {
					this.plugin.settings.token = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Root folder")
			.addText(t => t
				.setValue(this.plugin.settings.rootFolder)
				.onChange(async (value) => {
					this.plugin.settings.rootFolder = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Resources folder")
			.setDesc("Where attachments are stored (mirrored).")
			.addText(t => t
				.setValue(this.plugin.settings.resourcesFolder)
				.onChange(async (value) => {
					this.plugin.settings.resourcesFolder = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Concurrency")
			.setDesc("How many files to download in parallel.")
			.addSlider(s => s
				.setLimits(1, 10, 1)
				.setDynamicTooltip()
				.setValue(this.plugin.settings.concurrency)
				.onChange(async (value) => {
					this.plugin.settings.concurrency = value;
					await this.plugin.saveSettings();
				}));
	}
}
