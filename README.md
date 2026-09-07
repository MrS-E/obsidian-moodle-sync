# Moodle Sync for Obsidian

An Obsidian community plugin that syncs Moodle course content into an Obsidian vault.

## Status

This plugin is currently in an **early MVP** state.

What that means in practice:

- The core sync flow works.
- The vault structure and note format are already opinionated.
- Incremental sync, managed-block merge handling, path migration, and Markdown quiz attempts exist.
- The plugin is still missing broader Moodle compatibility testing and release validation in real Obsidian.

This is usable for real-world testing, but not yet something I would call production-ready.

## How a sync runs

1. **Test connection** verifies the configured Moodle URL and web service token.
2. A sync discovers Moodle content through a validated API adapter and captures a vault snapshot.
3. The plugin builds a deterministic plan for migrations, note merges, generated Markdown, and resource downloads.
4. **Sync now (dry-run)** shows that plan's summary without executing it or changing saved sync state. When sync logging is enabled, it appends a log entry only.
5. **Sync now (apply)** executes the plan: safe legacy-path moves and link rewrites first, then notes and generated Markdown, followed by bounded concurrent resource downloads.

The executor checks planned note content before writing it. If a note changed after planning, the sync stops rather than overwriting a concurrent edit; run sync again to create a new plan.

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
- Can append detailed dry-run and applied-sync entries to a log note.
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

The exact folder names depend on your settings and Moodle course/module names. Generated path segments are Unicode-normalized and replace control characters, path separators, and Obsidian-significant filename characters such as `[`, `]`, `#`, `^`, and `|`. Names that normalize to the same value are disambiguated with Moodle IDs.

### Legacy-path migration

The first sync after this version detects plugin-managed legacy paths and plans their move to the normalized layout. It also remaps path-keyed sync state and reverse-scans Markdown notes to rewrite resolved wikilinks, embeds, aliases, heading/block suffixes, and Markdown links/images that target moved files. It leaves unrelated text, external URLs, and inline or fenced code unchanged.

Review the move and link-rewrite counts in a dry-run before applying the migration. The plugin aborts ambiguous or occupied moves instead of deleting or overwriting vault data. A completed migration is recorded in sync state, so later syncs do not repeat it; unrelated vault files are never renamed.

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

## Data and privacy

The plugin sends only the Moodle web-service requests and authenticated file-download requests needed for the commands you run. It does not send vault contents to any service and includes no telemetry or analytics. Your token and sync state are stored in Obsidian plugin data; treat access to that local data as access to your Moodle token.

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
- Include planned actions in log details

Descriptions and finished quiz attempts are always rendered as Markdown. The log file path and action-detail option are shown only when log writing is enabled; each append-only entry has a compact outcome and expandable details containing the full summary and any warnings or failures. Enable planned actions when you need the full action list for auditing.

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
npm run package
npm run lint
npm test
npm run test:e2e
```

`npm run package` runs the production build and creates `dist/moodle-sync-<version>.zip`. Extract its three files directly into `<Vault>/.obsidian/plugins/moodle-sync/` to install the plugin. The **Package plugin** GitHub Actions workflow runs the same command and uploads the archive on pushes, pull requests, and manual runs.

`npm run test:e2e` builds the plugin and runs the opt-in real-Obsidian smoke suite. Set `OBSIDIAN_PATH` to the local Obsidian executable; the suite creates a disposable vault, uses a local fixture Moodle server, and retains Playwright traces/screenshots only when a test fails. Normal `npm test` remains deterministic and does not require Obsidian.

For a full local validation, run:

```bash
npm run lint
npm test
npm run build
OBSIDIAN_PATH=/path/to/Obsidian npm run test:e2e
```

The final command is optional and requires a local desktop Obsidian executable.

## Architecture for contributors

The code separates the integration into small layers:

- `src/api/` owns Moodle REST transport, endpoint fallbacks, and runtime response decoding.
- `src/discovery/` reads validated Moodle domain data.
- `src/planning/` creates a deterministic action plan from remote data, vault snapshots, settings, and sync state without performing I/O.
- `src/execution/` is the only layer that applies plan actions and saves state.
- `src/merge/` owns managed-block diff3 merging, while `src/rendering/` owns Markdown notes and quiz-attempt output.
- `src/migration/` owns filename normalization, legacy path migration, and targeted link rewriting.
- `src/vault/` isolates Obsidian vault access; `src/commands/` registers the stable command IDs; `src/main.ts` is lifecycle-only.

Keep this direction when extending the plugin: validate new Moodle responses at the API boundary, add side-effect-free planner actions for new sync behavior, and keep all vault/state mutations in the executor.

## Roadmap direction

Near-term work is still around making the MVP solid:

- improve settings and onboarding UX
- harden error handling for more Moodle variants
- improve quiz-attempt rendering coverage and formatting
- reduce rough edges in large syncs
- revisit token storage and security
- add more real-world testing across courses and Moodle instances
