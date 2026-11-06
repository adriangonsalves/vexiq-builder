## 1. Spread-out explode

- [x] 1.1 `spreadExplodePlan` in `src/utils/explodePlan.js`: groups apart up to 40%, then pieces out from their group's middle, never down
- [x] 1.2 `explodePlanFor` spreads builds over 300 parts at once, and builds the plan leaves mostly in place
- [x] 1.3 `settleSpread`: pieces still meeting at 100% go further out until nothing meets
- [x] 1.4 `scripts/check-explode-plan.mjs` on the Clawbot and Flop starters, with the spread checks

## 2. Lighting

- [x] 2.1 Key light turns with the camera; less ambient and sky light; no blue fill; neutral ground colour
- [x] 2.2 Matte plastic; full reflections on metal, a third on plastic

## 3. Docs and checks

- [x] 3.1 `features.md` and the `configure_viewport` description
- [x] 3.2 Run every `node scripts/check-*.mjs` and `npm run build`
