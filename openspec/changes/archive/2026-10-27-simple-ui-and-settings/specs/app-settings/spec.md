## Purpose

Keeps the app simple for young builders by default: a short toolbar, a calm Inspector and a Settings panel where display, history and assistant options live, with one switch that reveals the advanced tools for parents and older builders.

## ADDED Requirements

### Requirement: Settings panel
A gear button at the right of the toolbar SHALL open a Settings panel over the app, and closing it (its close button, `Esc` or clicking outside it) SHALL return to the app unchanged. The panel SHALL have these sections:
- **Display:** Shadows and Ambient occlusion switches (see render-shadows, render-ambient-occlusion).
- **History:** Linear or Keep branches (see build-history). The choice SHALL only be shown with advanced options on; with them off, the section says history is linear.
- **Assistant (MCP):** an on/off switch (see mcp-app-link). It SHALL only be shown with advanced options on.
- **Advanced options:** one switch, off by default (see Advanced options).

Each change SHALL apply at once. Settings SHALL NOT add history steps.

#### Scenario: Turn on shadows from Settings
- **WHEN** the user opens Settings and turns Shadows on
- **THEN** shadows appear in the view straight away, and the history has no new step

### Requirement: Advanced options
With advanced options off, the default, the app SHALL hide:
- the Inspector's "Smart Assembly & Fastening" section;
- the Inspector's "CAD & Semantic Metadata" section;
- the MCP status badge next to the title (the part count stays);
- the History choice and the Assistant section in Settings.

Turning advanced options on SHALL show them all again, where they were before this change. Everything else, including every viewport tool, shortcut and the part library, SHALL work the same either way.

#### Scenario: Simple by default
- **WHEN** the app opens for the first time and a part is selected
- **THEN** the Inspector shows the part's name, position, rotation and color, and neither the Smart Assembly nor the metadata section

#### Scenario: Parent turns on advanced
- **WHEN** the user turns on Advanced options in Settings
- **THEN** the Smart Assembly and metadata sections appear in the Inspector, and the History and Assistant choices appear in Settings

### Requirement: Compact toolbar
The toolbar SHALL show, left to right:
- the title, the current build's name (see build-library) and how many parts that build has;
- Undo, Redo and History;
- Move and Rotate;
- a **Snap** drop-down showing the current pitch snap (1P, 0.5P, 0.25P or Free);
- an **Explode** drop-down showing the current explode mode (Off, X, Y, Z or All);
- Focus;
- the hide-panels toggle (Wide / Panels);
- the View button (Stereo only, see view-cube-menu);
- the **File** drop-down (New, Starter ▸, Load…, Export; see build-library) and Audit & Blueprint;
- the Settings gear.

Grid, Axes, projection, layout and the stereo controls SHALL be in the cube menu, and Shadows and AO in Settings, not in the toolbar. A drop-down SHALL open on click, show its choices with the current one marked, apply a choice and close. It SHALL also close on `Esc` or a click outside. The `X` shortcut SHALL still cycle Explode, and the drop-down SHALL show the result.

#### Scenario: Pick a pitch snap
- **WHEN** the user opens the Snap drop-down and picks 0.25P
- **THEN** the drop-down closes and shows 0.25P, and drags step by 3.175 mm

### Requirement: Messages over the view
Messages from actions (mating, inserting, meshing, auto-fasten and the like, the ones the Smart Assembly section showed) SHALL appear in a message strip at the top of the 3D view. They SHALL show whether or not advanced options are on and whether or not a part is selected. A message SHALL fade after about 4 seconds, or when the next one replaces it. Error messages SHALL look different from the others.

#### Scenario: Mesh message in simple mode
- **WHEN** advanced options are off and the user drags a gear onto a hole beside another gear
- **THEN** "Meshed … with …" appears over the view and fades

### Requirement: Settings are saved for this app
History, Assistant and Advanced options SHALL be saved in one settings file read by the app, its bridge and the MCP server. They SHALL be the same in every browser tab and survive reloads and restarts. They are not part of the build: saving or opening a build file SHALL NOT change them. When the settings file is missing, the defaults SHALL apply: History linear, Assistant on, Advanced options off. Shadows and Ambient occlusion SHALL stay saved with the viewport settings as before (see render-shadows, render-ambient-occlusion), so the assistant can still set them; the Settings panel shows and changes the same values.

#### Scenario: Survives a reload
- **WHEN** the user turns on Advanced options and reloads the page
- **THEN** advanced options are still on

#### Scenario: Second tab follows
- **WHEN** the user turns the Assistant off in one tab
- **THEN** another open tab shows it off too, without reloading
