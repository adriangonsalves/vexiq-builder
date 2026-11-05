Scripts from the 2026-27 Herobot Flop build (November 2026), kept as reference for tasks 4.1-4.3. They were written against a working copy, not as project code.

- `parts.py`: walks the Cadasio project JSON (`getProjectViewer`) down to part-level nodes with world matrices.
- `convert.mjs`: CAD pose to app pose (scale 0.2141688, axis change, per-part `Q` and `o`); the `special` table is the seed for `cad-frames.json`.
- `mcpcall.mjs`: minimal stdio client for `mcp/vexiq-mcp-server.mjs`.
- `solve.mjs`: per part type, tries 24 turns and quarter-pitch shifts to seat the most pins and pegs (how the frame rules were found).
- `seatflaps.mjs`: seats Long Intake Flaps on tread links using `chainSpecs.seatInLink`.
- `onpins.mjs`, `inserttry.sh`, `cctop2.mjs`: pose a connector onto a square of pins, by insert trials, and onto the Bumper Switch's top holes.
