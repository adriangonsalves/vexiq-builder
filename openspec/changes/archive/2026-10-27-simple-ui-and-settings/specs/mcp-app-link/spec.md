## ADDED Requirements

### Requirement: The assistant can be turned off
With the Assistant (MCP) setting off (see app-settings), nothing the assistant does SHALL change the build:
- every MCP tool that would change the build SHALL change nothing and reply with an error saying the assistant is turned off in the app's Settings. These are the tools that place, update, remove, mate, fasten, mesh, mirror or clear parts, and undo and redo.
- tools that only read (search_parts, get_part_details, get_assembly, get_history, audit_assembly, capture_viewport_views) SHALL still answer;
- configure_viewport and capture_screenshot SHALL refuse with the same error;
- the app's bridge SHALL refuse changes posted by the MCP server, and the open app SHALL NOT take them;
- the in-browser WebMCP tools SHALL refuse changes the same way.

Turning the setting on again SHALL make every tool work as before. The setting SHALL be read on every call, so it takes effect without restarting the MCP server.

#### Scenario: Assistant off
- **WHEN** the Assistant setting is off and the assistant calls place_part
- **THEN** the reply is an error saying the assistant is turned off in Settings, and the build and its history are unchanged

#### Scenario: Reading still works
- **WHEN** the Assistant setting is off and the assistant calls get_assembly
- **THEN** it gets the build as usual

#### Scenario: Back on
- **WHEN** the user turns the Assistant on again and the assistant calls place_part
- **THEN** the part is placed as before
