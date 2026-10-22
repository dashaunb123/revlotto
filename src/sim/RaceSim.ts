// Deterministic quarter-mile sim. Fixed 120 Hz. No Phaser imports allowed here.
import type {
  Grade,
  GradeEvent,
  IRaceSim,
  RaceContext,
  RaceInput,
  RaceResult,
  RaceSetup,
  ShiftWindow,
  SimState,
} from '../core/types';

export const SIM_DT = 1 / 120;
export const TRACK_LENGTH = 402.3;
/** Sim starts here (seconds relative to green). Ambers at -1.5, -1.0, -0.5; green at 0. */
export const TREE_START = -2.0;

// ---------------- Tunable constants ----------------
const G = 9.81;
/** Stat "power" units → wheel watts. */
const KP = 950;
/** Top speed (m/s) of 4th gear at redline for a 200-power car; scales with power^V4_EXP. */
const V4_BASE = 50;
const V4_EXP = 0.42;
/** Fraction of 4th-gear top speed reached at redline in each gear. */
const GEAR_FRAC = [0.3, 0.5, 0.72, 1.0];
/** Aero drag force coefficient (N per (m/s)^2) at drag = 1. */
const CDA = 0.42;
const ROLLING = 0.012;
/** Clutch-slip floor for normalized rpm at launch. */
const LAUNCH_RPM = 0.5;
const IDLE_RPM = 0.13;
const REDLINE_ABS = 7500;
const IDLE_ABS = 900;

const LAUNCH_PERFECT = 0.06;
const LAUNCH_GOOD = 0.15;
const FALSE_START_PENALTY = 0.3;
const AUTO_LAUNCH_T = 1.0;
const LAUNCH_EFFECT_SECONDS = 1.5;
const LAUNCH_MULTS: Record<Grade, { power: number; grip: number }> = {
  perfect: { power: 1.0, grip: 1.06 },
  good: { power: 0.9, grip: 0.97 },
  miss: { power: 0.7, grip: 0.82 },
};

const SHIFT_CENTER = 0.94;
const SHIFT_PERFECT_HALF = 0.035;
const SHIFT_GOOD_HALF = 0.095;
/** Time with no drive while the shift happens, by grade. */
const SHIFT_TIME: Record<Grade, number> = { perfect: 0.07, good: 0.16, miss: 0.32 };
/** Power multiplier for the whole next gear, by grade. */
const SHIFT_GEAR_MULT: Record<Grade, number> = { perfect: 1.0, good: 0.96, miss: 0.82 };
/** Bouncing off the limiter longer than this makes the shift a Miss. */
const LIMITER_MISS_TIME = 0.15;
const LIMITER_PERIOD = 0.08;

// ---------------- Ghost curve ----------------
const GHOST_REACTION = 0.08;
const GHOST_TAU_FRAC = 0.5;

function ghostParams(targetEt: number) {
  const T = Math.max(0.5, targetEt - GHOST_REACTION);
  const tau = GHOST_TAU_FRAC * T;
  const vmax = TRACK_LENGTH / (T - tau * (1 - Math.exp(-T / tau)));
  return { T, tau, vmax };
}

/** Opponent position (m) at t seconds since green. Reaches TRACK_LENGTH exactly at targetEt. */
export function ghostX(t: number, targetEt: number): number {
  const { tau, vmax } = ghostParams(targetEt);
  const u = t - GHOST_REACTION;
  if (u <= 0) return 0;
  return vmax * (u - tau * (1 - Math.exp(-u / tau)));
}

/** Opponent speed (m/s) at t seconds since green. */
export function ghostV(t: number, targetEt: number): number {
  const { tau, vmax } = ghostParams(targetEt);
  const u = t - GHOST_REACTION;
  if (u <= 0) return 0;
  return vmax * (1 - Math.exp(-u / tau));
}

// ---------------- Engine curve ----------------
/** Normalized wheel power at normalized rpm r (peaks ~0.9-0.95, falls hard past 0.95). */
export function powerCurve(r: number): number {
  const torque = 1 - 1.2 * (r - 0.55) * (r - 0.55);
  let p = r * torque;
  if (r > 0.95) p *= 1 - 3 * (r - 0.95);
  return Math.max(0.05, p);
}

function newContext(): RaceContext {
  return {
    powerMult: 1,
    gripMult: 1,
    gearingMult: 1,
    gearPowerMult: 1,
    firstGearGripMult: 1,
    perfectCount: 0,
    cashEarned: 0,
    notes: [],
  };
}

export class RaceSim implements IRaceSim {
  readonly state: SimState;
  readonly setup: RaceSetup;
  readonly ctx: RaceContext = newContext();

  private readonly vTop: number[];
  private readonly quirks: Set<string>;
  private falseStarted = false;
  private launchTime = 0; // sim t at launch
  private launchGrade: Grade = 'miss';
  private shiftTimer = 0;
  private gradeGearMult = 1; // from last shift grade
  private limiterTime = 0;
  private nitroLeft = 0;
  private nitroUsed = false;
  private finishedResult: RaceResult | null = null;

  constructor(setup: RaceSetup) {
    this.setup = setup;
    this.quirks = new Set(setup.quirks);
    const p = Math.max(50, setup.stats.power);
    const v4 = V4_BASE * Math.pow(p / 200, V4_EXP);
    this.vTop = GEAR_FRAC.map((f) => f * v4);
    this.state = {
      t: TREE_START,
      phase: 'tree',
      lights: 0,
      launched: false,
      x: 0,
      v: 0,
      a: 0,
      gear: 1,
      rpm: IDLE_RPM,
      rpmAbs: IDLE_ABS,
      limiter: false,
      wheelspin: false,
      nitroAvailable: setup.stats.nitroPower > 0 && setup.stats.nitroDuration > 0,
      nitroActive: false,
      shiftWindow: this.computeWindow(),
      grades: [],
      reaction: null,
      penalty: 0,
      et: null,
      trapSpeedKph: null,
      live: { power: 1, grip: 1, gearing: 1 },
    };
  }

  /** Top speed (m/s) at redline in the given gear (1-based). Useful for UI speedo scaling. */
  gearTopSpeed(gear: number): number {
    return this.vTop[Math.max(0, Math.min(3, gear - 1))];
  }

  private windowMult(): number {
    return Math.max(0.2, this.setup.stats.shiftWindow) * this.setup.extraShiftWindowMult;
  }

  private computeWindow(): ShiftWindow {
    const m = this.windowMult();
    const ph = SHIFT_PERFECT_HALF * m;
    const gh = Math.max(ph + 0.02, SHIFT_GOOD_HALF * Math.sqrt(m));
    return {
      perfectLo: SHIFT_CENTER - ph,
      perfectHi: Math.min(1.0, SHIFT_CENTER + ph),
      goodLo: SHIFT_CENTER - gh,
      goodHi: 1.0,
    };
  }

  private launchWindowMult(): number {
    return this.setup.launchWindowMult * (this.quirks.has('two_step') ? 1.5 : 1);
  }

  private pushGrade(e: GradeEvent): GradeEvent {
    this.state.grades.push(e);
    if (e.grade === 'perfect') this.ctx.perfectCount++;
    return e;
  }

  // ---------------- Input ----------------
  input(action: RaceInput): GradeEvent | null {
    const s = this.state;
    if (s.phase === 'finished') return null;

    if (action === 'nitro') {
      if (!s.launched || !s.nitroAvailable || this.nitroUsed) return null;
      this.nitroUsed = true;
      s.nitroAvailable = false;
      s.nitroActive = true;
      this.nitroLeft = this.setup.stats.nitroDuration;
      const grade: Grade = s.wheelspin ? 'miss' : s.gear >= 2 ? 'perfect' : 'good';
      return this.pushGrade({ kind: 'nitro', grade, t: s.t, gear: s.gear, label: s.wheelspin ? 'SPIN' : 'NOS' });
    }

    // 'go'
    if (!s.launched) {
      if (s.t < 0) {
        if (this.falseStarted) return null;
        this.falseStarted = true;
        s.penalty += FALSE_START_PENALTY;
        return this.pushGrade({ kind: 'false_start', grade: 'miss', t: s.t, offsetMs: Math.round(s.t * 1000), label: 'FALSE START' });
      }
      if (this.falseStarted) return null; // launches automatically at green
      const reaction = s.t;
      const m = this.launchWindowMult();
      const grade: Grade = reaction <= LAUNCH_PERFECT * m ? 'perfect' : reaction <= LAUNCH_GOOD * m ? 'good' : 'miss';
      const e = this.pushGrade({ kind: 'launch', grade, t: s.t, offsetMs: Math.round(reaction * 1000), label: grade.toUpperCase() });
      this.doLaunch(grade, reaction);
      return e;
    }

    // Shift
    if (s.gear >= 4 || this.shiftTimer > 0) return null;
    const w = s.shiftWindow;
    const r = s.rpm;
    let grade: Grade;
    let label: string;
    if (this.limiterTime > LIMITER_MISS_TIME) {
      grade = 'miss';
      label = 'LIMITER';
    } else if (r >= w.perfectLo && r <= w.perfectHi + 0.005) {
      grade = 'perfect';
      label = 'PERFECT';
    } else if (r >= w.goodLo && r <= w.goodHi + 0.01) {
      grade = 'good';
      label = r < w.perfectLo ? 'EARLY' : 'LATE';
    } else {
      grade = 'miss';
      label = r < w.goodLo ? 'EARLY' : 'LATE';
    }
    const rpmRate = Math.max(0.02, Math.abs(s.a) / this.vTop[s.gear - 1]);
    const offsetMs = Math.round(((r - SHIFT_CENTER) / rpmRate) * 1000);
    const fromGear = s.gear;
    const e = this.pushGrade({ kind: 'shift', grade, t: s.t, gear: fromGear, offsetMs, label });

    s.gear = fromGear + 1;
    this.shiftTimer = SHIFT_TIME[grade] * (this.quirks.has('fast_shift') ? 0.5 : 1);
    this.gradeGearMult = SHIFT_GEAR_MULT[grade];
    this.limiterTime = 0;
    // gearPowerMult resets each shift; onShift hooks then run and may set it for the new gear.
    this.ctx.gearPowerMult = 1;
    for (const h of this.setup.hooks) h.onShift?.(grade, fromGear, this.ctx);
    this.updateRpm();
    return e;
  }

  private doLaunch(grade: Grade, reaction: number) {
    const s = this.state;
    s.launched = true;
    s.reaction = reaction;
    this.launchTime = s.t;
    this.launchGrade = grade;
    for (const h of this.setup.hooks) h.onLaunch?.(grade, this.ctx);
  }

  // ---------------- Step ----------------
  step(): void {
    const s = this.state;
    const dt = SIM_DT;
    const prevT = s.t;
    s.t = Math.round((s.t + dt) * 1e6) / 1e6;

    if (s.phase === 'tree') {
      s.lights = s.t >= 0 ? 4 : s.t >= -0.5 ? 3 : s.t >= -1.0 ? 2 : s.t >= -1.5 ? 1 : 0;
      // Pre-stage rev: engine held a bit off idle once the ambers start
      s.rpm = s.lights > 0 ? 0.42 + 0.03 * Math.sin(s.t * 40) : IDLE_RPM;
      s.rpmAbs = this.toAbs(s.rpm);
      if (prevT < 0 && s.t >= 0) {
        s.t = 0;
        s.lights = 4;
        s.phase = 'running';
        for (const h of this.setup.hooks) h.onStart?.(this.ctx);
        if (this.falseStarted) this.doLaunch('miss', 0);
      }
      return;
    }

    if (s.phase === 'running' && !s.launched) {
      s.rpm = 0.42 + 0.03 * Math.sin(s.t * 40);
      s.rpmAbs = this.toAbs(s.rpm);
      if (s.t >= AUTO_LAUNCH_T) {
        this.pushGrade({ kind: 'launch', grade: 'miss', t: s.t, offsetMs: Math.round(s.t * 1000), label: 'ASLEEP' });
        this.doLaunch('miss', s.t);
      }
      return;
    }

    if (s.phase === 'finished') {
      // Coast to a stop for the visuals; result is frozen.
      s.v = Math.max(0, s.v - 7 * dt);
      s.a = s.v > 0 ? -7 : 0;
      s.x += s.v * dt;
      s.nitroActive = false;
      s.limiter = false;
      s.wheelspin = false;
      s.rpm = Math.max(IDLE_RPM, s.rpm - 0.8 * dt);
      s.rpmAbs = this.toAbs(s.rpm);
      return;
    }

    this.physics(dt, prevT);
  }

  private toAbs(r: number): number {
    return Math.round(IDLE_ABS + (REDLINE_ABS - IDLE_ABS) * Math.max(0, Math.min(1.05, r)));
  }

  private updateRpm() {
    const s = this.state;
    const vt = this.vTop[s.gear - 1];
    const r = s.v / vt;
    s.rpm = Math.max(r, s.gear === 1 && s.launched ? LAUNCH_RPM : IDLE_RPM);
    s.rpmAbs = this.toAbs(s.rpm);
  }

  private physics(dt: number, prevT: number) {
    const s = this.state;
    const st = this.setup.stats;
    const ctx = this.ctx;
    const sinceLaunch = s.t - this.launchTime;
    const W = Math.max(300, st.weight);
    const gearIdx = s.gear - 1;
    const vt = this.vTop[gearIdx];

    // --- power ---
    let nitro = 0;
    if (s.nitroActive) {
      nitro = st.nitroPower;
      this.nitroLeft -= dt;
      if (this.nitroLeft <= 0) s.nitroActive = false;
    }
    let pMult = ctx.powerMult * ctx.gearPowerMult * this.gradeGearMult;
    let gripMult = ctx.gripMult;
    if (sinceLaunch < LAUNCH_EFFECT_SECONDS) {
      pMult *= LAUNCH_MULTS[this.launchGrade].power;
      gripMult *= LAUNCH_MULTS[this.launchGrade].grip;
    }
    if (this.quirks.has('launch_lag') && sinceLaunch < 1.2) {
      pMult *= 0.5 + 0.5 * (sinceLaunch / 1.2);
    }
    if (s.gear === 1) gripMult *= ctx.firstGearGripMult;
    if (sinceLaunch < this.setup.gripEarlySeconds) gripMult *= this.setup.gripEarlyMult;

    const power = Math.max(0, (st.power + nitro) * pMult);
    const gearing = Math.max(0.1, st.gearing * ctx.gearingMult);

    // --- rpm / limiter ---
    const rTrue = s.v / vt;
    let driveOn = this.shiftTimer <= 0;
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    let limiter = false;
    if (rTrue >= 0.999) {
      limiter = true;
      this.limiterTime += dt;
      // Intermittent cut: power off for half of each period.
      if ((this.limiterTime % LIMITER_PERIOD) < LIMITER_PERIOD * 0.55) driveOn = false;
    } else if (rTrue < 0.98) {
      this.limiterTime = 0;
    }

    // --- forces ---
    const rEff = Math.max(rTrue, s.gear === 1 ? LAUNCH_RPM : 0.2);
    const wheelWatts = power * KP * powerCurve(Math.min(rEff, 1.0));
    const vForForce = Math.max(s.v, rEff * vt);
    let aDrive = driveOn ? (wheelWatts * gearing) / (vForForce * W) : 0;
    const mu = Math.max(0.1, st.grip * gripMult);
    const aGrip = mu * G;
    let wheelspin = false;
    if (aDrive > aGrip) {
      aDrive = aGrip;
      wheelspin = true;
    }
    const aDrag = (CDA * Math.max(0.05, st.drag) * s.v * s.v) / W + (s.v > 0.1 ? ROLLING * G : 0);
    let a = aDrive - aDrag;
    if (s.v <= 0 && a < 0) a = 0;

    const xPrev = s.x;
    s.v = Math.max(0, s.v + a * dt);
    // Engine can't spin past redline in gear: limiter caps speed.
    if (s.v > vt) s.v = vt;
    s.x += s.v * dt;
    s.a = a;
    s.limiter = limiter;
    s.wheelspin = wheelspin && sinceLaunch < 4;

    // rpm for display/grading
    const rNow = s.v / vt;
    let rpm = Math.max(rNow, s.gear === 1 ? LAUNCH_RPM : IDLE_RPM);
    if (s.wheelspin) rpm = Math.min(1.0, Math.max(rpm, rpm + 0.12));
    if (limiter) rpm = driveOn ? 1.0 : 0.985;
    s.rpm = rpm;
    s.rpmAbs = this.toAbs(rpm);
    s.live = { power: ctx.powerMult * ctx.gearPowerMult, grip: ctx.gripMult * (s.gear === 1 ? ctx.firstGearGripMult : 1), gearing: ctx.gearingMult };
    s.shiftWindow = this.computeWindow();

    if (s.x >= TRACK_LENGTH) {
      const frac = (TRACK_LENGTH - xPrev) / Math.max(1e-9, s.x - xPrev);
      const tCross = prevT + dt * frac;
      const reaction = s.reaction ?? 0;
      const runTime = tCross - this.launchTime;
      const et = Math.round((reaction + runTime + s.penalty) * 1000) / 1000;
      s.et = et;
      s.trapSpeedKph = Math.round(s.v * 3.6 * 10) / 10;
      s.phase = 'finished';
      s.nitroActive = false;
      const won = et <= this.setup.targetEt;
      for (const h of this.setup.hooks) h.onFinish?.({ et, targetEt: this.setup.targetEt, won }, ctx);
      this.finishedResult = {
        et,
        targetEt: this.setup.targetEt,
        won,
        margin: Math.round((this.setup.targetEt - et) * 1000) / 1000,
        reaction,
        trapSpeedKph: s.trapSpeedKph,
        grades: s.grades.slice(),
        perfectCount: ctx.perfectCount,
        passiveCash: ctx.cashEarned,
      };
    }
  }

  result(): RaceResult {
    if (!this.finishedResult) throw new Error('RaceSim.result() called before the race finished');
    return this.finishedResult;
  }

  /** Run to completion with an input policy (headless). Returns the result. */
  runToEnd(policy: (sim: RaceSim) => RaceInput | null, maxSeconds = 60): RaceResult {
    while (this.state.phase !== 'finished' && this.state.t < maxSeconds) {
      const act = policy(this);
      if (act) this.input(act);
      this.step();
    }
    return this.result();
  }
}
