# Revlotto: Drag Racing Roguelike (MVP Design)

Source: "Drag Racing Roguelike: MVP Design Doc" by @Dashaun, Oct 22 2026. Decisions from the follow-up Q&A are folded in and marked **[DECIDED]**.

## Decisions (from Q&A)

- **[DECIDED] Run structure:** 4 rounds × (3 regular races + 1 boss race) = 16 races.
- **[DECIDED] Safety net:** keep the Mulligan consumable but make it **rare** (low weight in pools and Power Packs).
- **[DECIDED] Art style:** **chunky pixel art**, all drawn in code (no image files). Game renders at 640×360 internal resolution, `pixelArt: true`, scaled with nearest-neighbour. Font: "Press Start 2P" (bundled via @fontsource), use sizes 8/16/24 only.
- **[DECIDED] Nitrous:** **player-timed key (N)**. Usable once per race if a nitrous part is installed. Fires for the part's duration.
- Balatro is the inspiration, not a template: juicy number pops, cards that wobble, stat "scoring" that counts up left to right through passives, a punchy color palette, chunky buttons. Do not copy Balatro names or art.

## Pillars

- The build sets the ceiling; timing sets the result.
- Danger is visible: opponent target ET is shown before every race.
- Fast loop: race 10–20 s, shop ~1 min.
- Builds snowball: passives stack multiplicatively and order matters.

Platform: desktop browser, keyboard (Space = launch/shift, N = nitrous, mouse for menus), 2D side view.

## Run flow

1. Run starts in the shop with the starter car, $10, and one free pack (a free Parts Pack or Power Pack, player choice not needed: give a free Power Pack).
2. Staging: opponent name, target ET, boss modifier (if boss), choose consumables to use. Show stat breakdown.
3. Race. Result: win pays cash → shop; loss ends the run (unless Mulligan used → rerun once).
4. After round 4 boss → victory screen with run stats and seed.

## Race mechanics

- Space for launch and every shift. N for nitrous.
- Tree: three ambers 0.5 s apart, then green. Reaction = green → press.
  - Launch: Perfect 0–60 ms, Good 61–150 ms, Miss > 150 ms.
  - Press before green = false start: Miss + 0.3 s penalty (car still launches at green).
  - Launch grade scales first-gear traction and power for the first 1.5 s.
- 4 gears. RPM climbs to redline. Shift window near redline: inside = Perfect, slightly outside = Good, far = Miss.
  - Miss costs acceleration in the next gear. Missing late also hits the rev limiter (power cut while bouncing).
  - Window width is a car stat (shiftWindow multiplier); powerups widen/narrow it.
  - If the player never presses after redline, the limiter holds; the car stays in gear (very slow). 
- Quarter mile = 402.3 m. ET to the thousandth. ET = reaction time + run time + penalties. Win if ET < target; tie goes to player.
- Opponent = scripted ghost following a curve that ends exactly at target ET (not simulated).

## Stats

| Stat | Meaning | Starter |
| --- | --- | --- |
| power | engine output | 200 |
| grip | traction limit (μ) | 1.0 |
| weight | kg | 1400 |
| gearing | gear efficiency multiplier | 1.0 |
| drag | multiplier on drag coefficient (aero lowers it) | 1.0 |
| shiftWindow | multiplier on shift window width | 1.0 |
| nitroPower / nitroDuration | 0 unless a nitrous part is installed | 0 |

Calculation order:
1. Sum starter + installed parts.
2. Tuning levels (+10% of that part's stats per level, max level 3).
3. Passives left to right: flat adds first, then multiplies. Order matters.
4. Consumables chosen for this race.
5. Boss modifier.
6. Sim. Event-triggered passives (race start, launch grade, shift grade, finish) apply live in the sim.

Sim: fixed 120 Hz.
`a = min(P_eff·g_k·c(r)/W_eff, μ_eff·g) − k·v²`. Constants tuned so the starter runs ~14.0 s with average inputs and a fully built car ~7 s with all Perfect inputs.

## Parts: 12 slots × 3 tiers (Stock, Street, Pro) = 36

| Slot | Main stat | Stock / Street / Pro |
| --- | --- | --- |
| engine | power | Stock V6 / Built V8 / Big-block |
| intake | power | Stock airbox / Cold air / Individual throttle bodies |
| forced_induction | power | None / Small turbo / Twin turbo (quirk launch_lag) |
| exhaust | power | Stock / Catback / Headers |
| ecu | power, gearing | Stock map / Street tune / Race tune |
| transmission | gearing | 4-speed / Close-ratio / Sequential (wider shift window) |
| differential | grip, gearing | Open / Limited-slip / Spool |
| tires | grip | All-season / Sport / Drag slicks |
| suspension | grip | Stock / Coilovers / Drag-launch setup |
| chassis | weight | Stock / Seat delete / Carbon panels |
| aero | drag | Stock / Spoiler / Full kit |
| nitrous | nitro | None / Single shot / Progressive |

Some Pro parts have trade-offs. Installing replaces the old part; the old part sells for 50% of its cost (Stock = $0).

## Powerups

**Passives (5 slots, reorderable, evaluated left→right):**

| Item | Effect |
| --- | --- |
| Clean Launcher | Perfect launch: Power ×1.10 for the race |
| Shift Savant | Each Perfect shift: +3% Power for the rest of the race |
| Double Clutch | Each Perfect shift: Gearing ×1.05, compounding |
| Redline Gambler | Perfect window 40% narrower, Perfect shifts give Power ×1.25 for that gear |
| Sticky Compound | Grip ×1.15 while in 1st gear |
| Featherweight | Weight ×0.95 |
| Boost Brain | Forced induction and nitrous parts count 50% stronger |
| Garage Rat | +2% Power per slot with a non-Stock part |
| Cash Cow | $2 per Perfect grade in a race |
| Finish Line Flair | Win by < 0.1 s: earn $5 |

**Consumables (2 slots, chosen at staging):** Nitro Bottle (Power ×1.15), Grip Spray (Grip ×1.20 first 3 s), Wide Tach (Perfect window +30%), Mulligan (if you lose, rerun once; RARE).

**Tuning cards:** rare Power Pack drop. Apply to an installed non-Stock part: +1 level (max 3), +10% of that part's stats per level.

## Shop

After every win (and at run start): 2 parts, 2 powerups (passives + consumables), 2 packs (one Parts Pack, one Power Pack). Reroll $3, +$1 per reroll in that visit (resets next visit). Rerolling refreshes parts and powerups, not packs.
- Part draws: Street ~70%, Pro ~30%, Pro share +10% per round.
- Parts Pack ($6): 3 parts from different slots, pick 1 → installs. Power Pack ($8): 3 cards, ~50% passive / 40% consumable / 10% tuning card, pick 1. Can skip (no refund).
- Passives and parts sell for 50%; consumables can't be sold (can be discarded).
- Full slots → must sell/discard first.
- Shop generated from the run seed; show seed on game over & victory.

## Economy

Start $10. Regular win $6, boss win (rounds 1–3) $12, time bonus $1 per 0.1 s under target (cap $4).
Prices: Street part $6, Pro part $14, Parts Pack $6, Power Pack $8, Passive $8, Consumable $3, Reroll $3 (+$1).

## Opponents (target ET)

| Round | R1 | R2 | R3 | Boss |
| --- | --- | --- | --- | --- |
| 1 | 13.8 | 13.4 | 13.0 | 12.6 |
| 2 | 12.0 | 11.6 | 11.2 | 10.8 |
| 3 | 10.2 | 9.8 | 9.4 | 9.0 |
| 4 | 8.5 | 8.1 | 7.7 | 7.2 |

These are placeholders; the balance harness tunes them. Each opponent has a name and car look (colors/body type).

Boss modifiers: R1 Tight Tree (launch windows halved), R2 Slick Track (Grip ×0.8), R3 Headwind (drag +25%), R4 Redline Only (shift windows halved and the rightmost passive disabled).

## Tech

TypeScript + Phaser 3 + Vite. Sim and data are renderer-independent (run headless in Node via tsx). Data in JSON validated with zod. Seeded PRNG for all rolls. Scenes talk to RunState only through the actions API.
