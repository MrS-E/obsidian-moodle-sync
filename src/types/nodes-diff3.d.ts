declare module "node-diff3" {
	export function diff3Merge(
		a: string[],
		o: string[],
		b: string[],
		excludeFalseConflicts?: boolean
	): Array<
		| { ok: string[] }
		| { conflict: { a: string[]; o: string[]; b: string[] } }
	>;
}
