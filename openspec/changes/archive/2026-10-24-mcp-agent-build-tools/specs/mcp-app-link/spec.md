## Purpose

Tells an agent whether the user can see its changes in the open app, and lets it look at the 3D view itself, so problems like "the app isn't running" or "this looks wrong" surface right away.

## ADDED Requirements

### Requirement: Every change says whether the app got it
Every MCP tool that changes the assembly or the viewport SHALL include an `appSync` field in its reply:
- `live`: the app's dev server received the change and at least one browser has the app open;
- `no-browser`: the dev server received it but no browser has the app open;
- `saved-to-file-only`: the dev server could not be reached.

The reply SHALL also include a one-line hint for the last two (for example "Start the app with `npm run dev`" or "Open http://localhost:5173 to see it"). In every case the change SHALL still be saved to the assembly file, as today.

#### Scenario: App not running
- **WHEN** `place_parts` runs while the dev server is stopped
- **THEN** the parts are saved to the file, and the reply says `saved-to-file-only` with a hint to run `npm run dev`

#### Scenario: Browser open
- **WHEN** the dev server is running and the app is open in a browser
- **THEN** the reply says `live`

#### Scenario: Server up, no browser
- **WHEN** the dev server is running but no browser has the app open
- **THEN** the reply says `no-browser` with the app's address

### Requirement: Screenshot of the 3D view
The server SHALL offer a `capture_screenshot` tool that returns a PNG image of the app's 3D view as an image result. It takes:
- `view`: `current` for the user's camera, or `iso`, `front`, `top`, `side`, each framed on the whole assembly or on `focusInstanceId`;
- optional `width` and `height`, from 320 to 1920 px, default 1024 × 768.

A standard view SHALL be rendered with a separate camera, without moving the user's camera. The image SHALL show the assembly as the app currently shows it: overlap colors, but no gizmos, selection outline or hole highlights. When no browser has the app open, or no image arrives within 10 seconds, the tool SHALL return an error saying so, with the same hints as `appSync`.

#### Scenario: Check the build
- **WHEN** an agent calls `capture_screenshot` with `view: 'iso'` while the app is open
- **THEN** it gets a 1024 × 768 PNG of the whole assembly from a three-quarter view, and the user's camera has not moved

#### Scenario: No browser
- **WHEN** an agent calls `capture_screenshot` and no browser has the app open
- **THEN** the tool returns an error saying the app isn't open, with its address
