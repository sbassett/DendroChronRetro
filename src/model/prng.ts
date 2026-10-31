import { SpeciesId } from './types';

/**
 * Canonicalizes location & species so identical coordinates (within ~1.1m / 1e-5 deg)
 * and species produce the exact same seed string everywhere.
 */
export function buildCanonicalSeedKey(
  species: SpeciesId,
  latitude: number,
  longitude: number
): string {
  const latNorm = (Object.is(latitude, -0) ? 0 : latitude).toFixed(5);
  const lonNorm = (Object.is(longitude, -0) ? 0 : longitude).toFixed(5);
  return `dendrosim:v1:${species}:${latNorm}:${lonNorm}`;
}

/**
 * Coarse regional seed (~11 km grid) so nearby trees cross-date on pre-1940
 * synthetic climate anomalies while remaining 100% deterministic for a given spot.
 */
export function buildRegionalClimateSeedKey(
  latitude: number,
  longitude: number
): string {
  const latRegion = (Math.round(latitude * 10) / 10).toFixed(1);
  const lonRegion = (Math.round(longitude * 10) / 10).toFixed(1);
  return `dendrosim:climate:v1:${latRegion}:${lonRegion}`;
}

/** 128-bit string hash (cyrb128) returning four 32-bit unsigned integers */
export function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

export function hashToHex(str: string): string {
  const [a, b, c, d] = cyrb128(str);
  return [a, b]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('')
    .slice(0, 12)
    .toUpperCase() + `-${((c ^ d) >>> 0).toString(16).padStart(8, '0').slice(0, 4).toUpperCase()}`;
}

/**
 * Deterministic SFC32 pseudorandom number generator with domain sub-stream forking.
 */
export class SeededRNG {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spareGaussian: number | null = null;

  constructor(seedStr: string) {
    const [a, b, c, d] = cyrb128(seedStr);
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    // Warm up state
    for (let i = 0; i < 15; i++) {
      this.next();
    }
  }

  /** Fork an independent deterministic sub-stream */
  fork(domain: string): SeededRNG {
    const tag = `${this.a}:${this.b}:${this.c}:${this.d}:${domain}`;
    return new SeededRNG(tag);
  }

  /** Uniform float in [0, 1) */
  next(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(minInclusive: number, maxInclusive: number): number {
    return Math.floor(this.range(minInclusive, maxInclusive + 1));
  }

  gaussian(mean = 0, stdDev = 1): number {
    if (this.spareGaussian !== null) {
      const val = this.spareGaussian;
      this.spareGaussian = null;
      return mean + stdDev * val;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const mag = Math.sqrt(-2.0 * Math.log(u));
    this.spareGaussian = mag * Math.sin(2.0 * Math.PI * v);
    return mean + stdDev * (mag * Math.cos(2.0 * Math.PI * v));
  }
}

/**
 * 2D Perlin gradient noise used to sample smooth, seam-free periodic polar curves
 * along circles (cx + rho * cos(theta), cy + rho * sin(theta)).
 */
export class Noise2D {
  private perm: Uint8Array;

  constructor(rng: SeededRNG) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
    }
  }

  private static fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private static lerp(t: number, a: number, b: number): number {
    return a + t * (b - a);
  }

  private static grad(hash: number, x: number, y: number): number {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) !== 0 ? -u : u) + ((h & 2) !== 0 ? -2.0 * v : 2.0 * v);
  }

  /** Smooth 2D gradient noise approximately in [-1, 1] */
  eval(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = Noise2D.fade(xf);
    const v = Noise2D.fade(yf);

    const aa = this.perm[this.perm[X] + Y];
    const ab = this.perm[this.perm[X] + Y + 1];
    const ba = this.perm[this.perm[X + 1] + Y];
    const bb = this.perm[this.perm[X + 1] + Y + 1];

    const x1 = Noise2D.lerp(
      u,
      Noise2D.grad(aa, xf, yf),
      Noise2D.grad(ba, xf - 1, yf)
    );
    const x2 = Noise2D.lerp(
      u,
      Noise2D.grad(ab, xf, yf - 1),
      Noise2D.grad(bb, xf - 1, yf - 1)
    );
    return 0.45 * Noise2D.lerp(v, x1, x2);
  }

  /**
   * Seamlessly periodic angular fractional Brownian motion around theta in [0, 2*PI).
   * radialCoord controls how fast the angular pattern evolves from pith to bark.
   */
  polarFbm(
    theta: number,
    loopRadius: number,
    radialDrift: number,
    octaves = 3
  ): number {
    let total = 0;
    let amp = 1;
    let norm = 0;
    let freq = loopRadius;
    for (let o = 0; o < octaves; o++) {
      const nx = Math.cos(theta) * freq + radialDrift * (0.7 + o * 0.35);
      const ny = Math.sin(theta) * freq - radialDrift * (0.5 + o * 0.25);
      total += amp * this.eval(nx + o * 17.3, ny + o * 31.7);
      norm += amp;
      amp *= 0.5;
      freq *= 2.05;
    }
    return norm > 0 ? total / norm : 0;
  }
}
