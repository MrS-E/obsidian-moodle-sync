import { Buffer } from "node:buffer";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";

export interface FixtureMoodleServer {
	baseUrl: string;
	close(): Promise<void>;
}

export async function startFixtureMoodleServer(): Promise<FixtureMoodleServer> {
	let baseUrl = "";
	const server = createServer((request, response) => {
		void handleRequest(request, response, () => baseUrl).catch(() => {
			if (!response.headersSent) response.writeHead(500);
			response.end();
		});
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Fixture Moodle server did not expose a TCP address.");
	baseUrl = `http://127.0.0.1:${address.port}`;
	return { baseUrl, close: () => closeServer(server) };
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, getBaseUrl: () => string): Promise<void> {
		if (request.url?.startsWith("/files/slides.pdf")) {
			response.writeHead(200, { "content-type": "application/pdf" });
			response.end(Buffer.from("fixture-pdf"));
			return;
		}
		if (request.url !== "/webservice/rest/server.php" || request.method !== "POST") {
			response.writeHead(404).end();
			return;
		}

		const body = await readRequestBody(request);
		const functionName = new URLSearchParams(body).get("wsfunction");
		const json = responseFor(functionName, getBaseUrl());
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify(json));
}

function responseFor(functionName: string | null, baseUrl: string): unknown {
	switch (functionName) {
		case "core_webservice_get_site_info":
			return { userid: 7, sitename: "Fixture Moodle", username: "student" };
		case "core_enrol_get_users_courses":
			return [{ id: 42, fullname: "Course [A]" }];
		case "core_course_get_contents":
			return [{ id: 1, name: "Week 1", modules: [{
				id: 9,
				name: "Lecture [1]",
				modname: "resource",
				description: "<p>Fixture content</p>",
				contents: [{ type: "file", id: 10, filename: "slides [1].pdf", fileurl: `${baseUrl}/files/slides.pdf`, filesize: 11 }]
			}]}];
		default:
			return { exception: "invalid_parameter_exception", errorcode: "invalidfunction", message: `Unsupported fixture function ${functionName}` };
	}
}

function readRequestBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		request.on("error", reject);
	});
}

function closeServer(server: Server): Promise<void> {
	return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}