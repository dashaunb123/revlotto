// Night sky: gradient dome with city light pollution, thin lit clouds, moon, a 360° city skyline with lit
// windows and blinking aviation lights, a tree line, and a star field. The dome follows the camera (skybox),
// so no far-plane requirements.
import * as THREE from 'three';
import type { Ctx } from './ctx';
import * as L from './layout';
import { memo } from './textures';

export const HORIZON = new THREE.Color(0.026, 0.032, 0.052); // linear; fog matches this
export const ZENITH = new THREE.Color(0.0012, 0.0022, 0.0075);
const CITY_U = 0.0; // azimuth (fraction of a turn, 0 = +X) of downtown: beyond the finish line

/** 360° skyline strip: dense downtown around CITY_U, suburbs elsewhere, gaps. RGB = window light, A = building. */
function skyline(w: number, h: number): THREE.CanvasTexture {
  const [c] = memo(`skyline:${w}x${h}`, () => [skylineCanvas(w, h)]);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function skylineCanvas(w: number, h: number): HTMLCanvasElement {
  const r = L.rng(808);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  const dens = (u: number) => {
    const d = Math.min(Math.abs(u - CITY_U), Math.abs(u - CITY_U - 1), Math.abs(u - CITY_U + 1));
    const d2 = Math.min(Math.abs(u - 0.62), Math.abs(u - 0.62 + 1)); // a second smaller cluster
    return Math.max(Math.exp(-(d * d) / 0.004), 0.55 * Math.exp(-(d2 * d2) / 0.002), 0.12);
  };
  let x = 0;
  while (x < w) {
    const u = x / w, k = dens(u);
    const bw = (0.002 + r() * 0.006) * w;
    if (r() > 0.25 + k * 0.75) { x += bw; continue; }
    const bh = h * Math.min(0.98, (0.08 + r() * 0.25) * (0.3 + k * 1.4) * (r() < 0.08 * k ? 2.4 : 1));
    const shade = 3 + r() * 5;
    g.fillStyle = `rgba(${shade | 0},${(shade + 1) | 0},${(shade + 4) | 0},1)`;
    g.fillRect(x, h - bh, bw, bh);
    if (bh > h * 0.45 && r() < 0.5) g.fillRect(x + bw * 0.45, h - bh - h * 0.08, Math.max(1, bw * 0.06), h * 0.08);
    const ww = Math.max(1, bw / 8), wh = Math.max(1, h / 70);
    for (let yy = h - bh + wh * 1.5; yy < h - wh; yy += wh * 2) {
      const lit = r() < 0.3 + k * 0.25;
      if (!lit) continue;
      for (let xx = x + ww * 0.5; xx < x + bw - ww; xx += ww * 1.8) {
        if (r() > 0.45) continue;
        const b = 0.35 + r() * 0.65;
        g.fillStyle = r() > 0.25 ? `rgba(255,${(185 * b) | 0},${(100 * b) | 0},1)` : `rgba(${(150 * b) | 0},${(190 * b) | 0},255,1)`;
        g.globalAlpha = b;
        g.fillRect(xx, yy, ww, wh);
        g.globalAlpha = 1;
      }
    }
    x += bw * (0.8 + r() * 0.3);
  }
  return c;
}

export function skyMaterial(ctx: Ctx, skyTex: THREE.Texture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSky: { value: skyTex }, uNoise: { value: ctx.noise }, uTime: { value: 0 },
      uZen: { value: ZENITH }, uHor: { value: HORIZON }, uGlow: { value: new THREE.Color(0.075, 0.042, 0.03) },
      uMoon: { value: new THREE.Vector3(-0.45, 0.32, -0.83).normalize() },
    },
    vertexShader: `
varying vec3 vDir;
void main() {
  vDir = normalize( ( modelMatrix * vec4( position, 0.0 ) ).xyz );
  vec4 p = projectionMatrix * viewMatrix * vec4( ( modelMatrix * vec4( position, 1.0 ) ).xyz, 1.0 );
  gl_Position = p.xyww;
}`,
    fragmentShader: `
uniform sampler2D uSky; uniform sampler2D uNoise; uniform float uTime;
uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uGlow; uniform vec3 uMoon;
varying vec3 vDir;
#define TAU 6.2831853
void main() {
  vec3 d = normalize( vDir );
  float e = d.y;
  float az = fract( atan( -d.z, d.x ) / TAU + 1.0 );
  float cityD = min( abs( az - ${CITY_U.toFixed(3)} ), 1.0 - abs( az - ${CITY_U.toFixed(3)} ) );
  float city = exp( -cityD * cityD / 0.012 ) + 0.4 * exp( -pow( min( abs( az - 0.62 ), 1.0 - abs( az - 0.62 ) ), 2.0 ) / 0.006 );
  float he = max( e, 0.0 );
  vec3 col = mix( uHor, uZen, pow( smoothstep( 0.0, 0.55, he ), 0.55 ) );
  // sodium light pollution dome
  col += uGlow * ( 0.25 + 0.9 * city ) * exp( -he * ( 9.0 - 3.0 * city ) );
  // thin clouds, lit from below by the city
  vec2 cuv = d.xz / ( he + 0.12 ) * 0.06 + vec2( uTime * 0.0012, uTime * 0.0006 );
  float cl = texture2D( uNoise, cuv ).r * 0.65 + texture2D( uNoise, cuv * 3.1 ).g * 0.35;
  cl = smoothstep( 0.48, 0.78, cl ) * smoothstep( 0.0, 0.08, he ) * ( 1.0 - smoothstep( 0.35, 0.9, he ) );
  col = mix( col, uGlow * ( 0.25 + 0.8 * city ) * 0.8 + vec3( 0.012, 0.016, 0.03 ), cl * 0.6 );
  // moon + halo
  float md = dot( d, uMoon );
  float disc = smoothstep( 0.99985, 0.99992, md );
  float crater = texture2D( uNoise, ( d.xy - uMoon.xy ) * 60.0 ).b;
  col += vec3( 1.0, 0.97, 0.9 ) * disc * ( 2.2 + crater * 0.8 );
  col += vec3( 0.55, 0.6, 0.75 ) * 0.035 * pow( max( md, 0.0 ), 380.0 );
  col += vec3( 0.3, 0.33, 0.42 ) * 0.02 * pow( max( md, 0.0 ), 18.0 );
  // tree line (near ring) and skyline (far)
  float tl = texture2D( uNoise, vec2( az * 18.0, 0.5 ) ).r * 0.6 + texture2D( uNoise, vec2( az * 70.0, 0.3 ) ).b * 0.4;
  float treeH = 0.004 + tl * 0.012;
  float sk = 0.075;
  vec4 s = texture2D( uSky, vec2( az, clamp( e / sk, 0.0, 1.0 ) ) );
  float bld = s.a * step( 0.0, e ) * step( e, sk );
  vec3 bcol = mix( uHor * 0.6, s.rgb * 0.9 * vec3( 1.0, 0.95, 0.9 ), step( 0.02, max( s.r, s.b ) ) );
  col = mix( col, bcol, bld * 0.92 );
  // aviation lights on the tallest towers (blinking)
  float blink = step( 0.6, fract( uTime * 0.5 ) );
  for ( int i = 0; i < 3; i ++ ) {
    float a = 0.012 + float( i ) * 0.017;
    float h = 0.056 - float( i ) * 0.011;
    vec2 q = vec2( ( min( abs( az - a ), 1.0 - abs( az - a ) ) ) * TAU, e - h );
    col += vec3( 2.5, 0.12, 0.05 ) * smoothstep( 0.0016, 0.0, length( q ) ) * ( i == 1 ? 1.0 - blink : blink );
  }
  col = mix( col, uHor * 0.35, step( e, treeH ) * step( -0.02, e ) );
  if ( e < -0.02 ) col = uHor * 0.3;
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    depthWrite: false,
    depthTest: false,
    side: THREE.BackSide,
    fog: false,
  });
}

export function buildSky(ctx: Ctx) {
  const skyTex = ctx.own(skyline(ctx.cfg.tex >= 512 ? 2048 : 1024, ctx.cfg.tex >= 512 ? 128 : 64));
  const mat = ctx.own(skyMaterial(ctx, skyTex));
  const geo = ctx.own(new THREE.SphereGeometry(50, 48, 24));
  const dome = new THREE.Mesh(geo, mat);
  dome.name = 'sky';
  dome.frustumCulled = false;
  dome.renderOrder = -100;
  ctx.group.add(dome);

  // stars (dimmer near the horizon haze), drawn right after the dome
  const r = L.rng(999);
  const n = ctx.cfg.stars;
  const pos = new Float32Array(n * 3), mag = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const y = 0.05 + Math.pow(r(), 0.8) * 0.95, a = r() * Math.PI * 2, rr = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(a) * rr * 45; pos[i * 3 + 1] = y * 45; pos[i * 3 + 2] = Math.sin(a) * rr * 45;
    mag[i] = Math.pow(r(), 6);
  }
  const sg = ctx.own(new THREE.BufferGeometry());
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
  const sm = ctx.own(new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
    vertexShader: `
attribute float mag; uniform float uTime; uniform float uPx; varying float vB;
void main() {
  vec3 d = normalize( position );
  float tw = 0.75 + 0.25 * sin( uTime * ( 2.0 + mag * 9.0 ) + position.x * 7.0 );
  vB = ( 0.05 + mag * 1.3 ) * tw * smoothstep( 0.04, 0.3, d.y );
  gl_PointSize = ( 1.0 + mag * 2.2 ) * uPx;
  vec4 p = projectionMatrix * viewMatrix * vec4( ( modelMatrix * vec4( position, 1.0 ) ).xyz, 1.0 );
  gl_Position = p.xyww;
}`,
    fragmentShader: `
varying float vB;
void main() {
  float r = length( gl_PointCoord - 0.5 );
  float a = smoothstep( 0.5, 0.0, r );
  gl_FragColor = vec4( vec3( 0.85, 0.9, 1.0 ) * vB * a, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  }));
  const stars = new THREE.Points(sg, sm);
  stars.frustumCulled = false;
  stars.renderOrder = -99;
  ctx.group.add(stars);

  const cam = new THREE.Vector3();
  dome.onBeforeRender = (_r, _s, camera) => {
    camera.getWorldPosition(cam);
    // keep the dome / stars centred on the camera (group-local)
    dome.parent!.worldToLocal(dome.position.copy(cam));
    stars.position.copy(dome.position);
    dome.updateMatrixWorld();
    stars.updateMatrixWorld();
  };
  ctx.updaters.push((_dt, t) => {
    mat.uniforms.uTime.value = t;
    sm.uniforms.uTime.value = t;
  });
  return { dome, stars, mat, skyTex, setPixelRatio(p: number) { sm.uniforms.uPx.value = p; } };
}
