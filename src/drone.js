/* The flight: one drone that travels the page with the reader, over a contour
   map that streams underneath. Lives in a fixed canvas behind every act.
   Features: take-off intro, cursor follow + propwash on the hero name, click to
   flip, LiDAR beam on scan events, speed streaks + FOV kick, point-cloud peak. */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, MeshStandardMaterial, MeshPhysicalMaterial,
  MeshBasicMaterial, CylinderGeometry, BoxGeometry, SphereGeometry, PlaneGeometry, ConeGeometry, ShaderMaterial,
  HemisphereLight, DirectionalLight, PMREMGenerator, Color, MathUtils, DoubleSide, SRGBColorSpace,
  ACESFilmicToneMapping, AdditiveBlending, Vector3
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const canvas = document.getElementById('flight');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;
const endBoot = () => root.classList.remove('booting');

let renderer;
try {
  renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) { canvas.remove(); endBoot(); throw e; }
renderer.setPixelRatio(Math.min(matchMedia('(pointer: coarse)').matches ? 1.25 : 1.75, devicePixelRatio || 1));
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new Scene();
const pmrem = new PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new PerspectiveCamera(35, 1, 0.1, 400);
camera.rotation.x = -0.2;
scene.add(camera);
scene.add(new HemisphereLight(0xcfe0ff, 0x1a1410, 0.6));
const key = new DirectionalLight(0xffffff, 2.2); key.position.set(4, 6, 3); camera.add(key);
const rim = new DirectionalLight(0x9cc4ff, 2.4); rim.position.set(-3, 2, -8); camera.add(rim);
const warm = new DirectionalLight(0xff8a4a, 0.9); warm.position.set(3, -2, -2); camera.add(warm);

/* ---------- terrain ---------- */
const U = {
  uOff: { value: 0 }, uCol: { value: new Color('#7f8c99') }, uAcc: { value: new Color('#ff6a2b') },
  uPath: { value: 0 }, uVel: { value: 0 }, uPts: { value: 0 }, uReveal: { value: 999 }
};
const terrainMat = new ShaderMaterial({
  transparent: true, depthWrite: false, uniforms: U,
  vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `
    uniform float uOff, uPath, uVel, uPts, uReveal; uniform vec3 uCol, uAcc; varying vec3 vW;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
    float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
    void main(){
      vec2 q = vec2(vW.x, vW.z - uOff);
      float h = fbm(q * 0.075) * 9.0;
      float f = fract(h), w = fwidth(h);
      float line = 1.0 - smoothstep(0.0, w * 1.4, min(f, 1.0 - f));
      float major = 1.0 - step(0.5, abs(mod(floor(h + 0.5), 4.0)));
      float d = length(vW.xz);
      float fog = exp(-d * 0.028) * smoothstep(2.0, 9.0, d);
      float a = line * (0.26 + major * 0.2) * fog;
      vec3 col = uCol;
      // LiDAR point cloud (peak)
      vec2 g = fract(q * 1.25) - 0.5;
      float dotm = 1.0 - smoothstep(0.07, 0.12, length(g));
      float band = fract(h * 0.5);
      float dotA = dotm * (0.25 + 0.55 * band) * fog * 1.4;
      vec3 dotC = mix(uCol * 1.4, uAcc, step(0.82, band));
      a = mix(a, dotA, uPts); col = mix(col, dotC, uPts);
      // speed streaks
      float lane = abs(fract(vW.x * 0.35) - 0.5);
      float dash = step(0.72, fract((vW.z - uOff * 1.7) * 0.045 + hash(vec2(floor(vW.x * 0.35), 3.0)) * 7.0));
      float streak = (1.0 - smoothstep(0.0, 0.015, lane)) * dash * uVel * fog * 0.9;
      a += streak; col = mix(col, vec3(0.92), clamp(streak / max(a, 1e-3), 0.0, 1.0) * 0.6);
      // route
      float route = (1.0 - smoothstep(0.0, 0.06, abs(vW.x - uPath))) * step(0.5, fract((vW.z - uOff) * 0.25)) * fog * 0.32 * smoothstep(12.0, 22.0, d);
      // take-off ripple
      float ring = (1.0 - smoothstep(0.0, 1.6, abs(d - uReveal))) * 0.7 * step(uReveal, 150.0) * exp(-d * 0.02);
      a *= smoothstep(uReveal + 0.5, uReveal - 3.0, d);
      vec3 outC = mix(col, uAcc, clamp((route + ring) / max(a + route + ring, 1e-3), 0.0, 1.0));
      gl_FragColor = vec4(outC, clamp(a + route + ring, 0.0, 1.0));
    }`
});
const terrain = new Mesh(new PlaneGeometry(260, 260, 1, 1), terrainMat);
terrain.rotation.x = -Math.PI / 2; terrain.position.set(0, -3.4, -110);
scene.add(terrain);

/* ---------- the drone ---------- */
const graphite = new MeshPhysicalMaterial({ color: 0x2b3038, metalness: 0.55, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25 });
const darker = new MeshStandardMaterial({ color: 0x15181d, metalness: 0.4, roughness: 0.5 });
const accent = new MeshStandardMaterial({ color: 0xff6a2b, metalness: 0.2, roughness: 0.4, emissive: 0xff6a2b, emissiveIntensity: 0.15 });
const glass = new MeshPhysicalMaterial({ color: 0x05070a, metalness: 0.1, roughness: 0.05, clearcoat: 1 });
const propMat = new MeshStandardMaterial({ color: 0x0e1014, metalness: 0.2, roughness: 0.6 });
const blurMat = new MeshBasicMaterial({ color: 0xc9d4e0, transparent: true, opacity: 0.07, side: DoubleSide, depthWrite: false });
const ledW = new MeshBasicMaterial({ color: 0xf2f6ff });
const ledA = new MeshBasicMaterial({ color: 0xff6a2b });
const beamMat = new MeshBasicMaterial({ color: 0xff6a2b, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });

const drone = new Group(), props = [];
drone.add(new Mesh(new RoundedBoxGeometry(1.0, 0.22, 1.25, 3, 0.05), graphite));
const shell = new Mesh(new RoundedBoxGeometry(0.7, 0.12, 0.86, 3, 0.04), darker); shell.position.set(0, 0.16, 0.02); drone.add(shell);
const stripe = new Mesh(new BoxGeometry(0.08, 0.02, 0.78), accent); stripe.position.set(0, 0.225, 0.02); drone.add(stripe);
const sensor = new Mesh(new RoundedBoxGeometry(0.56, 0.13, 0.14, 3, 0.05), glass); sensor.position.set(0, -0.01, -0.64); drone.add(sensor);
const beam = new Mesh(new ConeGeometry(1.6, 3.4, 32, 1, true), beamMat);
beam.position.set(0, -1.75, -0.9); beam.rotation.x = 0.35; drone.add(beam);
[[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], i) => {
  const cx = sx * 1.02, cz = sz * 1.0, len = Math.hypot(cx, cz) - 0.35;
  const arm = new Mesh(new CylinderGeometry(0.055, 0.075, len, 12), graphite);
  arm.rotation.z = Math.PI / 2; const holder = new Group(); holder.add(arm);
  arm.position.x = len / 2 + 0.3; holder.rotation.y = -Math.atan2(cz, cx); holder.position.y = 0.04; drone.add(holder);
  const motor = new Mesh(new CylinderGeometry(0.15, 0.17, 0.2, 24), darker); motor.position.set(cx, 0.1, cz); drone.add(motor);
  const cap = new Mesh(new CylinderGeometry(0.06, 0.06, 0.06, 16), accent); cap.position.set(cx, 0.235, cz); drone.add(cap);
  const prop = new Group(); prop.position.set(cx, 0.25, cz);
  prop.add(new Mesh(new BoxGeometry(1.05, 0.012, 0.085), propMat));
  prop.add(new Mesh(new CylinderGeometry(0.54, 0.54, 0.004, 40), blurMat));
  prop.userData.dir = (i === 0 || i === 3) ? 1 : -1; props.push(prop); drone.add(prop);
  const led = new Mesh(new SphereGeometry(0.045, 12, 8), sz < 0 ? ledW : ledA); led.position.set(cx, -0.03, cz); drone.add(led);
});
[-0.36, 0.36].forEach((x) => {
  const leg = new Mesh(new CylinderGeometry(0.025, 0.025, 0.32, 8), darker); leg.position.set(x, -0.3, 0); drone.add(leg);
  const skid = new Mesh(new CylinderGeometry(0.028, 0.028, 1.1, 8), darker); skid.rotation.x = Math.PI / 2; skid.position.set(x * 1.15, -0.46, 0); drone.add(skid);
});
const rig = new Group(); rig.add(drone); rig.rotation.order = 'YXZ'; camera.add(rig);

/* ---------- flight plan: x, y (viewport -1..1, mirrored in RTL), z distance, yaw (turns) ---------- */
const acts = [].slice.call(document.querySelectorAll('[data-fly-act]'));
function plan() {
  const ph = innerWidth < 760 || (innerHeight > innerWidth && innerWidth <= 1100); // phones and portrait tablets
  return [
    /* hero      */ ph ? [0.6, 0.78, -15, -0.15] : [-0.42, 0.4, -6.4, 0.18],
    /* who       */ ph ? [0.5, 0.74, -12, 0.3] : [-0.62, -0.42, -9, 0.3],
    /* record    */ ph ? [-0.45, 0.74, -12, -0.2] : [-0.74, 0.62, -12, -0.25],
    /* studios   */ ph ? [0.4, 0.74, -12, 0.1] : [0.6, 0.62, -11, 0.15],
    /* quiet     */ ph ? [0.0, -0.55, -14, 0.0] : [0.0, -0.58, -14, 0.0],
    /* peak in   */ [0.0, 0.1, -40, 0.0],
    /* A2RL pass */ ph ? [0.1, -0.05, -2.6, 0.06] : [0.12, -0.08, -2.3, 0.08],
    /* A2RL hold */ ph ? [0.5, 0.62, -8, 0.4] : [0.6, 0.5, -6.5, 0.45],
    /* 42        */ ph ? [-0.4, 0.6, -9, -0.35] : [0.55, 0.12, -6, 0.85],
    /* G4C       */ ph ? [0.45, 0.66, -10, 0.2] : [0.3, 0.55, -9, -0.25],
    /* STAM      */ ph ? [-0.3, 0.6, -9, -0.15] : [0.62, 0.38, -6.8, 0.3],
    /* close     */ ph ? [-0.62, 0.3, -18, 0.3] : [-0.4, 0.55, -10, 0.3],
  ];
}
let stops = [], segs = [], seg = -1, P = plan(), vh = innerHeight;
const topOf = (el) => el.getBoundingClientRect().top + scrollY;
function layout() {
  vh = innerHeight; const maxS = Math.max(1, document.documentElement.scrollHeight - vh);
  const a = acts.map(topOf), peak = acts[5], travel = Math.max(1, peak.offsetHeight - vh);
  const s = [0, a[1] - vh * 0.5, a[2] - vh * 0.4, a[3] - vh * 0.4, a[4] - vh * 0.3,
    a[5] + travel * 0.0, a[5] + travel * 0.12, a[5] + travel * 0.24, a[5] + travel * 0.42,
    a[5] + travel * 0.64, a[5] + travel * 0.86, maxS];
  segs = [0.30, 0.52, 0.74].map((f) => a[5] + travel * f);
  for (let i = 1; i < s.length; i++) s[i] = Math.max(s[i], s[i - 1] + 1);
  stops = s; P = plan();
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  cacheChars();
}
const ease = (t) => t * t * (3 - 2 * t);
const sstep = (a, b, x) => ease(MathUtils.clamp((x - a) / (b - a), 0, 1));
function target(y) {
  if (reduce) { const c = y + vh * 0.5; let k = 0; acts.forEach((el, i) => { if (topOf(el) <= c) k = i; }); return P[[0, 1, 2, 3, 4, 7, 11][k]].slice(); }
  for (let i = 0; i < stops.length - 1; i++) if (y <= stops[i + 1]) {
    const t = ease(Math.max(0, (y - stops[i]) / (stops[i + 1] - stops[i])));
    return P[i].map((v, j) => v + (P[i + 1][j] - v) * t);
  }
  return P[P.length - 1].slice();
}

/* ---------- intro: take-off ---------- */
const booting = root.classList.contains('booting') && !reduce && scrollY < 10;
const t0 = performance.now(), INTRO = 2400;
if (!booting) endBoot(); else setTimeout(endBoot, 420);

/* ---------- pointer, flip, scan ---------- */
let mx = 0, my = 0, tmx = 0, tmy = 0, flipT = -1, beamPulse = 0, hoverDrone = false;
const scr = { x: -999, y: -999, w: 0 };
const near = (x, y) => Math.hypot(x - scr.x, y - scr.y) < scr.w * 0.5;
if (!reduce) {
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') { tmx = e.clientX / innerWidth * 2 - 1; tmy = e.clientY / innerHeight * 2 - 1; }
    const h = near(e.clientX, e.clientY);
    if (h !== hoverDrone) { hoverDrone = h; document.body.style.cursor = h ? 'pointer' : ''; }
  }, { passive: true });
  addEventListener('pointerdown', (e) => {
    if (e.target.closest('a,button')) return;
    if (near(e.clientX, e.clientY)) { if (flipT < 0) flipT = 0; return; }
    if (e.pointerType !== 'mouse' && scrollY < (stops[1] || vh)) { tmx = e.clientX / innerWidth * 2 - 1; tmy = e.clientY / innerHeight * 2 - 1; }
  });
}
addEventListener('drone:scan', () => { beamPulse = 1; });

/* ---------- propwash on the hero name ---------- */
let f60 = 1; const kf = (k) => 1 - Math.pow(1 - k, f60);
let chars = [];
function cacheChars() {
  chars = [].slice.call(document.querySelectorAll('#heroName .ch')).map((el) => ({ el, inner: el.firstElementChild, x: 0, y: 0, r: 0, vx: 0, vy: 0, vr: 0 }));
}
addEventListener('namesplit', cacheChars);
function propwash(strength) {
  if (reduce || !chars.length) return;
  const R = scr.w * 0.8, wx = scr.x, wy = scr.y + scr.w * 0.22;
  for (const c of chars) {
    let tx = 0, ty = 0, tr = 0;
    if (strength > 0.01) {
      const b = c.el.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height * 0.3;
      const dx = cx - wx, dy = cy - wy;
      if (dy > -R * 0.35) {
        const f = Math.exp(-(dx * dx) / (R * R) * 1.3 - (dy * dy) / (R * R * 2.2)) * strength;
        tx = Math.sign(dx) * f * R * 0.07 + dx * f * 0.04; ty = f * R * 0.13; tr = Math.sign(dx) * f * 4.5;
      }
    }
    for (let n = Math.max(1, Math.round(f60)); n--;) { // fixed 60Hz substeps
      c.vx += (tx - c.x) * 0.14; c.vy += (ty - c.y) * 0.14; c.vr += (tr - c.r) * 0.14;
      c.vx *= 0.76; c.vy *= 0.76; c.vr *= 0.76; c.x += c.vx; c.y += c.vy; c.r += c.vr;
    }
    c.inner.style.transform = (Math.abs(c.x) + Math.abs(c.y) + Math.abs(c.r) < 0.05) ? '' :
      'translate(' + c.x.toFixed(2) + 'px,' + c.y.toFixed(2) + 'px) rotate(' + c.r.toFixed(2) + 'deg)';
  }
}

/* ---------- loop ---------- */
const v3 = new Vector3();
let cur = null, lastY = scrollY, vel = 0, off = 0, pts = 0, running = true, lastT = 0;
// Every smoothing step is scaled to elapsed time, so slow devices fly the same path.
function frame(t) {
  if (running) requestAnimationFrame(frame);
  f60 = lastT ? MathUtils.clamp((t - lastT) / 16.667, 0.25, 6) : 1; lastT = t;
  const y = scrollY, rtl = root.dir === 'rtl';
  const tg = target(y); if (rtl) { tg[0] = -tg[0]; tg[3] = -tg[3]; }

  // hero: the drone follows the pointer, fading out as the hero scrolls away
  const heroW = 1 - sstep(0, stops[1] || vh, y);
  mx += (tmx - mx) * kf(0.06); my += (tmy - my) * kf(0.06);
  tg[0] += mx * 0.5 * heroW; tg[1] += -my * 0.3 * heroW; tg[3] += mx * 0.08 * heroW;

  // intro: rise from below with the props spinning up, map rippling outward
  const it = booting ? MathUtils.clamp((t - t0 - 150) / INTRO, 0, 1) : 1, ie = 1 - Math.pow(1 - it, 3);
  if (it < 1) { tg[1] = MathUtils.lerp(-1.6, tg[1], ie); tg[2] = MathUtils.lerp(-3.8, tg[2], ie); tg[3] += (1 - ie) * 0.6; }
  U.uReveal.value = it < 1 ? 2 + ease(it) * 150 : 999;

  if (!cur) cur = tg.slice();
  const prev = cur.slice(), k = reduce ? 1 : kf(it < 1 ? 0.2 : 0.075);
  for (let j = 0; j < 4; j++) cur[j] += (tg[j] - cur[j]) * k;
  vel += ((y - lastY) / vh / f60 - vel) * kf(0.1); lastY = y;
  off += ((y / vh) * 9 - off) * (reduce ? 1 : kf(0.08));

  camera.fov = 35 + (reduce ? 0 : Math.min(Math.abs(vel) * 70, 9)); camera.updateProjectionMatrix();
  const halfH = Math.tan(MathUtils.degToRad(camera.fov / 2)) * -cur[2];
  const bob = reduce ? 0 : Math.sin(t / 900) * 0.05;
  rig.position.set(cur[0] * halfH * camera.aspect, cur[1] * halfH + bob, cur[2]);
  const dx = (cur[0] - prev[0]) / f60, dy = (cur[1] - prev[1]) / f60;
  rig.rotation.y = cur[3] * Math.PI;
  rig.rotation.x = 0.28 + MathUtils.clamp(-vel * 3 + dy * -6, -0.35, 0.35);
  let roll = MathUtils.clamp(-dx * 14, -0.45, 0.45);
  if (flipT >= 0) {
    flipT += f60 / 48; const f = MathUtils.clamp(flipT, 0, 1);
    roll += Math.PI * 2 * (f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2);
    rig.position.y += Math.sin(f * Math.PI) * 0.6; if (flipT >= 1) flipT = -1;
  }
  rig.rotation.z = roll;

  const spin = reduce ? 0 : (0.15 + 0.85 * ease(Math.min(1, it * 2.5))) * (0.9 + Math.abs(vel) * 6);
  props.forEach((p) => { p.rotation.y += spin * f60 * p.userData.dir; });
  const blink = it < 1 ? (Math.sin(t / 70) > 0 ? 1 : 0.2) : 1;
  ledA.color.setRGB(blink, 0.42 * blink, 0.17 * blink);

  // peak: the map becomes a LiDAR point cloud
  // point cloud for A2RL (no cameras) and again for STAM (data)
  const ptsT = reduce ? ((y >= stops[5] && y < segs[0]) || (y >= segs[2] && y < stops[11] - vh * 0.6) ? 1 : 0)
    : sstep(stops[5], stops[6], y) * (1 - sstep(segs[0] - vh * 0.3, segs[0], y))
      + sstep(segs[2], segs[2] + vh * 0.4, y) * (1 - sstep(stops[10], stops[11], y));
  // a new project in the reel: fire the LiDAR beam
  const sg = y < stops[5] || y > stops[11] - vh * 0.5 ? -1 : segs.filter((v) => y >= v).length;
  if (sg !== seg) { if (sg >= 0) beamPulse = 1; seg = sg; }
  pts += (ptsT - pts) * (reduce ? 1 : kf(0.08));
  beamPulse *= Math.pow(0.955, f60);
  beamMat.opacity = 0.085 * beamPulse + pts * 0.035;
  U.uPts.value = pts;
  U.uVel.value = reduce ? 0 : MathUtils.clamp(Math.abs(vel) * 9 - 0.05, 0, 1);
  U.uOff.value = off;
  U.uPath.value = rig.position.x * 6;

  // screen position of the drone, for propwash and hit-testing
  rig.getWorldPosition(v3); v3.project(camera);
  scr.x = (v3.x + 1) / 2 * innerWidth; scr.y = (1 - v3.y) / 2 * innerHeight;
  scr.w = 2.6 * (innerHeight / 2 / Math.tan(MathUtils.degToRad(camera.fov / 2))) / -cur[2];
  const moving = Math.min(Math.hypot(dx, dy) * 70, 0.6) + Math.min(Math.abs(vel) * 8, 0.3);
  propwash(Math.min(0.9, heroW * ie * (0.1 + moving)) * (innerWidth < 760 ? 0.5 : 1));

  renderer.render(scene, camera);
}
addEventListener('resize', layout);
document.addEventListener('visibilitychange', () => { const was = running; running = !document.hidden; if (running && !was) requestAnimationFrame(frame); });
(document.fonts ? document.fonts.ready : Promise.resolve()).then(layout);
layout(); requestAnimationFrame(frame);
root.classList.add('has-flight');
