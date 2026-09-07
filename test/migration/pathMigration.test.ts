import { describe, expect, it } from "vitest";
import {
	createPathMigration,
	projectMigratedPath,
	remapSyncState
} from "../../src/migration/pathMigration";
import { DEFAULT_SYNC_STATE } from "../../src/domain/syncState";

describe("path migration", () => {
	it("orders parent moves, projects paths, and remaps path-keyed state", () => {
		const migration = createPathMigration([
			{ from: "Moodle/Old Course (1)", to: "Moodle/New Course (1)", kind: "folder" },
			{ from: "Moodle/Old Course (1)/Old note.md", to: "Moodle/New Course (1)/New note.md", kind: "file" }
		],
		(path) => path === "Moodle/Old Course (1)" || path === "Moodle/Old Course (1)/Old note.md");

		expect(migration.moves).toEqual([
			{ from: "Moodle/Old Course (1)", to: "Moodle/New Course (1)", kind: "folder" },
			{ from: "Moodle/Old Course (1)/Old note.md", to: "Moodle/New Course (1)/New note.md", kind: "file" }
		]);
		expect(projectMigratedPath("Moodle/Old Course (1)/Old note.md", migration.mappings)).toBe("Moodle/New Course (1)/New note.md");

		const remapped = remapSyncState({
			...DEFAULT_SYNC_STATE,
			files: { "Moodle/Old Course (1)/slides.pdf": { filesize: 10 } },
			notes: { "Moodle/Old Course (1)/Old note.md": { baseBlocks: { content: "old" }, lastSyncedManagedHash: "1" } }
		}, migration.mappings);

		expect(remapped.files).toHaveProperty("Moodle/New Course (1)/slides.pdf");
		expect(remapped.notes).toHaveProperty("Moodle/New Course (1)/New note.md");
	});

	it("rejects ambiguous and occupied destinations before applying a move", () => {
		expect(() => createPathMigration([
			{ from: "Moodle/One.md", to: "Moodle/Shared.md", kind: "file" },
			{ from: "Moodle/Two.md", to: "Moodle/Shared.md", kind: "file" }
		], () => false)).toThrow("multiple managed paths");

		expect(() => createPathMigration([
			{ from: "Moodle/Old.md", to: "Moodle/New.md", kind: "file" }
		], (path) => path === "Moodle/Old.md" || path === "Moodle/New.md")).toThrow("already exists");
	});

	it("leaves a legacy path untouched when it has competing normalized destinations", () => {
		const migration = createPathMigration([
			{ from: "Moodle/Course (1)/Topic-.md", to: "Moodle/Course (1)/Topic (10).md", kind: "file" },
			{ from: "Moodle/Course (1)/Topic-.md", to: "Moodle/Course (1)/Topic (11).md", kind: "file" }
		], path => path === "Moodle/Course (1)/Topic-.md");

		expect(migration.mappings).toEqual([]);
		expect(migration.moves).toEqual([]);
		expect(migration.skippedSources).toEqual(["Moodle/Course (1)/Topic-.md"]);
	});
});