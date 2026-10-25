// A plain box body with correct anchors so the rest of the pipeline works before the real models land.
import * as THREE from 'three';
import type { BodyBuild, CarSpec } from '../../types';

export function placeholderBody(spec: CarSpec, s: { length: number; width: number; height: number }): BodyBuild {
  const body = new THREE.Group();
  const wheelR = 0.33;
  const mat = new THREE.MeshPhysicalMaterial({ color: spec.paint, metalness: 0.5, roughness: 0.3, clearcoat: 1 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(s.length, s.height - wheelR, s.width), mat);
  box.position.y = wheelR + (s.height - wheelR) / 2;
  body.add(box);
  const wb = s.length * 0.6;
  const tr = s.width * 0.85;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  return {
    body,
    dims: { length: s.length, width: s.width, height: s.height, wheelbase: wb, trackF: tr, trackR: tr, wheelR, rideHeight: 0.15 },
    anchors: {
      wheelFL: v(wb / 2, wheelR, tr / 2), wheelFR: v(wb / 2, wheelR, -tr / 2),
      wheelRL: v(-wb / 2, wheelR, tr / 2), wheelRR: v(-wb / 2, wheelR, -tr / 2),
      exhausts: [{ pos: v(-s.length / 2, 0.35, -0.4), dir: v(-1, 0, 0) }],
      hood: v(s.length * 0.3, s.height * 0.8, 0), roof: v(-0.1, s.height, 0), deck: v(-s.length * 0.42, s.height * 0.8, 0),
      frontBumper: v(s.length / 2, 0.35, 0), seat: v(-0.2, s.height * 0.85, 0.35),
      headlights: [v(s.length / 2, 0.7, 0.6), v(s.length / 2, 0.7, -0.6)],
      taillights: [v(-s.length / 2, 0.8, 0.6), v(-s.length / 2, 0.8, -0.6)],
    },
    paintMeshes: [box],
  };
}
