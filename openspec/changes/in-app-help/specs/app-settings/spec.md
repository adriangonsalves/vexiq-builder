## MODIFIED Requirements

### Requirement: Compact toolbar
The toolbar SHALL show, left to right:
- the title, the current build's name (see build-library) and how many parts that build has;
- Undo, Redo and History;
- the **Select** menu (see multi-select);
- the **Tools** menu (Fix assembly, Audit, Blueprint, Explode, Play mode, and the chain, track, bend and band tools);
- a **Snap** drop-down showing the current pitch snap (1P, 0.5P, 0.25P or Free);
- Focus;
- the hide-panels toggle (Wide / Panels), except in the small layout;
- the View button (see view-cube-menu);
- the **File** drop-down (New, Starter ▸, Load…, Export; see build-library);
- the **Help** button, a question mark (see help-guide);
- the Settings gear.

Move and Rotate SHALL NOT be in the toolbar: they are on the context bar in the 3D view (see context-toolbar). Grid, Axes, projection, layout and the stereo controls SHALL be in the cube menu, and Shadows and AO in Settings, not in the toolbar. A drop-down SHALL open on click, show its choices with the current one marked, apply a choice and close. It SHALL also close on `Esc` or a click outside. The `X` shortcut SHALL open or close the Explode panel, and Tools → Explode SHALL show a tick while it is open. The Help button SHALL open and close the Help guide and SHALL show as on while the guide is open.

#### Scenario: Pick a pitch snap
- **WHEN** the user opens the Snap drop-down and picks 0.25P
- **THEN** the drop-down closes and shows 0.25P, and drags step by 3.175 mm

#### Scenario: No Move or Rotate in the toolbar
- **WHEN** the app is open in any layout size
- **THEN** the top toolbar has no Move or Rotate button, and the context bar in the 3D view has both

#### Scenario: Help in every layout
- **WHEN** the app is open in the large, medium or small layout
- **THEN** the toolbar has a Help button next to the Settings gear, and selecting it opens the Help guide
