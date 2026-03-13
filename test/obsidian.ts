export type RequestUrlOptions = {
	url: string;
	method?: string;
	body?: string;
	headers?: Record<string, string>;
};

export type RequestUrlResponse = {
	status: number;
	json?: unknown;
	arrayBuffer: ArrayBuffer;
};

export const noticeLog: Array<{ message: string; timeout?: number }> = [];
export const createdSettings: Setting[] = [];
export const requestLog: RequestUrlOptions[] = [];

let requestUrlImpl: (options: RequestUrlOptions) => Promise<RequestUrlResponse> = async () => ({
	status: 200,
	json: {},
	arrayBuffer: new ArrayBuffer(0)
});

export function resetObsidianMockState(): void {
	noticeLog.length = 0;
	createdSettings.length = 0;
	requestLog.length = 0;
	requestUrlImpl = async () => ({
		status: 200,
		json: {},
		arrayBuffer: new ArrayBuffer(0)
	});
}

export function setRequestUrlImpl(impl: typeof requestUrlImpl): void {
	requestUrlImpl = impl;
}

export async function requestUrl(options: RequestUrlOptions): Promise<RequestUrlResponse> {
	requestLog.push(options);
	return await requestUrlImpl(options);
}

export function normalizePath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.replace(/\/{2,}/g, "/")
		.replace(/\/\.\//g, "/")
		.replace(/\/$/, "");
}

export class Notice {
	message: string;
	timeout?: number;

	constructor(message: string, timeout?: number) {
		this.message = message;
		this.timeout = timeout;
		noticeLog.push({ message, timeout });
	}
}

export class TAbstractFile {
	constructor(public path: string) {}
}

export class TFile extends TAbstractFile {}

export class TFolder extends TAbstractFile {}

export class Plugin {
	app: unknown;
	manifest: unknown;
	commands: unknown[] = [];
	settingTabs: unknown[] = [];
	savedData: unknown[] = [];
	private data: unknown = {};

	constructor(app: unknown = {}, manifest: unknown = {}) {
		this.app = app;
		this.manifest = manifest;
	}

	addCommand(command: unknown): unknown {
		this.commands.push(command);
		return command;
	}

	addSettingTab(tab: unknown): unknown {
		this.settingTabs.push(tab);
		return tab;
	}

	addStatusBarItem(): HTMLElement & { setText: (text: string) => void } {
		const element = document.createElement("div") as HTMLElement & { setText: (text: string) => void };
		element.setText = (text: string) => {
			element.textContent = text;
		};
		return element;
	}

	async loadData(): Promise<unknown> {
		return this.data;
	}

	async saveData(data: unknown): Promise<void> {
		this.data = data;
		this.savedData.push(data);
	}

	__setData(data: unknown): void {
		this.data = data;
	}
}

export class PluginSettingTab {
	containerEl: HTMLElement;

	constructor(public app: unknown, public plugin: unknown) {
		this.containerEl = document.createElement("div");
	}
}

export class TextComponent {
	value = "";
	placeholder = "";
	onChangeHandler?: (value: string) => Promise<void> | void;

	setPlaceholder(value: string): this {
		this.placeholder = value;
		return this;
	}

	setValue(value: string): this {
		this.value = value;
		return this;
	}

	onChange(handler: (value: string) => Promise<void> | void): this {
		this.onChangeHandler = handler;
		return this;
	}

	async trigger(value: string): Promise<void> {
		this.value = value;
		await this.onChangeHandler?.(value);
	}
}

export class ToggleComponent {
	value = false;
	onChangeHandler?: (value: boolean) => Promise<void> | void;

	setValue(value: boolean): this {
		this.value = value;
		return this;
	}

	onChange(handler: (value: boolean) => Promise<void> | void): this {
		this.onChangeHandler = handler;
		return this;
	}

	async trigger(value: boolean): Promise<void> {
		this.value = value;
		await this.onChangeHandler?.(value);
	}
}

export class SliderComponent {
	value = 0;
	limits?: { min: number; max: number; step: number };
	onChangeHandler?: (value: number) => Promise<void> | void;

	setLimits(min: number, max: number, step: number): this {
		this.limits = { min, max, step };
		return this;
	}

	setDynamicTooltip(): this {
		return this;
	}

	setValue(value: number): this {
		this.value = value;
		return this;
	}

	onChange(handler: (value: number) => Promise<void> | void): this {
		this.onChangeHandler = handler;
		return this;
	}

	async trigger(value: number): Promise<void> {
		this.value = value;
		await this.onChangeHandler?.(value);
	}
}

export class Setting {
	name = "";
	desc = "";
	text?: TextComponent;
	toggle?: ToggleComponent;
	slider?: SliderComponent;

	constructor(public containerEl: HTMLElement) {
		createdSettings.push(this);
	}

	setName(name: string): this {
		this.name = name;
		return this;
	}

	setDesc(desc: string): this {
		this.desc = desc;
		return this;
	}

	addText(builder: (component: TextComponent) => TextComponent): this {
		this.text = builder(new TextComponent());
		return this;
	}

	addToggle(builder: (component: ToggleComponent) => ToggleComponent): this {
		this.toggle = builder(new ToggleComponent());
		return this;
	}

	addSlider(builder: (component: SliderComponent) => SliderComponent): this {
		this.slider = builder(new SliderComponent());
		return this;
	}
}
