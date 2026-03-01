import { requestUrl } from "obsidian";

export class MoodleClient {
	constructor(private baseUrl: string, private token: string) {}

	private endpoint(): string {
		return `${this.baseUrl}/webservice/rest/server.php`;
	}

	async call<T>(wsfunction: string, args: Record<string, any> = {}): Promise<T> {
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

		const json = res.json;
		if (json?.exception || json?.errorcode) {
			throw new Error(json?.message ?? json?.errorcode ?? "Moodle WS error");
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
