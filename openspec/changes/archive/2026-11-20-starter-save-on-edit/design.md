## Context

See `proposal.md` for motivation. Today in `src/App.jsx`:
- `handleStarterBuild` immediately mints a new build id and unique name (`starterBuildName`), creates a one-step history (`recordStep(createHistory([]), [], parts, { source: 'app', label: 'Add <Starter>' })`), and calls `switchToBuild(...)`.
- The autosave `useEffect` (1 s debounce) and `saveCurrentBuildNow()` write `currentBuild` unconditionally to IndexedDB (`putBuild`), even when `currentBuild` was just opened from a starter and never edited.
- `File → Load…` (`LibraryDialog`) reads from IndexedDB, and `switchToBuild` saves the outgoing build before switching.

Everything is client-side (React state + IndexedDB in `src/utils/buildLibrary.js`); no server changes are needed.

## Goals / Non-Goals

**Goals:**
- Prevent unedited starters from creating IndexedDB Build Library entries (on idle autosave, tab close/hide, reload, or switching away).
- Promote an unsaved starter into a real Build Library entry seamlessly on the first real edit, explicit rename, or Google Drive link.
- Remove an auto-created starter library entry and return to the unsaved starter state if all edits are undone back to the starter's initial step (unless explicitly renamed or linked to Drive).
- Preserve the existing "Open by itself / Add to this build" dialog when opening another starter, build, or file while viewing an unedited starter.

**Non-Goals:**
- Changing how `File → New` empty builds behave.
- Adding a manual "Save" button or confirmation dialogs when leaving an unedited starter.
- Changing how starters are built or stored in `src/starters.js`.

## Decisions

### 1. Track starter origin metadata on `currentBuild` (and pure state helpers in `buildLibrary.js`)
A freshly opened starter sets `currentBuild` to:
```js
{
  id: newBuildId(),
  name: starter.name,          // plain starter name while unsaved
  starter: {
    name: starter.name,        // base name for unique naming on promotion
    initialHeadId: history.headId, // the single "Add <Starter>" step id
    explicit: false            // becomes true on manual rename or Drive link
  },
  unsaved: true
}
```
- **Why `initialHeadId` instead of comparing full `instances` arrays?**
  The undo history already tracks `history.headId` (and `history.steps`). When a starter opens, `history` has one step whose `id` is `initialHeadId`. Any edit (move, add, delete, add-build-to-build, assistant edit, fix assembly, etc.) advances `headId` to a new step (or moves away from `initialHeadId`). Undoing all edits back to the starter's initial state returns `history.headId === initialHeadId` in O(1) time without deep-comparing 500+ part transforms.
- **Alternative considered:** Comparing `instances` JSON snapshots on every render. Rejected because a 594-part starter like Flop would serialize ~200 KB on every change and could false-positive on field ordering.

### 2. Promotion and demotion lifecycle (pure helper in `src/utils/buildLibrary.js`)
A small pure helper `starterSaveState(build, history)` evaluates the transition cleanly (making it directly unit-testable in `scripts/check-build-library.mjs`):
- **Stays unsaved:** `build.unsaved === true` and `history.headId === build.starter.initialHeadId` and `!build.starter.explicit` and `!build.drive?.fileId`.
  - Autosave (`useEffect`) and `saveCurrentBuildNow()` are no-ops.
  - `File → Delete this build…` (if clicked on an unsaved starter) simply switches to the most recent saved build (or a new empty build) without touching IndexedDB.
- **Promote to saved (`unsaved: true → false`):**
  - Triggered when `history.headId !== build.starter.initialHeadId` (any edit, including "Add to this build" or assistant edit), OR when the user explicitly renames the build (`starter.explicit = true`), OR links/saves to Google Drive (`drive.fileId` set).
  - On promotion: if not explicitly renamed, compute a unique name via `starterBuildName(existingLibraryNames, build.starter.name)` (excluding the unsaved starter's own name so the first copy gets `"Huey"`, not `"Huey 2"`). Clear `unsaved` and let the normal autosave write the build to IndexedDB.
- **Demote back to unsaved (`unsaved: false → true` on Undo):**
  - Triggered when `build.starter` is present, `!build.starter.explicit`, `!build.drive?.fileId`, and `history.headId === build.starter.initialHeadId`.
  - Cancel any pending autosave timer, call `deleteBuild(build.id)` (no-op if it wasn't written yet) and refresh the library list, restore `name: build.starter.name`, and set `unsaved: true`.
  - **Redo after demotion:** Because `history` still keeps its undone redo branch in memory, clicking Redo moves `history.headId` off `initialHeadId` again, which immediately re-promotes and autosaves the build!

### 3. Bridge / multi-tab state sync
- Keep `unsaved` and `starter` local to `currentBuild` (and stripped or preserved cleanly when syncing with the dev server bridge so `saveState` still works for MCP / assistant edits).
- If the assistant edits an unsaved starter via MCP, the incoming history step advances `headId !== initialHeadId`, which promotes and saves it to the library just like a manual edit.
- Do not overwrite `lastBuildId` (or only persist saved builds to IndexedDB) while `unsaved: true`; on reload, if the user never edited the starter, the app reopens their last saved build (no orphan starter entry).

### 4. Keep "Open by itself / Add to this build" prompt unchanged
- `offerOpenOrAdd` checks `instances.length === 0`. Because an unedited starter has `instances.length > 0`, opening another starter, library build, or `.vexiq.json` file continues to show the Open vs Add prompt.
- Choosing **Open by itself** skips saving the unedited starter and switches directly.
- Choosing **Add to this build** appends the assembly as a group (advancing `history.headId`), which promotes and saves the starter build.

## Risks / Trade-offs

- **[Race between async `starterBuildName` lookup and rapid Undo]** → Guard promotion/demotion async callbacks with `currentBuildRef.current?.id === buildId` and re-check `history.headId` before committing state/IndexedDB writes.
- **[Undo inside a multi-part initial starter step]** → `undo-history` supports scrubbing inside a single step (`subIndex`). Checking `history.headId === initialHeadId && (history.subIndex == null)` ensures scrubbing part-way through the starter's initial step doesn't accidentally treat it as a different state, or only treats full initial state as pristine.
- **[User edits starter, closes tab within < 1 s before debounce fires]** → Because promotion happens immediately on the edit (setting `unsaved: false`) and `visibilitychange` flushes pending autosave when `!unsaved`, the edited starter is never lost on quick tab close.
