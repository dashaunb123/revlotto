window.DEVLOG.overview = {
  "startedAt": "2026-10-23T19:29:53Z",
  "phase": "Brands + paragons: ready to play",
  "integrationMinutes": 10,
  "testRequest": "Play: http://localhost:5173 (old saves reset). Watch for brand chips on parts, the sets panel, and complete a 12-part set to see the PARAGON transformation. Paragon gallery: /src/render/race/dev/cars.html?page=paragons",
  "log": [
    {
      "t": "17:38",
      "msg": "Design decisions locked: 16 races, rare Mulligan, chunky pixel art, player-timed nitrous (N)."
    },
    {
      "t": "17:38",
      "msg": "Scaffolded TypeScript + Phaser 3 + Vite. Shared contracts written: src/core/types.ts, src/core/api.ts."
    },
    {
      "t": "17:38",
      "msg": "Spawned 4 agents: Engine, Run & Economy, Race Scene, Shop & Menus."
    },
    {
      "t": "17:50",
      "msg": "Run & Economy agent DONE: full game API, seeded shops, packs, payouts, Mulligan rerun, save/continue. Balance findings forwarded to Engine."
    },
    {
      "t": "17:51",
      "msg": "Engine agent DONE: 120 Hz sim, 36 parts, 10 passives, balance tuned. Headless runs: perfect bot wins 18/24 runs, average reaches round 3."
    },
    {
      "t": "17:58",
      "msg": "Shop & Menus agent DONE: Balatro-style shop, pack opening, drag-reorder passives, title demo, game over, victory. Waiting on Race Scene agent."
    },
    {
      "t": "18:20",
      "msg": "Race Scene agent DONE: pixel cars, tree, tach, smoke/flames/nitro FX, synth engine audio, staging + result screens."
    },
    {
      "t": "18:20",
      "msg": "Integration: full 16-race run played headlessly through the real UI to Victory with no errors. Fixed 4 layout bugs. MVP ready for playtest."
    },
    {
      "t": "19:06",
      "msg": "Polish pass started. Review done: found menu sounds ignore mute. Contracts stubbed. Spawning 4 agents: Audio, Car Art, Race FX, Garage & Upgrade Feedback."
    },
    {
      "t": "19:10",
      "msg": "4 agents working in parallel: Audio, Car Art, Race FX, Garage & Upgrade Feedback. Dev server + live activity watcher running."
    },
    {
      "t": "19:17",
      "msg": "Audio agent DONE: one shared mixer (M now mutes menus too), 12 distinct upgrade sounds + tier stingers, engine sound built from your parts (V6/V8/big-block, exhaust grit, turbo whistle), tyre squeal, crowd roar, garage rev."
    },
    {
      "t": "19:25",
      "msg": "Car Art agent DONE: painted-metal shading, 5 liveries + door numbers + rim colours, visible engine/suspension/tuning upgrades, wheelie rig, brake lights. Gallery: /src/render/race/dev/cars.html?page=grid"
    },
    {
      "t": "19:26",
      "msg": "Garage agent DONE: Paint Shop (title G / shop P), 36 cosmetics with 20 unlockable via bosses + milestones, unlock toasts, every install now plays its part sound then revs the engine."
    },
    {
      "t": "19:31",
      "msg": "Target 7:55. Race FX wrapping up by 7:42. QA agent spawned to play full runs in parallel. Whole project typechecks and builds."
    },
    {
      "t": "21:29",
      "msg": "Music phase: engine + endless menu track built and wired; music ducks under revs/installs. Race Music agent composing 8 race/boss tracks."
    },
    {
      "t": "21:37",
      "msg": "Race Music agent DONE: 4 round tracks (128-150 bpm) + 4 darker boss versions, 32-bar endless loops. All 9 tracks verified in-game."
    },
    {
      "t": "21:41",
      "msg": "New phase. Team 1 (Engine Sound): make V8+ engines deep and menacing. Team 2 (Director, Characters & Cars, Cutscene Audio): over-the-top 3D slow-mo cutscenes for all 4 bosses (big characters drifting in, tongues flapping)."
    },
    {
      "t": "21:57",
      "msg": "Cutscene Audio DONE: drift screech, slow-mo bwooom, name-card slam, per-boss roars/stings/signature sounds, gibberish voices (Buckshot drawl, Olga cackle, Gus bellow, Rosa growl). Audition: /src/render/cutscene/dev/sfx.html"
    },
    {
      "t": "22:00",
      "msg": "Team 1 Engine Sound DONE: engines rebuilt from real exhaust pulses with uneven V8 firing; big-block has a choppy cam lope and 94% of its sound in the deep 30-150 Hz range. A/B page: /src/render/race/dev/engines.html"
    },
    {
      "t": "22:00",
      "msg": "Fixed: the game page was reloading every 10 s because Vite watched the devlog files. Vite now ignores devlog/."
    },
    {
      "t": "22:08",
      "msg": "Characters & Cars DONE: Buckshot, Olga, Gus and Rosa as big-head toon models with expressions + signature moves, plus all 5 car bodies and each boss's ride. Viewer: /src/render/cutscene/dev/models.html?all=1"
    },
    {
      "t": "22:10",
      "msg": "Cutscene Director DONE: 4 boss intros (Buckshot, Olga, Gus, Rosa) play before each boss, skippable, once per run. Everything typechecks and builds."
    },
    {
      "t": "22:28",
      "msg": "Critique round: 4 critic agents reviewing each boss cutscene frame by frame. Fixes go to per-scene, shared and model fixers next."
    },
    {
      "t": "22:38",
      "msg": "Critics done: 48 issues across 4 cutscenes (name card covers every boss, signature beats off-camera, Olga's wave reads as a slab, Gus's beard reads as a jellyfish, Rosa's best beats hidden). 6 fixers now working in parallel: one per boss scene + shared systems + models."
    },
    {
      "t": "22:55",
      "msg": "Shared fixer DONE: name card slides in on the left so the boss stays visible, first skip jumps to the card, comic stamps, lens splat, impact frames, fat pixel flames, thunder/air horn/moo/whistle/siren sounds."
    },
    {
      "t": "22:55",
      "msg": "Fixed: devlog was frozen ~15 min (Vite served cached copies of the ignored files); now served straight from disk."
    },
    {
      "t": "22:56",
      "msg": "Models fixer DONE: Buckshot's real aviators + shades-down/toothpick-flick/hat-tip/finger-gun controls and black-and-white cruiser; Gus's enormous beard + bellow face; Olga's real cackle + innocent face + goggle snap; Rosa's clean helmet removal + white-hot glowing eyes + mane."
    },
    {
      "t": "23:00",
      "msg": "Gus fixer DONE: junk incl. porta-potty, lawn chair and a mooing cow skims the lens; HWOOOOAAAAR bellow blasts the camera and sticks a cone on his head; tornado spins out of his beard; cow lands on the truck."
    },
    {
      "t": "23:00",
      "msg": "Olga fixer DONE: new 11 m glossy curling oil wave with rainbow sheen, truck bursts out airborne in slow-mo, HA! HA!! cackle, oil splats the lens, 360 hydroplane, fake-innocent whistle, flooded lane with a rubber duck."
    },
    {
      "t": "23:05",
      "msg": "Rosa fixer DONE: pitch-black opening with a glowing segmented tach, lightning hits the towers on camera, real flames, 3-shot smash cut, helmet flung off, eyes ignite as the stadium dies around her, hero shot with the tach as a halo and the needle snapping into the sweet spot."
    },
    {
      "t": "23:15",
      "msg": "Buckshot fixer DONE: black siren opener, PULLED OVER. impact stop while he stays deadpan, shades/toothpick/hat beats, visible tree countdown, donut with power rays and flying hats, BLINK = DQ, finger-guns hero. Models follow-up running: shades-push hand reads as a middle finger and his eyes never show; fixing."
    },
    {
      "t": "23:22",
      "msg": "Models follow-up DONE: no more stray finger, Buckshot's eyes show over the shades, finger guns read, Rosa's eye glow ignites instantly, softer mane. Critique round complete."
    },
    {
      "t": "23:52",
      "msg": "v3 started: every boss goes from sweet and harmless to an absolute jerk via a Turbo-style glitch. Smoother, higher-poly, King Candy look. 8 agents: Style, Characters, Cars & Props, Audio, and one director per boss."
    },
    {
      "t": "00:01",
      "msg": "Cutscene Audio DONE: Turbo glitch (bass hit lands on the reveal), oil super-soaker squirt, sweet voice lines, music-box lullaby that cuts off on the glitch, splat, slap, crumple, inhale, crowd scream."
    },
    {
      "t": "00:10",
      "msg": "Cars & Props DONE: SLICK 3000 oil super-soaker (sloshing tank, pump), tiny brass oil can, bite-able rainbow lollipop, CITATION ticket pad, spinning pinwheel, crumple-able Rosa autograph; glossier rounded cars with chrome trim and a blow-off-able spoiler."
    },
    {
      "t": "00:20",
      "msg": "Characters DONE: every boss has a sweet face and a jerk face (setTurn), Olga's mischievous gremlin grin with tongue poke, Gus flushing red with an anger vein, Rosa's cold glare; new hand poses checked so nothing reads as a rude gesture."
    },
    {
      "t": "00:23",
      "msg": "Direction change: King Candy/Turbo was an ART STYLE reference only. No sweet half, no transformation; every boss is a jerk the whole cutscene. All 5 running agents redirected."
    },
    {
      "t": "00:25",
      "msg": "Style DONE: 960x540 render with smoothing, downsampled into the game's 640x360 pixel grid; glossy 4-band toon with specular + two-colour rim lights, bloom, colour grade; harshJerk lighting preset; thinner outlines; higher-poly kit defaults."
    },
    {
      "t": "00:29",
      "msg": "Rosa DONE (always-jerk): dark tach-to-redline open, lightning, eyes already burning, crumples a fan's autograph and flicks it at the lens (NO PHOTOS.), helmet slams down, stadium dies, burns rubber in your face (EAT SMOKE.), tach-halo hero shot."
    },
    {
      "t": "00:31",
      "msg": "Gus DONE (always-jerk): blows a pinwheel in your face till it shreds, crowd blown out of the stands, balloon inhale, HWOOOOAAAAR bellow with cow + porta-potty past the lens, your spoiler rips off and THWACKs the lens with a crack, HAW HAW HAW with the cone party hat."
    },
    {
      "t": "00:41",
      "msg": "Buckshot DONE (always-jerk, verified no sweet leftovers): siren open, PULLED OVER., CHOMP CHOMP on a stolen lollipop, aviators SHING, writes a ticket and SLAPS it on the lens in slow-mo (it stays stuck there), flicks the stick, finger guns under siren rays."
    },
    {
      "t": "00:48",
      "msg": "Olga DONE (always-jerk): surfs in on her truck hosing oil, coats the track, drenches screaming fans, floods your lane, double lens splat. All 4 bosses built. Polish pass starting: meaner Rosa, bigger Olga close-up, Gus inhale/beard, missing sounds."
    },
    {
      "t": "00:52",
      "msg": "Polish audio DONE: candy crunch, pen scribble, paper rip, glass tink, pump rack, gremlin hehe, flash pops, paper bonk. Wired crunch/scribble/rip/tink into Buckshot's scene (replacing stand-in sounds)."
    },
    {
      "t": "00:55",
      "msg": "Polish Rosa DONE: burnout no longer an orange blur (car, helmet and glowing eyes readable), tighter low-angle crumple close-up with her meaner face, flashbulb pops + paper bonk sounds."
    },
    {
      "t": "01:02",
      "msg": "Polish characters DONE: Rosa's blade brows + one-sided sneer, Olga cackles at full strength with her sly eyes open, Gus balloon inhale + cloud-puff beard, Buckshot flipShades control."
    },
    {
      "t": "01:07",
      "msg": "Polish Olga DONE: big slow-mo close-up of her gremlin grin mid-squirt with an open-eyed HEHEHE cackle, bigger entrance, glossy black oil. All agents finished; typecheck + build pass."
    },
    {
      "t": "09:31",
      "msg": "Fixed: wedge-body cars (Grandma Gloria, Kenji Kickdown, The Accountant) looked like they drove backwards; reshaped to a low pointed nose and tall chopped tail."
    },
    {
      "t": "09:31",
      "msg": "Fixed: upgraded engines were quieter than stock at full throttle (V8 -3.9 dB, big-block -5.4 dB). Now every upgrade adds loudness; a fully built car is +10 dB over stock, intake and exhaust count the most."
    },
    {
      "t": "10:07",
      "msg": "Content expansion started: heat levels, starting cars, ~50 passives, skip races for tags, garage upgrades, skill-based boss pool (oil slick, gusts, blind tach final, sudden death...), endless mode. 4 agents: Core, Passives, Bosses, UI. Multiplayer next."
    },
    {
      "t": "10:23",
      "msg": "Core DONE: heat 0-8, 5 starting cars with unlocks, 10 skip tags, 16 garage upgrades, passive editions, seeded boss draw (3 regular + 1 final), endless mode with records, new save format. Smoke test: 20 runs, all invariants hold, fully deterministic. Passives: 56 implemented."
    },
    {
      "t": "10:25",
      "msg": "Passives DONE: 56 total (30 common / 18 uncommon / 8 rare) across streak, launch, nitro, economy, scaling, position (copy-the-neighbour), risky (All or Nothing, Coin Flip) and new-system synergies; icons for every passive, tag and garage upgrade."
    },
    {
      "t": "10:29",
      "msg": "UI DONE: New Run screen (car + heat select with unlocks), heat badges, skip button with tag preview, boss HOW TO BEAT IT box, garage slot, tag chips, foil/holo/chrome cards, Pack Rat multi-pick, endless on Victory. Lead fixes: shortened 2 heat descriptions; endless NEW! no longer shows on a tie."
    },
    {
      "t": "10:32",
      "msg": "Bosses DONE: 13 bosses (9 regular, 4 final) with visible skill hazards: oil patches + tach OIL band, gust fronts + wind meter, decoy tree, drifting/short/squeezed windows, mirror/blackout/blind tach, Sudden Death DNF. Lead: softened Slick Track (grip 0.8 -> 0.87), typed DNF results. Build passes; seeded runs replay identically."
    },
    {
      "t": "10:50",
      "msg": "Wedge cars reshaped again (Countach-style): roof is now the high point, the engine deck slopes down to a low tail, and the windshield breaks into a long hood. The tall tail was reading as a nose taking off to the left."
    },
    {
      "t": "10:57",
      "msg": "Sound fixes: removed the crowd roar at the finish (read as fireworks); removed the white-noise intake layer and cut turbo hiss (they read as static: intake made the engine ~200x more noise-like); engine tone +3 dB overall, intake now brightens the engine tone instead."
    },
    {
      "t": "11:17",
      "msg": "Cutscenes for all 9 new bosses started: one agent per boss (3D jerk character + scene) plus an audio agent for their voices, roars and stings. 10 agents in parallel."
    },
    {
      "t": "11:30",
      "msg": "Boss audio DONE: all 9 new bosses have their own voice (Pivot nasal professor, Vera speaks backwards, Deacon hollow crypt whisper...), roar, sting (finals get Rosa-sized double hits) and signature (chalk screech, card shuffle, mirror shatter, record scratch, funeral bell, glove slap, vise crunch). Lead: muted 32 old test-driver scripts that could play sound on your laptop."
    },
    {
      "t": "11:35",
      "msg": "Boss audio added all 16 sounds the scenes asked for: Deacon's funeral bell, candle snuff, tape measure, chisel; Flashini's poof, card riffle, saw, dove coo, ta-da; Vera's reversing beep, kiss, raspberry; glass shatter."
    },
    {
      "t": "11:46",
      "msg": "Shortstack Sal DONE (1/9): pompadour peeking over the door (HEY YOU!!), kicks your tyre till the hubcap flies, stacks phone books to tower over you, pokes the lens (WHO YOU CALLIN' SHORT?!), tiny gearstick, topples face-first into the lens (I MEANT TO DO THAT!!), Napoleon pose."
    },
    {
      "t": "11:47",
      "msg": "Slick Rick Radial DONE (2/9): gold-tooth DING, HAVE I GOT A DEAL FOR YOU!, winks while selling you a bald tire that deflates (SOLD!), foams your tyres and slicks your whole lane (SLICK DEAL!), glazes the lens, NO REFUNDS., finger guns on the card."
    },
    {
      "t": "11:54",
      "msg": "Baron von Redline DONE (3/9, final boss): red carpet rolls to the lens under a blood moon, bat swarm, monocle inspection (PEASANT.), sips from a tach-shaped wine glass and smashes it, confiscates and tears your passive card (CONFISCATED.), slow-mo glove slap across the lens (EN GARDE.), cape-flare hero shot."
    },
    {
      "t": "11:58",
      "msg": "Iron Vise Ivy DONE (4/9, final boss): the letterbox is her vise, clanking tighter with every crush. Welds in the dark, flips her mask up, crushes a #1 trophy (SQUEEZE.), a car door (TIGHTER.), cracks her knuckles, squeezes the screen to a slit around her eyes and crunches a toy of YOUR car in slow-mo, then her V8 hero shot."
    },
    {
      "t": "12:00",
      "msg": "DJ Blackout DONE (5/9): scratches your tach dead, yanks the LIGHTS fader and kills the stadium, only his headphones and grin glow (LIGHTS OUT.), lasers + bass DROP IT. shockwave, rewinds the scene and drops it AGAIN!, mic drop into the lens. 11 sound requests sent to audio. Preview page now links all 13 bosses."
    },
    {
      "t": "12:03",
      "msg": "The Great Flashini DONE (6/9): POOF! appears in a smoke bomb, pulls a fake green light out of his hat (WATCH THE LIGHT...), you lunge and get a spring bouquet in the face (BOING! GOTCHA!), flings cards with a JOKER (YOU) that sticks to the lens, saws a YOUR CAR cutout in half (HALF OFF!), slow-mo TA-DA! with doves, one of which poops on the lens."
    },
    {
      "t": "12:04",
      "msg": "Vice Versa Vera DONE (7/9): the picture opens upside down and mirrored as she reverses in (AREV plate), ignores you admiring herself, blows a kiss that turns into a PFFFBT! raspberry, flips the camera left/right (!NUF EVAH), holds up a mirror showing a sneering green monster (MIRROR, MIRROR) that shatters at the lens."
    },
    {
      "t": "12:07",
      "msg": "Professor Pivot DONE (8/9): tweed wedge with a chalkboard on the roof drifts in (CLASS IS IN SESSION.), whacks the board so the SHIFT window jumps (PAY ATTENTION!), grades you a giant red F, rams the quiz onto the lens in slow-mo (WRONG. / SEE ME AFTER CLASS.), monocle SHING. Sent 3 sound requests to audio."
    },
    {
      "t": "12:12",
      "msg": "Deacon Dread DONE (9/9, final boss): fog and funeral bell, eyes ignite, snuffs a candle, measures you for a coffin (PERFECT FIT.), burns YOU into a tombstone, slow-mo last grain through the hourglass (ONE MISTAKE.), blackout, REST IN PIECES. Audio: Pivot's bell/whack/stamp + scaling funeral bell. All 13 cutscenes load with zero errors; typecheck + build pass."
    },
    {
      "t": "15:29",
      "msg": "Brands + paragons started: new Sport tier (Stock < Street < Sport < Pro), 8 parody brands with a part in every slot (Malibru, Civique, Stallion / Avenger, Kaiju, Viperion / Hellkat, Lamberghoul), set bonuses at 4 and 8, all 12 transforms your car into that brand's paragon. 4 agents."
    },
    {
      "t": "15:40",
      "msg": "Abilities DONE: 8 paragon abilities (Sleeper, VTEC, Pony Launch, Scat Pack, Boost Spike, ACR downforce, Demon burst, Doom Shift), brand logos + tier chevrons, set-progress tooltips, 2 new passives (Brand Loyalist, Mixed Bag). Flagged to Core: pro paragons may be too strong vs the final boss."
    },
    {
      "t": "15:42",
      "msg": "Core DONE: brands.json + 108 parts (e.g. Kaiju 2JZ-GTE, Hellkat 6.2 Supercharged), Sport tier odds by round, shops lean toward brands you own (+ Brand Loyalty garage upgrade), set bonuses and paragons in the stat breakdown, transform event. Street paragons beat round 3, Pro paragons only finishable around race 15 (endless power). Lead capped Brand Loyalist at +18%."
    },
    {
      "t": "15:46",
      "msg": "Paragon cars & engines DONE: 6 new car bodies (sedan, hatch, tuner, brick, widebody, hyper) and all 8 paragon looks; Sport-tier visuals; each paragon has its own engine voice (VTEC crossover, Hemi, 2JZ blow-off, V10, supercharger whine, V12 shriek) and a ~2.5 s transform sound. Gallery: /src/render/race/dev/cars.html?page=paragons"
    },
    {
      "t": "15:49",
      "msg": "UI DONE: brand logo + tier on every part, +1/-1 set chips on offers, sets panel with 4/8/12 pips, ~3.7 s PARAGON! transformation with the paragon reveal and signature ability, 'LOST' toast when a set breaks, paragon badge in staging/result/victory. Typecheck, build, determinism pass. Flag: sloppy players often lose race 1 by a hair; suggested easing race 1 target."
    }
  ]
};
