## MODIFIED Requirements

### Requirement: Static build
The project SHALL have a command that builds the app as a static site: a folder of plain files (HTML, scripts, styles, the part catalog, part metadata, part models, and the Help guide's text and pictures) that works when served by any static file host with no server code. The site's base path SHALL be configurable at build time, so it works at the root of a domain or in a sub-folder (for example `https://example.com/vexiq/`). The static build SHALL NOT include the developer's saved build, settings or blueprint files from `public/`.

#### Scenario: Served from a sub-folder
- **WHEN** the site is built with base path `/vexiq/` and served by a plain file server at `http://localhost:8080/vexiq/`
- **THEN** the app opens, the part library shows every part with thumbnails, and parts can be added to the view

#### Scenario: No server code needed
- **WHEN** the static site is open and its host answers only file requests (any `/api/...` request returns 404)
- **THEN** no feature shows an error caused by a missing server

#### Scenario: Developer's files left out
- **WHEN** the static build finishes
- **THEN** its output has no `assembly-state.json`, `app-settings.json` or `assembly-blueprint.svg`

#### Scenario: Help in a sub-folder
- **WHEN** the site is built with base path `/vexiq/`, served from that sub-folder, and the user opens a help page
- **THEN** the page's text and every picture show, and every file they use is in the site's offline file list
