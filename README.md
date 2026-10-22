# Revlotto

A browser drag-racing roguelike. Build a car from 12 part slots and a hand of powerups, then race it by timing your launch and shifts. Beat the target time, get paid, shop, snowball.

## Run it

```
npm install
npm run dev
```

Open http://localhost:5173.

**Controls:** `SPACE` launch on green and shift in the green band · `N` nitrous (if installed) · `M` mute · mouse for menus.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck and production build to `dist/` |
| `npm run balance` | Headless balance harness (ET distributions across builds) |
| `npm run test:sim` | Quick sim sanity run |

## Layout

- `src/core`: shared types, game API contract, seeded RNG
- `src/data`: JSON content (parts, passives, consumables, opponents, balance) and the zod loader
- `src/sim`: deterministic 120 Hz race sim (no Phaser), bots
- `src/game`: run state, shop, economy, stat pipeline, passive effects
- `src/scenes`, `src/render`: Phaser scenes and code-drawn pixel art
- `docs/DESIGN.md`: the design doc
- `devlog.html`: live build status
