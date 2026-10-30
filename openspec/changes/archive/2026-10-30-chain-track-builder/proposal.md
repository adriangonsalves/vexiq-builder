## Why

Putting a chain or a track around sprockets by hand means placing dozens of Chain Links one at a time, each at the right angle on the curve. Nobody does that, so builds that need a chain drive or a tank tread can't be made in the app today. A builder that wraps the chain for you, from the sprockets you already placed, makes those builds possible in one click.

## What Changes

- A new **Build** menu in the toolbar, next to the Select menu, with two items: **Chain builder** and **Track builder**. Both are greyed out unless two or more sprockets that sit in one plane are selected, and the menu says why.
- **Chain builder** wraps a loop of `Chain Link` parts round the outside of the selected sprockets. The sprockets can have different tooth counts (8, 16, 24, 32, 40). Links sit on the sprockets' teeth on the curves and run straight between sprockets, as a real chain does.
- **Track builder** wraps a loop of `Tank Tread, Attachment Link` parts the same way (they have the same pivots as Chain Links, plus two holes on top), and offers a checkbox to plug a `Traction Link` rubber gripper into every tread link, facing out.
- The new links are made into one group named "Chain N" or "Track N", selected, and the whole thing is one undo step.
- When the path around the sprockets isn't a whole number of links, the builder makes the nearest whole loop and says how far to move a sprocket for an exact fit. Sprockets are turned (with their axles) so their teeth sit in the chain.
- Sprockets get measured tooth data (pitch radius and tooth angle) like spur gears have, instead of the guess from their bounding box.
- The audit counts a chain or track group as held by its sprockets: no "unpinned" chain links, no islands, and links touching sprocket teeth aren't collisions.
- A new MCP tool, `build_chain`, does the same from an AI client.

Assumption: chain and track only fit sprockets. Selecting spur gears gives a message that chain needs sprockets. Selected sprockets that sit inside the loop (not touched by it) are left out and named in the message.

Not in this change: the chain following a sprocket that is moved later (delete the group and build again), and double-wide tracks joined with Track Tiebars.

## Capabilities

### New Capabilities
- `chain-track-builder`: the Build menu, wrapping chain or track (with optional rubber grippers) round selected sprockets, the grouping and undo step, sprocket tooth measurements, how the audit treats chain and track, and the `build_chain` MCP tool.

### Modified Capabilities
(none)

## Impact

- New: `src/utils/chainPath.js` (pure: sprockets in, link poses out; shared by the app and the MCP engine), `src/components/BuildMenu.jsx`, `scripts/check-chain-builder.mjs`.
- `src/App.jsx`: Build menu in the toolbar, handlers that add the links and group them as one history step.
- `scripts/measure-part-geometry.mjs`, `scripts/index-part-metadata.mjs`: measure sprocket teeth and the Chain Link and Traction Link spacing; regenerated `public/catalog.json` / `public/part-metadata.json`.
- `mcp/assembly-engine.mjs`: audit and overlap rules for chain and track; `mcp/vexiq-mcp-server.mjs`: `build_chain` tool.
- `features.md`, and the "How pieces are used" notes in `AGENTS.md` for chain and track.
