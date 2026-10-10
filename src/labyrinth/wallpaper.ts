// Hypnotic wallpaper: the walls are the biggest surfaces in the maze, so they
// carry the look. Everything that moves is done inside the walls' own shader
// (a few extra lines in MeshStandardMaterial), never as extra screen passes,
// video or per-frame canvas uploads:
//   · the see/face monogram in one of six patterns (grid, half-drop, diamond,
//     mirrored, a ticker band, one giant slowly turning crest), drifting slowly
//     like the cube page's walls
//   · a slow wave of light travels through the maze and the monograms glow as
//     it passes: the walls breathe, together (never said, only shown)
//   · each wall picks its own pattern, crop, mirror and tint from where it
//     stands, so 4 pictures per location look like dozens of rooms. The same
//     for everyone.
// Cost per wall pixel: one extra (tiny, mipmapped) texture read + a little math.
// Low quality and "reduce motion" keep the patterns but stop the motion.
import * as THREE from "three";

const shared = {
  sfTime: { value: 0 },
  /** 0 = still patterns, 1 = drifting */
  sfFlow: { value: 1 },
  /** strength of the travelling light wave */
  sfPulse: { value: 1 },
  sfLogo: { value: null as THREE.Texture | null },
};

function logoTexture() {
  if (shared.sfLogo.value) return shared.sfLogo.value;
  const t = new THREE.TextureLoader().load("/imgs/seeface-logo-transparent.png");
  t.colorSpace = THREE.NoColorSpace; // only its alpha is used
  t.anisotropy = 4;
  shared.sfLogo.value = t;
  return t;
}

const VERT_HEAD = /* glsl */ `
varying vec2 vSfUv;
varying vec3 vSfWorld;
varying float vSfSeed;
float sfHash(vec2 c) { c = mod(c, 997.0); return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
`;

const VERT_BODY = /* glsl */ `
vSfUv = uv;
#ifdef USE_INSTANCING
  vec4 sfOrigin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vSfWorld = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
#else
  vec4 sfOrigin = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vSfWorld = (modelMatrix * vec4(position, 1.0)).xyz;
#endif
// the wall's own seed: from where it stands (half-metre grid), the same on every screen
vSfSeed = sfHash(floor(sfOrigin.xz * 2.0 + 0.5));
`;

const FRAG_HEAD = /* glsl */ `
varying vec2 vSfUv;
varying vec3 vSfWorld;
varying float vSfSeed;
uniform sampler2D sfLogo;
uniform float sfTime;
uniform float sfFlow;
uniform float sfPulse;
uniform vec3 sfGlow;
uniform vec3 sfAccent;
uniform float sfGlowAmt;
uniform float sfInk;
uniform float sfCover;

// the monogram pattern on this wall: 0..1 coverage
float sfMono(vec2 uv, float seed) {
  if (fract(seed * 2.917) > sfCover) return 0.0; // some walls are just the picture
  // the wall face in metres (4.3 m wide, 3.4 m tall; uv.y runs 0..0.85)
  vec2 q = vec2(uv.x * 4.3, uv.y * 4.0);
  float mode = floor(fract(seed * 13.71) * 6.0);
  float s = mix(0.75, 1.5, fract(seed * 5.31));
  float dir = fract(seed * 9.13) > 0.5 ? 1.0 : -1.0;
  float drift = sfTime * sfFlow * 0.06 * dir;
  vec2 p = q / s;
  // mip level from the smooth coordinate, so tile edges never draw a seam
  vec2 gx = dFdx(p), gy = dFdy(p);
  vec2 cell;
  if (mode < 1.0) {            // grid, sliding sideways
    p.x += drift;
    cell = fract(p);
  } else if (mode < 2.0) {     // half-drop, falling slowly
    p.y += drift + mod(floor(p.x), 2.0) * 0.5;
    cell = fract(p);
  } else if (mode < 3.0) {     // diamond lattice
    mat2 r = mat2(0.7071, -0.7071, 0.7071, 0.7071);
    p = r * p;
    p.x += drift;
    gx = r * gx;
    gy = r * gy;
    cell = fract(p);
  } else if (mode < 4.0) {     // mirrored, kaleidoscopic
    p.y += drift;
    cell = fract(p);
    cell = mix(cell, 1.0 - cell, vec2(mod(floor(p.x), 2.0), mod(floor(p.y), 2.0)));
  } else if (mode < 5.0) {     // one ticker band across the middle
    p = vec2(q.x / s + drift * 2.0, (q.y - 1.6) / s + 0.5);
    if (p.y < 0.0 || p.y > 1.0) return 0.0;
    cell = vec2(fract(p.x), p.y);
  } else {                     // one giant crest, turning very slowly
    float a = sfTime * sfFlow * 0.04 * dir;
    mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a));
    p = r * ((q - vec2(2.15, 1.65)) / 2.6) + 0.5;
    gx = r * dFdx(q) / 2.6;
    gy = r * dFdy(q) / 2.6;
    if (any(lessThan(p, vec2(0.0))) || any(greaterThan(p, vec2(1.0)))) return 0.0;
    cell = p;
  }
  return textureGrad(sfLogo, cell, gx, gy).a;
}

// a slow wave of light travelling through the whole maze (~2 m/s, every ~11 s)
float sfWave(vec3 w) {
  float a = 0.5 + 0.5 * sin(dot(w.xz, vec2(0.21, 0.13)) - sfTime * 0.55);
  float b = 0.5 + 0.5 * sin(w.y * 1.4 - sfTime * 0.9 + w.x * 0.05);
  return a * a * a * (0.75 + 0.25 * b);
}
`;

const FRAG_MAP = /* glsl */ `
// this wall's crop of the picture: shifted, sometimes mirrored, drifting slowly
vec2 sfImgUv = vSfUv;
sfImgUv.x = mix(sfImgUv.x, -sfImgUv.x, step(0.5, fract(vSfSeed * 7.13))) + fract(vSfSeed * 3.71);
sfImgUv.x += sfTime * sfFlow * 0.006 * (fract(vSfSeed * 9.13) > 0.5 ? 1.0 : -1.0);
#ifdef USE_MAP
  diffuseColor *= texture2D(map, sfImgUv);
#endif
// each wall leans a little towards the location's accent colour
diffuseColor.rgb *= mix(vec3(1.0), sfAccent, fract(vSfSeed * 4.13) * 0.5);
float sfA = sfMono(vSfUv, vSfSeed);
float sfW = sfWave(vSfWorld) * sfPulse;
diffuseColor.rgb *= 1.0 - sfA * sfInk * (1.0 - 0.6 * sfW);
`;

const FRAG_EMISSIVE = /* glsl */ `
#ifdef USE_EMISSIVEMAP
  totalEmissiveRadiance *= texture2D(emissiveMap, sfImgUv).rgb;
#endif
// faint at rest, glowing as the wave passes
totalEmissiveRadiance += sfGlow * sfA * sfGlowAmt * (0.08 + 0.9 * sfW);
`;

export type WallpaperStyle = {
  /** colour the monograms glow in */
  glow: number;
  /** how strongly they glow (0 = never) */
  glowAmt: number;
  /** how much they darken the picture (0 = never) */
  ink: number;
  /** each wall's tint leans towards this */
  accent: number;
  /** share of walls with a pattern (the rest show only the picture) */
  cover: number;
};

/** Make a wall material hypnotic (call once, right after creating it). */
export function hypnotize(m: THREE.MeshStandardMaterial, style: WallpaperStyle) {
  logoTexture();
  const own = {
    sfGlow: { value: new THREE.Color(style.glow) },
    sfAccent: { value: new THREE.Color(style.accent) },
    sfGlowAmt: { value: style.glowAmt },
    sfInk: { value: style.ink },
    sfCover: { value: style.cover },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, own);
    shader.vertexShader = VERT_HEAD + shader.vertexShader.replace("#include <project_vertex>", `#include <project_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader
      .replace("#include <map_fragment>", FRAG_MAP)
      .replace("#include <emissivemap_fragment>", FRAG_EMISSIVE);
  };
  // every hypnotic wall shares one program (per light/fog setup)
  m.customProgramCacheKey = () => "sf-wallpaper-1";
  return m;
}

const calm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Per frame. `still` = low quality: patterns stay, motion stops. */
export function tickWallpaper(t: number, still: boolean) {
  // wrapped every hour on the CPU so the GPU's float never loses precision
  shared.sfTime.value = t % 3600;
  const quiet = still || calm;
  shared.sfFlow.value = quiet ? 0 : 1;
  shared.sfPulse.value += ((quiet ? 0.35 : 1) - shared.sfPulse.value) * 0.05;
}
