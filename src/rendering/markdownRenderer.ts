import { CourseModule, CourseSection } from "../domain/models";
import { ensureUserSection, upsertBlock } from "../merge/managedBlocks";
import { normalizePathSegment } from "../migration/pathNormalizer";
import { renderMoodleHtml } from "./htmlToMarkdown";

export function renderCourseIndex(
	courseName: string,
	courseId: string,
	sections: CourseSection[],
	moduleNames: Map<number, string>
): { text: string; blocks: Record<string, string> } {
	const lines = [`- Moodle course id: \`${courseId}\``, ""];
	for (const section of sections) {
		lines.push(`## ${section.name ?? `Section ${section.section ?? ""}`}`.trim());
		for (const module of section.modules ?? []) {
			const name = moduleNames.get(module.id) ?? normalizePathSegment(module.name ?? `${module.modname ?? "module"}-${module.id}`, `module-${module.id}`);
			lines.push(`- [[${name}]]`);
		}
		lines.push("");
	}
	const index = lines.join("\n").replace(/\s+$/, "");
	let text = `# ${courseName}\n\n`;
	text = upsertBlock(text, "index", index);
	return { text: ensureUserSection(text), blocks: { index } };
}

export function renderModuleNote(
	section: CourseSection,
	module: CourseModule,
	resourceLinks: string[]
): { text: string; blocks: Record<string, string> } {
	const meta = [
		`- Type: \`${module.modname ?? "unknown"}\``,
		`- Section: ${section.name ?? section.section ?? ""}`,
		...(module.url ? [`- URL: ${module.url}`] : [])
	].join("\n");
	const content = module.description?.trim() ? renderMoodleHtml(module.description) : "";
	const resources = resourceLinks.join("\n").replace(/\s+$/, "");
	let text = `# ${module.name ?? "Untitled"}\n\n`;
	text = upsertBlock(text, "meta", meta);
	text = upsertBlock(text, "content", content);
	text = upsertBlock(text, "resources", resources);
	return { text: ensureUserSection(text), blocks: { meta, content, resources } };
}