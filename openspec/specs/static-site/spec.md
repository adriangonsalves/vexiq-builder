# static-site Specification

## Purpose

Lets the builder be published as plain files on any static web host, with every building feature working in the visitor's browser and no server code, while the local dev app and its MCP server keep working as before.

## Requirements

### Requirement: Static build
The project SHALL have a command that builds the app as a static site: a folder of plain files (HTML, scripts, styles, the part catalog, part metadata and part models) that works when served by any static file host with no server code. The site's base path SHALL be configurable at build time, so it works at the root of a domain or in a sub-folder (for example `https://example.com/vexiq/`). The static build SHALL NOT include the developer's saved build, settings or blueprint files from `public/`.

#### Scenario: Served from a sub-folder
- **WHEN** the site is built with base path `/vexiq/` and served by a plain file server at `http://localhost:8080/vexiq/`
- **THEN** the app opens, the part library shows every part with thumbnails, and parts can be added to the view

#### Scenario: No server code needed
- **WHEN** the static site is open and its host answers only file requests (any `/api/...` request returns 404)
- **THEN** no feature shows an error caused by a missing server

#### Scenario: Developer's files left out
- **WHEN** the static build finishes
- **THEN** its output has no `assembly-state.json`, `app-settings.json` or `assembly-blueprint.svg`

### Requirement: Building features work in the browser
On the static site, every smart action the Inspector, menus and shortcuts offer SHALL work and give the same result as in the dev app for the same build: auto-fasten, mate parts, mesh gear train, build chain or track (including the over/under route questions), mirror, the joint graph used by selection and grouping, and audit with blueprint. A long action SHALL NOT freeze the page: the view SHALL keep responding to the mouse while it runs.

#### Scenario: Same result as the dev app
- **WHEN** the same build is open in the dev app and on the static site, and the same chain is built between the same two sprockets in both
- **THEN** both give the same links in the same places, and the same message

#### Scenario: Page stays responsive
- **WHEN** the user runs Audit on a build with 150 parts on the static site
- **THEN** the camera can still be orbited while the audit runs, and the audit result appears when it finishes

#### Scenario: Blueprint opens
- **WHEN** the user runs Audit on the static site and opens the blueprint
- **THEN** the blueprint picture for that audit is shown, both in the audit window and in a new tab

### Requirement: Explode works in the browser
On the static site, the Explode panel SHALL work out its plan in the browser, show the same progress ring as the dev app while it does, and keep plans it already worked out for the current build so that reopening Explode on an unchanged build is instant.

#### Scenario: Explode on the static site
- **WHEN** the user opens Explode on the static site
- **THEN** the progress ring fills, then the slider plays the take-apart

#### Scenario: Reopen is instant
- **WHEN** the user closes Explode and opens it again without changing the build
- **THEN** the slider plays at once, with no progress ring

### Requirement: Saving without a server
On the static site, builds SHALL save themselves in the visitor's browser exactly as the build library describes (auto-save, library, New, Starter, Load…, Export, Delete), and settings SHALL be kept in the browser. A reload SHALL bring back the current build, its undo history and the settings. Nothing about a build SHALL be sent anywhere.

#### Scenario: Reload keeps build and settings
- **WHEN** a visitor adds parts, turns Shadows on and reloads the static site
- **THEN** the same build opens with its parts and undo history, and Shadows is still on

#### Scenario: First visit
- **WHEN** someone opens the static site for the first time in their browser
- **THEN** a new build opens (the same starting build the dev app gives a new visitor), with default settings

### Requirement: Assistant features hidden on the static site
The static site SHALL hide everything that only works with the local assistant: the MCP status badge next to the title (the part count stays), the Assistant (MCP) section in Settings, and any message about the assistant or the dev server. It SHALL NOT try to connect to an event stream or answer screenshot requests. All other settings, including Advanced options, SHALL work as in the dev app.

#### Scenario: No MCP badge
- **WHEN** a visitor turns Advanced options on in the static site
- **THEN** the title shows the part count without an MCP status, and Settings has no Assistant section

#### Scenario: No connection attempts
- **WHEN** the static site is open for a minute
- **THEN** it has made no request to any `/api/...` address

### Requirement: Dev app and MCP unchanged
Running the app with `npm run dev` SHALL behave as it does before this change, including saving through the dev server, live updates from the MCP server, screenshots and every MCP tool.

#### Scenario: MCP still drives the dev app
- **WHEN** the dev app is open and an MCP client calls `place_parts`
- **THEN** the parts appear in the open app and the reply says `live`, as before

### Requirement: Part meshes load as needed
On the static site, a smart action or explode plan SHALL only download the part models for the parts it needs, and SHALL reuse models it has already downloaded during the visit. A model that fails to download SHALL stop that action with a message naming the part, and SHALL NOT change the build.

#### Scenario: Only needed models
- **WHEN** a visitor runs Audit on a build that uses 12 different parts
- **THEN** at most those 12 part models are downloaded for the audit (models already downloaded for the 3D view may be reused)

#### Scenario: Model download fails
- **WHEN** a model download fails during Build chain
- **THEN** the build is unchanged and a message says which part's model could not be loaded
