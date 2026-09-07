import { Course, CourseModule, CourseSection, FileContent, isFileContent } from "../domain/models";
import { join } from "../util";
import { ManagedPathMapping } from "./pathMigration";
import {
	legacyPathSegment,
	legacyPathSegments,
	normalizePathSegment,
	normalizePathSegments,
	resolvePathSegmentCollisions
} from "./pathNormalizer";

export interface ManagedModulePath {
	section: CourseSection;
	module: CourseModule;
	name: string;
	legacyName: string;
	notePath: string;
	legacyNotePath: string;
	resourceFolder: string;
	legacyResourceFolder: string;
	resources: ManagedResourcePath[];
}

export interface ManagedResourcePath {
	content: FileContent;
	path: string;
	legacyPath: string;
}

export interface ManagedCoursePath {
	course: Course;
	sections: CourseSection[];
	name: string;
	folder: string;
	legacyFolder: string;
	resourceFolder: string;
	legacyResourceFolder: string;
	modules: ManagedModulePath[];
}

export interface ManagedPathLayout {
	courses: ManagedCoursePath[];
	mappings: ManagedPathMapping[];
}

export function createManagedPathLayout(
	courses: Array<{ course: Course; sections: CourseSection[] }>,
	settings: { rootFolder: string; resourcesFolder: string }
): ManagedPathLayout {
	const layouts: ManagedCoursePath[] = [];
	const mappings: ManagedPathMapping[] = [];

	for (const { course, sections } of courses) {
		const courseId = String(course.id);
		const nameSource = course.fullname ?? course.shortname ?? `Course ${courseId}`;
		const name = normalizePathSegment(nameSource, `Course ${courseId}`);
		const legacyName = legacyPathSegment(nameSource);
		const folder = join(settings.rootFolder, `${name} (${courseId})`);
		const legacyFolder = join(settings.rootFolder, `${legacyName} (${courseId})`);
		const resourceFolder = join(settings.resourcesFolder, `${name} (${courseId})`);
		const legacyResourceFolder = join(settings.resourcesFolder, `${legacyName} (${courseId})`);

		addMapping(mappings, legacyFolder, folder, "folder");
		addMapping(mappings, legacyResourceFolder, resourceFolder, "folder");

		const moduleEntries = collectModules(sections);
		const names = resolvePathSegmentCollisions(moduleEntries.map(entry => ({
			key: entry.key,
			value: entry.module.name ?? `${entry.module.modname ?? "module"}-${entry.module.id}`,
			moodleId: entry.module.id,
			fallback: `module-${entry.module.id}`
		})));
		const modules = moduleEntries.map(entry => {
			const source = entry.module.name ?? `${entry.module.modname ?? "module"}-${entry.module.id}`;
			const name = names.get(entry.key) ?? normalizePathSegment(source, `module-${entry.module.id}`);
			const legacyName = legacyPathSegment(source);
			const notePath = join(folder, `${name}.md`);
			const legacyNotePath = join(legacyFolder, `${legacyName}.md`);
			const moduleResourceFolder = join(resourceFolder, name);
			const legacyModuleResourceFolder = join(legacyResourceFolder, legacyName);

			addMapping(mappings, legacyNotePath, notePath, "file");
			addMapping(mappings, legacyModuleResourceFolder, moduleResourceFolder, "folder");
			const resources = createManagedResourcePaths(mappings, entry.module, legacyModuleResourceFolder, moduleResourceFolder);

			return {
				section: entry.section,
				module: entry.module,
				name,
				legacyName,
				notePath,
				legacyNotePath,
				resourceFolder: moduleResourceFolder,
				legacyResourceFolder: legacyModuleResourceFolder,
				resources
			};
		});

		const indexPath = join(folder, "_index.md");
		const legacyIndexPath = join(legacyFolder, "_index.md");
		addMapping(mappings, legacyIndexPath, indexPath, "file");
		layouts.push({
			course,
			sections,
			name,
			folder,
			legacyFolder,
			resourceFolder,
			legacyResourceFolder,
			modules
		});
	}

	return { courses: layouts, mappings };
}

function collectModules(sections: CourseSection[]): Array<{ key: string; section: CourseSection; module: CourseModule }> {
	const modules: Array<{ key: string; section: CourseSection; module: CourseModule }> = [];
	for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
		const section = sections[sectionIndex];
		if (!section) continue;
		for (let moduleIndex = 0; moduleIndex < (section.modules?.length ?? 0); moduleIndex++) {
			const module = section.modules?.[moduleIndex];
			if (!module) continue;
			modules.push({ key: `${sectionIndex}:${moduleIndex}:${module.id}`, section, module });
		}
	}
	return modules;
}

function createManagedResourcePaths(
	mappings: ManagedPathMapping[],
	module: CourseModule,
	legacyModuleFolder: string,
	moduleFolder: string
): ManagedResourcePath[] {
	const files = (module.contents ?? []).filter(isFileContent);
	const paths = files.map((content, index) => ({
		content,
		key: String(index),
		legacyDirectories: legacyPathSegments(content.filepath),
		directories: normalizePathSegments(content.filepath)
	}));
	const names = new Map<string, string>();
	const pathsByDirectory = new Map<string, typeof paths>();
	for (const path of paths) {
		const directory = path.directories.join("/");
		const existing = pathsByDirectory.get(directory) ?? [];
		existing.push(path);
		pathsByDirectory.set(directory, existing);
	}
	for (const directoryPaths of pathsByDirectory.values()) {
		const resolved = resolvePathSegmentCollisions(directoryPaths.map(path => ({
			key: path.key,
			value: path.content.filename,
			moodleId: path.content.id ?? module.id,
			fallback: "resource"
		})));
		for (const [key, name] of resolved) {
			names.set(key, name);
		}
	}

	return paths.map(path => {
		const { content, legacyDirectories, directories } = path;
		const commonDepth = Math.min(legacyDirectories.length, directories.length);
		for (let index = 0; index < commonDepth; index++) {
			addMapping(
				mappings,
				join(legacyModuleFolder, ...legacyDirectories.slice(0, index + 1)),
				join(moduleFolder, ...directories.slice(0, index + 1)),
				"folder"
			);
		}

		const legacyPath = join(legacyModuleFolder, ...legacyDirectories, legacyPathSegment(content.filename));
		const resourcePath = join(moduleFolder, ...directories, names.get(path.key) ?? normalizePathSegment(content.filename, "resource"));
		addMapping(mappings, legacyPath, resourcePath, "file");
		return { content, path: resourcePath, legacyPath };
	});
}

function addMapping(mappings: ManagedPathMapping[], from: string, to: string, kind: ManagedPathMapping["kind"]): void {
	if (from !== to) {
		mappings.push({ from, to, kind });
	}
}