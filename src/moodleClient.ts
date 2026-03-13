import { requestUrl } from "obsidian";

type MoodleScalar = string | number | boolean;
type MoodleArgValue = MoodleScalar | null | undefined | MoodleScalar[];

export interface MoodleSiteInfo {
	sitename?: string;
	username?: string;
	userid?: number;
}

export class MoodleClient {
	constructor(private baseUrl: string, private token: string) {}

	private endpoint(): string {
		return `${this.baseUrl}/webservice/rest/server.php`;
	}

	async call<T>(wsfunction: string, args: Record<string, MoodleArgValue> = {}): Promise<T> {
		const body = new URLSearchParams();
		body.set("wstoken", this.token);
		body.set("wsfunction", wsfunction);
		body.set("moodlewsrestformat", "json");

		// Simple flatten: arrays become key[0], key[1]...
		for (const [k, v] of Object.entries(args)) {
			if (Array.isArray(v)) {
				v.forEach((item, idx) => body.set(`${k}[${idx}]`, String(item)));
			} else if (v !== undefined && v !== null) {
				body.set(k, String(v));
			}
		}

		const res = await requestUrl({
			url: this.endpoint(),
			method: "POST",
			body: body.toString(),
			headers: { "Content-Type": "application/x-www-form-urlencoded" }
		});

		const json: unknown = res.json;
		const error = getMoodleError(json);
		if (error) {
			throw new Error(error);
		}
		return json as T;
	}

	async downloadFile(fileurl: string): Promise<ArrayBuffer> {
		// Most Moodle "pluginfile.php" URLs accept token=... for WS tokens.
		const url = new URL(fileurl);
		if (!url.searchParams.get("token")) url.searchParams.set("token", this.token);

		const res = await requestUrl({ url: url.toString(), method: "GET" });
		if (res.status >= 400) throw new Error(`Download failed HTTP ${res.status}`);
		return res.arrayBuffer;
	}
}

function getMoodleError(value: unknown): string | null {
	if (!isRecord(value)) {
		return null;
	}

	const hasException = typeof value.exception === "string" && value.exception.length > 0;
	const errorCode = typeof value.errorcode === "string" ? value.errorcode : null;
	const hasErrorCode = errorCode !== null && errorCode.length > 0;
	if (!hasException && !hasErrorCode) {
		return null;
	}

	if (typeof value.message === "string" && value.message.length > 0) {
		return value.message;
	}

	if (hasErrorCode) {
		return errorCode;
	}

	return "Moodle WS error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
