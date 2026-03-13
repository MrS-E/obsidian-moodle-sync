import { describe, expect, it } from "vitest";
import { requestLog, RequestUrlOptions, setRequestUrlImpl } from "./obsidian";
import { MoodleClient } from "../src/moodleClient";

describe("MoodleClient", () => {
	it("posts Moodle web service calls and flattens arrays", async () => {
		setRequestUrlImpl(async (options: RequestUrlOptions) => ({
			status: 200,
			json: { ok: true, echoed: options.body },
			arrayBuffer: new ArrayBuffer(0)
		}));

		const client = new MoodleClient("https://moodle.example.edu", "token123");
		const result = await client.call<{ ok: boolean; echoed: string }>("test_function", {
			userid: 7,
			courseids: [1, 2]
		});

		expect(result.ok).toBe(true);
		expect(requestLog[0]?.url).toBe("https://moodle.example.edu/webservice/rest/server.php");
		expect(result.echoed).toContain("wsfunction=test_function");
		expect(result.echoed).toContain("courseids%5B0%5D=1");
		expect(result.echoed).toContain("courseids%5B1%5D=2");
	});

	it("surfaces Moodle errors", async () => {
		setRequestUrlImpl(async () => ({
			status: 200,
			json: { exception: "moodle_exception", message: "Bad token" },
			arrayBuffer: new ArrayBuffer(0)
		}));

		const client = new MoodleClient("https://moodle.example.edu", "token123");
		await expect(client.call("test_function")).rejects.toThrow("Bad token");
	});

	it("falls back to the Moodle error code when no message is present", async () => {
		setRequestUrlImpl(async () => ({
			status: 200,
			json: { errorcode: "invalidtoken" },
			arrayBuffer: new ArrayBuffer(0)
		}));

		const client = new MoodleClient("https://moodle.example.edu", "token123");
		await expect(client.call("test_function")).rejects.toThrow("invalidtoken");
	});

	it("downloads files with the token appended", async () => {
		const bytes = new Uint8Array([1, 2, 3]).buffer;
		setRequestUrlImpl(async () => ({
			status: 200,
			json: {},
			arrayBuffer: bytes
		}));

		const client = new MoodleClient("https://moodle.example.edu", "token123");
		const result = await client.downloadFile("https://moodle.example.edu/pluginfile.php/1/mod_resource/content/1/file.pdf");

		expect(result).toBe(bytes);
		expect(requestLog[0]?.url).toContain("token=token123");
	});

	it("keeps an existing download token and throws on HTTP failures", async () => {
		setRequestUrlImpl(async () => ({
			status: 404,
			json: {},
			arrayBuffer: new ArrayBuffer(0)
		}));

		const client = new MoodleClient("https://moodle.example.edu", "token123");
		await expect(
			client.downloadFile("https://moodle.example.edu/pluginfile.php/1/file.pdf?token=keepme")
		).rejects.toThrow("Download failed HTTP 404");
		expect(requestLog[0]?.url).toContain("token=keepme");
	});
});
