import { RemoteSyncData } from "../domain/models";
import { SyncState } from "../domain/syncState";
import { NoteMergeAction, planNoteMerge } from "../merge/noteMergeActor";
import { rewriteMarkdownLinks } from "../migration/linkRewriter";
import { createManagedPathLayout, ManagedModulePath } from "../migration/managedPaths";
import {
	createPathMigration,
	CURRENT_PATH_MIGRATION_VERSION,
	ManagedPathMapping,
	projectMigratedPath
} from "../migration/pathMigration";
import { renderCourseIndex, renderModuleNote } from "../rendering/markdownRenderer";
import { renderQuizAttemptNotes } from "../rendering/quizRenderer";
import { isEmbeddableMedia, join } from "../util";
import { SyncMode, SyncPlan, SyncPlanAction } from "./actions";
import { parentPath } from "./pathUtils";
import { VaultSnapshot } from "./vaultSnapshot";

export interface SyncPlannerSettings {
	rootFolder: string;
	resourcesFolder: string;
}

export function createSyncPlan(
	remote: RemoteSyncData,
	snapshot: VaultSnapshot,
	state: SyncState,
	settings: SyncPlannerSettings,
	mode: SyncMode
): SyncPlan {
	const actions: SyncPlanAction[] = [];
	const layout = createManagedPathLayout(remote.courses, settings);
	const quizzesByCourse = new Map(remote.courses.map(course => [course.course.id, course.quizAttempts]));
	let pathMoves = 0;
	let linksRewrite = 0;

	if (state.pathMigrationVersion < CURRENT_PATH_MIGRATION_VERSION) {
		const migration = createPathMigration(layout.mappings, path => snapshot.hasPath(path));
		const linkActions = planLinkRewrites(snapshot, migration.mappings);
		pathMoves = migration.moves.length;
		linksRewrite = linkActions.reduce((total, action) => total + action.count, 0);
		actions.push(...migration.moves.map(move => ({
			kind: "path-move" as const,
			from: move.from,
			to: move.to,
			pathKind: move.kind
		})));
		actions.push(...linkActions);
		actions.push({ kind: "state-remap", mappings: migration.mappings, migrationVersion: CURRENT_PATH_MIGRATION_VERSION });
	}

	actions.push({ kind: "ensure-folder", path: settings.rootFolder });
	actions.push({ kind: "ensure-folder", path: settings.resourcesFolder });

	let notesCreate = 0;
	let notesUpdate = 0;
	let noteConflicts = 0;
	let resourcesDownload = 0;
	let markdownGenerate = 0;
	let resourcesSkip = 0;
	let bytesToDownload = 0;

	for (const course of layout.courses) {
		actions.push({ kind: "ensure-folder", path: course.folder });
		actions.push({ kind: "ensure-folder", path: course.resourceFolder });

		const indexPath = join(course.folder, "_index.md");
		const index = renderCourseIndex(course.name, String(course.course.id), course.sections, moduleNames(course.modules));
		const indexAction = planNote(snapshot, state, indexPath, index.text, index.blocks, layout.mappings);
		addNoteAction(actions, indexAction, counters => {
			notesCreate += counters.create;
			notesUpdate += counters.update;
			noteConflicts += counters.conflicts;
		});

		for (const modulePath of course.modules) {
			const modulePlan = planModule(modulePath, quizzesByCourse.get(course.course.id)?.get(modulePath.module.id) ?? []);
			const noteAction = planNote(
				snapshot,
				state,
				modulePath.notePath,
				modulePlan.noteText,
				modulePlan.remoteBlocks,
				layout.mappings,
				modulePath.legacyNotePath
			);
			addNoteAction(actions, noteAction, counters => {
				notesCreate += counters.create;
				notesUpdate += counters.update;
				noteConflicts += counters.conflicts;
			});

			for (const resource of modulePlan.resources) {
				const folder = parentPath(resource.destPath);
				if (folder) actions.push({ kind: "ensure-folder", path: folder });
				if (shouldDownload(state, snapshot, resource.destPath, resource.legacyDestPath, resource.timemodified, resource.filesize)) {
					resourcesDownload++;
					bytesToDownload += resource.filesize ?? 0;
					actions.push({ kind: "resource-download", ...resource });
				} else {
					resourcesSkip++;
					actions.push({ kind: "resource-skip", destPath: resource.destPath });
				}
			}

			for (const generated of modulePlan.generatedMarkdown) {
				const folder = parentPath(generated.destPath);
				if (folder) actions.push({ kind: "ensure-folder", path: folder });
				markdownGenerate++;
				actions.push({ kind: "markdown-generate", ...generated });
			}
		}
	}

	return {
		mode,
		actions: dedupeEnsureFolders(actions),
		summary: {
			courses: remote.courses.length,
			pathMoves,
			linksRewrite,
			notesCreate,
			notesUpdate,
			noteConflicts,
			resourcesDownload,
			markdownGenerate,
			resourcesSkip,
			bytesToDownload
		},
		meta: remote.site
	};
}

function planModule(modulePath: ManagedModulePath, quizAttempts: Parameters<typeof renderQuizAttemptNotes>[2]) {
	const resources = modulePath.resources.map(resource => {
		const filename = resource.path.split("/").pop() ?? resource.content.filename;
		return {
			destPath: resource.path,
			legacyDestPath: resource.legacyPath,
			fileurl: resource.content.fileurl,
			timemodified: resource.content.timemodified,
			filesize: resource.content.filesize,
			link: isEmbeddableMedia(filename) ? `- ![[${resource.path}]]` : `- [[${resource.path}]]`
		};
	});
	const quiz = renderQuizAttemptNotes(modulePath.resourceFolder, modulePath.module, quizAttempts);
	const rendered = renderModuleNote(modulePath.section, modulePath.module, [
		...resources.map(resource => resource.link),
		...quiz.resourceLinks
	]);
	return {
		noteText: rendered.text,
		remoteBlocks: rendered.blocks,
		resources,
		generatedMarkdown: quiz.files
	};
}

function planNote(
	snapshot: VaultSnapshot,
	state: SyncState,
	path: string,
	text: string,
	blocks: Record<string, string>,
	mappings: ManagedPathMapping[],
	legacyPath = legacyPathFor(path, mappings)
): NoteMergeAction {
	const current = snapshot.getFile(legacyPath) ?? snapshot.getFile(path);
	return planNoteMerge(state, path, text, blocks, current);
}

function planLinkRewrites(
	snapshot: VaultSnapshot,
	mappings: ManagedPathMapping[]
): Array<Extract<SyncPlanAction, { kind: "links-rewrite" }>> {
	return snapshot.getMarkdownFiles().flatMap(file => {
		const rewritten = rewriteMarkdownLinks(file.text, {
			sourcePath: file.path,
			outputSourcePath: projectMigratedPath(file.path, mappings),
			resolveLink: (sourcePath, linkPath) => snapshot.resolveLink(sourcePath, linkPath),
			mapPath: path => projectMigratedPath(path, mappings)
		});
		return rewritten.text === file.text ? [] : [{
			kind: "links-rewrite" as const,
			path: projectMigratedPath(file.path, mappings),
			text: rewritten.text,
			expectedHash: file.hash,
			count: rewritten.count
		}];
	});
}

function addNoteAction(
	actions: SyncPlanAction[],
	action: NoteMergeAction,
	add: (counters: { create: number; update: number; conflicts: number }) => void
): void {
	if (action.noOp) return;
	add({
		create: action.operation === "create" ? 1 : 0,
		update: action.operation === "update" ? 1 : 0,
		conflicts: action.conflicted ? 1 : 0
	});
	actions.push(action);
}

function shouldDownload(
	state: SyncState,
	snapshot: VaultSnapshot,
	destPath: string,
	legacyDestPath: string,
	timemodified: number | undefined,
	filesize: number | undefined
): boolean {
	const previous = state.files[destPath] ?? state.files[legacyDestPath];
	if (!previous) return true;
	if (timemodified && previous.timemodified && timemodified > previous.timemodified) return true;
	if (filesize && previous.filesize && filesize !== previous.filesize) return true;
	return !snapshot.hasPath(destPath) && !snapshot.hasPath(legacyDestPath);
}

function legacyPathFor(path: string, mappings: ManagedPathMapping[]): string {
	return mappings.find(mapping => mapping.kind === "file" && mapping.to === path)?.from ?? path;
}

function moduleNames(modules: ManagedModulePath[]): Map<number, string> {
	return new Map(modules.map(modulePath => [modulePath.module.id, modulePath.name]));
}

function dedupeEnsureFolders(actions: SyncPlanAction[]): SyncPlanAction[] {
	const paths = new Set<string>();
	return actions.filter(action => {
		if (action.kind !== "ensure-folder") return true;
		if (paths.has(action.path)) return false;
		paths.add(action.path);
		return true;
	});
}