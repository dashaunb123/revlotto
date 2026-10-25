// buildCar3D(spec): body (hand-built, per body type) + kit (wheels, add-ons by tier, paragon dressing) + paint/livery
// + the animation API. specFromVisual() maps the 2D CarVisual so both modes show the same build.
//
// Scene graph (car space: +X forward, +Y up, +Z = left; ground y = 0):
//   root ─ pivot (wheelie, at the rear axle) ─ chassis ─┬─ 4 wheel corners (unsprung: steer → spin)
//                                                      ├─ wheelie bar (kept level with the ground)
//                                                      └─ stance (tyre-size rake + ride height) ─ sprung (pitch/roll/squat
//                                                         about the CG) ─ inner ─┬─ build.body
//                                                                                └─ kit add-ons, lights, paragon decals
import * as THREE from 'three';
import type { Tier } from '../../../core/types';
import type { CarVisual } from '../../car';
import type { BodyBuild, Car3D, CarSpec } from '../types';
import { buildAddons, type AddonsOut, type ExhaustTip } from './kit/addons';
import { buildChute } from './kit/chute';
import { canvas, texFrom } from './kit/tex';
import { KitMats, lookApi } from './kit/mats';
import { mergeStatic } from './kit/merge';
import { buildParagon } from './kit/paragons';
import { isShared, Res } from './kit/res';
import { axleSpecs, buildWheel, wheelMats, type AxleSpecs, type Quality, type Wheel3D } from './kit/wheels';
import { BODY_BUILDERS } from './registry';

/** Default rim colour when the visual has none (matches the 2D renderer's tier defaults). */
function defaultRim(v: CarVisual): string {
  if (v.tires === 'street') return v.accent;
  if (v.tires === 'sport') return '#c8a050';
  if (v.tires === 'pro') return '#e8e8ee';
  return '#9a97ac';
}

/** CarSpec plus kit-only extras. */
export type KitSpec = CarSpec & { plate?: string };

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const PLATE_ABC = 'ABCDEFGHJKLMNPRSTUVWXYZ';

/** A licence plate for a named driver/opponent, e.g. 'Dez "Daily Driver"' -> 'DEZ 418'. */
export function plateFor(name: string): string {
  const h = hashStr(name);
  const word = (name.toUpperCase().match(/[A-Z]{2,}/) ?? ['RVL'])[0].slice(0, 4);
  return `${word} ${100 + (h % 900)}`;
}

/** Opponents (no rim/livery in their visual) get their own plate instead of the body's default player plate. */
function opponentPlate(v: CarVisual): string {
  const h = hashStr(`${v.body}|${v.color}|${v.accent}`);
  const l = (k: number) => PLATE_ABC[Math.floor(h / 23 ** k) % PLATE_ABC.length];
  return `${l(0)}${l(1)}${l(2)} ${100 + (h % 900)}`;
}

/** The 2D visual -> 3D spec. opts.plate sets the licence plate text (world: plateFor(opponent.name)). */
export function specFromVisual(v: CarVisual, opts: { plate?: string } = {}): KitSpec {
  const opponent = v.rim === undefined && v.livery === undefined && !v.paragon;
  return {
    plate: opts.plate ?? (opponent ? opponentPlate(v) : undefined),
    body: v.body,
    paint: v.color,
    accent: v.accent,
    rim: v.rim ?? defaultRim(v),
    livery: v.livery ?? 'none',
    number: v.number ?? 0,
    parts: {
      tires: v.tires, aero: v.aero, exhaust: v.exhaust, intake: v.intake, forcedInduction: v.forcedInduction,
      engine: v.engine ?? 'stock', suspension: v.suspension ?? 'stock', nitrous: v.nitrous, carbon: !!v.carbon,
    },
    paragon: (v as CarVisual & { paragon?: string }).paragon,
  };
}

/** The assembled car plus kit extras for the race/FX/showcase agents. */
export interface KitCar3D extends Car3D {
  spec: CarSpec;
  axles: AxleSpecs;
  wheels: Wheel3D[]; // FL, FR, RL, RR
  /** The sprung body group (pitch/roll); parent of build.body and the body-mounted kit. */
  sprung: THREE.Group;
  /** Brake discs (4 meshes sharing one per-car material): FX can drive glow via setBrakeGlow or the material. */
  brakeDiscs: THREE.Mesh[];
  /** Red-hot disc glow 0..1 (emissive). */
  setBrakeGlow(k: number): void;
  /** Wheel hub centre i (0 FL, 1 FR, 2 RL, 3 RR) in car-root space (at rest). */
  wheelCentre(i: number, out?: THREE.Vector3): THREE.Vector3;
  /** Number of exhaust tips (exhaustWorld(i) for i < exhaustCount). */
  exhaustCount: number;
  exhaustDirWorld(i: number, out: THREE.Vector3): THREE.Vector3;
  /** Contact point of the wheelie-bar wheels (null without one), for sparks. */
  wheelieBarWorld(out: THREE.Vector3): THREE.Vector3 | null;
  /** Drag chute: 0 = packed (clears it), 1 = fully blown. No-op on cars without a chute pack. */
  setChute(k: number): void;
  hasChute: boolean;
  /** Engine speed 0..1 (shaker scoop / blower belt shake, idle lope). */
  setEngine(rpm01: number): void;
  /**
   * Compile every material of this car up front (call once after adding the car to its scene and setting up the
   * lights): nothing appears or changes defines later, so no shader compiles mid-race.
   */
  prewarm(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene): void;
  /** Tyre radii actually fitted (front, rear), for FX/smoke placement. */
  tyreRadius: { front: number; rear: number };
}

const DROP: Record<Tier, number> = { stock: 0, street: 0.012, sport: 0.024, pro: 0.018 };

/**
 * opts.quality: geometry LOD (high/medium/low). opts.lights: dynamic lights per car ('auto' = one shared glow light at
 * high, none below; 'full' adds a headlight spot for hero shots; 'none'). Every light costs shading on every material.
 * opts.beams: the headlight ground beam (default on; studio showcases turn it off, it reads as a stripe on the floor).
 */
export function buildCar3D(spec: CarSpec, opts: { quality?: Quality; lights?: 'auto' | 'none' | 'full'; beams?: boolean } = {}): KitCar3D {
  const q: Quality = opts.quality ?? 'high';
  const res = new Res();
  const mats = new KitMats(res);
  const build: BodyBuild = BODY_BUILDERS[spec.body](spec);
  const { dims, anchors: A } = build;
  // licence plate: the body's default text is the player's; opponents/explicit plates swap the plate material
  const plateText = (spec as KitSpec).plate;
  const plateMat = plateText ? (lookApi?.plateMaterial as ((t: string) => THREE.Material) | undefined)?.(plateText) : undefined;
  if (plateMat) build.body.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && /^plate\d*$/i.test(o.name)) (o as THREE.Mesh).material = plateMat;
  });

  const root = new THREE.Group();
  root.name = `car3d_${spec.body}`;
  const axles = axleSpecs(spec, dims.wheelR, dims.width);
  const rF = axles.front.R;
  const rR = axles.rear.R;
  const xR = (A.wheelRL.x + A.wheelRR.x) / 2;
  const xF = (A.wheelFL.x + A.wheelFR.x) / 2;
  const wb = Math.max(0.5, xF - xR);

  const pivot = new THREE.Group();
  pivot.position.set(xR, rR, 0);
  root.add(pivot);
  const chassis = new THREE.Group();
  chassis.position.set(-xR, -rR, 0);
  pivot.add(chassis);

  // --- stance: bigger/smaller tyres lift each axle; suspension tiers drop the body ---
  const stance = new THREE.Group();
  const dyF = rF - dims.wheelR;
  const dyR = rR - dims.wheelR;
  const drop = DROP[spec.parts.suspension] ?? 0;
  const xMid = (xF + xR) / 2;
  const liftMid = (dyF + dyR) / 2 - drop;
  const rake = Math.atan2(dyF - dyR, wb);
  stance.position.set(xMid, liftMid, 0);
  stance.rotation.z = rake;
  chassis.add(stance);
  const cgY = dims.rideHeight + dims.height * 0.3;
  const sprung = new THREE.Group();
  sprung.position.set(0, cgY, 0);
  stance.add(sprung);
  const inner = new THREE.Group();
  inner.position.set(-xMid, -cgY, 0);
  sprung.add(inner);
  inner.add(build.body);
  build.body.updateMatrixWorld(true);

  // --- wheels ---
  const wm = wheelMats(res, spec, axles);
  const corners = [A.wheelFL, A.wheelFR, A.wheelRL, A.wheelRR];
  const wheels: Wheel3D[] = corners.map((a, i) => {
    const front = i < 2;
    const s = front ? axles.front : axles.rear;
    const side: 1 | -1 = a.z >= 0 ? 1 : -1;
    const w = buildWheel(res, mats, wm, spec, s, side, front, q);
    // fat rear slicks tuck mostly inboard (mini-tubbed), skinnies sit on the hub face
    const base = front ? axles.front : axles.rear;
    const stockW = Math.min(0.25, Math.max(0.19, dims.width * 0.118)) * 0.95;
    const tuck = (base.W - stockW) * 0.5 * (base.W > stockW ? 0.55 : 0.8);
    w.steer.position.set(a.x, s.R, a.z - side * tuck);
    chassis.add(w.steer);
    return w;
  });
  const brakeDiscs = wheels.map((w) => w.disc);

  // --- paint, carbon hood, livery (Look), kit add-ons, paragon dressing ---
  const addons: AddonsOut = buildAddons({ build, spec, res, mats, quality: q, inner, chassis, axles, rearAxleX: xR, rearR: rR });
  const paragon = spec.paragon ? buildParagon({ build, spec, res, mats, quality: q, inner, addons }) : null;
  let livery: { dispose?: () => void } | null = null;
  const applyLivery = lookApi?.applyLivery as ((b: BodyBuild, s: CarSpec, o?: Record<string, unknown>) => { dispose?: () => void }) | undefined;
  if (applyLivery) {
    try {
      livery = applyLivery(build, spec, { atlas: q === 'low' ? 1024 : 2048 });
    } catch (e) {
      console.warn('[kit] applyLivery failed', e);
    }
  } else if (!build.paintMeshes.some((m) => (m.material as THREE.Material)?.userData?.livery)) {
    // no Look yet: plain clearcoat paint in the spec colour on every paint panel
    const pm = mats.paint(spec.paint, { flake: 0.5 });
    for (const m of build.paintMeshes) if (m.name !== 'hood' || !spec.parts.carbon) m.material = pm;
  }
  addons.afterPaint?.();

  // --- lights: per-car light materials so one car's brake lights don't light the other's ---
  const lightMats = (meshes: THREE.Mesh[] | undefined) => {
    const out: THREE.Material[] = [];
    const seen = new Map<THREE.Material, THREE.Material>();
    for (const m of meshes ?? []) {
      const list = Array.isArray(m.material) ? m.material : [m.material];
      const next = list.map((mat) => {
        let c = seen.get(mat);
        if (!c) {
          c = res.own(mat.clone());
          seen.set(mat, c);
          out.push(c);
        }
        return c;
      });
      m.material = Array.isArray(m.material) ? next : next[0];
    }
    return out as (THREE.Material & { emissiveIntensity?: number; userData: Record<string, unknown> })[];
  };
  const tailMats = lightMats(build.tailLightMeshes);
  const headMats = lightMats(build.headLightMeshes);

  // --- bake the static body + kit into one mesh per material (draw calls: ~330 -> a few dozen per car) ---
  const merged = mergeStatic(build.body, addons.animated);
  const remap = (list: THREE.Mesh[] | undefined) => (list ? [...new Set(list.map((m) => merged.map.get(m) ?? m))] : list);
  build.paintMeshes = remap(build.paintMeshes) ?? [];
  build.tailLightMeshes = remap(build.tailLightMeshes);
  build.headLightMeshes = remap(build.headLightMeshes);
  if (addons.bar) mergeStatic(addons.bar);
  const setLightLevel = lookApi?.setLightLevel as ((m: THREE.Material, k: number) => void) | undefined;
  for (const m of [...tailMats, ...headMats]) m.userData.kitBaseEI = m.emissiveIntensity ?? 1;
  const level = (list: typeof tailMats, k: number) => {
    for (const m of list) {
      if (setLightLevel) setLightLevel(m, k);
      else if (m.emissiveIntensity !== undefined) m.emissiveIntensity = (m.userData.kitBaseEI as number) * k;
    }
  };
  // dynamic lights: one glow light behind the car (brake red / nitrous blue) at high; a headlight spot only on request
  const lightMode = opts.lights ?? 'auto';
  const glowPt = lightMode === 'full' || (lightMode === 'auto' && q === 'high') ? new THREE.PointLight(0xff2010, 0, 4, 2) : null;
  const headSpot = lightMode === 'full' ? new THREE.SpotLight(0xfff1dc, 0, 40, 0.42, 0.5, 1.6) : null;
  {
    const tl = A.taillights.length ? A.taillights.reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(A.taillights.length) : new THREE.Vector3(-dims.length / 2, 0.8, 0);
    if (glowPt) {
      glowPt.position.copy(tl).add(new THREE.Vector3(-0.35, -0.15, -tl.z));
      inner.add(glowPt);
    }
    if (headSpot) {
      const hl = A.headlights.length ? A.headlights.reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(A.headlights.length) : new THREE.Vector3(dims.length / 2, 0.7, 0);
      headSpot.position.copy(hl);
      headSpot.target.position.set(hl.x + 12, 0, hl.z);
      inner.add(headSpot, headSpot.target);
    }
  }
  // parachute (style.chute): canopy + shroud lines in car-root space, attached to the bumper pack
  const chute = addons.chuteAttach ? buildChute(res, spec.accent === '#1c1a24' ? '#d0182c' : spec.accent) : null;
  if (chute) root.add(chute.group);
  const chuteAt = new THREE.Vector3();
  // headlight beams on the asphalt: one additive ground quad ahead of the nose (cheaper than a spot light)
  let beam: THREE.Mesh | null = null;
  if (q !== 'low' && opts.beams !== false) {
    const tex = res.get('t:beam', () => {
      const [c, g] = canvas(128, 64);
      const gr = g.createLinearGradient(0, 0, 128, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0.0)');
      gr.addColorStop(0.08, 'rgba(255,255,255,0.9)');
      gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 64);
      g.globalCompositeOperation = 'destination-in';
      const gv = g.createLinearGradient(0, 0, 0, 64);
      gv.addColorStop(0, 'rgba(0,0,0,0)');
      gv.addColorStop(0.3, 'rgba(0,0,0,1)');
      gv.addColorStop(0.7, 'rgba(0,0,0,1)');
      gv.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gv;
      g.fillRect(0, 0, 128, 64);
      return texFrom(c, { srgb: true });
    });
    const m = res.own(new THREE.MeshBasicMaterial({ map: tex, color: 0xfff0d8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const g = res.own(new THREE.PlaneGeometry(16, Math.min(2.8, dims.width * 1.4)));
    g.rotateX(-Math.PI / 2);
    beam = new THREE.Mesh(g, m);
    beam.name = 'headBeam';
    beam.position.set(dims.length / 2 + 7.7, 0.015, 0);
    beam.renderOrder = 1;
    beam.visible = false;
    root.add(beam);
  }
  let brakeOn = false;
  let headOn = false;
  let nitroOn = false;
  let brakeK = 0;
  let nitroK = 0;
  level(tailMats, 0.3);
  level(headMats, 0.06);

  // --- motion state ---
  let spinF = 0;
  let spinR = 0;
  let angF = 0;
  let angR = 0;
  let rpm = 0.15;
  let time = 0;
  let glow = 0;
  const tmp = new THREE.Vector3();
  const q4 = new THREE.Quaternion();
  const smooth = (a: number, b: number, x: number) => THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);

  const car: KitCar3D = {
    root,
    build,
    spec,
    axles,
    wheels,
    sprung,
    brakeDiscs,
    tyreRadius: { front: rF, rear: rR },
    exhaustCount: addons.tips.length,
    wheelCentre(i, out = new THREE.Vector3()) {
      const w = wheels[i] ?? wheels[0];
      root.updateMatrixWorld(true);
      return out.copy(w.steer.position).applyMatrix4(chassis.matrixWorld).applyMatrix4(tmpInv.copy(root.matrixWorld).invert());
    },
    setWheelSpin(front, rear = front) {
      spinF = front;
      spinR = rear;
    },
    /** + = steer left (toward -Z; +Z is the car's right). */
    setSteer(rad) {
      wheels[0].steer.rotation.y = rad;
      wheels[1].steer.rotation.y = rad;
    },
    setSuspension(pitch, roll, squat = 0) {
      sprung.rotation.set(roll, 0, pitch);
      sprung.position.y = cgY - squat;
    },
    hasChute: !!chute,
    setChute(k) {
      chute?.set(k);
    },
    setWheelie(rad) {
      pivot.rotation.z = Math.max(0, rad);
      addons.setWheelie?.(Math.max(0, rad));
    },
    setBrakeLights(on) {
      brakeOn = on;
    },
    setHeadlights(on) {
      headOn = on;
      level(headMats, on ? 1 : 0.06);
      if (headSpot) headSpot.intensity = on ? 60 : 0;
      if (beam) {
        beam.visible = on;
        (beam.material as THREE.MeshBasicMaterial).opacity = on ? 0.5 : 0;
      }
    },
    setNitro(on) {
      nitroOn = on;
    },
    prewarm(renderer, camera, scene) {
      // everything that can appear later (chute, beams, sharp/blurred wheel parts) is compiled now
      const beamWas = beam?.visible ?? false;
      chute?.showForPrewarm(true);
      if (beam) beam.visible = true;
      try {
        renderer.compile(root, camera, scene);
        // the smeared tyre materials share the lettered ones' program; upload their textures now too
        for (const w of wheels) for (const t of [w.tyreMats[1].map, w.tyreMats[1].bumpMap]) if (t) renderer.initTexture(t);
      } catch (e) {
        console.warn('[kit] prewarm failed', e);
      }
      chute?.showForPrewarm(false);
      if (beam) beam.visible = beamWas;
    },
    setBrakeGlow(k) {
      glow = THREE.MathUtils.clamp(k, 0, 1);
      wm.disc.emissiveIntensity = glow * glow * 3.5;
    },
    setEngine(r) {
      rpm = THREE.MathUtils.clamp(r, 0, 1);
    },
    exhaustWorld(i, out) {
      const t: ExhaustTip | undefined = addons.tips[i] ?? addons.tips[0];
      if (!t) return root.localToWorld(out.set(-dims.length / 2, 0.35, 0));
      return inner.localToWorld(out.copy(t.pos));
    },
    exhaustDirWorld(i, out) {
      const t = addons.tips[i] ?? addons.tips[0];
      inner.getWorldQuaternion(q4);
      return out.copy(t ? t.dir : tmp.set(-1, 0, 0)).applyQuaternion(q4).normalize();
    },
    rearContactWorld(side, out) {
      const w = side === 'L' ? wheels[2] : wheels[3];
      return root.localToWorld(out.set(w.steer.position.x, 0, w.steer.position.z));
    },
    wheelieBarWorld(out) {
      return addons.wheelieBarContact ? addons.wheelieBarContact(out) : null;
    },
    update(dt) {
      time += dt;
      angF -= spinF * dt;
      angR -= spinR * dt;
      angF %= Math.PI * 2;
      angR %= Math.PI * 2;
      for (let i = 0; i < 4; i++) {
        const w = wheels[i];
        const a = i < 2 ? angF : angR;
        w.spin.rotation.z = w.side > 0 ? a : -a;
      }
      // motion blur keyed on the angle turned THIS frame (a 1/60 s shutter): slow-mo dt sharpens it naturally.
      // Above ~0.9 the spokes/lugs are hidden behind the opaque smear so they cannot wagon-wheel.
      const bF = smooth(0.25, 0.7, Math.abs(spinF * dt));
      const bR = smooth(0.25, 0.7, Math.abs(spinR * dt));
      if (dt > 0) {
        wm.blurF.opacity = bF;
        wm.blurR.opacity = bR;
        for (let i = 0; i < 4; i++) {
          const sharp = (i < 2 ? bF : bR) < 0.9;
          for (const m of wheels[i].sharp) m.visible = sharp;
          wheels[i].tyre.material = wheels[i].tyreMats[sharp ? 0 : 1];
        }
      }
      // blur discs stay visible (opacity 0 at rest) so their shader is compiled with the car, not at launch
      // lights ease in/out (incandescent-ish)
      brakeK += ((brakeOn ? 1 : 0) - brakeK) * Math.min(1, dt * 25);
      level(tailMats, 0.3 + brakeK * 1.3);
      nitroK += ((nitroOn ? 1 : 0) - nitroK) * Math.min(1, dt * 12);
      if (glowPt) {
        const nb = nitroK * (5 + Math.sin(time * 60) * 1.2);
        glowPt.intensity = brakeK * 2.2 + nb;
        glowPt.color.setRGB(1 * brakeK * 2.2 + 0.29 * nb, 0.13 * brakeK * 2.2 + 0.49 * nb, 0.06 * brakeK * 2.2 + 1 * nb).multiplyScalar(1 / Math.max(1e-3, brakeK * 2.2 + nb));
      }
      addons.update?.(dt, { time, rpm, nitro: nitroK });
      paragon?.update?.(dt);
      if (chute && addons.chuteAttach) {
        build.body.localToWorld(chuteAt.copy(addons.chuteAttach));
        root.worldToLocal(chuteAt);
        chute.update(dt, chuteAt);
      }
      void headOn;
    },
    dispose() {
      livery?.dispose?.();
      paragon?.dispose?.();
      addons.dispose?.();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (m.geometry && !isShared(m.geometry)) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) if (!isShared(x)) x.dispose();
      });
      res.release();
      glowPt?.dispose();
      headSpot?.dispose();
      root.removeFromParent();
    },
  };
  const tmpInv = new THREE.Matrix4();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.receiveShadow = true;
    if (m.name === 'blur' || m.name === 'calLogo' || (m.material as THREE.Material).transparent) m.castShadow = false;
  });
  return car;
}
