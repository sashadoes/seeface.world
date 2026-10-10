// Light and effects, to make the labyrinth look like a moving artwork:
//   · glow (bloom): everything bright bleeds soft light, like film
//   · the vibe (vibes.ts): colour grade, scanlines, tape band, lens, grain;
//     in "signal" vibes the picture tears and snows near the dark king and
//     drops out on its own now and then
//   · light shafts falling from the ceiling lights (god rays)
//   · dust motes sparkling in the air around you
//   · a light trail behind you as you walk, tinted by where you are
//   · aurora ribbons waving in the sky (the open, the hall, the ship)
// Off on "low" quality or when "glow & effects" is switched off in settings.
import * as THREE from "three";
import { profile } from "./tiers";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { CELL, WALL_H, hasPanel } from "./maze";
import type { Vibe } from "./vibes";

const FilmShader = {
  uniforms: {
    tDiffuse: { value: null }, time: { value: 0 }, amount: { value: 1 }, signal: { value: 0 }, res: { value: new THREE.Vector2(1280, 720) },
    // the vibe (see vibes.ts)
    mono: { value: 0 }, tint: { value: new THREE.Vector3(1, 1, 1) }, contrast: { value: 1 }, split: { value: 0 }, lift: { value: 0 },
    scan: { value: 0 }, bandAmt: { value: 0 }, chroma: { value: 0 }, grain: { value: 0.045 }, vig: { value: 0.9 }, fisheye: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform float amount; uniform float signal; uniform vec2 res; varying vec2 vUv;
    uniform float mono; uniform vec3 tint; uniform float contrast; uniform float split; uniform float lift;
    uniform float scan; uniform float bandAmt; uniform float chroma; uniform float grain; uniform float vig; uniform float fisheye;
    float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    float hash(float n){ return fract(sin(n) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      // a camera lens bulge (cctv)
      vec2 fc = uv - 0.5;
      uv = 0.5 + fc * (1.0 - fisheye * 0.3 + fisheye * dot(fc, fc));
      // lost signal: a tracking band rolls slowly down the picture, and when the
      // signal breaks (signal > 0) whole lines tear sideways
      float band = bandAmt * smoothstep(0.0, 0.06, abs(fract(uv.y - time * 0.045) - 0.5) - 0.44);
      float line = floor(uv.y * res.y / 3.0);
      float tear = (hash(line + floor(time * 24.0)) - 0.5) * signal * signal * 0.09 * step(0.55, hash(floor(uv.y * 14.0) + floor(time * 9.0)));
      uv.x += band * 0.004 * sin(uv.y * 300.0 + time * 40.0) + tear;
      vec2 c = uv - 0.5;
      float d = dot(c, c);
      // chromatic aberration grows towards the edges (and with a bad signal)
      vec2 off = c * d * 0.018 * amount + vec2(chroma + signal * 0.006, 0.0) * amount;
      vec3 col = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
      // colour grade
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l), mono * amount) * mix(vec3(1.0), tint, amount);
      col = mix(col, (col - 0.5) * contrast + 0.5, amount);
      col = mix(col, col * mix(vec3(0.72, 0.95, 1.05), vec3(1.12, 0.88, 1.02), clamp(l * 1.4, 0.0, 1.0)), split * amount);
      col = col * (1.0 - lift * amount) + vec3(0.95, 0.86, 1.0) * lift * amount;
      // scanlines
      col *= 1.0 - scan * amount * step(0.5, fract(vUv.y * res.y / 3.0));
      // the band is brighter and noisier
      col += band * (rand(vUv * 1.7) - 0.3) * 0.08 * amount;
      // grain, snow when the signal breaks
      float n = rand(vUv);
      col += (n - 0.5) * (grain + signal * 0.35) * amount;
      col = mix(col, vec3(n), clamp(signal - 0.75, 0.0, 1.0) * 1.6 * amount);
      // vignette (and black outside the lens)
      col *= 1.0 - d * vig * amount;
      col *= step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

function dot(inner = "rgba(255,255,255,1)") {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, inner);
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export function createFx(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, vibe: Vibe) {
  // ---------------- post-processing
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.55, 0.45, 0.72);
  composer.addPass(bloom);
  bloom.strength = vibe.bloom;
  const film = new ShaderPass(FilmShader);
  const u = film.uniforms;
  u.mono.value = vibe.mono;
  u.tint.value.set(...vibe.tint);
  u.contrast.value = vibe.contrast;
  u.split.value = vibe.split;
  u.lift.value = vibe.lift;
  u.scan.value = vibe.scan;
  u.bandAmt.value = vibe.band;
  u.chroma.value = vibe.chroma;
  u.grain.value = vibe.grain;
  u.vig.value = vibe.vignette;
  u.fisheye.value = vibe.fisheye;
  composer.addPass(film);
  composer.addPass(new OutputPass());
  let enabled = true;
  // signal: 0 = clean tape. It breaks near the dark king and drops out now and then
  let danger = 0, dropT = 0, nextDrop = 20 + Math.random() * 40;

  // ---------------- in-world light play
  const group = new THREE.Group();
  scene.add(group);
  const soft = dot();

  // dust motes around you
  const MOTES = 260;
  const mp = new Float32Array(MOTES * 3);
  for (let k = 0; k < MOTES; k++) mp.set([(Math.random() - 0.5) * 16, Math.random() * WALL_H, (Math.random() - 0.5) * 16], k * 3);
  const mg = new THREE.BufferGeometry();
  mg.setAttribute("position", new THREE.BufferAttribute(mp, 3));
  const motes = new THREE.Points(mg, new THREE.PointsMaterial({ map: soft, size: 0.06, color: 0xfff6e2, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  group.add(motes);

  // god rays from the ceiling lights near you
  const shaftMat = new THREE.MeshBasicMaterial({ color: 0xfff2d8, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const shafts = Array.from({ length: 14 }, () => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.5, WALL_H, 20, 1, true), shaftMat);
    m.position.y = WALL_H / 2;
    m.visible = false;
    group.add(m);
    return m;
  });
  let lastCell = "";

  // your light trail
  const trail = Array.from({ length: 70 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
    s.scale.setScalar(0.35);
    s.userData.life = 0;
    group.add(s);
    return s;
  });
  let trailK = 0, lastDrop = { x: 0, z: 0 };

  // aurora ribbons for the sky places
  const aurora = new THREE.Group();
  const ribbons = Array.from({ length: 3 }, (_, k) => {
    const geo = new THREE.PlaneGeometry(90, 14, 60, 1);
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 128);
    const hue = [150, 280, 190][k];
    grad.addColorStop(0, `hsla(${hue},90%,60%,0)`);
    grad.addColorStop(0.6, `hsla(${hue},90%,60%,0.55)`);
    grad.addColorStop(1, `hsla(${hue + 40},90%,70%,0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 128);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.position.set(0, 34 + k * 6, -20 + k * 14);
    m.rotation.x = -0.3;
    m.userData.base = (geo.getAttribute("position") as THREE.BufferAttribute).array.slice();
    aurora.add(m);
    return m;
  });
  aurora.visible = false;
  group.add(aurora);

  const tint = new THREE.Color();

  return {
    setEnabled(on: boolean) {
      enabled = on;
      group.visible = on;
    },
    setSize(w: number, h: number) {
      composer.setSize(w, h);
      film.uniforms.res.value.set(w, h);
      // phones get a cheaper glow (a third of the screen size)
      const k = matchMedia("(pointer: coarse)").matches ? 3 : 2;
      bloom.resolution.set(w / k, h / k);
    },
    /** how close danger is (0..1): the picture tears and snows */
    setDanger(v: number) {
      danger = v;
    },
    setPixelRatio(pr: number) {
      composer.setPixelRatio(pr);
    },
    update(dt: number, t: number, me: { x: number; z: number; moving: boolean; sky: boolean; zoneTint: number }) {
      if (!enabled) return;
      // the basic set (medium = most phones and laptops): the film look and the
      // motes only; the walls carry the glow themselves (wallpaper.ts). High adds
      // the bloom, the light shafts and your trail.
      const pf = profile();
      bloom.enabled = pf.bloom;
      film.uniforms.time.value = t;
      nextDrop -= dt;
      if (nextDrop <= 0) {
        dropT = 0.25 + Math.random() * 0.5;
        nextDrop = 25 + Math.random() * 50;
      }
      dropT = Math.max(0, dropT - dt);
      if (vibe.signal) film.uniforms.signal.value = Math.min(1, Math.max(danger * 0.7, dropT > 0 ? 0.6 + Math.random() * 0.4 : 0));
      // motes follow you, drifting and twinkling
      motes.position.set(me.x, 0, me.z);
      mg.setDrawRange(0, Math.round(MOTES * profile().particles)); // fewer on lower tiers
      const a = mg.getAttribute("position") as THREE.BufferAttribute;
      const arr = a.array as Float32Array;
      for (let k = 0; k < MOTES; k++) {
        arr[k * 3 + 1] += Math.sin(t * 0.7 + k) * dt * 0.08;
        arr[k * 3] += Math.cos(t * 0.3 + k * 1.7) * dt * 0.05;
        if (arr[k * 3 + 1] > WALL_H) arr[k * 3 + 1] = 0;
        if (arr[k * 3 + 1] < 0) arr[k * 3 + 1] = WALL_H;
      }
      a.needsUpdate = true;
      (motes.material as THREE.PointsMaterial).opacity = 0.4 + Math.sin(t * 2) * 0.15;
      // shafts under the nearest ceiling lights
      const ci = Math.floor(me.x / CELL), cj = Math.floor(me.z / CELL);
      const cell = `${ci}:${cj}`;
      if (cell !== lastCell) {
        lastCell = cell;
        let k = 0;
        for (let r = 0; r <= 4 && k < shafts.length; r++)
          for (let i = ci - r; i <= ci + r && k < shafts.length; i++)
            for (let j = cj - r; j <= cj + r && k < shafts.length; j++) {
              if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || !hasPanel(i, j)) continue;
              shafts[k].position.set((i + 0.5) * CELL, WALL_H / 2, (j + 0.5) * CELL);
              shafts[k].visible = !me.sky && pf.extras;
              k++;
            }
        for (; k < shafts.length; k++) shafts[k].visible = false;
      }
      shaftMat.opacity = 0.055 + Math.sin(t * 0.9) * 0.02;
      // the trail
      tint.setHex(me.zoneTint);
      if (pf.extras && me.moving && Math.hypot(me.x - lastDrop.x, me.z - lastDrop.z) > 0.35) {
        lastDrop = { x: me.x, z: me.z };
        const s = trail[trailK++ % trail.length];
        s.position.set(me.x, 0.25 + Math.random() * 0.2, me.z);
        (s.material as THREE.SpriteMaterial).color.copy(tint).lerp(new THREE.Color(0xffffff), 0.4);
        s.userData.life = 1;
      }
      for (const s of trail) {
        if (s.userData.life <= 0) continue;
        s.userData.life -= dt / 4;
        (s.material as THREE.SpriteMaterial).opacity = Math.max(0, s.userData.life) * 0.7;
        s.position.y += dt * 0.15;
      }
      // aurora over open skies
      aurora.visible = me.sky;
      if (me.sky) {
        aurora.position.set(me.x, 0, me.z);
        ribbons.forEach((m, k) => {
          const p = m.geometry.getAttribute("position") as THREE.BufferAttribute;
          const base = m.userData.base as Float32Array;
          const arr2 = p.array as Float32Array;
          for (let v = 0; v < arr2.length; v += 3) arr2[v + 2] = base[v + 2] + Math.sin(base[v] * 0.08 + t * 0.6 + k) * 4 + Math.sin(base[v] * 0.21 + t * 0.9) * 1.5;
          p.needsUpdate = true;
        });
      }
    },
    render() {
      if (enabled) composer.render();
      else renderer.render(scene, camera);
    },
  };
}
