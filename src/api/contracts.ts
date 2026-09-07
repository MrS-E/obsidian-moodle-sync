export type MoodleScalar = string | number | boolean;
export type MoodleArgValue = MoodleScalar | null | undefined | MoodleScalar[];
export type MoodleArgs = Record<string, MoodleArgValue>;

export interface MoodleTransport {
	call(functionName: string, args?: MoodleArgs): Promise<unknown>;
	download(url: string): Promise<ArrayBuffer>;
}