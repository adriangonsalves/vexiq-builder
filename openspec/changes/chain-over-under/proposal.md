## Why

The chain builder only goes round the outside of the selected sprockets: a selected sprocket inside the loop is quietly left out, and standoffs are ignored. Real VEX IQ chains often bend in round an idler sprocket, or rub on a standoff that keeps a long run from flapping, so builders can't model those today. When a chain can't be built, the reason is also not always clear.

## What Changes

- Standoffs in the selection now take part in the chain: a standoff whose axle is parallel to the sprockets' and whose body reaches the chain's plane is treated as a smooth round guide (no teeth). On the outside of the loop the chain or track goes round it like a sprocket.
- A selected sprocket or standoff **enclosed by the chain** (inside the loop, between two runs) is no longer left out. Before building a chain, the app lists each enclosed part, highlights it in the 3D view, and asks whether the chain goes:
  - **Under / inner**: the run above the part bends down and passes under it, wrapping round it;
  - **Over / outer**: the return run below the part bends up and passes over it, wrapping round it.
  Every enclosed selected part must get an answer; there is no "leave out" choice for selected parts. Parts that aren't selected are never asked about and stay out of the chain.
- A selected sprocket on the outside of the loop that the straight run between its neighbours would pass through (a **crossing** sprocket) is asked about too: the chain can wrap round its outside as before, or pass the other side of it (Over / Under, with a hint saying which one is the outside wrap). Standoffs and other thin parts are only asked about when fully inside the loop.
- **Tracks only go round the outside** of sprockets and standoffs for now (their attachments face out). The Track builder doesn't ask about routes; an enclosed part is left out and the message says why.
- **Track attachments:** Track builder asks which attachment to plug into the tread links: None, Traction Link, or a Short, Medium or Long Intake Flap; and how often, with a slider from every link to every 20th link. This replaces the "Add rubber grippers" checkbox (Traction Link on every link stays the default). `build_chain` takes the same two choices.
- When a chain can't be built with the chosen route, nothing is built and the message names the part and the reason (for example a bent run would pass through another selected part, the two runs would touch, or an outer sprocket would no longer touch the chain).
- `build_chain` over MCP takes a `route` map (`{ instanceId: "over" | "under" }`). A chain call with enclosed parts and no answer for them builds nothing and replies with the list of parts that need an answer.
- The audit counts chain links riding on a standoff as touching by design (not a collision), and a standoff the chain wraps as part of the loop.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chain-track-builder`: the Build menu takes standoffs as well as sprockets; which parts carry a chain now includes enclosed parts and standoffs; chains can bend in round enclosed parts and crossing sprockets (over/under), with a question dialog that highlights each part; tracks stay on the outside and say why a part is left out; tracks take a choice of attachment (Traction Link or Short/Medium/Long Intake Flap) and spacing; build refusals give the reason; `build_chain` gains `route`; the audit treats links on standoffs as by design.

## Impact

- `src/utils/chainPath.js`: path with signed wraps (parts wrapped from inside or outside the loop), standoff guides, enclosed-part detection and the over/under run choice, refusal reasons.
- `src/utils/chainFit.js`: a link seated on a standoff; overlap and audit rules.
- `src/components/BuildMenu.jsx` and `src/App.jsx`: a chain route dialog, part highlighting while it is open, the route passed to the `build_chain` action; the track dialog's attachment picker and spacing slider.
- `scripts/index-part-metadata.mjs` and `public/part-metadata.json`: where each Intake Flap seats in a tread link (as the Traction Link has today).
- `src/components/Viewport3D.jsx`: a highlight for the part being asked about.
- `mcp/assembly-engine.mjs` (`buildChain`, audit), `mcp/vexiq-mcp-server.mjs` (`build_chain` schema and reply), `vite.config.js` action passthrough.
- `scripts/check-chain-builder.mjs`, `scripts/check-mcp-tools.mjs`; `AGENTS.md` chain notes; `features.md`.
- No new parts or saved fields (the flaps are already in the library); older builds and chains load unchanged.
