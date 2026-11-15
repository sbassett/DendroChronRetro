/**
 * src/model/textureFilters.ts
 * Procedural SVG filter definitions for wood grain micro-texture and watercolor bleeding.
 */

import { escapeXml } from './colophon';

export const WOOD_GRAIN_FILTER_ID = 'wood-grain-filter';
export const WATERCOLOR_BLEED_FILTER_ID = 'watercolor-bleed';

export interface WoodGrainFilterConfig {
  baseFrequencyX: number;
  baseFrequencyY: number;
  numOctaves: number;
  displacementScale: number;
}

export interface WatercolorBleedFilterConfig {
  baseFrequency: number;
  numOctaves: number;
  displacementScale: number;
  blurDeviation: number;
}

export const DEFAULT_WOOD_GRAIN_CONFIG: WoodGrainFilterConfig = {
  baseFrequencyX: 0.02,
  baseFrequencyY: 0.35,
  numOctaves: 3,
  displacementScale: 3.5,
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

/**
 * Generates anisotropic wood grain SVG filter XML.
 * Base frequency x (0.02) << y (0.35) elongates the procedural turbulence along the longitudinal xylem axis.
 */
export function generateWoodGrainFilterXml(
  customConfig?: Partial<WoodGrainFilterConfig>,
  seed?: number | string
): string {
  const config = { ...DEFAULT_WOOD_GRAIN_CONFIG, ...customConfig };
  const seedAttr = seed !== undefined ? ` seed="${escapeXml(String(seed))}"` : '';
  return `<filter id="${WOOD_GRAIN_FILTER_ID}">
  <feTurbulence type="fractalNoise" baseFrequency="${config.baseFrequencyX} ${config.baseFrequencyY}" numOctaves="${config.numOctaves}"${seedAttr} result="noise"/>
  <feDisplacementMap in="SourceGraphic" in2="noise" scale="${config.displacementScale}" xChannelSelector="R" yChannelSelector="G"/>
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
