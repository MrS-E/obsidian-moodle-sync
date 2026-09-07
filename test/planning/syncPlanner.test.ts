import { describe, expect, it } from "vitest";
import { RemoteSyncData } from "../../src/domain/models";
import { DEFAULT_SYNC_STATE } from "../../src/domain/syncState";
import { createSyncPlan } from "../../src/planning/syncPlanner";
import { VaultSnapshot } from "../../src/planning/vaultSnapshot";

describe("sync planner", () => {
	it("creates a deterministic migration-first action sequence from immutable inputs", () => {
		const remote: RemoteSyncData = {
			site: { userid: 4 },
			courses: [{
				course: { id: 10, fullname: "Course [A]" },
				sections: [{ id: 2, modules: [{ id: 3, name: "Module #1", modname: "resource" }] }],
				quizAttempts: new Map()
			}]
		};
		const snapshot = new VaultSnapshot(
			new Set(["Moodle/Course [A] (10)", "Moodle/Course [A] (10)/Module #1.md"]),
			new Map([[
				"Moodle/Course [A] (10)/Module #1.md",
				{ path: "Moodle/Course [A] (10)/Module #1.md", text: "# Existing", hash: "hash" }
			]]),
			new Map()
		);

		const first = createSyncPlan(remote, snapshot, structuredClone(DEFAULT_SYNC_STATE), settings(), "dry-run");
		const second = createSyncPlan(remote, snapshot, structuredClone(DEFAULT_SYNC_STATE), settings(), "dry-run");

		expect(first).toEqual(second);
		expect(first.actions.findIndex(action => action.kind === "path-move")).toBe(0);
		expect(first.actions.findIndex(action => action.kind === "state-remap"))
			.toBeLessThan(first.actions.findIndex(action => action.kind === "ensure-folder"));
		expect(first.actions).toContainEqual(expect.objectContaining({ kind: "note-merge", path: "Moodle/Course-A (10)/Module-1.md" }));
	});
});

function settings() {
	return { rootFolder: "Moodle", resourcesFolder: "Moodle/_resources" };
}