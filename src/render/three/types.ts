// Contract for the semi-realistic 3D mode (separate from the toon-shaded boss cutscenes in render/cutscene).
// Units: metres. Car faces +X, +Y up, +Z is the car's RIGHT (passenger side; LHD driver sits on -Z). Ground at y = 0.
import type * as THREE from 'three';
import type { Tier } from '../../core/types';
import type { BodyType, LiveryId } from '../car';

/** Everything needed to build a car; derived from the 2D CarVisual so both modes show the same build. */
export interface CarSpec {
  body: BodyType;
  paint: string; // '#rrggbb'
  accent: string;
  rim: string;
  livery: LiveryId;
  number: number;
  /** Visible upgrade tier per area (drives wheels, wings, scoops, exhaust, stance…). */
  parts: { tires: Tier; aero: Tier; exhaust: Tier; intake: Tier; forcedInduction: Tier; engine: Tier; suspension: Tier; nitrous: boolean; carbon: boolean };
  /** Paragon brand id: switches to that paragon's own body dressing/livery. */
  paragon?: string;
}

/** What a hand-built body returns: geometry plus named anchor points the kit attaches parts to. */
export interface BodyBuild {
  /** The sprung body (everything that pitches/rolls on the suspension). Origin: ground level, mid-wheelbase. */
  body: THREE.Group;
  dims: { length: number; width: number; height: number; wheelbase: number; trackF: number; trackR: number; wheelR: number; rideHeight: number };
  anchors: {
    /** Wheel centres (local to the car root, at rest). */
    wheelFL: THREE.Vector3; wheelFR: THREE.Vector3; wheelRL: THREE.Vector3; wheelRR: THREE.Vector3;
    /** Exhaust tip positions and outward direction (+X = forward, so tips usually point -X). */
    exhausts: { pos: THREE.Vector3; dir: THREE.Vector3 }[];
    hood: THREE.Vector3; // top of the hood centre (scoops, blowers)
    roof: THREE.Vector3;
    deck: THREE.Vector3; // trunk / rear deck centre (wing mount)
    frontBumper: THREE.Vector3; // lower centre of the front bumper (splitter, intercooler)
    seat: THREE.Vector3; // driver head position
    headlights: THREE.Vector3[];
    taillights: THREE.Vector3[];
  };
  /** Meshes the paint/livery system should re-skin (body panels). */
  paintMeshes: THREE.Mesh[];
  /** Optional: meshes for brake-light / headlight emissive switching. */
  tailLightMeshes?: THREE.Mesh[];
  headLightMeshes?: THREE.Mesh[];
}

export type BodyBuilder = (spec: CarSpec) => BodyBuild;

/** A fully assembled, animatable 3D car. */
export interface Car3D {
  root: THREE.Group;
  build: BodyBuild;
  /** Wheel spin in rad/s (rear may differ: wheelspin). */
  setWheelSpin(front: number, rear?: number): void;
  setSteer(rad: number): void;
  /** Body pitch (rad, + = nose up), roll (rad) and squat (m) on the suspension. */
  setSuspension(pitch: number, roll: number, squat?: number): void;
  /** Whole-car wheelie angle around the rear axle (rad). */
  setWheelie(rad: number): void;
  setBrakeLights(on: boolean): void;
  setHeadlights(on: boolean): void;
  setNitro(on: boolean): void;
  /** World positions (call after the root has moved) for FX. */
  exhaustWorld(i: number, out: THREE.Vector3): THREE.Vector3;
  rearContactWorld(side: 'L' | 'R', out: THREE.Vector3): THREE.Vector3;
  update(dt: number): void;
  dispose(): void;
}
