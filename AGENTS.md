# Notes for agents working on VEX IQ Builder

The app and its MCP server (`mcp/vexiq-mcp-server.mjs`) build VEX IQ robots from the official CAD parts. `features.md` describes what the app does; this file holds what isn't obvious from the code: how real pieces are meant to go together, and habits that avoid mistakes made in earlier sessions.

## How pieces are used

The MCP server sends the section between the markers below to every client when it connects, so keep it short and true.

<!-- part-usage:start -->
- **Motor shafts (2x/3x/4x Pitch Motor Shaft) have a stop ring near one end that can't pass through a hole.** The short end past the ring goes into the Smart Motor's socket and the ring sits between the plate and the motor, so the shaft can't fall out. The long end comes out the other side of the plate and carries the wheel or gear. Put the shaft through the plate before the motor goes on, ring toward the motor. Never fit one with the ring outside, at the wheel end.
- **A free axle made from a motor shaft** (no motor) has its ring against one face of the beam or plate it goes through; the long end carries the wheel.
- **Rubber Shaft Collars go on last, pushed all the way in** until they touch the wheel, gear or spacer, so nothing slides along the shaft. On the 2nd gen omni wheel the collar sits inside the wheel's centre recess, and the recess faces outward, away from the robot (its pin holes are on the inner face). A 2x2 Center Offset Round Lock Beam goes into that recess from outside, its pins pushing inward into the wheel.
- **0.25x Pitch Spacers go on the shaft between a plate and a wheel** so the wheel clears the plate: insert its `hole_1` onto the shaft and push it to the plate, then the wheel, then the collar.
- **Wheels:** push the wheel along the shaft until it touches the spacer or plate. A tire goes on a hub (`Tire (200 mm Travel)` on `Small Wheel Hub (44 mm)`); the two overlap in the model by design and that isn't a collision. Hubs face their open dish outward.
- **Double 2x Wide, 1x2 Corner Connector:** the flat face with the three holes in a clean rim faces out (up when it joins a side plate to the brain); the ribbed open side faces in. Both ways fit the pins, so check it.
- **2x Wide, 2x2 Offset Corner Connector:** its peg block is offset to one side. On the outside of a plate the block wraps round the plate's end, so the pegs line up with the plate's outer face (and with a 2x10 beam's end holes across a 4x8-plate chassis).
- **Smart Motor:** mount it flat on 4 pins around the shaft hole; its drive socket lines up with the shaft.
- **Robot Brain:** side plates hang off its side rails on 1x Pitch Standoffs or corner connector pegs (12.7 mm gap). The library has both brains: **VEX IQ Robot Brain Gen 2** (228-6480, one piece, used by current VEX CAD) and **VEX IQ Robot Brain Gen 1** (228-2540) with its battery (228-2604). The Gen 1 battery is its own part: it slides into the bay under the brain at `[-0.75, -1.15, 0]`, turned `[0, -90, 0]`, in the brain's frame (`src/utils/batteryBay.js`), and the audit counts it as held there. In the app, select the battery and double-click the brain to slide it in. For builds that don't need it separate, use the **VEX IQ Robot Brain Gen 1 with Battery** part (`228-2540 + 228-2604`).
- **Before calling a build done,** compare each part with the build instructions from the same angle. Parts that fit more than one way (corner connectors, offset connectors, capped shafts, collars, hubs) are where mistakes hide.
- **Chain and track only go on sprockets** (8/16/24/32/40 Tooth), never spur gears, with the sprockets' axles parallel and teeth in one plane. Use `build_chain` (or Tools → Chain builder / Track builder in the app) rather than placing links by hand: links are 6.35 mm apart and sit one tooth apart round each sprocket. Standoffs in `instanceIds` act as smooth round chain guides; for a chain with sprockets or standoffs inside the outer loop, or a sprocket a straight run would pass through, pass `route: { "<id>": "over" | "under" }` (the chain goes above or below that part; the reply's `needsRoute` lists what still needs an answer; tracks only go round the outside). A sprocket sticking out past both runs (Flop's 16 Tooth between two 8 Tooth) is wrapped on both without asking (`wrapped` side `both`). Select any other part the chain must clear (a beam, bracket) with the sprockets: it becomes an obstacle the chain bends round, asked over or under when a run would pass through it; parts the planned chain would still hit are listed in `blockedBy`. A track is Tank Tread Attachment Links; its attachment (`"traction"` grippers by default, or `"short-flap"` / `"medium-flap"` / `"long-flap"`) plugs into the two holes on every `attachmentEvery`-th tread link, facing out. The builder never makes a chain too tight (it adds a link and lets one run sag); move a sprocket for a snug fit when the reply says it will sag, then build again.
<!-- part-usage:end -->

## Working habits

- Check the result after every MCP step: `audit_assembly`, then `capture_screenshot` from more than one view. A clean audit doesn't mean the parts face the right way.
- `mirror_subassembly` (or `place_parts` with `mirror`) builds the second side; still look at it, since a part whose left and right versions differ can only be turned to the closest pose.
- Converting new parts: put the STEP file in `VEX-IQ-All-Parts/`, then `npm run convert` and `npm run index-metadata`. In a git worktree, link `VEX-IQ-All-Parts/` and `VEX-IQ-All-Control/` from the main checkout first, or the catalog is rewritten empty.
- Checks: `node scripts/check-*.mjs` (each exits 1 on failure).

## Importing VEX CAD

- `node scripts/import-cad.mjs <instructions.online link or project id> --clear` builds an official VEX CAD robot through the MCP server; `--dry-run` only prints the report. Read the report: parts left out, duplicates dropped, and part types placed by an unchecked rule.
- How each part sits in VEX's CAD is data in `public/cad-frames.json`, not code. For a new robot, run `node scripts/fit-cad-frames.mjs <project>` first: it compares every entry with VEX's own part meshes and adds `mesh` entries for part types the table lacks (`--write`). On Flop it found three wrong hand entries (the Long Intake Flap and two capped shafts), so trust it over a guess, then check the result on the robot (pins seated, no overlaps).
- Imported parts that overlap stay where they are with a warning; tight fits (up to 0.5 mm, common in VEX CAD) aren't overlaps. Port ids are stable (`hole.+y.-2_8_-2`); old ids such as `hole_14` still work.
