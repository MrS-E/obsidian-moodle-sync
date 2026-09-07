export interface PathSegmentCandidate {
	key: string;
	value: string | undefined;
	moodleId: number;
	fallback?: string;
}

const INVALID_SEGMENT_CHARACTERS = /\s*[\\/:*?"<>|\[\]#^]+\s*/g;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;

export function normalizePathSegment(value: string | undefined, fallback = "Untitled"): string {
	const normalized = (value ?? "")
		.normalize("NFKC")
		.replace(CONTROL_CHARACTERS, "")
		.replace(INVALID_SEGMENT_CHARACTERS, "-")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^[. ]+|[. ]+$/g, "")
		.replace(/-+/g, "-")
		.replace(/-(?=\.)/g, "")
		.replace(/^-+|-+$/g, "");

	if (normalized.length > 0) {
		return normalized;
	}

	const normalizedFallback = fallback
		.normalize("NFKC")
		.replace(CONTROL_CHARACTERS, "")
		.replace(INVALID_SEGMENT_CHARACTERS, "-")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^[. -]+|[. -]+$/g, "");
	return normalizedFallback || "Untitled";
}

export function normalizePathSegments(value: string | undefined, fallback = "Untitled"): string[] {
	const segments = (value ?? "")
		.split(/[\\/]+/)
		.filter(segment => segment.length > 0 && segment !== "." && segment !== "..");
	return segments.map(segment => normalizePathSegment(segment, fallback));
}

export function legacyPathSegment(value: string | undefined): string {
	return (value ?? "Untitled")
		.replace(/[\\/:*?"<>|]/g, "-")
		.replace(/\s+/g, " ")
		.trim();
}

export function legacyPathSegments(value: string | undefined): string[] {
	const segments = (value ?? "")
		.split(/[\\/]+/)
		.filter(segment => segment.length > 0 && segment !== "." && segment !== "..");
	return segments.map(segment => legacyPathSegment(segment));
}

export function resolvePathSegmentCollisions(candidates: PathSegmentCandidate[]): Map<string, string> {
	const normalized = candidates.map(candidate => ({
		...candidate,
		base: normalizePathSegment(candidate.value, candidate.fallback)
	}));
	const counts = new Map<string, number>();
	for (const candidate of normalized) {
		counts.set(candidate.base, (counts.get(candidate.base) ?? 0) + 1);
	}

	const ordered = [...normalized].sort((left, right) =>
		left.base.localeCompare(right.base) || left.moodleId - right.moodleId || left.key.localeCompare(right.key)
	);
	const resolved = new Map<string, string>();
	const occupied = new Set<string>();
	for (const candidate of ordered) {
		let name = (counts.get(candidate.base) ?? 0) > 1
			? appendMoodleId(candidate.base, candidate.moodleId)
			: candidate.base;
		let duplicate = 2;
		while (occupied.has(name)) {
			name = appendMoodleId(candidate.base, candidate.moodleId, duplicate);
			duplicate++;
		}
		occupied.add(name);
		resolved.set(candidate.key, name);
	}
	return resolved;
}

function appendMoodleId(name: string, moodleId: number, duplicate?: number): string {
	const extensionIndex = name.lastIndexOf(".");
	const suffix = ` (${moodleId})${duplicate ? `-${duplicate}` : ""}`;
	return extensionIndex > 0
		? `${name.slice(0, extensionIndex)}${suffix}${name.slice(extensionIndex)}`
		: `${name}${suffix}`;
}