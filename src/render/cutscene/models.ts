// Low-poly procedural toon characters and cars for the boss cutscenes (contract: ./types.ts).
//
// Extras beyond the contract (all optional to use):
// - Characters return CharacterRigX: `props` (hat, glasses, toothpick, helmet, ...), `torso`, `legs`,
//   `hipHeight`, `height`, setTalk(0..1) to flap the jaw, setLook(x, y) to aim the pupils.
//   Exposed head/jaw/eyes/armL/armR are free for the Director to rotate: the rig animates inner
//   children, so Director rotations add on top of expressions and signature moves.
// - Cars return CarRigX: `roof` (stand point), `body` (sprung group), `props` (lightBar, lightRed,
//   lightBlue, horns), setSiren(on), setLights(k). buildBossCar(id) builds each boss's ride.
// - Seating: parent the character root to car.seat with root.position.y = -rig.hipHeight, hide
//   rig.legs, and the hips sit on the driver's (+Z) window sill so the torso and the big head lean out
//   of the window above the roof line. Rotate rig.torso (x/z) to lean further out.
// - toonMaterial() / addOutline() / outlineTree() / gradientTexture() for the Director's own props.
import type { CarLook3D, CarRig, CharacterRig, CutsceneId } from './types';
import { buildCar3D } from './models/car';
import { buildBuckshot } from './models/buckshot';
import { buildOlga } from './models/olga';
import { buildGus } from './models/gus';
import { buildRosa } from './models/rosa';
import { buildPivot } from './models/pivot';
import { buildFlashini } from './models/flashini';
import { buildSal } from './models/sal';
import { buildVera } from './models/vera';
import { buildDj } from './models/dj';
import { buildRick } from './models/rick';
import { buildDeacon } from './models/deacon';
import { buildBaron } from './models/baron';
import { buildIvy } from './models/ivy';
import type { CharacterRigX } from './models/character';

export { addOutline, outlineTree, toonMaterial, gradientTexture, SHARED_OUTLINE } from './models/kit';
export { buildBossCar, buildCar3D, BOSS_CARS } from './models/car';
export type { CarRigX, CarOpts } from './models/car';
export type { CharacterRigX } from './models/character';

export function buildCharacter(id: CutsceneId): CharacterRigX {
  switch (id) {
    case 'buckshot': return buildBuckshot();
    case 'olga': return buildOlga();
    case 'gus': return buildGus();
    case 'rosa': return buildRosa();
    case 'pivot': return buildPivot();
    case 'flashini': return buildFlashini();
    case 'sal': return buildSal();
    case 'vera': return buildVera();
    case 'dj': return buildDj();
    case 'rick': return buildRick();
    case 'deacon': return buildDeacon();
    case 'baron': return buildBaron();
    case 'ivy': return buildIvy();
  }
}

export function buildCar(look: CarLook3D): CarRig & ReturnType<typeof buildCar3D> {
  return buildCar3D(look);
}

export type { CharacterRig };
