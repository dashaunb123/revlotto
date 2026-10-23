// Dev dyno: A/B the engine voices (stock V6 / street V8 / sport V8 / pro big-block + the 8 PARAGON voices) by ear.
// http://localhost:5173/src/render/race/dev/engines.html
import type { Tier } from "../../../core/types";
import {
  DEFAULT_ENGINE_PROFILE,
  EngineSound,
  PARAGON_ENGINES,
  revBlip,
  sfx,
  toggleMute,
  unlockAudio,
  type EngineProfile,
} from "../../audio";

const TIERS: Tier[] = ["stock", "street", "sport", "pro"];
const profile: EngineProfile = { ...DEFAULT_ENGINE_PROFILE };
const read = document.getElementById("read")!;
const needle = document.getElementById("needle")!;

/** One frame of a run: what to feed EngineSound.set, plus any one-off events. */
type Frame = { rpm: number; thr: number; limiter?: boolean; label: string };
type Run = (s: number, ev: (k: "shift" | "blow") => void) => Frame | null;

let engine: EngineSound | null = null;
let run: Run | null = null;
let runName = "";
let t0 = 0;
let timer = 0;
const fired = new Set<string>();

function start(name: string, r: Run) {
  unlockAudio();
  engine?.stop();
  engine = new EngineSound({ ...profile });
  run = r;
  runName = name;
  t0 = performance.now();
  fired.clear();
  runBtns.forEach((b) => b.classList.toggle("on", b.textContent === name));
  if (!timer) timer = window.setInterval(tick, 16);
}

function stop() {
  engine?.stop();
  engine = null;
  run = null;
  clearInterval(timer);
  timer = 0;
  read.textContent = "stopped";
  needle.style.width = "0";
  runBtns.forEach((b) => b.classList.remove("on"));
}

function tick() {
  if (!engine || !run) return;
  const s = (performance.now() - t0) / 1000;
  const f = run(s, (k) => {
    if (k === "shift") {
      sfx.shift();
      engine?.shift("perfect");
    } else engine?.blowOff();
  });
  if (!f) {
    stop();
    return;
  }
  engine.set(f.rpm, f.thr, !!f.limiter);
  read.textContent = `${runName}  ${f.label}  rpm ${f.rpm.toFixed(2)}  throttle ${f.thr.toFixed(1)}`;
  needle.style.width = `${Math.min(100, f.rpm * 100)}%`;
  needle.classList.toggle("red", f.rpm > 0.9);
}

const once = (key: string, fn: () => void) => {
  if (!fired.has(key)) {
    fired.add(key);
    fn();
  }
};
const ease = (x: number) => 1 - (1 - Math.max(0, Math.min(1, x))) ** 2;
const IDLE = 0.13;

const RUNS: [string, Run][] = [
  ["Idle", () => ({ rpm: IDLE, thr: 0.1, label: "idle" })],
  [
    "Rev sweep",
    (s, ev) => {
      // Idle, slow climb to redline, lift, fall back to idle, repeat.
      const p = s % 6;
      if (p < 1) return { rpm: IDLE, thr: 0.1, label: "idle" };
      if (p < 3.5) {
        fired.delete("lift" + Math.floor(s / 6));
        return {
          rpm: IDLE + (1 - IDLE) * ((p - 1) / 2.5),
          thr: 1,
          label: "climbing",
        };
      }
      once("lift" + Math.floor(s / 6), () => ev("blow"));
      return {
        rpm: IDLE + (1 - IDLE) * (1 - ease((p - 3.5) / 1.8)),
        thr: 0,
        label: "off throttle",
      };
    },
  ],
  [
    "Blips",
    (s, ev) => {
      // Stab the throttle at idle every 1.4 s, the way you would in the pits.
      const p = s % 1.4;
      const n = Math.floor(s / 1.4);
      if (p < 0.25)
        return { rpm: IDLE + 0.55 * ease(p / 0.25), thr: 1, label: "blip" };
      once("b" + n, () => ev("blow"));
      return {
        rpm: IDLE + 0.55 * (1 - ease((p - 0.25) / 0.7)),
        thr: 0,
        label: "blip",
      };
    },
  ],
  [
    "Full race pull",
    (s, ev) => {
      // Staging, revs up on the lights, launch, four gears with shifts, a touch of limiter, lift and coast.
      if (s < 1.2) return { rpm: IDLE, thr: 0.1, label: "staged" };
      if (s < 2.6)
        return {
          rpm: 0.55 + Math.sin(s * 14) * 0.03,
          thr: 0.5,
          label: "lights",
        };
      const gears = [1.1, 1.5, 1.9, 2.4];
      let at = 2.6;
      for (let g = 0; g < gears.length; g++) {
        const from = g === 0 ? 0.45 : 0.6;
        if (s < at + gears[g]) {
          if (g > 0) once("shift" + g, () => ev("shift"));
          const x = (s - at) / gears[g];
          const top = g === gears.length - 1 ? 1 : 0.95;
          return {
            rpm: from + (top - from) * x ** 0.85,
            thr: 1,
            label: `gear ${g + 1}`,
          };
        }
        at += gears[g];
      }
      if (s < at + 0.5)
        return { rpm: 1, thr: 1, limiter: true, label: "limiter" };
      at += 0.5;
      if (s < at + 3)
        return {
          rpm: IDLE + (1 - IDLE) * (1 - ease((s - at) / 2.4)),
          thr: 0,
          label: "lift, coast",
        };
      return null;
    },
  ],
];

const engineRow = document.getElementById("engine")!;
const PARAGON_NAMES: Record<string, string> = {
  malibru: "Malibru SS: sneaky I4",
  civique: "Civique: VTEC",
  stallion: "Stallion: V8 burble",
  avenger: "Avenger: Hemi",
  kaiju: "Kaiju: I6 turbo",
  viperion: "Viperion: V10",
  hellkat: "Hellkat: blown V8",
  lamberghoul: "Lamberghoul: V12",
};
const engBtns: HTMLButtonElement[] = [];
(["stock V6", "street V8", "sport V8", "pro big-block"] as const).forEach(
  (name, i) => {
    const b = document.createElement("button");
    b.textContent = name;
    b.onclick = () => {
      profile.engine = TIERS[i];
      profile.paragon = undefined;
      engBtns.forEach((x) => x.classList.toggle("on", x === b));
      restart();
    };
    engBtns.push(b);
    engineRow.appendChild(b);
  },
);
const paragonRow = document.getElementById("paragons")!;
const transformRow = document.getElementById("transform")!;
for (const id of PARAGON_ENGINES) {
  const b = document.createElement("button");
  b.textContent = PARAGON_NAMES[id] ?? id;
  b.onclick = () => {
    profile.paragon = id;
    engBtns.forEach((x) => x.classList.toggle("on", x === b));
    restart();
  };
  engBtns.push(b);
  paragonRow.appendChild(b);
  const t = document.createElement("button");
  t.textContent = `TRANSFORM ${id}`;
  t.onclick = () => {
    unlockAudio();
    stop();
    sfx.paragon(id);
  };
  transformRow.appendChild(t);
}
engBtns[0].classList.add("on");

const PARTS: [
  string,
  "exhaust" | "forcedInduction" | "intake" | "transmission",
][] = [
  ["Exhaust", "exhaust"],
  ["Turbo", "forcedInduction"],
  ["Intake", "intake"],
  ["Gearbox", "transmission"],
];
const partsRow = document.getElementById("parts")!;
for (const [name, key] of PARTS) {
  const b = document.createElement("button");
  const show = () => {
    b.textContent = `${name}: ${profile[key]}`;
    b.classList.toggle("on", profile[key] !== "stock");
  };
  b.onclick = () => {
    profile[key] = TIERS[(TIERS.indexOf(profile[key]) + 1) % TIERS.length];
    show();
    restart();
  };
  show();
  partsRow.appendChild(b);
}

const runsRow = document.getElementById("runs")!;
const runBtns = RUNS.map(([name, r]) => {
  const b = document.createElement("button");
  b.textContent = name;
  b.onclick = () => start(name, r);
  runsRow.appendChild(b);
  return b;
});
const blip = document.createElement("button");
blip.textContent = "Garage rev (revBlip)";
blip.onclick = () => {
  unlockAudio();
  stop();
  revBlip({ ...profile });
};
runsRow.appendChild(blip);

/** Swap in the new parts on whatever is running, picking up where it was. */
function restart() {
  if (!run) return;
  const keep = t0;
  const r = run;
  start(runName, r);
  t0 = keep;
}

document.getElementById("stop")!.onclick = stop;
document.getElementById("mute")!.onclick = () => toggleMute();
