import { App, PluginSettingTab, Setting } from "obsidian";

export interface MoodleSyncSettings {
	baseUrl: string;
	token: string;
	rootFolder: string;
	resourcesFolder: string;
	concurrency: number;

	// v2
	writeLogFile: boolean;     // write Moodle/_sync-log.md
	logFilePath: string;       // default Moodle/_sync-log.md
}

export const DEFAULT_SETTINGS: MoodleSyncSettings = {
	baseUrl: "",
	token: "",
	rootFolder: "Moodle",
	resourcesFolder: "Moodle/_resources",
	concurrency: 4,

	writeLogFile: true,
	logFilePath: "Moodle/_sync-log.md"
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
			.setDesc("Example: https://moodle.example.edu (no trailing slash)")
			.addText(t => t
				.setPlaceholder("https://moodle.example.edu")
				.setValue(this.plugin.settings.baseUrl)
				.onChange(async (value) => {
					this.plugin.settings.baseUrl = value.trim().replace(/\/$/, "");
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Web service token")
			.setDesc("Moodle WS token (wstoken).")
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
			.setDesc("Attachments are mirrored under this folder.")
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

		new Setting(containerEl)
			.setName("Write sync log file")
			.setDesc("Append a summary to a log note in your vault.")
			.addToggle(t => t
				.setValue(this.plugin.settings.writeLogFile)
				.onChange(async (value) => {
					this.plugin.settings.writeLogFile = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Log file path")
			.setDesc("Where to append logs (markdown).")
			.addText(t => t
				.setValue(this.plugin.settings.logFilePath)
				.onChange(async (value) => {
					this.plugin.settings.logFilePath = value.trim();
					await this.plugin.saveSettings();
				}));
	}
}
