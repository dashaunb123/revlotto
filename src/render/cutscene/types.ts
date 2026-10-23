// Shared contract for the 3D boss cutscenes (three.js). The Director (director.ts, scenes/*.ts) choreographs;
// the Modeler (models.ts) builds characters and cars; Cutscene Audio (sfx.ts) makes the noise.
// Units: 1 = 1 metre. +X = car forward, +Y = up. Characters face +Z (toward the camera) at rest.
import type * as THREE from 'three';

export type CutsceneId =
  | 'buckshot' | 'olga' | 'gus' | 'rosa'
  | 'pivot' | 'flashini' | 'sal' | 'vera' | 'dj' | 'rick' | 'deacon' | 'baron' | 'ivy';

export type Expression = 'smirk' | 'crazy' | 'yell' | 'wink' | 'grin';

export interface CharacterRig {
  root: THREE.Group;
  head: THREE.Object3D;
  jaw: THREE.Object3D;
  eyes: THREE.Object3D[];
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  setExpression(e: Expression): void;
  /**
   * The character's signature move, 0 = off, 1 = full. Each boss has their own: Buckshot spins his
   * toothpick and tips his hat, Olga cackles with her shoulders bouncing, Gus's beard and scarf whip in
   * the wind, Rosa's eyes glow. The rig animates it itself in update().
   */
  setSignature(amount: number): void;
  /**
   * Heel turn (v3 cutscenes): 0 = sweet, harmless, peaceful version; 1 = absolute jerk (sneer, glare, posture).
   * Optional so older rigs still satisfy the contract; scenes call it via `rig.setTurn?.(k)`.
   */
  setTurn?(k: number): void;
  /** Secondary motion (jiggle, hair, blinks, signature move). dt in seconds, already slow-mo scaled. */
  update(dt: number): void;
  dispose(): void;
}

export interface CarRig {
  root: THREE.Group;
  /** Where a character's hips go (driver seat / window). */
  seat: THREE.Object3D;
  /** Exhaust tips, for smoke and flames. */
  exhausts: THREE.Object3D[];
  /** Rear tyre contact points, for drift smoke. */
  rearContacts: THREE.Object3D[];
  /** Wheel spin in rad/s (rear can differ for wheelspin). */
  setWheelSpin(front: number, rear?: number): void;
  /** Front wheel steer angle in radians. */
  setSteer(rad: number): void;
  /** Body roll / pitch in radians (suspension lean). */
  setLean(roll: number, pitch: number): void;
  update(dt: number): void;
  dispose(): void;
}

export interface CarLook3D {
  body: 'compact' | 'muscle' | 'wedge' | 'truck' | 'super';
  color: string;
  accent: string;
}
