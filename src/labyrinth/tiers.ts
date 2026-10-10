// What each graphics tier (settings → graphics → quality) controls, in one place.
// Low is for weak / older phones, medium for most phones and laptops, high for
// strong devices (an iPhone 16 Pro or a gaming PC stay on high).
import { settings, type Settings } from "./settings";

export type Tier = Settings["quality"];

export type Profile = {
  /** pixel ratio = min(devicePixelRatio, cap); dynamic resolution works below it */
  pixelCap: { phone: number; desktop: number };
  /** wall/floor/art texture size in px */
  texture: number;
  anisotropy: number;
  /** lantern shadows (only with immersive mode, which also needs a smooth frame) */
  shadows: boolean;
  /** maze cells built around you (draw distance) */
  view: number;
  /** glow, film look, light shafts, aurora (the player can still switch them off) */
  post: boolean;
  /** with post: the bloom glow (several screen-sized blur passes: the costliest effect) */
  bloom: boolean;
  /** with post: light shafts + your light trail (lots of see-through overdraw) */
  extras: boolean;
  /** the wallpaper's monograms drift and the light wave travels (wallpaper.ts) */
  wallMotion: boolean;
  /** share of particles (rain, snow, motes, dream particles) */
  particles: number;
  /** other players drawn at once (the nearest ones); the rest stay on the map */
  maxPlayers: number;
  /** frame rate cap */
  fps: 30 | 60;
  /** point lights on at once */
  lights: number;
};

export const PROFILES: Record<Tier, Profile> = {
  low: { pixelCap: { phone: 0.75, desktop: 0.75 }, texture: 256, anisotropy: 1, shadows: false, view: 6, post: false, bloom: false, extras: false, wallMotion: false, particles: 0.35, maxPlayers: 8, fps: 30, lights: 5 },
  medium: { pixelCap: { phone: 1.25, desktop: 1.5 }, texture: 512, anisotropy: 4, shadows: false, view: 7, post: true, bloom: false, extras: false, wallMotion: true, particles: 0.7, maxPlayers: 16, fps: 60, lights: 9 },
  high: { pixelCap: { phone: 2, desktop: 2 }, texture: 512, anisotropy: 8, shadows: true, view: 7, post: true, bloom: true, extras: true, wallMotion: true, particles: 1, maxPlayers: 40, fps: 60, lights: 14 },
};

export const MAX_VIEW = Math.max(...Object.values(PROFILES).map((p) => p.view));

export const profile = (tier: Tier = settings().quality) => PROFILES[tier];
