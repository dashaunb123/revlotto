// Spring chains for hair, braids, beards and scarves: each joint is a damped angular spring that lags
// the parent's acceleration and bends in the wind, with a phase delay down the chain so it whips.
import * as THREE from 'three';

export interface ChainOpts {
  stiffness?: number; // spring k (1/s^2)
  damping?: number;
  inertia?: number; // how hard parent acceleration swings it
  /** Phase lag per joint (rad) for wind turbulence; bigger = more travelling-wave whip. */
  lag?: number;
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Chain {
  readonly joints: THREE.Group[] = [];
  private rest: [number, number][] = [];
  private o: number[][] = []; // [rx, rz, vx, vz]
  private prev = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private acc = new THREE.Vector3();
  private primed = false;
  /** Wind bend of the root joint (rad): y = about X (+ swings a hanging chain toward -Z), x = about Z (+ toward +X). */
  wind = new THREE.Vector2();
  /** 0..1 turbulence on top of the wind. */
  gust = 0;
  /** Gust frequency (Hz-ish). */
  freq = 2.2;
  readonly k: number;
  readonly c: number;
  readonly g: number;
  readonly lag: number;

  constructor(
    readonly parent: THREE.Object3D,
    o: ChainOpts = {},
  ) {
    this.k = o.stiffness ?? 90;
    this.c = o.damping ?? 9;
    this.g = o.inertia ?? 0.06;
    this.lag = o.lag ?? 0.7;
  }

  /** Adds a joint at `offset` from the previous joint (or the parent), with a rest bend (rx, rz). */
  add(offset: THREE.Vector3Like, rx = 0, rz = 0, ry = 0): THREE.Group {
    const j = new THREE.Group();
    j.position.copy(offset as THREE.Vector3);
    j.rotation.set(rx, ry, rz);
    (this.joints[this.joints.length - 1] ?? this.parent).add(j);
    this.joints.push(j);
    this.rest.push([rx, rz]);
    this.o.push([0, 0, 0, 0]);
    return j;
  }

  update(dt: number, t: number) {
    if (dt <= 0) return;
    const d = Math.min(dt, 1 / 30);
    this.parent.getWorldPosition(_p);
    if (!this.primed) this.prev.copy(_p), (this.primed = true);
    const v = _p.clone().sub(this.prev).divideScalar(d);
    this.acc.copy(v).sub(this.vel).divideScalar(d).clampLength(0, 25);
    this.vel.copy(v);
    this.prev.copy(_p);
    // Acceleration into the parent's local frame.
    this.parent.getWorldQuaternion(_q);
    const a = this.acc.applyQuaternion(_q.invert());
    const n = this.joints.length;
    for (let i = 0; i < n; i++) {
      const s = this.o[i];
      // The root joint takes the wind's bend; the rest stay straight-ish and carry a travelling ripple.
      const ph = t * this.freq * Math.PI * 2 - i * this.lag;
      const amp = this.gust * (0.12 + 0.3 * (i / n));
      const tx = (i === 0 ? this.wind.y : 0) + amp * (Math.sin(ph) + 0.4 * Math.sin(ph * 2.3 + 1.7));
      const tz = (i === 0 ? this.wind.x : 0) + amp * 0.7 * Math.sin(ph * 1.3 + 0.5);
      const fx = a.z * this.g, fz = -a.x * this.g;
      s[2] += (this.k * (tx - s[0]) - this.c * s[2] + fx * this.k * 0.05) * d;
      s[3] += (this.k * (tz - s[1]) - this.c * s[3] + fz * this.k * 0.05) * d;
      s[0] += s[2] * d;
      s[1] += s[3] * d;
      const lim = i === 0 ? 2 : 1.2;
      s[0] = THREE.MathUtils.clamp(s[0], -lim, lim);
      s[1] = THREE.MathUtils.clamp(s[1], -lim, lim);
      this.joints[i].rotation.x = this.rest[i][0] + s[0];
      this.joints[i].rotation.z = this.rest[i][1] + s[1];
    }
  }
}
