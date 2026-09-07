import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";

const releaseFiles = ["main.js", "manifest.json", "styles.css"];

async function readManifest() {
	let manifest;
	try {
		manifest = JSON.parse(await readFile("manifest.json", "utf8"));
	} catch (error) {
		throw new Error(`Unable to read manifest.json: ${error instanceof Error ? error.message : String(error)}`);
	}

	if (!isNonEmptyString(manifest?.id) || !isNonEmptyString(manifest?.version)) {
		throw new Error("manifest.json must contain non-empty id and version fields.");
	}

	return manifest;
}

function isNonEmptyString(value) {
	return typeof value === "string" && value.length > 0;
}

function crc32(contents) {
	let crc = 0xffffffff;
	for (const byte of contents) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) {
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
	}

	return (crc ^ 0xffffffff) >>> 0;
}

function toDosTimestamp(date) {
	const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
	return {
		date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
		time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
	};
}

function createZip(entries) {
	const timestamp = toDosTimestamp(new Date());
	let offset = 0;
	const localRecords = [];
	const centralRecords = [];

	for (const entry of entries) {
		const name = Buffer.from(entry.name);
		const checksum = crc32(entry.contents);
		const localHeader = Buffer.alloc(30);
		localHeader.writeUInt32LE(0x04034b50, 0);
		localHeader.writeUInt16LE(20, 4);
		localHeader.writeUInt16LE(0, 6);
		localHeader.writeUInt16LE(0, 8);
		localHeader.writeUInt16LE(timestamp.time, 10);
		localHeader.writeUInt16LE(timestamp.date, 12);
		localHeader.writeUInt32LE(checksum, 14);
		localHeader.writeUInt32LE(entry.contents.length, 18);
		localHeader.writeUInt32LE(entry.contents.length, 22);
		localHeader.writeUInt16LE(name.length, 26);
		localHeader.writeUInt16LE(0, 28);
		const localRecord = Buffer.concat([localHeader, name, entry.contents]);
		localRecords.push(localRecord);

		const centralHeader = Buffer.alloc(46);
		centralHeader.writeUInt32LE(0x02014b50, 0);
		centralHeader.writeUInt16LE(0x0314, 4);
		centralHeader.writeUInt16LE(20, 6);
		centralHeader.writeUInt16LE(0, 8);
		centralHeader.writeUInt16LE(0, 10);
		centralHeader.writeUInt16LE(timestamp.time, 12);
		centralHeader.writeUInt16LE(timestamp.date, 14);
		centralHeader.writeUInt32LE(checksum, 16);
		centralHeader.writeUInt32LE(entry.contents.length, 20);
		centralHeader.writeUInt32LE(entry.contents.length, 24);
		centralHeader.writeUInt16LE(name.length, 28);
		centralHeader.writeUInt16LE(0, 30);
		centralHeader.writeUInt16LE(0, 32);
		centralHeader.writeUInt16LE(0, 34);
		centralHeader.writeUInt16LE(0, 36);
		centralHeader.writeUInt32LE(0, 38);
		centralHeader.writeUInt32LE(offset, 42);
		centralRecords.push(Buffer.concat([centralHeader, name]));
		offset += localRecord.length;
	}

	const centralDirectory = Buffer.concat(centralRecords);
	const endRecord = Buffer.alloc(22);
	endRecord.writeUInt32LE(0x06054b50, 0);
	endRecord.writeUInt16LE(0, 4);
	endRecord.writeUInt16LE(0, 6);
	endRecord.writeUInt16LE(entries.length, 8);
	endRecord.writeUInt16LE(entries.length, 10);
	endRecord.writeUInt32LE(centralDirectory.length, 12);
	endRecord.writeUInt32LE(offset, 16);
	endRecord.writeUInt16LE(0, 20);

	return Buffer.concat([...localRecords, centralDirectory, endRecord]);
}

const manifest = await readManifest();
await Promise.all(releaseFiles.map(async (file) => {
	try {
		await access(file, constants.R_OK);
	} catch {
		throw new Error(`Missing release file: ${file}. Run npm run build first.`);
	}
}));

const entries = await Promise.all(releaseFiles.map(async (name) => ({
	name,
	contents: await readFile(name),
})));
const archivePath = join("dist", `${manifest.id}-${manifest.version}.zip`);

await mkdir(dirname(archivePath), { recursive: true });
await writeFile(archivePath, createZip(entries));

console.log(`Created ${archivePath} with ${releaseFiles.join(", ")}.`);