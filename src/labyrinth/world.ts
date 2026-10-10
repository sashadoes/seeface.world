// The labyrinth scene (three.js): monogram walls, dark polished floor, low
// ceiling with flickering fluorescent panels, deep fog, and a black glass cube
// floating in every room under its own spotlight. Only the cells around the
// visitor exist at any time; they are rebuilt as you walk (infinite maze).
import * as THREE from "three";
import { CELL, WALL_H, hasPanel, inShip, placeAt, roomCentre, roomOf, wallEast, wallSouth, rnd } from "./maze";
import type { Weather } from "../marks/weather";
import { createRelief } from "./relief";
import { WALL_VARIANTS, textureReady, zoneAt, zoneFloorMaterial, zoneOfCell, zoneWallMaterial, ZONE_CELLS, type ZoneDef } from "./zones";
import { MAX_VIEW, profile } from "./tiers";
import { release } from "./gpu";
import { tickWallpaper } from "./wallpaper";

const MAX_WALLS = (MAX_VIEW * 2 + 2) ** 2 * 2;
const MAX_PANELS = (MAX_VIEW * 2 + 2) ** 2;
// a location's textures that nothing has shown for this long leave the graphics
// chip (the picture stays in memory, so coming back re-uploads it in a blink)
const PARK_AFTER_MS = 20_000;

export type World = {
  scene: THREE.Scene;
  /** Is (x, z) under a working fluorescent panel? (recharges the lantern, scares the Hollow) */
  isLit: (x: number, z: number) => boolean;
  /** Deeper levels: the labyrinth shifts (colour, fog). */
  setDepth: (depth: number) => void;
  /** the zone the visitor is in (for exposure etc.) */
  zone: () => ZoneDef;
  update: (px: number, pz: number, t: number, dt: number) => void;
  setWeather: (w: Weather) => void;
  nearestCube: (px: number, pz: number) => { mesh: THREE.Object3D; dist: number } | null;
  spinCube: (cube: THREE.Object3D) => void;
  /** inside the ship: thin air, far sight */
  setSpace: (on: boolean) => void;
  /** settings: lightning flashes on/off */
  setFlashes: (on: boolean) => void;
  /** hide the ceiling (under the open sky) */
  setCeiling: (on: boolean) => void;
  /** 0–1: how wet the floor is (shiny, reflective) */
  setWet: (w: number) => void;
  /** 0–1: the static fog at the edge of the labyrinth */
  setEdgeFog: (f: number) => void;
  /** location textures currently on the graphics chip / known (perf overlay) */
  zoneInfo: () => { kinds: string[]; resident: number; parked: number };
  /** load these locations' textures now (teleport destination); resolves when they're ready */
  prepare: (x: number, z: number) => Promise<void>;
  /** free every location texture not on screen right now (after a teleport) */
  parkNow: () => void;
};

function digitTexture(d: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#050505";
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(255,255,255,0.12)";
  g.lineWidth = 6;
  g.strokeRect(3, 3, 250, 250);
  g.font = "italic 150px 'Times New Roman', serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = d === "6" ? "#3cff6a" : "#e9e9e9";
  g.shadowColor = d === "6" ? "#3cff6a" : "#ffffff";
  g.shadowBlur = 18;
  g.fillText(d, 128, 136);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createWorld(): World {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0c0b);
  let edgeFog = 0;
  let wet = 0;
  let flashesOn = true;
  let openSky = false; // under the open sky: night instead of the corridor fog
  let space = false; // inside the ship
  scene.fog = new THREE.FogExp2(0x0c0c0b, 0.06);

  // ---------------------------------------------------------------- materials
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x8c8a85, roughness: 0.95 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xf2f5ff, emissiveIntensity: 1.2 });

  // ---------------------------------------------------------------- walls (instanced)
  const wallGeo = new THREE.BoxGeometry(CELL + 0.3, WALL_H, 0.3);
  // map the texture so each wall shows one 2×2 chess tile
  const uv = wallGeo.getAttribute("uv") as THREE.BufferAttribute;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 1, uv.getY(k) * 0.85);
  // walls: one instanced mesh per (location, image variant), created on first use
  const wallMeshes = new Map<string, THREE.InstancedMesh>();
  function wallMesh(zone: ZoneDef, variant: number) {
    const key = `${zone.kind}:${variant}`;
    let m = wallMeshes.get(key);
    if (!m) {
      m = new THREE.InstancedMesh(wallGeo, zoneWallMaterial(zone, variant), MAX_WALLS);
      m.frustumCulled = false;
      m.count = 0;
      m.visible = false;
      scene.add(m);
      wallMeshes.set(key, m);
    }
    return m;
  }

  // floor + ceiling follow the visitor; textures scroll with world position
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 40, CELL * 40), zoneFloorMaterial(zoneAt(0, 0)));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 40, CELL * 40), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = WALL_H;
  scene.add(ceil);

  // ceiling light panels (instanced) + a small pool of real lights on the nearest ones
  const panels = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.6, 1.6), panelMat, MAX_PANELS);
  panels.frustumCulled = false;
  scene.add(panels);
  const panelLights = Array.from({ length: 5 }, () => {
    const l = new THREE.PointLight(0xdfe6ff, 0, 14, 1.3);
    scene.add(l);
    return l;
  });

  // tiles, puddles, rugs, skirting, columns, a stepped ceiling (no collisions)
  const relief = createRelief(scene);

  const ambient = new THREE.AmbientLight(0xb8b6ae, 0.13);
  scene.add(ambient);
  scene.add(new THREE.HemisphereLight(0xdedcd4, 0x1a1a18, 0.16));

  // ---------------------------------------------------------------- cubes in rooms
  const faces = ["1", "2", "3", "4", "5", "6"].map(
    (d) => new THREE.MeshStandardMaterial({ map: digitTexture(d), roughness: 0.18, metalness: 0.55, emissive: 0xffffff, emissiveMap: digitTexture(d), emissiveIntensity: 0.35 })
  );
  const cubeGeo = new THREE.BoxGeometry(1.1, 1.1, 1.1);
  const cubes = Array.from({ length: 4 }, () => {
    const g = new THREE.Group();
    const m = new THREE.Mesh(cubeGeo, faces);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(cubeGeo), new THREE.LineBasicMaterial({ color: 0x000000 }));
    m.add(edges);
    g.add(m);
    const spot = new THREE.SpotLight(0xfff1d6, 18, 12, Math.PI / 7, 0.55, 1.4);
    spot.position.set(0, WALL_H - 0.1, 0);
    spot.target = m;
    g.add(spot);
    const halo = new THREE.PointLight(0xbfd8ff, 2.2, 5, 2);
    halo.position.set(0, 0.2, 0);
    g.add(halo);
    g.userData = { spin: 0, key: "" };
    g.visible = false;
    scene.add(g);
    return g;
  });

  // ---------------------------------------------------------------- weather
  let weather: Weather | null = null;
  let precip: THREE.Points | null = null;
  let precipSpeed = 0;
  let flash = 0;
  let nextBolt = 0;
  const flashLight = new THREE.AmbientLight(0xc8d8ff, 0);
  scene.add(flashLight);

  // soft round drops/flakes (plain points are squares up close)
  const dropTexture = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d")!;
    const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(0.45, "rgba(255,255,255,0.5)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();
  let weatherFog = 0;
  let depthLevel = 0;
  function setWeather(w: Weather) {
    weather = w;
    weatherFog = w.kind === "fog" ? 0.07 : w.kind === "drizzle" || w.kind === "rain" ? 0.02 : w.kind === "storm" ? 0.03 : 0;
    const tint = w.kind === "storm" || w.kind === "rain" ? 0xc9d8ff : w.isDay ? 0xfff0dc : 0xd9e2ff;
    panelMat.emissive.setHex(tint);
    panelLights.forEach((l) => l.color.setHex(tint));
    release(precip);
    precip = null;
    if (["rain", "drizzle", "storm", "snow"].includes(w.kind)) {
      const n = Math.round((w.kind === "snow" ? 900 : w.kind === "drizzle" ? 500 : 1400) * profile().particles);
      const pos = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) pos.set([(Math.random() - 0.5) * 24, Math.random() * WALL_H, (Math.random() - 0.5) * 24], k * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      precip = new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          map: dropTexture,
          color: w.kind === "snow" ? 0xffffff : 0xaac4ff,
          size: w.kind === "snow" ? 0.07 : 0.035,
          transparent: true,
          opacity: w.kind === "snow" ? 0.9 : 0.6,
          depthWrite: false,
        })
      );
      precipSpeed = w.kind === "snow" ? 0.7 : w.kind === "drizzle" ? 4 : 9;
      scene.add(precip);
    }
  }

  // ---------------------------------------------------------------- rebuild around the visitor
  let lastCell = "";
  let currentZone: ZoneDef = zoneAt(0, 0);
  const tmpCol = new THREE.Color();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s1 = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const rotY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const flatQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  let panelSpots: { x: number; z: number; seed: number }[] = [];

  // ---------------------------------------------------------------- location textures
  // Prefetch: the locations just beyond what you can see get their materials
  // (= their pictures start downloading and drawing) before you walk in.
  const prefetched = new Set<string>();
  function warmZone(zone: ZoneDef) {
    for (let v = 0; v < WALL_VARIANTS; v++) zoneWallMaterial(zone, v);
    zoneFloorMaterial(zone);
  }
  function prefetchAround(ci: number, cj: number, view: number) {
    const reach = view + 4; // cells
    for (let a = 0; a < 8; a++) {
      const i = Math.floor(ci + Math.cos((a / 8) * Math.PI * 2) * reach);
      const j = Math.floor(cj + Math.sin((a / 8) * Math.PI * 2) * reach);
      const zone = zoneOfCell(i, j);
      if (prefetched.has(zone.kind)) continue;
      prefetched.add(zone.kind);
      warmZone(zone);
    }
  }
  const mapsOf = (m: THREE.Material) => {
    const s = m as THREE.MeshStandardMaterial;
    return [s.map, s.emissiveMap].filter((t): t is THREE.Texture => !!t);
  };
  const parked = new Set<THREE.Texture>();
  // Unload: free the GPU copy of textures no wall/floor has used for a while
  function park(now: number, after = PARK_AFTER_MS) {
    for (const m of wallMeshes.values()) {
      if (m.visible || now - (m.userData.used ?? 0) < after) continue;
      for (const t of mapsOf(m.material as THREE.Material)) {
        if (parked.has(t)) continue;
        t.dispose(); // three.js uploads it again from the canvas if it's ever drawn
        parked.add(t);
      }
    }
    for (const [kind, used] of floorUsed) {
      if (now - used < after || kind === currentZone.kind) continue;
      for (const t of mapsOf(zoneFloorMaterial(zoneOfKind(kind)!))) {
        if (parked.has(t)) continue;
        t.dispose();
        parked.add(t);
      }
    }
    // anything drawn again is back on the chip
    for (const m of wallMeshes.values()) if (m.visible) for (const t of mapsOf(m.material as THREE.Material)) parked.delete(t);
    for (const t of mapsOf(zoneFloorMaterial(currentZone))) parked.delete(t);
  }
  const floorUsed = new Map<string, number>();
  const kindsSeen = new Map<string, ZoneDef>();
  const zoneOfKind = (k: string) => kindsSeen.get(k);

  function rebuild(ci: number, cj: number) {
    const counts = new Map<THREE.InstancedMesh, number>();
    const putWall = (i: number, j: number, side: number, mat: THREE.Matrix4) => {
      const zone = zoneOfCell(i, j);
      const variant = Math.floor(rnd(i, j, 20 + side) * WALL_VARIANTS);
      const m = wallMesh(zone, variant);
      const n = counts.get(m) ?? 0;
      m.setMatrixAt(n, mat);
      counts.set(m, n + 1);
    };
    let np = 0;
    panelSpots = [];
    const VIEW = profile().view;
    for (let i = ci - VIEW; i <= ci + VIEW; i++) {
      for (let j = cj - VIEW; j <= cj + VIEW; j++) {
        if (wallEast(i, j)) {
          p.set((i + 1) * CELL, WALL_H / 2, (j + 0.5) * CELL);
          putWall(i, j, 0, m4.compose(p, rotY, s1));
        }
        if (wallSouth(i, j)) {
          p.set((i + 0.5) * CELL, WALL_H / 2, (j + 1) * CELL);
          putWall(i, j, 1, m4.compose(p, q.identity(), s1));
        }
        if (hasPanel(i, j)) {
          const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL;
          p.set(x, WALL_H - 0.02, z);
          panels.setMatrixAt(np++, m4.compose(p, flatQ, s1));
          panelSpots.push({ x, z, seed: rnd(i, j, 9) });
        }
      }
    }
    const now = performance.now();
    for (const m of wallMeshes.values()) {
      m.count = counts.get(m) ?? 0;
      // an empty mesh would still bind (and so re-upload) its texture every frame
      m.visible = m.count > 0;
      if (m.visible) m.userData.used = now;
      m.instanceMatrix.needsUpdate = true;
    }
    panels.count = np;
    panels.instanceMatrix.needsUpdate = true;
    relief.rebuild(ci, cj, VIEW);
    prefetchAround(ci, cj, VIEW);
    park(now);

    // cubes: the rooms nearest to the visitor
    const R = 7;
    const I0 = Math.floor(ci / R), J0 = Math.floor(cj / R);
    const rooms: { I: number; J: number; d: number }[] = [];
    for (let I = I0 - 1; I <= I0 + 1; I++)
      for (let J = J0 - 1; J <= J0 + 1; J++) {
        if (placeAt(I, J)) continue; // places have their own things, no cube
        const c = roomCentre(I, J);
        if (inShip(c.x, c.z)) continue; // nor the ship
        rooms.push({ I, J, d: Math.hypot(c.x - (ci + 0.5) * CELL, c.z - (cj + 0.5) * CELL) });
      }
    rooms.sort((a, b) => a.d - b.d);
    cubes.forEach((g, k) => {
      const r = rooms[k];
      if (!r) return (g.visible = false);
      const key = `${r.I}:${r.J}`;
      if (g.userData.key !== key) {
        const c = roomCentre(r.I, r.J);
        g.position.set(c.x, 1.45, c.z);
        g.userData.key = key;
        g.children[0].rotation.set(rnd(r.I, r.J, 3) * 6, rnd(r.I, r.J, 4) * 6, 0);
      }
      g.visible = true;
    });
  }

  // ---------------------------------------------------------------- per frame
  function update(px: number, pz: number, t: number, dt: number) {
    const ci = Math.floor(px / CELL), cj = Math.floor(pz / CELL);
    const key = `${ci}:${cj}`;
    if (key !== lastCell) {
      lastCell = key;
      rebuild(ci, cj);
    }

    tickWallpaper(t, !profile().wallMotion);

    // floor/ceiling stay under the visitor; texture offset keeps the world fixed
    floor.position.set(px, 0, pz);
    ceil.position.set(px, WALL_H, pz);
    const zone = zoneAt(px, pz);
    currentZone = zone;
    const fm = zoneFloorMaterial(zone);
    if (floor.material !== fm) floor.material = fm;
    kindsSeen.set(zone.kind, zone);
    floorUsed.set(zone.kind, performance.now());
    fm.map?.offset.set(px / CELL, -pz / CELL);
    // wet floors turn glossy (each zone keeps its own dry look underneath)
    fm.userData.dry ??= { r: fm.roughness, m: fm.metalness };
    fm.roughness = fm.userData.dry.r + (0.04 - fm.userData.dry.r) * wet;
    fm.metalness = fm.userData.dry.m + (0.55 - fm.userData.dry.m) * wet * 0.6;

    // the atmosphere drifts towards this location's
    const k = Math.min(1, dt * 1.5);
    const fog = scene.fog as THREE.FogExp2;
    fog.color.lerp(tmpCol.setHex(space ? 0x0c1220 : openSky ? 0x060914 : zone.fog), k);
    (scene.background as THREE.Color).copy(fog.color);
    fog.density += ((space ? 0.0045 : openSky ? 0.022 : Math.min(zone.fogDensity + weatherFog + depthLevel * 0.008, 0.16)) + edgeFog * 0.3 - fog.density) * Math.max(k, edgeFog > 0 ? 0.1 : 0);
    ambient.color.lerp(tmpCol.setHex(zone.ambient), k);
    ambient.intensity += (Math.max(zone.ambientIntensity - depthLevel * 0.015, 0.04) - ambient.intensity) * k;
    ceilMat.color.lerp(tmpCol.setHex(zone.ceiling), k);
    panelMat.emissive.lerp(tmpCol.setHex(zone.panel), k);
    panelLights.forEach((l) => l.color.lerp(tmpCol.setHex(zone.panel), k));

    // nearest panels get real (flickering) light
    panelSpots.sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
    panelLights.forEach((l, k) => {
      const s = panelSpots[k];
      if (!s) return (l.intensity = 0);
      l.position.set(s.x, WALL_H - 0.3, s.z);
      const broken = s.seed < 0.25; // some tubes are dying
      const flicker = broken ? (Math.sin(t * 23 + s.seed * 50) > 0.6 || Math.random() < 0.04 ? 0.15 : 1) : 1;
      l.intensity = 9 * flicker;
    });

    // cubes float and turn; a spun cube whirls then settles
    cubes.forEach((g, k) => {
      if (!g.visible) return;
      const m = g.children[0];
      g.userData.spin *= 0.97;
      m.rotation.y += dt * (0.25 + g.userData.spin);
      m.rotation.x += dt * (0.12 + g.userData.spin * 0.6);
      m.position.y = Math.sin(t * 1.1 + k) * 0.12;
    });

    // weather moves with the visitor
    if (precip && weather) {
      precip.position.set(px, 0, pz);
      const a = (precip.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
      const drift = Math.min(weather.wind / 40, 1);
      for (let k = 0; k < a.length; k += 3) {
        a[k + 1] -= precipSpeed * dt;
        a[k] -= drift * dt * (weather.kind === "snow" ? 0.6 : 2);
        if (weather.kind === "snow") a[k] += Math.sin(t + k) * dt * 0.2;
        if (a[k + 1] < 0) {
          a[k + 1] = WALL_H;
          a[k] = (Math.random() - 0.5) * 24;
          a[k + 2] = (Math.random() - 0.5) * 24;
        }
      }
      precip.geometry.getAttribute("position").needsUpdate = true;
    }
    if (weather?.kind === "storm" && t * 1000 > nextBolt) {
      flash = 1;
      nextBolt = t * 1000 + 4000 + Math.random() * 8000;
    }
    flash = Math.max(0, flash - dt * 2.5);
    flashLight.intensity = flashesOn ? flash * 2.5 * (Math.random() < 0.3 ? 0.4 : 1) : 0;
  }

  function nearestCube(px: number, pz: number) {
    let best: { mesh: THREE.Object3D; dist: number } | null = null;
    for (const g of cubes) {
      if (!g.visible) continue;
      const d = Math.hypot(g.position.x - px, g.position.z - pz);
      if (!best || d < best.dist) best = { mesh: g, dist: d };
    }
    return best;
  }

  function spinCube(g: THREE.Object3D) {
    g.userData.spin = 9;
  }

  function isLit(x: number, z: number) {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    if (!hasPanel(i, j) || rnd(i, j, 9) < 0.25) return false; // dying tubes don't count
    return Math.hypot(x - (i + 0.5) * CELL, z - (j + 0.5) * CELL) < 2.3;
  }

  // each depth makes every location a little darker and thicker
  function setDepth(depth: number) {
    depthLevel = depth;
  }

  function zoneInfo() {
    let resident = 0;
    for (const m of wallMeshes.values()) resident += mapsOf(m.material as THREE.Material).filter((t) => !parked.has(t)).length;
    const kinds = new Set<string>();
    for (const [key, m] of wallMeshes) if (m.visible) kinds.add(key.split(":")[0]);
    return { kinds: [...kinds], resident, parked: parked.size };
  }
  // Teleport: build the destination's location textures and wait for the pictures
  function prepare(x: number, z: number) {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    const zones = new Map<string, ZoneDef>();
    for (const [di, dj] of [[0, 0], [-ZONE_CELLS, 0], [ZONE_CELLS, 0], [0, -ZONE_CELLS], [0, ZONE_CELLS]]) {
      const zn = zoneOfCell(ci + di, cj + dj);
      zones.set(zn.kind, zn);
    }
    const waits: Promise<void>[] = [];
    for (const zn of zones.values()) {
      warmZone(zn);
      kindsSeen.set(zn.kind, zn);
      for (let v = 0; v < WALL_VARIANTS; v++) waits.push(textureReady(zoneWallMaterial(zn, v).map));
      waits.push(textureReady(zoneFloorMaterial(zn).map));
    }
    return Promise.all(waits).then(() => undefined);
  }

  return { scene, update, zoneInfo, prepare, parkNow: () => park(performance.now(), 0), setWeather, nearestCube, spinCube, isLit, setDepth, zone: () => currentZone, setEdgeFog: (f: number) => (edgeFog = f), setWet: (w: number) => {
    wet = w;
    relief.setWet(w);
  }, setFlashes: (on: boolean) => (flashesOn = on), setSpace: (on: boolean) => (space = on), setCeiling: (on: boolean) => {
    ceil.visible = on;
    panels.visible = on;
    relief.setCeiling(on);
    openSky = !on;
  } };
}

export { roomOf };
