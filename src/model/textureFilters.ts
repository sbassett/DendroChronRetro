/**
 * src/model/textureFilters.ts
 * Procedural SVG filter definitions for wood grain micro-texture and watercolor bleeding.
 */

import { escapeXml } from './colophon';
import { cyrb128 } from './prng';

export const WOOD_GRAIN_FILTER_ID = 'wood-grain-filter';
export const WATERCOLOR_BLEED_FILTER_ID = 'watercolor-bleed';

export type WoodGrainCompositeMode = 'composite' | 'overlay';

export interface WoodGrainFilterConfig {
  /** Isotropic spatial frequency (cycles/mm) for fine transverse tracheid-lumen pores */
  poreFrequency: number;
  /** Fractal noise octave count for tracheid pores */
  poreOctaves: number;
  /** Contrast slope for dark tracheid-lumen pores (0..1) */
  poreStrength: number;
  /** Contrast slope for subtle pale cut cell-wall micro-highlights (0..1) */
  cellWallHighlight: number;
  /** Isotropic spatial frequency (cycles/mm) for mesoscopic extractive/resin mottling */
  mottleFrequency: number;
  /** Fractal noise octave count for extractive mottling */
  mottleOctaves: number;
  /** Contrast slope for mesoscopic extractive mottling (0..1) */
  mottleStrength: number;
  /**
   * 'composite' (default): merges end-grain layers over SourceGraphic and masks to SourceAlpha.
   * 'overlay': outputs only translucent end-grain layers for clipping over crisp vector rings.
   */
  compositeMode: WoodGrainCompositeMode;
}

export interface WatercolorBleedFilterConfig {
  baseFrequency: number;
  numOctaves: number;
  displacementScale: number;
  blurDeviation: number;
}

export const DEFAULT_WOOD_GRAIN_CONFIG: WoodGrainFilterConfig = {
  poreFrequency: 0.6,
  poreOctaves: 4,
  poreStrength: 0.34,
  cellWallHighlight: 0.2,
  mottleFrequency: 0.085,
  mottleOctaves: 3,
  mottleStrength: 0.14,
  compositeMode: 'composite',
};

export const DEFAULT_WATERCOLOR_BLEED_CONFIG: WatercolorBleedFilterConfig = {
  baseFrequency: 0.04,
  numOctaves: 4,
  displacementScale: 2.5,
  blurDeviation: 1.2,
};

export interface TextureFilterOptions {
  enableWoodGrain?: boolean;
  enableWatercolorBleed?: boolean;
  woodGrainConfig?: Partial<WoodGrainFilterConfig>;
  watercolorBleedConfig?: Partial<WatercolorBleedFilterConfig>;
  seed?: number | string;
  wrapDefs?: boolean;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function finiteOr(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function fmtNum(v: number): string {
  const n = Number(v.toFixed(4));
  return Math.abs(n) < 1e-9 ? '0' : n.toString();
}

/**
 * Normalizes numeric or arbitrary string seeds (such as specimen seedHex) into
 * valid deterministic integer seeds required by SVG <feTurbulence seed="..."/>.
 */
export function normalizeFilterSeed(seed?: number | string): number | undefined {
  if (seed === undefined) return undefined;
  if (typeof seed === 'number') {
    if (!Number.isFinite(seed)) return 0;
    const truncated = Math.trunc(seed);
    return truncated === 0 ? 0 : truncated;
  }
  const trimmed = seed.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const truncated = Math.trunc(Number(trimmed));
    return truncated === 0 ? 0 : truncated;
  }
  return (cyrb128(trimmed)[0] % 9973) + 1;
}

/**
 * Computes specimen-scale-calibrated transverse end-grain filter parameters
 * from the full cambium cross-section diameter in millimeters.
 */
export function computeEndGrainConfig(
  woodDiameterMm: number,
  options?: {
    intensityScale?: number;
    compositeMode?: WoodGrainCompositeMode;
  }
): WoodGrainFilterConfig {
  const safeDiameter =
    Number.isFinite(woodDiameterMm) && woodDiameterMm > 0 ? woodDiameterMm : 400;
  const poreFrequency = Number(clamp(240 / safeDiameter, 0.25, 2.5).toFixed(4));
  const mottleFrequency = Number((poreFrequency * 0.14).toFixed(4));
  const intensity = clamp(finiteOr(options?.intensityScale, 1.0), 0.1, 2.0);

  return {
    poreFrequency,
    poreOctaves: DEFAULT_WOOD_GRAIN_CONFIG.poreOctaves,
    poreStrength: Number(
      clamp(DEFAULT_WOOD_GRAIN_CONFIG.poreStrength * intensity, 0, 1).toFixed(4)
    ),
    cellWallHighlight: Number(
      clamp(DEFAULT_WOOD_GRAIN_CONFIG.cellWallHighlight * intensity, 0, 1).toFixed(4)
    ),
    mottleFrequency,
    mottleOctaves: DEFAULT_WOOD_GRAIN_CONFIG.mottleOctaves,
    mottleStrength: Number(
      clamp(DEFAULT_WOOD_GRAIN_CONFIG.mottleStrength * intensity, 0, 1).toFixed(4)
    ),
    compositeMode: options?.compositeMode ?? 'composite',
  };
}

/**
 * Generates physically grounded transverse end-grain wood micro-texture SVG filter XML.
 * Combines isotropic fine tracheid-lumen pores & cell-wall glints with mesoscopic
 * extractive mottling via alpha-channel thresholding (zero geometric displacement).
 */
export function generateWoodGrainFilterXml(
  customConfig?: Partial<WoodGrainFilterConfig>,
  seed?: number | string
): string {
  const merged = { ...DEFAULT_WOOD_GRAIN_CONFIG, ...customConfig };
  const poreFrequency = clamp(
    finiteOr(merged.poreFrequency, DEFAULT_WOOD_GRAIN_CONFIG.poreFrequency),
    0.05,
    8
  );
  const poreOctaves = Math.round(
    clamp(
      finiteOr(merged.poreOctaves, DEFAULT_WOOD_GRAIN_CONFIG.poreOctaves),
      1,
      6
    )
  );
  const poreStrength = clamp(
    finiteOr(merged.poreStrength, DEFAULT_WOOD_GRAIN_CONFIG.poreStrength),
    0,
    1
  );
  const cellWallHighlight = clamp(
    finiteOr(merged.cellWallHighlight, DEFAULT_WOOD_GRAIN_CONFIG.cellWallHighlight),
    0,
    1
  );
  const mottleFrequency = clamp(
    finiteOr(merged.mottleFrequency, DEFAULT_WOOD_GRAIN_CONFIG.mottleFrequency),
    0.01,
    2
  );
  const mottleOctaves = Math.round(
    clamp(
      finiteOr(merged.mottleOctaves, DEFAULT_WOOD_GRAIN_CONFIG.mottleOctaves),
      1,
      5
    )
  );
  const mottleStrength = clamp(
    finiteOr(merged.mottleStrength, DEFAULT_WOOD_GRAIN_CONFIG.mottleStrength),
    0,
    1
  );
  const compositeMode: WoodGrainCompositeMode =
    merged.compositeMode === 'overlay' ? 'overlay' : 'composite';

  const pf = fmtNum(poreFrequency);
  const mf = fmtNum(mottleFrequency);

  const poreSeed = normalizeFilterSeed(seed);
  const poreSeedAttr = poreSeed !== undefined ? ` seed="${poreSeed}"` : '';
  const mottleSeed = poreSeed !== undefined ? poreSeed + 17 : 17;

  const poreIntercept = fmtNum(poreStrength * 0.48);
  const poreSlope = fmtNum(-poreStrength);
  const wallIntercept = fmtNum(-cellWallHighlight * 0.54);
  const wallSlope = fmtNum(cellWallHighlight);
  const mottleIntercept = fmtNum(mottleStrength * 0.52);
  const mottleSlope = fmtNum(-mottleStrength);

  const mergeBlock =
    compositeMode === 'overlay'
      ? `  <feMerge>
    <feMergeNode in="extractiveMottle"/>
    <feMergeNode in="poreLumens"/>
    <feMergeNode in="cellWalls"/>
  </feMerge>`
      : `  <feMerge result="grainComposite">
    <feMergeNode in="SourceGraphic"/>
    <feMergeNode in="extractiveMottle"/>
    <feMergeNode in="poreLumens"/>
    <feMergeNode in="cellWalls"/>
  </feMerge>
  <feComposite in="grainComposite" in2="SourceAlpha" operator="in"/>`;

  return `<filter id="${WOOD_GRAIN_FILTER_ID}" x="0%" y="0%" width="100%" height="100%" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="${pf} ${pf}" numOctaves="${poreOctaves}"${poreSeedAttr} result="poreNoise"/>
  <feColorMatrix in="poreNoise" type="matrix" values="0 0 0 0 0.05 0 0 0 0 0.05 0 0 0 0 0.05 0 0 0 ${poreSlope} ${poreIntercept}" result="poreLumens"/>
  <feColorMatrix in="poreNoise" type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 ${wallSlope} ${wallIntercept}" result="cellWalls"/>
  <feTurbulence type="fractalNoise" baseFrequency="${mf} ${mf}" numOctaves="${mottleOctaves}" seed="${mottleSeed}" result="mottleNoise"/>
  <feColorMatrix in="mottleNoise" type="matrix" values="0 0 0 0 0.07 0 0 0 0 0.07 0 0 0 0 0.07 0 0 0 ${mottleSlope} ${mottleIntercept}" result="extractiveMottle"/>
${mergeBlock}
</filter>`;
}

/**
 * Generates capillary watercolor bleed SVG filter XML.
 * Uses restrained Gaussian blur radius to prevent edge blowout while creating organic edge diffusion.
 */
export function generateWatercolorBleedFilterXml(
  customConfig?: Partial<WatercolorBleedFilterConfig>,
  seed?: number | string
): string {
  const config = { ...DEFAULT_WATERCOLOR_BLEED_CONFIG, ...customConfig };
  const seedAttr = seed !== undefined ? ` seed="${escapeXml(String(seed))}"` : '';
  return `<filter id="${WATERCOLOR_BLEED_FILTER_ID}">
  <feTurbulence type="fractalNoise" baseFrequency="${config.baseFrequency} ${config.baseFrequency}" numOctaves="${config.numOctaves}"${seedAttr} result="bleedNoise"/>
  <feDisplacementMap in="SourceGraphic" in2="bleedNoise" scale="${config.displacementScale}" xChannelSelector="R" yChannelSelector="G" result="roughened"/>
  <feGaussianBlur in="roughened" stdDeviation="${config.blurDeviation}" result="blurred"/>
  <feMerge>
    <feMergeNode in="blurred"/>
    <feMergeNode in="SourceGraphic"/>
  </feMerge>
</filter>`;
}

/**
 * Generates SVG <defs> containing procedural texture filters.
 * When called with no arguments, wraps both wood grain and watercolor filters in <defs>...</defs>.
 */
export function generateTextureFilterDefs(options?: TextureFilterOptions): string {
  const includeWoodGrain = options?.enableWoodGrain ?? (options ? options.enableWoodGrain === true || options.enableWatercolorBleed !== true : true);
  const includeBleed = options?.enableWatercolorBleed ?? (options ? options.enableWatercolorBleed === true || options.enableWoodGrain !== true : true);
  const wrap = options?.wrapDefs ?? true;

  const parts: string[] = [];
  if (includeWoodGrain) {
    parts.push(generateWoodGrainFilterXml(options?.woodGrainConfig, options?.seed));
  }
  if (includeBleed) {
    parts.push(generateWatercolorBleedFilterXml(options?.watercolorBleedConfig, options?.seed));
  }

  if (parts.length === 0) return '';
  const inner = parts.join('\n');
  return wrap ? `<defs>\n${inner}\n</defs>` : inner;
}
