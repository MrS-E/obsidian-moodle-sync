import { NoteMergeAction } from "../merge/noteMergeActor";
import { ManagedPathMapping } from "../migration/pathMigration";

export type SyncMode = "apply" | "dry-run";

export type SyncPlanAction =
	| { kind: "path-move"; from: string; to: string; pathKind: "file" | "folder" }
	| { kind: "links-rewrite"; path: string; text: string; expectedHash: string; count: number }
	| { kind: "state-remap"; mappings: ManagedPathMapping[]; migrationVersion: number }
	| { kind: "ensure-folder"; path: string }
	| NoteMergeAction
	| { kind: "resource-download"; destPath: string; fileurl: string; timemodified?: number; filesize?: number }
	| { kind: "resource-skip"; destPath: string }
	| { kind: "markdown-generate"; destPath: string; text: string };

export interface SyncPlanSummary {
	courses: number;
	pathMoves: number;
	linksRewrite: number;
	notesCreate: number;
	notesUpdate: number;
	noteConflicts: number;
	resourcesDownload: number;
	markdownGenerate: number;
	resourcesSkip: number;
	bytesToDownload: number;
}

export interface SyncPlan {
	mode: SyncMode;
	actions: SyncPlanAction[];
	summary: SyncPlanSummary;
	meta: {
		username?: string;
		userid: number;
		sitename?: string;
	};
}