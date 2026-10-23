// DEV ONLY (not imported by the game): car art gallery.
// /src/render/race/dev/cars.html?page=grid|big&zoom=2  (grid: every body x tier x livery at 2x; big: 3x showcase + motion)
// ?page=paragons  (the 8 brand PARAGONS at 3x (paint shop) and 2x (race / shop), plus a wheelie row)
// ?page=one&body=compact&tier=street&livery=checker&num=10&scale=8&wheelie=0&brake=1  (one car, close up)
import Phaser from "phaser";
import "@fontsource/press-start-2p";
import {
  PARAGONS,
  PARAGON_IDS,
  carVisualForOpponent,
  makeCar,
  paragonVisual,
} from "../../car";
import OPPONENTS from "../../../data/opponents.json";
import type { BodyType, CarVisual, LiveryId } from "../../car";
import type { Tier } from "../../../core/types";

const q = new URLSearchParams(location.search);
const page = q.get("page") ?? "grid";
const W = 1600;
const H =
  page === "grid"
    ? 1620
    : page === "one"
      ? 400
      : page === "paragons"
        ? 940
        : page === "pclose"
          ? 960
          : 1000;
const W1 = page === "one" ? 800 : W;

const BODIES: BodyType[] = ["compact", "muscle", "wedge", "truck", "super"];
const TIERS: Tier[] = ["stock", "street", "sport", "pro"];
const LIVERIES: LiveryId[] = ["none", "stripes", "flames", "checker", "split"];
const COLORS = ["#e8413c", "#3c78e8", "#f7d23e", "#3f7d4e", "#9b4de0"];
const ACCENTS = ["#f7d23e", "#f4ecd8", "#e8413c", "#f28c28", "#38c6f0"];

/** A car at tier t, with hood pieces varied per body so every hood option shows up somewhere. */
function visual(bi: number, t: Tier, livery: LiveryId, number = 0): CarVisual {
  const pro = t === "pro";
  const street = t === "street" || t === "sport";
  return {
    body: BODIES[bi],
    color: COLORS[bi],
    accent: ACCENTS[bi],
    rim:
      t === "stock"
        ? undefined
        : ["#d6d4e4", "#f7d23e", "#16141e", "#e8413c", "#38c6f0"][bi],
    livery,
    number,
    tires: t,
    aero: t,
    exhaust: t,
    intake: pro
      ? bi === 0
        ? "pro"
        : "stock"
      : street && bi % 2 === 0
        ? t
        : "stock",
    forcedInduction: pro
      ? bi === 1 || bi === 3
        ? "pro"
        : "street"
      : t === "sport" && bi % 2 === 1
        ? "sport"
        : "stock",
    nitrous: t !== "stock",
    carbon: pro && bi === 4,
    engine: t,
    suspension: t,
    tuneLevels: pro ? 36 : street ? 14 : 0,
  };
}

class Gallery extends Phaser.Scene {
  constructor() {
    super("Gallery");
  }
  label(x: number, y: number, s: string) {
    this.add.text(x, y, s, {
      fontFamily: '"Press Start 2P"',
      fontSize: "8px",
      color: "#9a97ac",
    });
  }
  ground(y: number) {
    this.add.rectangle(0, y, W, 1, 0x4a4658).setOrigin(0, 0);
  }
  create() {
    this.add.rectangle(0, 0, W, H, 0x2a2833).setOrigin(0, 0);
    if (page === "grid") this.grid();
    else if (page === "one") this.one();
    else if (page === "opp") this.opp();
    else if (page === "paragons") this.paragons();
    else if (page === "pclose") this.pclose();
    else this.big();
  }
  one() {
    const bi = Math.max(
      0,
      BODIES.indexOf((q.get("body") ?? "compact") as BodyType),
    );
    const v = visual(
      bi,
      (q.get("tier") ?? "pro") as Tier,
      (q.get("livery") ?? "none") as LiveryId,
      Number(q.get("num") ?? 0),
    );
    this.ground(330);
    const c = makeCar(this, 400, 330, v, Number(q.get("scale") ?? 8));
    c.setWheelie(Number(q.get("wheelie") ?? 0)).setBrakeLights(
      !!q.get("brake"),
    );
  }
  /** Every opponent exactly as the race and staging scenes draw them (?page=opp, optional &body=wedge). */
  opp() {
    const only = q.get("body");
    const list = (
      OPPONENTS as Parameters<typeof carVisualForOpponent>[0][]
    ).filter((o) => !only || o.car.body === only);
    list.forEach((o, i) => {
      const x = 170 + (i % 4) * 310;
      const y = 120 + Math.floor(i / 4) * 150;
      this.ground(y);
      makeCar(this, x, y, carVisualForOpponent(o), 3);
      this.label(x - 120, y + 8, (o as unknown as { name: string }).name);
    });
  }
  /** Close-up of the paragons at 5x (?page=pclose), for pixel work. */
  pclose() {
    PARAGON_IDS.forEach((id, i) => {
      const x = 400 + (i % 2) * 800;
      const y = 230 + Math.floor(i / 2) * 230;
      this.ground(y);
      makeCar(this, x, y, paragonVisual(id)!, 5);
      this.label(x - 380, y + 14, PARAGONS[id].name);
    });
  }
  /** The 8 paragons: 3x like the Paint Shop, then 2x like the race and shop, then 2x in motion. */
  paragons() {
    PARAGON_IDS.forEach((id, i) => {
      const x = 200 + (i % 4) * 400;
      const y = 120 + Math.floor(i / 4) * 170;
      this.ground(y);
      makeCar(this, x, y, paragonVisual(id)!, 3);
      this.label(
        x - 150,
        y + 12,
        `${PARAGONS[id].name} (${PARAGONS[id].body})`,
      );
    });
    PARAGON_IDS.forEach((id, i) => {
      const x = 110 + i * 196;
      const y = 520;
      this.ground(y);
      makeCar(this, x, y, paragonVisual(id)!, 2);
      this.label(x - 70, y + 10, id);
    });
    // Motion: launch wheelie + nitro + backfire at 2x, alternating.
    PARAGON_IDS.forEach((id, i) => {
      const x = 110 + i * 196;
      const y = 660;
      this.ground(y);
      const c = makeCar(this, x, y, paragonVisual(id)!, 2)
        .setWheelie(i % 2 ? 6 : 0)
        .setBrakeLights(i % 2 === 0);
      if (i % 2) c.setNitro(true);
      else c.flameBurst(100000);
    });
    // Race lanes: a paragon next to a regular opponent, at race scale.
    const y = 840;
    this.ground(y);
    this.ground(y - 40);
    makeCar(
      this,
      300,
      y - 40,
      carVisualForOpponent(
        (OPPONENTS as Parameters<typeof carVisualForOpponent>[0][])[6],
      ),
      2,
    );
    makeCar(
      this,
      300,
      y,
      paragonVisual(q.get("id") ?? "hellkat")!,
      2,
    ).setWheelSpin(20, 30);
    this.label(40, y + 10, "race lanes: opponent vs paragon (blur)");
  }
  grid() {
    // 5 bodies x 4 tiers (rows) x 5 liveries (columns), 2x.
    LIVERIES.forEach((l, li) => this.label(130 + li * 290, 6, l));
    BODIES.forEach((b, bi) =>
      TIERS.forEach((t, ti) => {
        const y = 82 + (bi * TIERS.length + ti) * 77;
        this.ground(y);
        this.label(6, y - 30, `${b}`);
        this.label(6, y - 18, t);
        LIVERIES.forEach((l, li) => {
          const c = makeCar(
            this,
            190 + li * 290,
            y,
            visual(bi, t, l, ti === 0 ? 0 : 7 + bi * 11 + li),
            2,
          );
          c.setWheelSpin(0);
        });
      }),
    );
  }
  big() {
    // 3x showcase: each body with a different livery + number, then motion examples.
    BODIES.forEach((b, bi) => {
      const col = bi % 3;
      const row = Math.floor(bi / 3);
      const x = 260 + col * 520;
      const y = 150 + row * 170;
      this.ground(y);
      this.label(x - 240, y + 10, `${b} pro ${LIVERIES[bi]}`);
      makeCar(
        this,
        x,
        y,
        visual(bi, "pro", LIVERIES[bi], [1, 23, 7, 88, 42][bi]),
        3,
      );
    });
    // Motion row: wheelie (pro + bar), brake lights, squat via setSuspension, 2x wheelie.
    const y = 620;
    this.ground(y);
    const w = makeCar(this, 260, y, visual(1, "pro", "stripes", 5), 3)
      .setWheelie(12)
      .setNitro(true);
    this.label(40, y + 10, "wheelie 12deg + nitro");
    // mark live points: hood (yellow), exhaust (cyan), bar (red), front contact (green)
    const mark = (
      c: typeof w,
      p: { x: number; y: number },
      onBody: boolean,
      col: number,
    ) => {
      const s = c.worldPoint(p, onBody);
      this.add.rectangle(s.x, s.y, 3, 3, col).setDepth(10);
    };
    for (const c of [w]) {
      mark(c, c.hoodLocal, true, 0xffff00);
      mark(c, c.exhaustLocal, true, 0x00ffff);
      mark(c, c.wheelieBarLocal, true, 0xff0000);
      mark(c, c.frontContactLocal, false, 0x00ff00);
    }
    makeCar(this, 780, y, visual(0, "street", "checker", 12), 3).setBrakeLights(
      true,
    );
    this.label(560, y + 10, "brake lights");
    makeCar(this, 1300, y, visual(4, "street", "flames", 3), 3)
      .setSuspension(2, 2)
      .setBodyRoll(1);
    this.label(1080, y + 10, "squat 2/2 + roll 1");
    const y2 = 860;
    this.ground(y2);
    const w2 = makeCar(
      this,
      200,
      y2,
      visual(3, "pro", "split", 9),
      2,
    ).setWheelie(5);
    mark(w2, w2.wheelieBarLocal, true, 0xff0000);
    this.label(40, y2 + 10, "wheelie 5deg 2x (bar on ground)");
    makeCar(this, 620, y2, visual(2, "stock", "none"), 2)
      .setWheelie(8)
      .setBrakeLights(true);
    this.label(500, y2 + 10, "stock wheelie");
    // Opponent-style visual: no optional fields at all.
    makeCar(
      this,
      1000,
      y2,
      {
        body: "muscle",
        color: "#3f7d4e",
        accent: "#f4ecd8",
        tires: "street",
        aero: "street",
        exhaust: "pro",
        intake: "street",
        forcedInduction: "street",
        nitrous: true,
      },
      2,
    );
    this.label(900, y2 + 10, "opponent (no extras)");
    makeCar(this, 1380, y2, visual(0, "pro", "flames", 77), 2).setWheelSpin(
      20,
      30,
    );
    this.label(1260, y2 + 10, "blur frame");
  }
}

async function boot() {
  await document.fonts.load('8px "Press Start 2P"');
  new Phaser.Game({
    type: q.get("canvas") ? Phaser.CANVAS : Phaser.AUTO,
    parent: "game",
    width: W1,
    height: H,
    backgroundColor: 0x0b0a14,
    pixelArt: true,
    roundPixels: true,
    zoom: Number(q.get("zoom") ?? 1),
    scene: [Gallery],
  });
}
boot();
