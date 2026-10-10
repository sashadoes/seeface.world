// Locations. The surface labyrinth is split into zones (10×10 cells), each with
// its own mood: walls and floors are textures made from random images, turned
// monochrome, cut up a little (a "digital mess": slipped slices, mirrored
// halves, pixel blocks, leaked pages) and tinted to the zone. The pictures
// change every day (the entrance halls keep theirs, they're preloaded). The
// see/face monogram patterns and their slow glow live in the walls' shader
// (wallpaper.ts), so they cost almost nothing. Secret levels live far away along x (LEVEL_OFFSET apart)
// on the same infinite maze; a secret level is one zone everywhere.
import * as THREE from "three";
import { CELL, rnd } from "./maze";
import { profile } from "./tiers";
import { hypnotize } from "./wallpaper";

export const ZONE_CELLS = 10;
export const LEVEL_OFFSET = 100_000; // metres between the surface and each secret level
export const WALL_VARIANTS = 4; // different image walls per zone

export type ZoneKind = "monogram" | "pools" | "red" | "neon" | "photo" | "white" | "ash" | "deep";

export type ZoneDef = {
  kind: ZoneKind;
  fog: number;
  fogDensity: number;
  ambient: number;
  ambientIntensity: number;
  ceiling: number;
  panel: number;
  exposure: number;
  /** wall tint (multiplies the monochrome image) */
  wall: number;
  floor: number;
  /** contrast + brightness of the monochrome image */
  contrast: number;
  bright: number;
  /** share of walls that carry a monogram pattern (wallpaper.ts) */
  logoChance: number;
  /** how much the monograms darken the picture / how much they glow (in the panel colour) */
  ink: number;
  glow: number;
  neon?: boolean;
};

export const ZONES: Record<ZoneKind, ZoneDef> = {
  monogram: { kind: "monogram", fog: 0x0c0c0b, fogDensity: 0.06, ambient: 0xb8b6ae, ambientIntensity: 0.13, ceiling: 0x8c8a85, panel: 0xf2f5ff, exposure: 1.25, wall: 0xe4dccd, floor: 0x5a554d, contrast: 1.15, bright: 1, logoChance: 0.85, ink: 0.35, glow: 0.3 },
  pools: { kind: "pools", fog: 0x0a1416, fogDensity: 0.07, ambient: 0x9fd8e0, ambientIntensity: 0.22, ceiling: 0xd8e4e4, panel: 0xdff8ff, exposure: 1.3, wall: 0xbfeff2, floor: 0x2fa6ad, contrast: 0.85, bright: 1.25, logoChance: 0.32, ink: 0.25, glow: 0.35 },
  red: { kind: "red", fog: 0x120404, fogDensity: 0.075, ambient: 0xff6a5a, ambientIntensity: 0.12, ceiling: 0x3a0e0c, panel: 0xffb08a, exposure: 1.2, wall: 0xc23a2c, floor: 0x3a0d0b, contrast: 1.3, bright: 0.85, logoChance: 0.42, ink: 0.3, glow: 0.4 },
  neon: { kind: "neon", fog: 0x05020a, fogDensity: 0.05, ambient: 0x8a5cff, ambientIntensity: 0.08, ceiling: 0x050308, panel: 0xff3cf0, exposure: 1.35, wall: 0x6a5a8a, floor: 0x2a2440, contrast: 1.6, bright: 0.55, logoChance: 0.5, ink: 0.1, glow: 0.9, neon: true },
  photo: { kind: "photo", fog: 0x0a0d08, fogDensity: 0.065, ambient: 0xc8e0b0, ambientIntensity: 0.16, ceiling: 0x2a3324, panel: 0xf6ffe0, exposure: 1.25, wall: 0xdfe6cf, floor: 0x3d4a30, contrast: 1.05, bright: 1.05, logoChance: 0.23, ink: 0.35, glow: 0.18 },
  white: { kind: "white", fog: 0xd2cfc7, fogDensity: 0.035, ambient: 0xfffcf4, ambientIntensity: 0.55, ceiling: 0xeeebe3, panel: 0xffffff, exposure: 0.95, wall: 0xf2eee6, floor: 0xcdc9c0, contrast: 0.45, bright: 1.6, logoChance: 0.35, ink: 0.45, glow: 0 },
  ash: { kind: "ash", fog: 0x0d0a08, fogDensity: 0.08, ambient: 0xff8a40, ambientIntensity: 0.1, ceiling: 0x1c1714, panel: 0xffa060, exposure: 1.2, wall: 0xa89c90, floor: 0x26211d, contrast: 1.3, bright: 1, logoChance: 0.35, ink: 0.4, glow: 0.35 },
  deep: { kind: "deep", fog: 0x021014, fogDensity: 0.07, ambient: 0x2ad8c0, ambientIntensity: 0.16, ceiling: 0x06232a, panel: 0x7cffe8, exposure: 1.25, wall: 0x5fc8c0, floor: 0x0d3a40, contrast: 1.1, bright: 0.9, logoChance: 0.27, ink: 0.2, glow: 0.55 },
};

const SURFACE: ZoneKind[] = ["monogram", "pools", "red", "neon", "photo", "white", "ash", "deep"];

/** Secret levels: 1 = The Below (pools), 2 = The Static (neon), 3 = The White. */
export const LEVELS: { name: string; zone: ZoneKind; colour: number }[] = [
  { name: "surface", zone: "monogram", colour: 0xffffff },
  { name: "the below", zone: "pools", colour: 0x3cf2ff },
  { name: "the static", zone: "neon", colour: 0xff3cf0 },
  { name: "the white", zone: "white", colour: 0xffffff },
];

export function levelAtX(x: number) {
  const k = Math.round(x / LEVEL_OFFSET);
  return k >= 1 && k < LEVELS.length ? k : 0;
}

export function zoneOfCell(i: number, j: number): ZoneDef {
  const level = levelAtX((i + 0.5) * CELL);
  if (level > 0) return ZONES[LEVELS[level].zone];
  const zi = Math.floor(i / ZONE_CELLS), zj = Math.floor(j / ZONE_CELLS);
  if (zi === 0 && zj === 0) return ZONES.monogram; // everyone arrives in the monogram halls
  return ZONES[SURFACE[Math.floor(rnd(zi, zj, 70) * SURFACE.length)]];
}

export const zoneAt = (x: number, z: number) => zoneOfCell(Math.floor(x / CELL), Math.floor(z / CELL));

// ------------------------------------------------------------------ monochrome image textures

function neonLines(g: CanvasRenderingContext2D, s: number, seed: number) {
  const cols = ["#ff3cf0", "#3cf2ff", "#a4ff3c", "#ffb13c"];
  g.lineWidth = 4;
  for (let k = 0; k < 4; k++) {
    g.strokeStyle = cols[(k + Math.floor(seed * 4)) % cols.length];
    g.shadowColor = g.strokeStyle;
    g.shadowBlur = 16;
    g.beginPath();
    const y = (k + 0.5) * (s / 4);
    g.moveTo(0, y);
    for (let x = 0; x <= s; x += 32) g.lineTo(x, y + Math.sin(x / 40 + k + seed * 9) * 12);
    g.stroke();
  }
  g.shadowBlur = 0;
}

// ------------------------------------------------------------------ the archive
// Leaked pages pasted over some walls: typewritten lines, black redaction bars,
// a stamp. Seeded by zone + variant, so everyone sees the same pages.
const FILE_LINES = [
  "subject entered the hallway at 03:14",
  "the cube was recovered from room",
  "witness describes a tall figure, no face",
  "tape labelled 1994 found intact",
  "all copies must be destroyed",
  "the king was seen again on level",
  "nobody returned from the lower floor",
  "signal lost at this point",
  "case closed. case reopened.",
  "she said the walls were breathing",
  "do not open during the show",
  "location of the entrance is unknown",
  "the visitor asked to stay",
  "footage ends here",
];
const STAMPS = ["CLASSIFIED", "REDACTED", "DO NOT SHARE", "FILE 1994", "NO SIGNAL", "EYES ONLY"];

function seeded(n: number) {
  let a = Math.floor(n * 2 ** 31) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function archivePage(g: CanvasRenderingContext2D, s: number, seed: number) {
  const r = seeded(seed);
  const w = s * (0.5 + r() * 0.2), h = w * 1.3;
  g.save();
  g.translate(s * (0.3 + r() * 0.4), s * (0.32 + r() * 0.36));
  g.rotate((r() - 0.5) * 0.18);
  // the sheet: old paper, a little transparent so the wall shows through
  g.fillStyle = "rgba(226,222,210,0.78)";
  g.fillRect(-w / 2, -h / 2, w, h);
  g.strokeStyle = "rgba(0,0,0,0.25)";
  g.strokeRect(-w / 2, -h / 2, w, h);
  // header line
  g.fillStyle = "rgba(20,20,20,0.85)";
  g.font = `bold ${Math.round(w * 0.05)}px "Courier New", monospace`;
  g.fillText(`FILE ${1000 + Math.floor(r() * 8999)} · LEVEL ${Math.floor(r() * 4)}`, -w / 2 + w * 0.08, -h / 2 + h * 0.09);
  // typewritten lines, some words blacked out
  const fs = Math.round(w * 0.042);
  g.font = `${fs}px "Courier New", monospace`;
  const left = -w / 2 + w * 0.08, maxW = w * 0.84;
  for (let y = -h / 2 + h * 0.17; y < h / 2 - h * 0.08; y += fs * 1.7) {
    if (r() < 0.12) continue;
    const words = FILE_LINES[Math.floor(r() * FILE_LINES.length)].split(" ");
    let x = left;
    for (const word of words) {
      const ww = g.measureText(word + " ").width;
      if (x + ww > left + maxW) break;
      if (r() < 0.32) {
        g.fillStyle = "rgba(5,5,5,0.95)";
        g.fillRect(x, y - fs * 0.85, ww - fs * 0.3, fs * 1.05);
      } else {
        g.fillStyle = "rgba(25,25,25,0.8)";
        g.fillText(word, x, y);
      }
      x += ww;
    }
  }
  // a whole paragraph gone
  if (r() < 0.6) {
    g.fillStyle = "rgba(5,5,5,0.95)";
    g.fillRect(left, h * (r() * 0.3 - 0.05), maxW * (0.6 + r() * 0.4), fs * 3.4);
  }
  // the stamp
  g.translate(w * (r() * 0.3 - 0.15), h * (0.18 + r() * 0.15));
  g.rotate(-0.25 + r() * 0.5);
  const stamp = STAMPS[Math.floor(r() * STAMPS.length)];
  g.font = `bold ${Math.round(w * 0.1)}px "Courier New", monospace`;
  const sw = g.measureText(stamp).width;
  g.globalAlpha = 0.55;
  g.strokeStyle = g.fillStyle = "#3a3a3a";
  g.lineWidth = 3;
  g.strokeRect(-sw / 2 - 10, -w * 0.09, sw + 20, w * 0.125);
  g.fillText(stamp, -sw / 2, w * 0.01);
  g.restore();
}

// ------------------------------------------------------------------ the digital mess
// Cheap cut-ups on the picture, drawn once when the texture is made: no extra
// downloads, nothing per frame. Each variant gets its own mix.
function digitalMess(g: CanvasRenderingContext2D, c: HTMLCanvasElement, s: number, seed: number) {
  const r = seeded(seed);
  // slipped slices: horizontal bands copied sideways, like a torn signal
  if (r() < 0.55) {
    const n = 4 + Math.floor(r() * 8);
    for (let k = 0; k < n; k++) {
      const y = Math.floor(r() * s), h = Math.max(2, Math.floor(r() * s * 0.08));
      g.drawImage(c, 0, y, s, h, (r() - 0.5) * s * 0.25, y, s, h);
    }
  }
  // a mirrored half: the picture folds into a face
  if (r() < 0.35) {
    g.save();
    g.translate(s, 0);
    g.scale(-1, 1);
    g.drawImage(c, s / 2, 0, s / 2, s, s / 2, 0, s / 2, s);
    g.restore();
  }
  // a block of big pixels, like a broken file
  if (r() < 0.4) {
    const w = s * (0.2 + r() * 0.35), h = s * (0.15 + r() * 0.3), x = r() * (s - w), y = r() * (s - h);
    const px = Math.max(4, Math.round(s / (12 + r() * 20)));
    const t = document.createElement("canvas");
    t.width = Math.max(1, Math.round(w / px));
    t.height = Math.max(1, Math.round(h / px));
    t.getContext("2d")!.drawImage(c, x, y, w, h, 0, 0, t.width, t.height);
    g.imageSmoothingEnabled = false;
    g.drawImage(t, x, y, w, h);
    g.imageSmoothingEnabled = true;
  }
  // thin scan bars
  if (r() < 0.3) {
    g.fillStyle = `rgba(0,0,0,${0.15 + r() * 0.2})`;
    const step = 3 + Math.floor(r() * 5);
    for (let y = 0; y < s; y += step) g.fillRect(0, y, s, 1);
  }
}

/** Days since 1970 (UTC): the pictures change with it, the same for everyone. */
const today = () => Math.floor(Date.now() / 86_400_000);

/**
 * A wall/floor texture from a random image: monochrome, zone contrast and
 * brightness, a little digital mess. Tint comes from the material.
 */
export function monoTexture(zone: ZoneDef, variant: number, opts: { floor?: boolean } = {}) {
  const s = profile().texture; // 256 on low: a quarter of the graphics memory
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  g.fillStyle = "#555";
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  // walls mirror at their edges, so a picture drifting across them never shows a seam
  t.wrapS = t.wrapT = opts.floor ? THREE.RepeatWrapping : THREE.MirroredRepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = profile().anisotropy;

  // the entrance keeps its pictures (preloaded by the Service Worker, scripts/sw.mjs);
  // every other location gets new ones each day
  const day = zone.kind === "monogram" ? "" : `d${today()}-`;
  const seed = `${day}${zone.kind}-${opts.floor ? "floor" : "wall"}-${variant}`;
  const url = (px: number) => `https://picsum.photos/seed/seeface1-${seed}/${px}?grayscale`;
  // progressive: a tiny blurry copy (~1 kB) shows at once, the full image replaces it
  let full = false;
  let done = () => {};
  // resolves when the full picture is drawn, or it failed (the grey stays): never hangs
  t.userData.ready = new Promise<void>((res) => (done = res));
  const tiny = new Image();
  tiny.crossOrigin = "anonymous";
  tiny.onload = () => {
    if (full) return;
    g.filter = `grayscale(1) contrast(${zone.contrast}) brightness(${zone.bright * (opts.floor ? 0.75 : 1)}) blur(${s / 64}px)`;
    g.drawImage(tiny, 0, 0, s, s);
    g.filter = "none";
    t.needsUpdate = true;
  };
  tiny.src = url(32);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    full = true;
    g.filter = `grayscale(1) contrast(${zone.contrast}) brightness(${zone.bright * (opts.floor ? 0.75 : 1)})`;
    g.drawImage(img, 0, 0, s, s);
    g.filter = "none";
    // a little grime and vignette so walls feel old
    const v = g.createRadialGradient(s / 2, s / 2, s * 0.2, s / 2, s / 2, s * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.35)");
    g.fillStyle = v;
    g.fillRect(0, 0, s, s);
    if (!opts.floor) digitalMess(g, c, s, rnd(variant, zone.kind.length + today(), 79));
    if (zone.neon && !opts.floor) neonLines(g, s, (variant * 0.37) % 1);
    // about a third of the wall images carry a leaked page
    const page = rnd(variant, zone.kind.length, 73);
    if (!opts.floor && page < 0.35) archivePage(g, s, page);
    t.needsUpdate = true;
    done();
  };
  img.onerror = () => done();
  img.src = url(512); // always 512: the same file the Service Worker keeps for every tier
  return t;
}

/** Resolves once a location texture's full picture is in (see monoTexture). */
export const textureReady = (t: THREE.Texture | null | undefined): Promise<void> => (t?.userData.ready as Promise<void> | undefined) ?? Promise.resolve();

/** Material for a zone's wall variant (built on first use). */
const wallCache = new Map<string, THREE.MeshStandardMaterial>();
export function zoneWallMaterial(zone: ZoneDef, variant: number) {
  const key = `${zone.kind}:${variant}`;
  let m = wallCache.get(key);
  if (!m) {
    const map = monoTexture(zone, variant);
    m = new THREE.MeshStandardMaterial({
      map,
      color: zone.wall,
      roughness: zone.kind === "pools" ? 0.3 : 0.85,
      metalness: 0.03,
      ...(zone.neon ? { emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.45 } : {}),
    });
    hypnotize(m, {
      glow: zone.panel,
      glowAmt: zone.glow,
      ink: zone.ink,
      accent: zone.ambient,
      cover: Math.min(0.95, zone.logoChance + 0.35),
    });
    wallCache.set(key, m);
  }
  return m;
}

const floorCache = new Map<ZoneKind, THREE.MeshStandardMaterial>();
export function zoneFloorMaterial(zone: ZoneDef) {
  let m = floorCache.get(zone.kind);
  if (!m) {
    const map = monoTexture(zone, 0, { floor: true });
    map.repeat.set(40, 40);
    m = new THREE.MeshStandardMaterial({
      map,
      color: zone.floor,
      roughness: zone.kind === "pools" || zone.kind === "neon" ? 0.12 : 0.55,
      metalness: zone.kind === "pools" || zone.kind === "neon" ? 0.4 : 0.15,
    });
    floorCache.set(zone.kind, m);
  }
  return m;
}
