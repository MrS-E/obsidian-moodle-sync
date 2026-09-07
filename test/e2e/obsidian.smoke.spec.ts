import { _electron as electron, ElectronApplication, expect, test } from "@playwright/test";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { env, platform } from "node:process";
import { startFixtureMoodleServer } from "./fixtureMoodleServer";

const obsidianPath = env.OBSIDIAN_PATH;

test.describe("Obsidian Moodle sync smoke", () => {
	test.skip(!obsidianPath, "Set OBSIDIAN_PATH to run the real-Obsidian smoke suite.");

	test("loads the plugin and runs connection, dry-run, apply, migration, and reload flows", async () => {
		if (!obsidianPath) throw new Error("OBSIDIAN_PATH is required for the real-Obsidian smoke suite.");
		const server = await startFixtureMoodleServer();
		const vaultPath = await createFixtureVault(server.baseUrl);
		let application: ElectronApplication | undefined;
		try {
			application = await electron.launch({ executablePath: obsidianPath, args: ["--vault", vaultPath] });
			const page = await application.firstWindow();
			await expect(page.getByText("Moodle sync: idle", { exact: true })).toBeVisible({ timeout: 30_000 });
			await editAndPersistSettings(page, server.baseUrl);

			await runCommand(page, "Test connection");
			await expect(page.getByText("OK: Fixture Moodle / student", { exact: true })).toBeVisible();
			await runCommand(page, "Sync now (dry-run)");
			await expect(page.getByText("Moodle sync (dry-run) summary:", { exact: true })).toBeVisible();
			await expect(readFile(join(vaultPath, "Moodle", "Course-A (42)", "Lecture-1.md"), "utf8")).rejects.toThrow();

			await runCommand(page, "Sync now (apply)");
			await expect.poll(async () => await readFile(join(vaultPath, "Moodle", "Course-A (42)", "Lecture-1.md"), "utf8"))
				.toContain("Fixture content");
			expect(await readFile(join(vaultPath, "Notes", "references.md"), "utf8"))
				.toContain("[[Moodle/Course-A (42)/Lecture-1|Lecture]]");
			await openGeneratedNote(page, "Lecture-1");
			await expect(page.getByText("Fixture content", { exact: true })).toBeVisible();

			await application.close();
			application = undefined;
			application = await electron.launch({ executablePath: obsidianPath, args: ["--vault", vaultPath] });
			await expect((await application.firstWindow()).getByText("Moodle sync: idle", { exact: true })).toBeVisible({ timeout: 30_000 });
		} finally {
			await application?.close();
			await server.close();
			await rm(vaultPath, { recursive: true, force: true });
		}
	});
});

async function createFixtureVault(baseUrl: string): Promise<string> {
	const vaultPath = await mkdtemp(join(tmpdir(), "obsidian-moodle-sync-"));
	// eslint-disable-next-line obsidianmd/hardcoded-config-path -- The disposable fixture uses Obsidian's default config directory.
	const pluginPath = join(vaultPath, ".obsidian", "plugins", "moodle-sync");
	await mkdir(pluginPath, { recursive: true });
	for (const file of ["main.js", "manifest.json", "styles.css"]) {
		await cp(resolve(file), join(pluginPath, file));
	}
	await writeFile(join(pluginPath, "data.json"), JSON.stringify({
		baseUrl,
		token: "fixture-token",
		rootFolder: "Moodle",
		resourcesFolder: "Moodle/_resources",
		concurrency: 1,
		writeLogFile: false,
		logFilePath: "Moodle/_sync-log.md"
	}));
	// eslint-disable-next-line obsidianmd/hardcoded-config-path -- The disposable fixture uses Obsidian's default config directory.
	await writeFile(join(vaultPath, ".obsidian", "community-plugins.json"), JSON.stringify(["moodle-sync"]));
	await mkdir(join(vaultPath, "Moodle", "Course [A] (42)"), { recursive: true });
	await mkdir(join(vaultPath, "Notes"), { recursive: true });
	await writeFile(join(vaultPath, "Moodle", "Course [A] (42)", "Lecture [1].md"), "# Lecture\n");
	await writeFile(join(vaultPath, "Notes", "references.md"), "[[Moodle/Course [A] (42)/Lecture [1]|Lecture]]\n");
	return vaultPath;
}

async function runCommand(page: Awaited<ReturnType<ElectronApplication["firstWindow"]>>, name: string): Promise<void> {
	await page.keyboard.press(shortcut("P"));
	const input = page.locator(".prompt-input").last();
	await input.fill(name);
	await page.getByText(name, { exact: true }).last().click();
}

async function editAndPersistSettings(page: Awaited<ReturnType<ElectronApplication["firstWindow"]>>, baseUrl: string): Promise<void> {
	await page.keyboard.press(shortcut(","));
	await page.getByText("Moodle Sync", { exact: true }).last().click();
	const baseUrlInput = page.getByPlaceholder("https://moodle.example.edu").last();
	await baseUrlInput.fill(`${baseUrl}/`);
	await baseUrlInput.press("Tab");
	await expect(baseUrlInput).toHaveValue(baseUrl);
}

async function openGeneratedNote(page: Awaited<ReturnType<ElectronApplication["firstWindow"]>>, name: string): Promise<void> {
	await page.keyboard.press(shortcut("O"));
	const input = page.locator(".prompt-input").last();
	await input.fill(name);
	await input.press("Enter");
}

function shortcut(key: string): string {
	return platform === "darwin" ? `Meta+${key}` : `Control+${key}`;
}