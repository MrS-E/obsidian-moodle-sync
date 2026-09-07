import { App, Plugin, PluginSettingTab, Setting } from "obsidian";

export interface MoodleSyncSettings {
	baseUrl: string;
	token: string;
	rootFolder: string;
	resourcesFolder: string;
	concurrency: number;

	// v2
	writeLogFile: boolean;     // write Moodle/_sync-log.md
	logFilePath: string;       // default Moodle/_sync-log.md
	includeActionsInLogDetails: boolean;
}

export const DEFAULT_SETTINGS: MoodleSyncSettings = {
	baseUrl: "",
	token: "",
	rootFolder: "Moodle",
	resourcesFolder: "Moodle/_resources",
	concurrency: 4,
	writeLogFile: true,
	logFilePath: "Moodle/_sync-log.md",
	includeActionsInLogDetails: false
};

type SettingsPlugin = Plugin & {
	settings: MoodleSyncSettings;
	saveSettings: () => Promise<void>;
};

export class MoodleSyncSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: SettingsPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Moodle base URL")
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
			.setDesc("Moodle web service token (`wstoken`).")
			.addText(t => t
				.setPlaceholder("Paste your wstoken")
				.setValue(this.plugin.settings.token)
				.onChange(async (value) => {
					this.plugin.settings.token = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Root folder")
			.setDesc("Store generated Markdown notes in this vault folder.")
			.addText(t => t
				.setValue(this.plugin.settings.rootFolder)
				.onChange(async (value) => {
					await this.saveNonEmptyPath("rootFolder", value);
				}));

		new Setting(containerEl)
			.setName("Resources folder")
			.setDesc("Attachments are mirrored under this folder.")
			.addText(t => t
				.setValue(this.plugin.settings.resourcesFolder)
				.onChange(async (value) => {
					await this.saveNonEmptyPath("resourcesFolder", value);
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
			.setDesc("Append detailed dry-run and applied sync entries to a log note in your vault.")
			.addToggle(t => t
				.setValue(this.plugin.settings.writeLogFile)
				.onChange(async (value) => {
					this.plugin.settings.writeLogFile = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		if (this.plugin.settings.writeLogFile) {
			new Setting(containerEl)
				.setName("Log file path")
				.setDesc("Where to append sync logs.")
				.addText(t => t
					.setValue(this.plugin.settings.logFilePath)
					.onChange(async (value) => {
						await this.saveNonEmptyPath("logFilePath", value);
					}));

			new Setting(containerEl)
				.setName("Include planned actions in log details")
				.setDesc("List every planned action in expanded sync-log details.")
				.addToggle(t => t
					.setValue(this.plugin.settings.includeActionsInLogDetails)
					.onChange(async (value) => {
						this.plugin.settings.includeActionsInLogDetails = value;
						await this.plugin.saveSettings();
					}));
		}
	}

	private async saveNonEmptyPath(setting: "rootFolder" | "resourcesFolder" | "logFilePath", value: string): Promise<void> {
		const normalized = value.trim().replace(/^\/+|\/+$/g, "");
		if (!normalized) return;
		this.plugin.settings[setting] = normalized;
		await this.plugin.saveSettings();
	}
}
