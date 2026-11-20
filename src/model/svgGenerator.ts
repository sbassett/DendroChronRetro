import {
  LOCATOR_MAP_HEIGHT,
  LOCATOR_MAP_WIDTH,
  NA_GREAT_LAKES_PATH,
  NA_LAND_PATH,
  projectToLocatorMap,
  SPECIES_NATIVE_RANGE_PATH,
} from './locatorMapData';
import {
  blendHex,
  DEFAULT_PALETTE_ID,
  getPalette,
  PaletteDefinition,
  PaletteId,
} from './palettes';
import { SeededRNG } from './prng';
import { SPECIES_PROFILES } from './species';
import {
  generateTextureFilterDefs,
  TextureFilterOptions,
  WOOD_GRAIN_FILTER_ID,
} from './textureFilters';
import { PolarPoint, TreeSimulationResult } from './types';
import {
  chooseScaleBar,
  formatStumpHeightShort,
  UnitSystem,
} from './units';

export interface SvgRenderOptions {
  showBark: boolean;
  showMedullaryRays: boolean;
  showAnnotations: boolean;
  showLocatorMap?: boolean;
  showCaptionText?: boolean;
  transparentBackground: boolean;
  unitSystem?: UnitSystem;
  highlightedRingIndex?: number | null;
  maxRenderedRingIndex?: number;
  paletteId?: PaletteId;
  palette?: PaletteDefinition;
  enableWoodGrain?: boolean;
  enableTextureFilter?: boolean;
  textureFilterOptions?: TextureFilterOptions;
}

export interface SvgViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GeneratedSvgBundle {
  svgMarkup: string;
  innerMarkup: string;
  viewBox: SvgViewBox;
}

function grayHex(v: number): string {
  const c = Math.max(0, Math.min(255, Math.round(v)));
  const h = c.toString(16).padStart(2, '0');
  return `#${h}${h}${h}`;
}

/**
 * Crisp polygonal closed path (used for high-res fractured bark silhouettes).
 */
function polarPolygonClosedPath(
  radiiMm: number[],
  anglesRad: number[],
  reverse = false
): string {
  const n = radiiMm.length;
  if (n === 0) return '';
  const parts: string[] = [];
  if (!reverse) {
    for (let i = 0; i < n; i++) {
      const r = radiiMm[i];
      const theta = anglesRad[i];
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
    }
  } else {
    for (let i = n - 1; i >= 0; i--) {
      const r = radiiMm[i];
      const theta = anglesRad[i];
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      parts.push(`${i === n - 1 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
    }
  }
  parts.push('Z');
  return parts.join('');
}

/**
 * Smooth C1-continuous closed Catmull-Rom -> Cubic Bezier spline path
 * so annual growth rings have zero polygonal faceting at any zoom level.
 */
function polarSmoothClosedPath(
  radiiMm: number[],
  anglesRad: number[],
  stride = 1
): string {
  const xs: number[] = [];
  const ys: number[] = [];
  const n = radiiMm.length;
  for (let i = 0; i < n; i += stride) {
    const r = radiiMm[i];
    const theta = anglesRad[i];
    xs.push(r * Math.cos(theta));
    ys.push(r * Math.sin(theta));
  }

  const m = xs.length;
  if (m < 3) return '';

  const parts: string[] = [`M${xs[0].toFixed(2)} ${ys[0].toFixed(2)}`];
  for (let i = 0; i < m; i++) {
    const iPrev = (i - 1 + m) % m;
    const iNext = (i + 1) % m;
    const iNext2 = (i + 2) % m;

    const c1x = xs[i] + (xs[iNext] - xs[iPrev]) / 6;
    const c1y = ys[i] + (ys[iNext] - ys[iPrev]) / 6;
    const c2x = xs[iNext] - (xs[iNext2] - xs[i]) / 6;
    const c2y = ys[iNext] - (ys[iNext2] - ys[i]) / 6;

    parts.push(
      `C${c1x.toFixed(2)} ${c1y.toFixed(2)},${c2x.toFixed(2)} ${c2y.toFixed(2)},${xs[iNext].toFixed(2)} ${ys[iNext].toFixed(2)}`
    );
  }
  parts.push('Z');
  return parts.join('');
}

function polarPointsPath(points: PolarPoint[], closed: boolean): string {
  if (points.length === 0) return '';
  const parts: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const { theta, r } = points[i];
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  if (closed) parts.push('Z');
  return parts.join('');
}

export interface CachedRingPaths {
  ringIndex: number;
  calendarYear: number;
  outerD: string;
  outerDStride1: string;
  lwInnerD: string;
  trans2D?: string;
  ewBoundD: string;
  falseD?: string;
  defaultMarkup: string;
  highlightedMarkup: string;
}

export interface CachedFireScar {
  year: number;
  markup: string;
}

export interface CachedResinPocket {
  ringIndex: number;
  element: string;
}

export interface CachedViewBoxLayout {
  viewBox: SvgViewBox;
  vbX: number;
  vbY: number;
  vbW: number;
  vbH: number;
  pad: number;
  maxSpan: number;
  locX: number;
  locY: number;
  locW: number;
  locH: number;
}

export const MAX_BUNDLE_CACHE_SIZE = 3;

export interface PaletteMarkupCache {
  rings: CachedRingPaths[];
  ringBlocks: string[];
  pithMarkup: string;
  barkLayerMarkup: string;
  fireScars: CachedFireScar[];
  resinPockets: CachedResinPocket[];
}

export interface SimSvgCache {
  rings: CachedRingPaths[];
  ringBlocks: string[];
  pithMarkup: string;
  cambiumBarkSmoothD: string;
  barkDefsClipPaths: string;
  barkLayerMarkup: string;
  fireScars: CachedFireScar[];
  resinPockets: CachedResinPocket[];
  layoutCache: Map<string, CachedViewBoxLayout>;
  bundleCache: Map<string, GeneratedSvgBundle>;
  rayPathsCache: Map<boolean, { woodRayPaths: string; phloemRayPaths: string }>;
  paletteMarkupCache: Map<PaletteId, PaletteMarkupCache>;
  getLayout: (showBark: boolean, showAnnotations: boolean, showLocatorMap: boolean) => CachedViewBoxLayout;
  getRayPaths: (showBark: boolean) => { woodRayPaths: string; phloemRayPaths: string };
  getPaletteMarkup: (palette: PaletteDefinition) => PaletteMarkupCache;
}

const simSvgCacheMap = new WeakMap<TreeSimulationResult, SimSvgCache>();

export function getSimSvgCache(sim: TreeSimulationResult): SimSvgCache | undefined {
  const cache = simSvgCacheMap.get(sim);
  if (cache && !cache.bundleCache) {
    cache.bundleCache = new Map<string, GeneratedSvgBundle>();
  }
  return cache;
}

export function invalidateSimSvgCache(sim: TreeSimulationResult): void {
  simSvgCacheMap.delete(sim);
}

function computeViewBoxLayout(
  sim: TreeSimulationResult,
  showBark: boolean,
  showAnnotations: boolean,
  showLocatorMap: boolean
): CachedViewBoxLayout {
  const outerRefRadii = showBark
    ? sim.bark.outerBarkRadiusMm
    : sim.bark.cambiumRadiusMm;
  const outerRefAngles = showBark
    ? sim.bark.barkAnglesRad
    : sim.anglesRad;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < outerRefRadii.length; i++) {
    const r = outerRefRadii[i];
    const theta = outerRefAngles[i];
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const maxSpan = Math.max(spanX, spanY, 20);
  const pad = maxSpan * (showAnnotations || showLocatorMap ? 0.13 : 0.06);
  const bottomExtra = showAnnotations ? maxSpan * 0.08 : 0;

  const vbY = minY - pad;
  const vbH = spanY + pad * 2 + bottomExtra;

  const locMargin = pad * 0.36;
  const locW = maxSpan * 0.27;
  const locH = locW * (LOCATOR_MAP_HEIGHT / LOCATOR_MAP_WIDTH);
  const locY = vbY + locMargin;

  let padX = pad;
  if (showLocatorMap) {
    const locGap = maxSpan * 0.038;
    const bandBottom = locY + locH + locGap;
    for (let i = 0; i < outerRefRadii.length; i++) {
      const r = outerRefRadii[i];
      const theta = outerRefAngles[i];
      const y = r * Math.sin(theta);
      if (y <= bandBottom) {
        const x = r * Math.cos(theta);
        const yFrac = Math.max(0, Math.min(1, (y - locY) / locH));
        const continentRightFrac =
          yFrac <= 0.48 ? 0.99 : yFrac <= 0.82 ? 0.83 : 0.75;
        const targetVbX =
          x - locGap - locW * continentRightFrac - locMargin;
        padX = Math.max(padX, minX - targetVbX);
      }
    }
  }
  if (showAnnotations) {
    const minAnnotatedWidth = maxSpan * 1.24;
    if (spanX + padX * 2 < minAnnotatedWidth) {
      padX = (minAnnotatedWidth - spanX) / 2;
    }
  }

  const vbX = minX - padX;
  const vbW = spanX + padX * 2;
  const locX = vbX + locMargin;

  return {
    viewBox: { x: vbX, y: vbY, width: vbW, height: vbH },
    vbX,
    vbY,
    vbW,
    vbH,
    pad,
    maxSpan,
    locX,
    locY,
    locW,
    locH,
  };
}

export function precomputeSimSvgCache(sim: TreeSimulationResult): SimSvgCache {
  // 1. Precompute ring paths and geometry
  interface PrecomputedRingGeom {
    ringIndex: number;
    calendarYear: number;
    rec: (typeof sim.rings)[0]['record'];
    outerD: string;
    outerDStride1: string;
    lwInnerD: string;
    trans2D?: string;
    ewBoundD: string;
    falseD?: string;
    falseWidth: number;
  }

  const ringGeoms: PrecomputedRingGeom[] = [];
  for (let i = 0; i < sim.rings.length; i++) {
    const ring = sim.rings[i];
    const rec = ring.record;
    const approxR = ring.outerRadiusMm[0];
    const stride = approxR > 45 ? 1 : 2;

    const outerD = polarSmoothClosedPath(ring.outerRadiusMm, sim.anglesRad, stride);
    const outerDStride1 =
      stride === 1 ? outerD : polarSmoothClosedPath(ring.outerRadiusMm, sim.anglesRad, 1);
    const lwInnerD = polarSmoothClosedPath(ring.lwInnerRadiusMm, sim.anglesRad, stride);

    let trans2D: string | undefined;
    if (ring.transition2RadiusMm) {
      trans2D = polarSmoothClosedPath(ring.transition2RadiusMm, sim.anglesRad, stride);
    }

    const ewBoundD = polarSmoothClosedPath(ring.ewBoundaryRadiusMm, sim.anglesRad, stride);

    let falseD: string | undefined;
    if (ring.falseRingRadiusMm) {
      falseD = polarSmoothClosedPath(ring.falseRingRadiusMm, sim.anglesRad, stride);
    }

    const falseWidth = Math.max(0.08, rec.meanWidthMm * 0.085);

    ringGeoms.push({
      ringIndex: rec.ringIndex,
      calendarYear: rec.calendarYear,
      rec,
      outerD,
      outerDStride1,
      lwInnerD,
      trans2D,
      ewBoundD,
      falseD,
      falseWidth,
    });
  }

  // 2. Precompute pith geometry
  const pithD =
    sim.rings.length > 0
      ? polarSmoothClosedPath(sim.rings[0].innerRadiusMm, sim.anglesRad, 2)
      : '';

  // 3. Precompute bark contours and defs
  const cambiumBarkSmoothD = polarSmoothClosedPath(sim.bark.cambiumRadiusMm, sim.anglesRad, 1);
  const cambiumReverseD = polarPolygonClosedPath(sim.bark.cambiumRadiusMm, sim.anglesRad, true);
  const outerBarkD = polarPolygonClosedPath(sim.bark.outerBarkRadiusMm, sim.bark.barkAnglesRad, false);
  const phloemOuterD = polarPolygonClosedPath(sim.bark.phloemOuterRadiusMm, sim.bark.barkAnglesRad, false);
  const phloemReverseD = polarPolygonClosedPath(sim.bark.phloemOuterRadiusMm, sim.bark.barkAnglesRad, true);

  const barkDefsClipPaths =
    `<clipPath id="rhytidome-clip"><path clip-rule="evenodd" d="${outerBarkD}${phloemReverseD}"/></clipPath>` +
    `<clipPath id="phloem-clip"><path clip-rule="evenodd" d="${phloemOuterD}${cambiumReverseD}"/></clipPath>`;

  // 4. Precompute ray generator function & cache
  const rayPathsCache = new Map<boolean, { woodRayPaths: string; phloemRayPaths: string }>();

  function computeRayPaths(showBark: boolean): { woodRayPaths: string; phloemRayPaths: string } {
    if (sim.rings.length === 0) return { woodRayPaths: '', phloemRayPaths: '' };
    const outerRefRadii = showBark ? sim.bark.outerBarkRadiusMm : sim.bark.cambiumRadiusMm;
    const outerRefAngles = showBark ? sim.bark.barkAnglesRad : sim.anglesRad;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < outerRefRadii.length; i++) {
      const r = outerRefRadii[i];
      const theta = outerRefAngles[i];
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const maxSpan = Math.max(maxX - minX, maxY - minY, 20);

    const rayRng = new SeededRNG(`${sim.seedKey}:rays`);
    const rayCount = Math.min(240, Math.max(96, Math.round(maxSpan * 0.48)));
    const wPaths: string[] = [];
    const pPaths: string[] = [];
    const maxWoodR = Math.max(...sim.bark.cambiumRadiusMm);
    const maxPhloemR = Math.max(...sim.bark.phloemOuterRadiusMm);

    for (let rIdx = 0; rIdx < rayCount; rIdx++) {
      const baseTheta = (rIdx / rayCount) * 2 * Math.PI + rayRng.range(-0.012, 0.012);
      const startFrac =
        rIdx % 3 === 0
          ? 0.03
          : rIdx % 3 === 1
            ? rayRng.range(0.18, 0.45)
            : rayRng.range(0.45, 0.75);
      const cosT = Math.cos(baseTheta);
      const sinT = Math.sin(baseTheta);
      const rStart = Math.max(sim.pithRadiusMm * 1.2, maxWoodR * startFrac);
      const rWoodEnd = maxWoodR * 1.05;
      wPaths.push(
        `M${(rStart * cosT).toFixed(2)} ${(rStart * sinT).toFixed(2)}L${(rWoodEnd * cosT).toFixed(2)} ${(rWoodEnd * sinT).toFixed(2)}`
      );
      if (showBark && rIdx % 2 === 0) {
        const rPhloemStart = Math.max(0.5, sim.pithRadiusMm);
        const rPhloemEnd = maxPhloemR * 1.03;
        pPaths.push(
          `M${(rPhloemStart * cosT).toFixed(2)} ${(rPhloemStart * sinT).toFixed(2)}L${(rPhloemEnd * cosT).toFixed(2)} ${(rPhloemEnd * sinT).toFixed(2)}`
        );
      }
    }
    return {
      woodRayPaths: wPaths.join(''),
      phloemRayPaths: pPaths.join(''),
    };
  }

  function getRayPaths(showBark: boolean) {
    let cached = rayPathsCache.get(showBark);
    if (!cached) {
      cached = computeRayPaths(showBark);
      rayPathsCache.set(showBark, cached);
    }
    return cached;
  }

  // Precompute bark layer elements (bark is only rendered with showBark = true)
  const defaultRaysWithBark = getRayPaths(true);
  const phloemRayPaths = defaultRaysWithBark.phloemRayPaths;

  let bMinX = Infinity;
  let bMaxX = -Infinity;
  let bMinY = Infinity;
  let bMaxY = -Infinity;
  for (let i = 0; i < sim.bark.outerBarkRadiusMm.length; i++) {
    const r = sim.bark.outerBarkRadiusMm[i];
    const theta = sim.bark.barkAnglesRad[i];
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    if (x < bMinX) bMinX = x;
    if (x > bMaxX) bMaxX = x;
    if (y < bMinY) bMinY = y;
    if (y > bMaxY) bMaxY = y;
  }
  const barkMaxSpan = Math.max(bMaxX - bMinX, bMaxY - bMinY, 20);
  const outerStrokeW = Math.min(0.85, Math.max(0.22, barkMaxSpan * 0.0014));
  const innerPeridermW = Math.min(0.52, Math.max(0.16, sim.bark.phloemThicknessMm * 0.18));

  // Palette-driven markup generator
  function buildPaletteMarkup(pal: PaletteDefinition): PaletteMarkupCache {
    const palRings: CachedRingPaths[] = [];
    for (const g of ringGeoms) {
      const rec = g.rec;
      const ewFill = rec.isHeartwood
        ? blendHex(pal.earlywoodColor, pal.heartwoodTint, 0.32)
        : pal.earlywoodColor;
      const trans1Fill = pal.transitionColors[0];
      const trans2Fill = pal.transitionColors[1] ?? pal.transitionColors[0];
      const lwFill = pal.latewoodColor;

      const defaultElements: string[] = [
        `<path data-ring="${rec.ringIndex}" data-year="${rec.calendarYear}" d="${g.outerD}" fill="${lwFill}"/>`,
        `<path data-ring="${rec.ringIndex}" d="${g.lwInnerD}" fill="${trans2Fill}"/>`,
      ];
      if (g.trans2D) {
        defaultElements.push(
          `<path data-ring="${rec.ringIndex}" d="${g.trans2D}" fill="${trans1Fill}"/>`
        );
      }
      defaultElements.push(
        `<path data-ring="${rec.ringIndex}" d="${g.ewBoundD}" fill="${ewFill}"/>`
      );
      if (g.falseD) {
        const fw = g.falseWidth;
        const falseStroke = blendHex(ewFill, lwFill, 0.7);
        defaultElements.push(
          `<path pointer-events="none" d="${g.falseD}" fill="none" stroke="${falseStroke}" stroke-width="${(fw * 1.8).toFixed(2)}" stroke-opacity="0.18"/>`,
          `<path pointer-events="none" d="${g.falseD}" fill="none" stroke="${falseStroke}" stroke-width="${fw.toFixed(2)}" stroke-opacity="0.45"/>`,
          `<path pointer-events="none" d="${g.falseD}" fill="none" stroke="${lwFill}" stroke-width="${(fw * 0.45).toFixed(2)}" stroke-opacity="0.30"/>`
        );
      }

      // Highlighted elements (for ring hover HUD or active ring focus)
      const highlightedElements: string[] = [
        `<path data-ring="${rec.ringIndex}" data-year="${rec.calendarYear}" d="${g.outerD}" fill="#0a0a0a"/>`,
        `<path data-ring="${rec.ringIndex}" d="${g.lwInnerD}" fill="#404040"/>`,
      ];
      if (g.trans2D) {
        highlightedElements.push(
          `<path data-ring="${rec.ringIndex}" d="${g.trans2D}" fill="#808080"/>`
        );
      }
      highlightedElements.push(
        `<path data-ring="${rec.ringIndex}" d="${g.ewBoundD}" fill="#ffffff"/>`
      );
      if (g.falseD) {
        const fw = g.falseWidth;
        highlightedElements.push(
          `<path pointer-events="none" d="${g.falseD}" fill="none" stroke="#666666" stroke-width="${(fw * 1.8).toFixed(2)}" stroke-opacity="0.18"/>`,
          `<path pointer-events="none" d="${g.falseD}" fill="none" stroke="#444444" stroke-width="${fw.toFixed(2)}" stroke-opacity="0.45"/>`,
          `<path pointer-events="none" d="${g.falseD}" fill="none" stroke="#111111" stroke-width="${(fw * 0.45).toFixed(2)}" stroke-opacity="0.30"/>`
        );
      }

      palRings.push({
        ringIndex: rec.ringIndex,
        calendarYear: rec.calendarYear,
        outerD: g.outerD,
        outerDStride1: g.outerDStride1,
        lwInnerD: g.lwInnerD,
        trans2D: g.trans2D,
        ewBoundD: g.ewBoundD,
        falseD: g.falseD,
        defaultMarkup: defaultElements.join('\n'),
        highlightedMarkup: highlightedElements.join('\n'),
      });
    }

    const BLOCK_SIZE = 20;
    const blockCount = Math.ceil(palRings.length / BLOCK_SIZE);
    const palRingBlocks: string[] = [];
    for (let b = 0; b < blockCount; b++) {
      const start = b * BLOCK_SIZE;
      const end = Math.min(start + BLOCK_SIZE, palRings.length);
      const blockParts: string[] = [];
      for (let i = end - 1; i >= start; i--) {
        blockParts.push(palRings[i].defaultMarkup);
      }
      palRingBlocks.push(blockParts.join('\n'));
    }

    // Pith
    const pithElements: string[] = [];
    if (sim.rings.length > 0 && pithD) {
      pithElements.push(
        `<path id="pith" d="${pithD}" fill="${pal.pithColor}"/>`,
        `<circle cx="0" cy="0" r="${(sim.pithRadiusMm * 0.42).toFixed(2)}" fill="${blendHex(pal.pithColor, pal.heartwoodTint, 0.4)}"/>`
      );
    }
    const palPithMarkup = pithElements.join('\n');

    // Bark layer
    const barkLayerElements: string[] = [
      `<g id="bark-layer">`,
      `<path d="${outerBarkD}" fill="${pal.barkPlateColor}"/>`,
      `<g id="rhytidome-anatomy" clip-path="url(#rhytidome-clip)">`,
    ];
    for (const cell of sim.bark.rhytidomeCells) {
      const cellD = polarPointsPath(cell.pointsPolar, true);
      if (cellD) {
        barkLayerElements.push(
          `<path d="${cellD}" fill="${grayHex(cell.fillGray)}" stroke="${grayHex(cell.strokeGray)}" stroke-width="${cell.strokeWidthMm.toFixed(2)}" stroke-linejoin="round"/>`
        );
      }
    }
    for (const seam of sim.bark.peridermSeams) {
      const seamD = polarPointsPath(seam.pointsPolar, false);
      if (seamD) {
        barkLayerElements.push(
          `<path d="${seamD}" fill="none" stroke="${grayHex(seam.gray)}" stroke-width="${seam.widthMm.toFixed(2)}" stroke-linecap="round"/>`
        );
      }
    }
    barkLayerElements.push(`</g>`);

    barkLayerElements.push(
      `<path d="${outerBarkD}" fill="none" stroke="${pal.barkFissureColor}" stroke-width="${outerStrokeW.toFixed(2)}" stroke-linejoin="round"/>`
    );
    barkLayerElements.push(
      `<path id="inner-phloem" d="${phloemOuterD}" fill="#d0cec6" stroke="${pal.barkFissureColor}" stroke-width="${innerPeridermW.toFixed(2)}" stroke-linejoin="round"/>`
    );
    if (phloemRayPaths) {
      const phloemRayW = Math.max(0.08, sim.bark.phloemThicknessMm * 0.075);
      barkLayerElements.push(
        `<path id="phloem-rays" pointer-events="none" clip-path="url(#phloem-clip)" d="${phloemRayPaths}" fill="none" stroke="#4a4944" stroke-width="${phloemRayW.toFixed(2)}" stroke-opacity="0.22"/>`
      );
    }
    barkLayerElements.push(`</g>`);
    const palBarkMarkup = barkLayerElements.join('\n');

    // Fire scars: shallow anatomical charred cambial crust ribbons tracing exact killed ring contours
    const palFireScars: CachedFireScar[] = (sim.fireScars ?? []).map((scar) => {
      let pts: PolarPoint[] = scar.scarArcPoints ?? [];
      if (pts.length < 3) {
        const startAngle = scar.catfaceArcStartRad;
        let arcSpan = scar.catfaceArcEndRad - startAngle;
        if (arcSpan < 0) arcSpan += 2 * Math.PI;
        if (arcSpan <= 0.05) arcSpan = 0.6;
        const fallbackN = 32;
        pts = [];
        for (let i = 0; i < fallbackN; i++) {
          const u = i / (fallbackN - 1);
          pts.push({
            theta: startAngle + u * arcSpan,
            r: scar.exposedWoodRadiusMm,
          });
        }
      }

      const charDepthMm = Math.max(
        1.0,
        Math.min(2.4, 1.1 + (scar.fireIntensity ?? 0.65) * 1.1)
      );
      const outerPts: string[] = [];
      const innerPts: string[] = [];
      const innerLinePts: string[] = [];

      for (let i = 0; i < pts.length; i++) {
        const u = i / (pts.length - 1);
        const pt = pts[i];
        const taper = Math.pow(Math.sin(u * Math.PI), 0.55);
        const rOuter = pt.r + 0.25 + 0.35 * taper;
        const rInner = Math.max(2.0, pt.r - charDepthMm * (0.22 + 0.78 * taper));
        const cosT = Math.cos(pt.theta);
        const sinT = Math.sin(pt.theta);

        const ox = (rOuter * cosT).toFixed(2);
        const oy = (rOuter * sinT).toFixed(2);
        const ix = (rInner * cosT).toFixed(2);
        const iy = (rInner * sinT).toFixed(2);

        outerPts.push(`${i === 0 ? 'M' : 'L'}${ox} ${oy}`);
        innerPts.push(`L${ix} ${iy}`);
        innerLinePts.push(`${i === 0 ? 'M' : 'L'}${ix} ${iy}`);
      }

      const charRibbonD = `${outerPts.join('')}${innerPts.reverse().join('')}Z`;
      const innerLineD = innerLinePts.join('');

      const elements: string[] = [
        `<path data-fire-year="${scar.year}" data-rescar="${scar.isRescar ? 'true' : 'false'}" d="${charRibbonD}" fill="${pal.fireCharColor}" fill-opacity="0.93" stroke="${pal.fireCharColor}" stroke-width="0.35" stroke-linejoin="round"/>`,
        `<path pointer-events="none" d="${innerLineD}" fill="none" stroke="${pal.resinColor}" stroke-width="0.6" stroke-opacity="0.38" stroke-linecap="round"/>`,
      ];
      return {
        year: scar.year,
        markup: elements.join('\n'),
      };
    });

    // Resin pockets
    const palResinPockets: CachedResinPocket[] = (sim.resinPockets ?? []).map((pocket) => ({
      ringIndex: pocket.ringIndex,
      element: `<path data-ring="${pocket.ringIndex}" d="${pocket.pathD}" fill="${pal.resinColor}" fill-opacity="0.85" stroke="${blendHex(pal.resinColor, '#000000', 0.65)}" stroke-width="0.45"/>`,
    }));

    return {
      rings: palRings,
      ringBlocks: palRingBlocks,
      pithMarkup: palPithMarkup,
      barkLayerMarkup: palBarkMarkup,
      fireScars: palFireScars,
      resinPockets: palResinPockets,
    };
  }

  const paletteMarkupCache = new Map<PaletteId, PaletteMarkupCache>();

  function getPaletteMarkup(pal: PaletteDefinition): PaletteMarkupCache {
    let cached = paletteMarkupCache.get(pal.id);
    if (!cached) {
      cached = buildPaletteMarkup(pal);
      paletteMarkupCache.set(pal.id, cached);
    }
    return cached;
  }

  // Prewarm default aged-wood palette
  const defaultPalette = getPalette(DEFAULT_PALETTE_ID);
  const defaultMarkup = getPaletteMarkup(defaultPalette);

  // Layout cache
  const layoutCache = new Map<string, CachedViewBoxLayout>();

  function getLayout(
    showBark: boolean,
    showAnnotations: boolean,
    showLocatorMap: boolean
  ): CachedViewBoxLayout {
    const key = `${showBark}:${showAnnotations}:${showLocatorMap}`;
    let cached = layoutCache.get(key);
    if (!cached) {
      cached = computeViewBoxLayout(sim, showBark, showAnnotations, showLocatorMap);
      layoutCache.set(key, cached);
    }
    return cached;
  }

  // Prewarm standard layouts and rays
  getLayout(true, true, true);
  getLayout(false, true, true);
  getRayPaths(false);

  const cacheObj: SimSvgCache = {
    rings: defaultMarkup.rings,
    ringBlocks: defaultMarkup.ringBlocks,
    pithMarkup: defaultMarkup.pithMarkup,
    cambiumBarkSmoothD,
    barkDefsClipPaths,
    barkLayerMarkup: defaultMarkup.barkLayerMarkup,
    fireScars: defaultMarkup.fireScars,
    resinPockets: defaultMarkup.resinPockets,
    layoutCache,
    bundleCache: new Map<string, GeneratedSvgBundle>(),
    rayPathsCache,
    paletteMarkupCache,
    getLayout,
    getRayPaths,
    getPaletteMarkup,
  };

  simSvgCacheMap.set(sim, cacheObj);
  return cacheObj;
}

export function getOrCreateSimSvgCache(sim: TreeSimulationResult): SimSvgCache {
  let cache = simSvgCacheMap.get(sim);
  if (!cache) {
    cache = precomputeSimSvgCache(sim);
  } else if (!cache.bundleCache) {
    cache.bundleCache = new Map<string, GeneratedSvgBundle>();
  }
  return cache;
}

/**
 * Generates both the standalone SVG string and pre-parsed inner vector markup + viewBox
 * for native infinite-resolution vector pan & zoom.
 */
export function generateCrossSectionSvgBundle(
  sim: TreeSimulationResult,
  options: SvgRenderOptions
): GeneratedSvgBundle {
  const profile = SPECIES_PROFILES[sim.params.species];
  const cache = getOrCreateSimSvgCache(sim);

  const showBark = options.showBark;
  const showAnnotations = options.showAnnotations;
  const showLocator = options.showLocatorMap ?? true;
  const showCaption = options.showCaptionText ?? true;
  const palette = getPalette(options.paletteId ?? options.palette?.id);
  const palMarkup = cache.getPaletteMarkup(palette);
  const enableFilter = Boolean(options.enableWoodGrain ?? options.enableTextureFilter);

  // Calibrate ring slicing limit
  const rawMax =
    options.maxRenderedRingIndex !== undefined &&
    !Number.isNaN(options.maxRenderedRingIndex)
      ? Math.floor(options.maxRenderedRingIndex)
      : sim.rings.length;
  const effectiveMaxRing = Math.max(1, Math.min(sim.rings.length, rawMax));

  // Check bundle memoization cache
  const cacheKey = `${effectiveMaxRing}:${options.highlightedRingIndex ?? ''}:${showBark}:${Boolean(options.showMedullaryRays)}:${showAnnotations}:${showLocator}:${showCaption}:${options.transparentBackground}:${options.unitSystem ?? 'us'}:${palette.id}:${enableFilter ? 'grain' : 'nograin'}`;
  const cachedBundle = cache.bundleCache.get(cacheKey);
  if (cachedBundle) {
    // Refresh LRU order on cache hit
    cache.bundleCache.delete(cacheKey);
    cache.bundleCache.set(cacheKey, cachedBundle);
    return cachedBundle;
  }

  const layout = cache.getLayout(showBark, showAnnotations, showLocator);
  const { viewBox, vbX, vbY, vbW, vbH, pad, maxSpan, locX, locY, locW } = layout;

  const elements: string[] = [];

  const isPeeledInterior =
    options.maxRenderedRingIndex !== undefined &&
    effectiveMaxRing < sim.rings.length;

  const cambiumSmoothD =
    isPeeledInterior && effectiveMaxRing > 0 && effectiveMaxRing <= palMarkup.rings.length
      ? palMarkup.rings[effectiveMaxRing - 1].outerDStride1
      : cache.cambiumBarkSmoothD;

  const filterDefs = enableFilter
    ? generateTextureFilterDefs({
        ...options.textureFilterOptions,
        enableWoodGrain: true,
        wrapDefs: false,
      })
    : '';

  // Definitions: wood clip path + annular phloem & rhytidome clip paths
  elements.push(
    `<defs>` +
      filterDefs +
      `<clipPath id="wood-clip"><path d="${cambiumSmoothD}"/></clipPath>` +
      (options.showBark && !isPeeledInterior ? cache.barkDefsClipPaths : '') +
      `</defs>`
  );

  // Layer 1: Anatomical Outer Rhytidome & Living Inner Phloem
  if (options.showBark && !isPeeledInterior) {
    elements.push(palMarkup.barkLayerMarkup);
  }

  // Layer 2: Smooth Cubic-Bezier Annual Growth Rings from outermost (K) inward to (1)
  const filterAttr = enableFilter ? ` filter="url(#${WOOD_GRAIN_FILTER_ID})"` : '';
  elements.push(`<g id="annual-rings"${filterAttr}>`);
  const highlightedIdx = options.highlightedRingIndex ?? null;
  const ringLimit = Math.min(effectiveMaxRing, palMarkup.rings.length);

  if (highlightedIdx !== null) {
    // Individual ring loop only when single ring is highlighted
    for (let i = ringLimit - 1; i >= 0; i--) {
      const rc = palMarkup.rings[i];
      elements.push(
        rc.ringIndex === highlightedIdx
          ? rc.highlightedMarkup
          : rc.defaultMarkup
      );
    }
  } else {
    // O(1) multi-century block slicing for continuous 60fps scrubbing
    const fullBlockCount = Math.floor(ringLimit / 20);
    for (let i = ringLimit - 1; i >= fullBlockCount * 20; i--) {
      elements.push(palMarkup.rings[i].defaultMarkup);
    }
    for (let b = fullBlockCount - 1; b >= 0; b--) {
      elements.push(palMarkup.ringBlocks[b]);
    }
  }

  // Central Pith
  if (palMarkup.pithMarkup) {
    elements.push(palMarkup.pithMarkup);
  }
  elements.push(`</g>`);

  // Layer 2b: Traumatic Micro-Disturbances (Fire Scars & Resin Pockets)
  if (palMarkup.fireScars.length > 0) {
    elements.push(`<g id="fire-scars">`);
    const activeYear =
      sim.rings.length > 0 && effectiveMaxRing > 0 && effectiveMaxRing <= sim.rings.length
        ? sim.rings[effectiveMaxRing - 1].record.calendarYear
        : sim.params.deathYear;
    for (const scar of palMarkup.fireScars) {
      if (options.maxRenderedRingIndex !== undefined && scar.year > activeYear) {
        continue;
      }
      elements.push(scar.markup);
    }
    elements.push(`</g>`);
  }

  if (palMarkup.resinPockets.length > 0) {
    elements.push(`<g id="resin-pockets">`);
    for (const pocket of palMarkup.resinPockets) {
      if (
        options.maxRenderedRingIndex !== undefined &&
        pocket.ringIndex > effectiveMaxRing
      ) {
        continue;
      }
      elements.push(pocket.element);
    }
    elements.push(`</g>`);
  }

  // Layer 3: Subtle Radial Medullary Rays
  const { woodRayPaths } = cache.getRayPaths(Boolean(options.showBark));
  if (options.showMedullaryRays && woodRayPaths) {
    const rayStrokeW = Math.max(0.07, maxSpan * 0.00055);
    elements.push(
      `<path id="medullary-rays" pointer-events="none" clip-path="url(#wood-clip)" d="${woodRayPaths}" fill="none" stroke="#1f1f1f" stroke-width="${rayStrokeW.toFixed(2)}" stroke-opacity="0.11"/>`
    );
  }

  // Layer 3b: Vascular Cambium Meristem Boundary (drawn above outermost latewood so stroke is unclipped)
  const cambiumStrokeW =
    options.showBark && !isPeeledInterior
      ? Math.min(0.36, Math.max(0.13, sim.bark.phloemThicknessMm * 0.13))
      : Math.max(0.3, maxSpan * 0.002);
  elements.push(
    `<path id="vascular-cambium" pointer-events="none" d="${cambiumSmoothD}" fill="none" stroke="${options.showBark && !isPeeledInterior ? '#2d2d2b' : '#222222'}" stroke-width="${cambiumStrokeW.toFixed(2)}"/>`
  );

  // Layer 4: Scientific Scale Bar, Orientation Compass, & Specimen Metadata
  if (options.showAnnotations) {
    const units: UnitSystem = options.unitSystem ?? 'us';
    const fontSize = maxSpan * 0.0235;
    const smallFont = fontSize * 0.78;
    const strokeW = maxSpan * 0.0023;

    const scaleSpec = chooseScaleBar(maxSpan, units);
    const scaleMm = scaleSpec.lengthMm;
    const barX = vbX + pad * 0.55;
    const barY = vbY + vbH - pad * 0.62;
    const scaleLabel = scaleSpec.label;

    elements.push(
      `<g id="annotations" pointer-events="none" fill="${palette.annotationColor}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">`
    );
    elements.push(
      `<line x1="${barX.toFixed(2)}" y1="${barY.toFixed(2)}" x2="${(barX + scaleMm).toFixed(2)}" y2="${barY.toFixed(2)}" stroke="${palette.annotationColor}" stroke-width="${(strokeW * 1.35).toFixed(2)}"/>` +
        `<line x1="${barX.toFixed(2)}" y1="${(barY - fontSize * 0.35).toFixed(2)}" x2="${barX.toFixed(2)}" y2="${(barY + fontSize * 0.35).toFixed(2)}" stroke="${palette.annotationColor}" stroke-width="${strokeW.toFixed(2)}"/>` +
        `<line x1="${(barX + scaleMm).toFixed(2)}" y1="${(barY - fontSize * 0.35).toFixed(2)}" x2="${(barX + scaleMm).toFixed(2)}" y2="${(barY + fontSize * 0.35).toFixed(2)}" stroke="${palette.annotationColor}" stroke-width="${strokeW.toFixed(2)}"/>` +
        `<text x="${barX.toFixed(2)}" y="${(barY - fontSize * 0.58).toFixed(2)}" font-size="${smallFont.toFixed(2)}" font-weight="600">${scaleLabel}</text>`
    );

    if (showCaption) {
      const latLabel = `${Math.abs(sim.params.latitude).toFixed(4)}°${sim.params.latitude >= 0 ? 'N' : 'S'}`;
      const lonLabel = `${Math.abs(sim.params.longitude).toFixed(4)}°${sim.params.longitude >= 0 ? 'E' : 'W'}`;
      const stumpLabel = formatStumpHeightShort(sim.stumpHeightM, units);
      const rightX = vbX + vbW - pad * 0.55;
      const activeRecord =
        sim.rings.length > 0 && effectiveMaxRing > 0 && effectiveMaxRing <= sim.rings.length
          ? sim.rings[effectiveMaxRing - 1].record
          : null;
      const extentSubtext =
        isPeeledInterior && activeRecord
          ? `Modeled Extent: ${activeRecord.treeAge}y (Ring #${effectiveMaxRing}, ${sim.firstRingYear}–${activeRecord.calendarYear} CE)`
          : `Chronology Extent: ${sim.params.totalAge}y (${sim.visibleRingCount} Annual Rings, ${sim.firstRingYear}–${sim.params.deathYear} CE)`;

      elements.push(
        `<text x="${rightX.toFixed(2)}" y="${(barY - smallFont * 0.95).toFixed(2)}" text-anchor="end" font-size="${smallFont.toFixed(2)}" font-style="italic">${profile.scientificName} (${profile.commonName})</text>` +
          `<text x="${rightX.toFixed(2)}" y="${(barY + smallFont * 0.35).toFixed(2)}" text-anchor="end" font-size="${(smallFont * 0.88).toFixed(2)}" fill="${palette.annotationColor}" fill-opacity="0.75">${latLabel}, ${lonLabel} · h=${stumpLabel} · ${extentSubtext}</text>`
      );
    }

    const compR = fontSize * 1.45;
    const compX = vbX + vbW - pad * 0.55 - compR;
    const compY = vbY + pad * 0.58 + compR;
    const leanRad = ((sim.leanAzimuthDeg - 90) * Math.PI) / 180;
    const lx = compX + compR * 0.82 * Math.cos(leanRad);
    const ly = compY + compR * 0.82 * Math.sin(leanRad);

    elements.push(
      `<circle cx="${compX.toFixed(2)}" cy="${compY.toFixed(2)}" r="${compR.toFixed(2)}" fill="none" stroke="${palette.annotationColor}" stroke-opacity="0.6" stroke-width="${(strokeW * 0.75).toFixed(2)}"/>` +
        `<line x1="${compX.toFixed(2)}" y1="${(compY + compR * 0.65).toFixed(2)}" x2="${compX.toFixed(2)}" y2="${(compY - compR * 0.82).toFixed(2)}" stroke="${palette.annotationColor}" stroke-width="${strokeW.toFixed(2)}"/>` +
        `<text x="${compX.toFixed(2)}" y="${(compY - compR * 1.08).toFixed(2)}" text-anchor="middle" font-size="${smallFont.toFixed(2)}" font-weight="700">N</text>` +
        `<line x1="${compX.toFixed(2)}" y1="${compY.toFixed(2)}" x2="${lx.toFixed(2)}" y2="${ly.toFixed(2)}" stroke="${palette.annotationColor}" stroke-opacity="0.6" stroke-width="${(strokeW * 0.9).toFixed(2)}" stroke-dasharray="${(strokeW * 1.8).toFixed(2)} ${(strokeW * 1.2).toFixed(2)}"/>`
    );
    elements.push(`</g>`);
  }

  // Layer 5: Minimalist Tuftean Top-Left Locator Map (frameless North America, native range, specimen dot)
  if (showLocator) {
    const mapScale = locW / LOCATOR_MAP_WIDTH;
    const projPin = projectToLocatorMap(
      sim.params.latitude,
      sim.params.longitude
    );
    const px = projPin.inFrame ? projPin.x : projPin.clampedX;
    const py = projPin.inFrame ? projPin.y : projPin.clampedY;
    const lakeFill = options.transparentBackground ? '#ededeb' : palette.background;

    const pinMarkup = projPin.inFrame
      ? `<circle id="locator-specimen-pin" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="15.5" fill="#0a0a0a" stroke="#ffffff" stroke-width="7.5"/>`
      : `<circle id="locator-specimen-pin" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="15" fill="none" stroke="${palette.annotationColor}" stroke-width="5" stroke-dasharray="8 6"/>`;

    elements.push(
      `<g id="locator-map" pointer-events="none" transform="translate(${locX.toFixed(2)} ${locY.toFixed(2)}) scale(${mapScale.toFixed(5)})">` +
        `<path d="${NA_LAND_PATH}" fill="#ffffff" stroke="#8f8f88" stroke-width="2.2" stroke-linejoin="round"/>` +
        `<path d="${NA_GREAT_LAKES_PATH}" fill="${lakeFill}" stroke="#8f8f88" stroke-width="1.8" stroke-linejoin="round"/>` +
        `<path data-species-range="${sim.params.species}" fill-rule="evenodd" d="${SPECIES_NATIVE_RANGE_PATH[sim.params.species]}" fill="#42423e" fill-opacity="0.68"/>` +
        pinMarkup +
        `</g>`
    );
  }

  const innerContent = elements.join('\n');
  const bgPad = Math.max(vbW, vbH) * 2;
  const innerMarkup = !options.transparentBackground
    ? `<rect x="${(vbX - bgPad).toFixed(2)}" y="${(vbY - bgPad).toFixed(2)}" width="${(vbW + bgPad * 2).toFixed(2)}" height="${(vbH + bgPad * 2).toFixed(2)}" fill="${palette.background}"/>\n` +
      innerContent
    : innerContent;

  let memoizedSvgMarkup: string | undefined;
  const result: GeneratedSvgBundle = {
    get svgMarkup() {
      if (memoizedSvgMarkup === undefined) {
        const standaloneBg = !options.transparentBackground
          ? `<rect x="${vbX.toFixed(2)}" y="${vbY.toFixed(2)}" width="${vbW.toFixed(2)}" height="${vbH.toFixed(2)}" fill="${palette.background}"/>\n`
          : '';
        const standaloneBody = standaloneBg + innerContent;
        memoizedSvgMarkup = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<svg xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision" preserveAspectRatio="xMidYMid meet" viewBox="${vbX.toFixed(2)} ${vbY.toFixed(2)} ${vbW.toFixed(2)} ${vbH.toFixed(2)}" width="100%" height="100%">`,
          `<title>XYLEM: ${profile.commonName} (${profile.scientificName}) Retrospective Dendrochronological Cross-Section — Radial Ledger ${sim.seedHex}</title>`,
          standaloneBody,
          `</svg>`,
        ].join('\n');
      }
      return memoizedSvgMarkup;
    },
    innerMarkup,
    viewBox,
  };
  while (cache.bundleCache.size >= MAX_BUNDLE_CACHE_SIZE) {
    const oldestKey = cache.bundleCache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.bundleCache.delete(oldestKey);
    } else {
      break;
    }
  }
  cache.bundleCache.set(cacheKey, result);
  return result;
}

/**
 * Backwards-compatible helper returning the standalone SVG string.
 */
export function generateCrossSectionSvg(
  sim: TreeSimulationResult,
  options: SvgRenderOptions
): string {
  return generateCrossSectionSvgBundle(sim, options).svgMarkup;
}
