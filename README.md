# Moodle Sync for Obsidian

Early MVP for syncing Moodle course content into an Obsidian vault.

## Status

This plugin is currently in an **early MVP** state.

What that means in practice:

- The core sync flow works.
- The vault structure and note format are already opinionated.
- Incremental sync, managed-block merge handling, path migration, and Markdown quiz attempts exist.
- The plugin is still missing broader Moodle compatibility testing and release validation in real Obsidian.

This is usable for real-world testing, but not yet something I would call production-ready.

## What it does

The plugin connects to Moodle via a web service token and syncs your enrolled courses into your vault.

Current behavior:

- Creates one folder per course under a configurable root folder.
- Creates an `_index.md` note per course.
- Creates one note per Moodle module.
- Downloads Moodle file resources into a mirrored resources folder.
- Re-downloads files only when metadata changed or the local file is missing.
- Preserves a user-editable notes section in synced notes.
- Merges Moodle-managed note blocks with local edits using block-level diff3.
- Marks unresolved conflicts instead of silently overwriting content.
- Supports dry-run planning before applying changes.
- Can append sync summaries to a log note.
- Renders finished quiz attempts as linked Markdown notes.
- Migrates legacy plugin-generated paths to link-safe normalized names and rewrites resolved internal links.

## Current vault layout

Example structure:

```text
Moodle/
  Databases (42)/
    _index.md
    Lecture 1.md
    Quiz 1.md
  _resources/
    Databases (42)/
      Lecture 1/
        slides.pdf
      Quiz 1/
        attempt-17.md
```

The exact folder names depend on your settings and Moodle course/module names. Generated path segments are Unicode-normalized and replace characters that conflict with filesystem paths or Obsidian links. Existing plugin-managed folders and files are migrated once; unrelated vault files are never renamed. The migration updates resolved wikilinks, embeds, aliases, heading/block suffixes, and Markdown links that target moved plugin files.

## Synced note model

Each generated note contains Moodle-managed blocks for:

- metadata
- content
- resources

Everything outside those managed blocks is treated as user-owned content. The plugin also ensures a `## My notes` section exists so you have a stable place for local annotations.

When Moodle content changes, the plugin compares:

- the last synced remote block
- the current local block
- the new remote block

If the change can be merged safely, it updates the block automatically. If not, it keeps both versions and tags the note with conflict markers instead of dropping either side.

## Quiz attempts

Finished quiz attempts are rendered as Markdown notes:

- Only quiz modules are considered.
- Only finished attempts are exported.
- Each attempt produces one linked `.md` note.
- Supported Moodle HTML is converted to readable Markdown.
- Safe inline HTML is retained when conversion would lose quiz structure.

The plugin remains desktop-only while its Obsidian integration is validated there.

## Commands

The plugin currently adds these commands:

- `Test connection`
- `Sync now (dry-run)`
- `Sync now (apply)`

## Settings

Current settings:

- Moodle base URL
- Web service token
- Root folder
- Resources folder
- Download concurrency
- Write sync log file
- Log file path

Descriptions and finished quiz attempts are always rendered as Markdown. The log file path is shown only when log writing is enabled.

## Installation for development

1. Install dependencies:

```bash
npm install
```

2. Build the plugin:

```bash
npm run build
```

3. Copy the plugin files into your vault:

```text
<Vault>/.obsidian/plugins/moodle-sync/
```

Required files:

- `main.js`
- `manifest.json`
- `styles.css`

4. Reload Obsidian and enable **Moodle Sync** in **Settings → Community plugins**.

## Moodle setup

You need:

- your Moodle base URL, for example `https://moodle.example.edu`
- a valid Moodle web service token

The token must have access to the Moodle web service functions the plugin uses, including:

- site info lookup
- enrolled course lookup
- course content lookup
- quiz attempt lookup
- quiz attempt review lookup
- file downloads via Moodle URLs

Exact token setup can vary by Moodle installation and permissions.

## Limitations

Current known limitations:

- Desktop only.
- Token is stored in plugin data and is not yet moved to secure storage.
- No background sync or scheduling.
- No selective sync by course.
- No cancellation once a sync has started.
- Moodle API compatibility may vary across installations and versions.
- Quiz attempts focus on finished attempts and review data only.
- HTML-to-Markdown conversion is intentionally simple and not lossless.
- Large courses may still result in a lot of note writes and downloads.

## Development

Useful commands:

```bash
npm run dev
npm run build
npm run lint
npm test
npm run test:e2e
```

`npm run test:e2e` builds the plugin and runs the opt-in real-Obsidian smoke suite. Set `OBSIDIAN_PATH` to the local Obsidian executable; the suite creates a disposable vault, uses a local fixture Moodle server, and retains Playwright traces/screenshots only when a test fails. Normal `npm test` remains deterministic and does not require Obsidian.

## Roadmap direction

Near-term work is still around making the MVP solid:

- improve settings and onboarding UX
- harden error handling for more Moodle variants
- improve quiz-attempt rendering coverage and formatting
- reduce rough edges in large syncs
- revisit token storage and security
- add more real-world testing across courses and Moodle instances
