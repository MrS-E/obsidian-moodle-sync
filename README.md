# Obsidian Moodle Sync (PoC -> MVP)

> ⚠️ **Project status:** Between **Proof of Concept (PoC)** and **early MVP**.
> Most of the codebase was *vibe coded* up to commit **`971e3361`** and is currently focused on validating architecture and sync behavior rather than production hardening.

## Overview

This plugin syncs **Moodle courses, content, and attachments** into an **Obsidian vault**, with:

* Mirrored course folder structure
* Downloaded attachments
* Managed note blocks for Moodle-owned content
* Block-level 3-way merge with diff3
* Conflict tagging and preservation of local edits
* Dry-run planning with progress tracking
* Incremental file sync using timestamps

The goal is to provide a safe way to:

* Keep Moodle content locally searchable
* Annotate it freely in Obsidian
* Sync updates without losing local notes

## Current Capabilities

### Course Sync

* Fetches all enrolled courses
* Creates:

  ```
  <RootFolder>/
    Course Name (courseId)/
      _index.md
      Module.md
  ```
  
* Index note links all modules
* One note per Moodle module

### Attachments & Resources

* All Moodle files are downloaded
* Mirrored into:

  ```
  <ResourcesFolder>/
    Course Name (courseId)/
      ModuleName/
        files...
  ```

* Embedded automatically if:
	* image
	* audio
	* video
* Otherwise linked normally
* Files are only re-downloaded when:
	* `timemodified` increased
	* `filesize` changed
	* file missing locally



### Managed Blocks (Important)

Remote-managed content is wrapped in Obsidian comment markers:

```
%% moodle:meta:begin %%
...
%% moodle:meta:end %%
```

```
%% moodle:content:begin %%
...
%% moodle:content:end %%
```

```
%% moodle:resources:begin %%
...
%% moodle:resources:end %%
```

Everything outside these blocks (especially `## My notes`) is **never touched**.

This makes merges deterministic and prevents local edits from being overwritten.

### Block-Level 3-Way Merge (diff3)

When both:

* Moodle content changed
* AND user edited the same block locally

The plugin performs a **real diff3 merge**:

```
base   = last synced remote block
local  = current local block
remote = new Moodle block
```

Behavior:

| Case                     | Result                    |
| ------------------------ | ------------------------- |
| local == base            | take remote               |
| remote == base           | keep local                |
| both changed, no overlap | auto-merge                |
| overlapping edits        | keep both + mark conflict |

If unresolved:

* The block is replaced with:

```
#colition

### Local

### Remote
```

* The note receives tags at top:

```
#colition #conflict
```

### Dry Run Mode

You can run:

* **Dry-run**
* **Apply**

Dry-run shows:

* Courses count
* Notes created/updated
* Conflicts detected
* Files to download (with total size)

No vault modifications are made in dry-run mode.

### Progress Tracking

* Status bar progress indicator
* Total planned operations
* Download concurrency control
* Optional sync log file

## Installation (Development)

1. Clone repo
2. `npm install`
3. `npm run build`
4. Copy to:
```
<vault>/.obsidian/plugins/moodle-sync-poc/
```
5. Enable plugin
6. Add Moodle base URL + token in settings
	* Token can be created via profile-settings -> security keys


## Implementation Overview

### Architecture

Core files:

| File | Responsibility |
|------|---------------|
| `main.ts` | Plugin entry + commands |
| `sync.ts` | Planning + applying sync |
| `moodleClient.ts` | Moodle REST client |
| `blocks.ts` | Managed block parsing/replacement |
| `state.ts` | Persistent sync state |
| `util.ts` | Helpers (hashing, path, etc.) |

### Sync Model

The plugin uses a **plan -> apply** architecture.

1. Build a full sync plan:
   * Note updates
   * File downloads
   * Folder creation
2. Show summary
3. Execute (if not dry-run)

### State Model

Each note stores:

```

baseBlocks: {
meta: "...",
content: "...",
resources: "..."
}

```

These are the last synced remote blocks and serve as the `base` in diff3.

Files store:

```
timemodified
filesize
```

### Merge Strategy

* Block-level merge only.
* Whole notes are never blindly overwritten.
* Managed blocks are replaced or merged individually.
* User-owned areas are untouched.

## Known Problems

This is still between PoC and MVP.

### Security

* Moodle WebToken is stored in plugin settings (plain).
* Not using Obsidian `SecretStorage` yet.
* Token is long-lived and powerful.

### Large Syncs

* Large courses can produce:
  * Hundreds of note updates
  * Many file downloads
* No cancellation yet.
* No partial sync per course.

### HTML Handling

* Moodle HTML is currently wrapped in:
```
```html
...
```

* No Markdown conversion.
* No DOM parsing.
* No sanitization.

### Quiz Handling (Incomplete)

* Finished quizzes:
  * HTML preserved
  * No PDF generation yet
  * Diffing HTML blocks may create noisy merges.


### Block Marker Fragility

If user deletes:

```
%% moodle:content:begin %%
```

Plugin will recreate it on next sync, but behavior might be surprising.

### Conflict UX

Currently:
* Conflicts are auto-embedded
* No interactive modal merge UI
* No side-by-side diff view

### Massive Refactors Missing

* No unit tests
* No integration tests
* No typed Moodle API client schema
* Error handling is pragmatic, not robust
