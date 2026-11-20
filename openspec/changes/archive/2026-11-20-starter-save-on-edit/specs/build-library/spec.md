## MODIFIED Requirements

### Requirement: Builds save themselves
The current build SHALL be saved to the browser's storage about one second after each change: its parts, its undo history, its view settings, its name and a small picture. The same applies to changes made by the assistant while the app is open. There SHALL be no Save button. A build SHALL never be lost by New, Starter, opening another build, closing the tab or reloading. Reloading SHALL open the build that was current, except that an unedited starter (not yet saved to the library) SHALL NOT create a library entry on reload, tab close, or switch.

#### Scenario: Reload keeps the build
- **WHEN** the user adds two parts and reloads the page
- **THEN** the same build opens with both parts and its undo history

#### Scenario: New keeps the old build
- **WHEN** the user has "Build #1" with parts and picks File → New
- **THEN** an empty "Build #2" is shown, and "Build #1" with its parts is in the library

#### Scenario: Unedited starter is not saved on switch or close
- **WHEN** the user opens a starter ("Huey") by itself, orbits the camera, runs Play mode or a drop test, and then switches to another build or closes the tab without changing any parts
- **THEN** no "Huey" entry is created in the browser's library

### Requirement: New and Starter
File → New SHALL make a new, empty build with a fresh history and make it current. File → Starter → a starter SHALL, when the open build has no parts or the user picks "Open by itself" (see add-to-build), load that starter's parts with a fresh history whose first step adds them, showing the starter's name without creating a library entry yet. Both SHALL turn Explode off, select nothing, and frame the view. When the open build has parts — including when it is an unedited starter — opening another starter, saved build, or file SHALL still prompt whether to open it by itself or add it to the open build. When the user picks "Add to this build", the picked build SHALL be added to the open build as add-to-build describes and no separate build SHALL be made.

An unedited starter SHALL be promoted into a saved build in the library — named after the starter ("Huey", then "Huey 2", …) — as soon as the user makes a change to its parts/history (including "Add to this build" or an assistant edit), explicitly renames it, or saves it to Google Drive. If a starter was promoted solely by edits (not explicitly renamed or linked to Google Drive) and the user undoes all changes so the build returns to the starter's initial state, it SHALL return to the unsaved starter state and any auto-created library entry for it SHALL be removed.

#### Scenario: Starter as a new build
- **WHEN** the user picks File → Starter → Sample starter with an empty build open and waits more than one second without editing parts
- **THEN** the starter parts are shown with the name "Sample starter", the previously open build (if any) remains in the library, and no new "Sample starter" entry is created in the library until edited

#### Scenario: Starter promoted on first edit
- **WHEN** the user has opened starter "Huey" (unsaved) and moves or deletes a part
- **THEN** after about a second, a build named "Huey" (or "Huey 2" if "Huey" already exists in the library) is saved in the library with the change

#### Scenario: Starter undone back to initial state is not saved
- **WHEN** the user has opened starter "Huey", moves a part (which autosaves "Huey" in the library), and then clicks Undo so the build returns to Huey's initial step
- **THEN** the auto-created "Huey" entry is removed from the library and the open starter returns to the unsaved state

#### Scenario: Explicitly renamed starter stays saved after undo
- **WHEN** the user opens starter "Huey", renames it to "My Huey", moves a part, and then clicks Undo
- **THEN** "My Huey" remains saved in the library

#### Scenario: Opening another build while viewing an unedited starter still prompts
- **WHEN** the user is viewing an unedited starter ("Huey") and picks File → Starter → Simple claw (or opens a saved build or file)
- **THEN** the app prompts whether to open it by itself or add it to the open build; picking "Add to this build" adds "Simple claw" as a group to Huey and promotes Huey to a saved build in the library

#### Scenario: Starter added to the open build
- **WHEN** the open build has parts and the user picks File → Starter → Sample starter → "Add to this build"
- **THEN** the open build keeps its name and gains a group "Sample starter", and the library has no new build
