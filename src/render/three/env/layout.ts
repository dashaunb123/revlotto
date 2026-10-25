// Drag strip layout (metres). Cars drive +X; front wheels at x = 0 when staged. +Z is the driver's left,
// so the player's lane (left lane) is +Z and the ghost's is -Z. Ground at y = 0.
import { TRACK_LENGTH } from '../../../sim/RaceSim';
import type { Quality } from '../../../game/settings';

export const START_X = 0;
export const FINISH_X = TRACK_LENGTH; // 402.3, exactly the sim's quarter mile
export const FT = 0.3048;
export const LANE_W = 5.5;
export const CWALL_HALF = 0.3; // centre guardwall half-width at the base
export const LANE_Z = CWALL_HALF + LANE_W / 2; // 3.05
export const OUTER_Z = CWALL_HALF + LANE_W; // 5.8: inner face of the outer walls
export const OWALL_T = 0.32;
export const OWALL_H = 1.05;
export const CWALL_START = 9;
export const CWALL_END = 600;
export const OWALL_END_L = 560; // +Z wall ends where the turn-off road leaves
export const OWALL_END_R = 700;
export const OWALL_X0 = -12;
export const TREE_X = 7;
export const BURNOUT = { x0: -22, x1: -6 };
export const WATERBOX = { x0: -30, x1: -22 };
export const CONCRETE_END = 200; // launch pad concrete, asphalt after
export const TRACK_X0 = -70; // staging lanes start
export const TRACK_X1 = 720; // shutdown end
export const SAND = { x0: 668, x1: 712 };
export const NET_X = 714;
export const FENCE_Z = OUTER_Z + OWALL_T + 0.25;
export const TOWER_Z = 9.2;
export const STAND_Z0 = 14; // front row of the grandstands (|z|)
export const SCOREBOARD = { x: 418, z: 12.5 };
export const MARKERS: { x: number; label: string }[] = [
  { x: 60 * FT, label: "60'" },
  { x: 330 * FT, label: "330'" },
  { x: 660 * FT, label: '1/8' },
  { x: 1000 * FT, label: "1000'" },
  { x: FINISH_X, label: 'FINISH' },
];

export interface QualityCfg {
  tex: number; // procedural texture size
  crowd: number; // crowd instances (camera-facing cards)
  nearCrowd: number; // metres within which crowd chunks swap to 3D figures (0 = cards only)
  lights: number; // analytic stadium lights per fragment
  shafts: boolean;
  haze: number; // ground mist billboards
  stars: number;
  treeLights: boolean; // real point lights at the tree
  props: number; // 0..1 density of secondary props
  aniso: number;
}

export function qualityCfg(q: Quality): QualityCfg {
  if (q === 'low') return { tex: 256, crowd: 1400, nearCrowd: 0, lights: 10, shafts: false, haze: 0, stars: 600, treeLights: false, props: 0.35, aniso: 2 };
  if (q === 'medium') return { tex: 512, crowd: 3200, nearCrowd: 20, lights: 16, shafts: true, haze: 16, stars: 1200, treeLights: true, props: 0.65, aniso: 4 };
  return { tex: 512, crowd: 6000, nearCrowd: 28, lights: 23, shafts: true, haze: 32, stars: 2000, treeLights: true, props: 1, aniso: 8 };
}

/** Deterministic PRNG so the strip looks the same every load. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
