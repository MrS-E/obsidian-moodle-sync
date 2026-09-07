import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SYNC_STATE } from "../../src/domain/syncState";
import { PlanExecutor } from "../../src/execution/planExecutor";
import { SyncPlan } from "../../src/planning/actions";
import { ObsidianVaultGateway } from "../../src/vault/obsidianVaultGateway";
import { createFakeApp } from "../helpers/fakeVault";

describe("plan executor", () => {
	it("writes successful downloads and leaves failed downloads out of state", async () => {
		const app = createFakeApp();
		const api = {
			downloadResource: vi.fn(async (url: string) => {
				if (url.endsWith("bad")) throw new Error("offline");
				return new ArrayBuffer(1);
			})
		};
		const plan: SyncPlan = {
			mode: "apply",
			actions: [
				{ kind: "ensure-folder", path: "Moodle" },
				{ kind: "resource-download", destPath: "Moodle/good.pdf", fileurl: "good", filesize: 1 },
				{ kind: "resource-download", destPath: "Moodle/bad.pdf", fileurl: "bad", filesize: 1 }
			],
			summary: { courses: 0, pathMoves: 0, linksRewrite: 0, migrationWarnings: [], notesCreate: 0, notesUpdate: 0, noteConflicts: 0, resourcesDownload: 2, markdownGenerate: 0, resourcesSkip: 0, bytesToDownload: 2 },
			meta: { userid: 4 }
		};
		const state = structuredClone(DEFAULT_SYNC_STATE);

		const result = await new PlanExecutor(new ObsidianVaultGateway(app as never), api, 2)
			.execute(plan, state, vi.fn(async () => undefined), { totalSteps: 3, setStatus: vi.fn(), tick: vi.fn() });

		expect(app.files.has("Moodle/good.pdf")).toBe(true);
		expect(state.files).toHaveProperty("Moodle/good.pdf");
		expect(state.files).not.toHaveProperty("Moodle/bad.pdf");
		expect(result.failedDownloads).toHaveLength(1);
	});
});