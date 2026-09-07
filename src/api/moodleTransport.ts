import { requestUrl } from "obsidian";
import { MoodleArgs, MoodleTransport } from "./contracts";

export class MoodleRestTransport implements MoodleTransport {
	constructor(private readonly baseUrl: string, private readonly token: string) {}

	async call(functionName: string, args: MoodleArgs = {}): Promise<unknown> {
		const body = new URLSearchParams();
		body.set("wstoken", this.token);
		body.set("wsfunction", functionName);
		body.set("moodlewsrestformat", "json");

		for (const [key, value] of Object.entries(args)) {
			if (Array.isArray(value)) {
				value.forEach((item, index) => body.set(`${key}[${index}]`, String(item)));
			} else if (value !== undefined && value !== null) {
				body.set(key, String(value));
			}
		}

		const response = await requestUrl({
			url: `${this.baseUrl}/webservice/rest/server.php`,
			method: "POST",
			body: body.toString(),
			headers: { "Content-Type": "application/x-www-form-urlencoded" }
		});

		if (response.status >= 400) {
			throw new Error(`Moodle request failed HTTP ${response.status}`);
		}

		const error = getMoodleError(response.json);
		if (error) {
			throw new Error(error);
		}
		return response.json;
	}

	async download(fileurl: string): Promise<ArrayBuffer> {
		const url = new URL(fileurl);
		if (!url.searchParams.get("token")) {
			url.searchParams.set("token", this.token);
		}

		const response = await requestUrl({ url: url.toString(), method: "GET" });
		if (response.status >= 400) {
			throw new Error(`Download failed HTTP ${response.status}`);
		}
		return response.arrayBuffer;
	}
}

export function getMoodleError(value: unknown): string | null {
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

	return errorCode ?? "Moodle WS error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}