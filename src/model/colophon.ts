/**
 * src/model/colophon.ts
 * Typographic museum exhibition colophon border and print plate framing for XYLEM.
 */

import { generateEnvironmentalNarrative } from './narrative';
import { PaletteId } from './palettes';
import { buildShareableUrl } from './permalink';
import { SPECIES_PROFILES } from './species';
import { GeneratedSvgBundle, SvgViewBox } from './svgGenerator';
import { TreeSimulationResult } from './types';
import { formatStumpHeightShort, UnitSystem } from './units';

export interface ColophonPaletteColors {
  background: string;
  borderColor: string;
  borderHairline: string;
  textColor: string;
  textColorMid: string;
  textColorDim: string;
  accentColor: string;
}

export interface ColophonOptions {
  unitSystem?: UnitSystem;
  paletteId?: PaletteId;
  customColors?: Partial<ColophonPaletteColors>;
  permalinkUrl?: string;
  plateTitle?: string;
  plateSubtitle?: string;
  aspectRatio?: number; // e.g. 16/9 for 4K presentation; undefined for adaptive plate
  maxRenderedRingIndex?: number;
  narrative?: string;
}

export interface ColophonPlateBundle {
  svgMarkup: string;
  viewBox: SvgViewBox;
  title: string;
}

export interface ColophonLayoutMetrics {
  plateViewBox: SvgViewBox;
  artViewBox: SvgViewBox;
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
  innerInset: number;
  outerPad: number;
  strokeW: number;
  headerY: number;
  footerY: number;
  fontSizeTitle: number;
  fontSizeSub: number;
  fontSizeBody: number;
  fontSizeSmall: number;
}

const PALETTE_COLOPHON_COLORS: Record<PaletteId, ColophonPaletteColors> = {
  'aged-wood': {
    background: '#f5f0e6',
    borderColor: '#2b2621',
    borderHairline: '#827b73',
    textColor: '#1f1c19',
    textColorMid: '#4a443e',
    textColorDim: '#7a736a',
    accentColor: '#8b4513',
  },
  'charred-subalpine': {
    background: '#e8ecef',
    borderColor: '#1e252b',
    borderHairline: '#606a74',
    textColor: '#0f172a',
    textColorMid: '#334155',
    textColorDim: '#64748b',
    accentColor: '#3b82f6',
  },
  'skeleton-plot': {
    background: '#fdfcf7',
    borderColor: '#111111',
    borderHairline: '#71717a',
    textColor: '#111111',
    textColorMid: '#3f3f46',
    textColorDim: '#71717a',
    accentColor: '#dc2626',
  },
};

/**
 * Escapes XML special characters (&, <, >, ", ') to preserve SVG vector integrity.
 */
export function escapeXml(str: unknown): string {
  if (str === null || str === undefined) return '';
  const s = typeof str === 'string' ? str : String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Resolves colophon colors for a palette ID with custom overrides.
 */
export function getColophonPaletteColors(
  paletteId?: PaletteId,
  customColors?: Partial<ColophonPaletteColors>
): ColophonPaletteColors {
  const base = PALETTE_COLOPHON_COLORS[paletteId ?? 'aged-wood'] ?? PALETTE_COLOPHON_COLORS['aged-wood'];
  if (!customColors) return { ...base };
  const HEX_REGEX = /^#([0-9a-fA-F]{3,8})$/;
  const sanitized: Partial<ColophonPaletteColors> = {};
  for (const [key, val] of Object.entries(customColors)) {
    if (val !== undefined && val !== null) {
      const s = typeof val === 'string' ? val.trim() : String(val);
      sanitized[key as keyof ColophonPaletteColors] = HEX_REGEX.test(s)
        ? s
        : escapeXml(s);
    }
  }
  return { ...base, ...sanitized };
}

/**
 * Computes outer expanded viewBox layout, margins, and typography metrics.
 */
export function computeColophonLayout(
  treeViewBox: SvgViewBox,
  aspectRatio?: number
): ColophonLayoutMetrics {
  const artW = treeViewBox.width;
  const artH = treeViewBox.height;
  const maxDim = Math.max(artW, artH);

  // Archival margin proportions
  const marginTop = maxDim * 0.16;
  const marginBottom = maxDim * 0.28;
  const marginLeft = maxDim * 0.08;
  const marginRight = maxDim * 0.08;
  const outerPad = maxDim * 0.032;

  let totalW = artW + marginLeft + marginRight + outerPad * 2;
  let totalH = artH + marginTop + marginBottom + outerPad * 2;

  // Enforce target aspect ratio if provided (e.g. 16/9 for 4K presentation)
  if (aspectRatio !== undefined && aspectRatio > 0) {
    const currentRatio = totalW / totalH;
    if (currentRatio < aspectRatio) {
      // Widen horizontally
      totalW = totalH * aspectRatio;
    } else {
      // Heighten vertically
      totalH = totalW / aspectRatio;
    }
  }

  // Calculate centered outer plate coordinates keeping art at original treeViewBox (x, y)
  const plateX = treeViewBox.x - (totalW - artW) / 2;
  const plateY = treeViewBox.y - outerPad - marginTop;

  const plateViewBox: SvgViewBox = {
    x: Number(plateX.toFixed(2)),
    y: Number(plateY.toFixed(2)),
    width: Number(totalW.toFixed(2)),
    height: Number(totalH.toFixed(2)),
  };

  const strokeW = Math.max(0.4, maxDim * 0.0018);
  const fontSizeTitle = maxDim * 0.028;
  const fontSizeSub = fontSizeTitle * 0.65;
  const fontSizeBody = fontSizeTitle * 0.52;
  const fontSizeSmall = fontSizeTitle * 0.42;

  return {
    plateViewBox,
    artViewBox: treeViewBox,
    boxX: treeViewBox.x - maxDim * 0.02,
    boxY: treeViewBox.y - maxDim * 0.02,
    boxW: treeViewBox.width + maxDim * 0.04,
    boxH: treeViewBox.height + maxDim * 0.04,
    innerInset: outerPad,
    outerPad,
    strokeW,
    headerY: plateY + outerPad + maxDim * 0.045,
    footerY: treeViewBox.y + treeViewBox.height + maxDim * 0.04,
    fontSizeTitle,
    fontSizeSub,
    fontSizeBody,
    fontSizeSmall,
  };
}

/**
 * Generates decorative outer border, hairline rule, and corner bracket accents.
 */
export function generateColophonBorderRules(
  m: ColophonLayoutMetrics,
  colors: ColophonPaletteColors
): string {
  const vb = m.plateViewBox;
  const pad = m.outerPad;
  const x1 = vb.x + pad;
  const y1 = vb.y + pad;
  const w = vb.width - pad * 2;
  const h = vb.height - pad * 2;

  const innerGap = pad * 0.35;
  const ix1 = x1 + innerGap;
  const iy1 = y1 + innerGap;
  const iw = w - innerGap * 2;
  const ih = h - innerGap * 2;

  const bracketLen = Math.max(12, m.artViewBox.width * 0.035);
  const bX = m.boxX;
  const bY = m.boxY;
  const bW = m.boxW;
  const bH = m.boxH;

  const elements: string[] = [
    `<g id="colophon-borders" pointer-events="none">`,
    // Heavy outer border
    `<rect x="${x1.toFixed(2)}" y="${y1.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="none" stroke="${colors.borderColor}" stroke-width="${(m.strokeW * 1.8).toFixed(2)}"/>`,
    // Subtle inner hairline rule
    `<rect x="${ix1.toFixed(2)}" y="${iy1.toFixed(2)}" width="${iw.toFixed(2)}" height="${ih.toFixed(2)}" fill="none" stroke="${colors.borderHairline}" stroke-width="${(m.strokeW * 0.5).toFixed(2)}" stroke-opacity="0.6"/>`,
    // Corner brackets framing the tree artwork window (┌ ┐ └ ┘)
    `<path d="M ${bX.toFixed(2)} ${(bY + bracketLen).toFixed(2)} L ${bX.toFixed(2)} ${bY.toFixed(2)} L ${(bX + bracketLen).toFixed(2)} ${bY.toFixed(2)}" fill="none" stroke="${colors.borderHairline}" stroke-width="${m.strokeW.toFixed(2)}"/>`,
    `<path d="M ${(bX + bW - bracketLen).toFixed(2)} ${bY.toFixed(2)} L ${(bX + bW).toFixed(2)} ${bY.toFixed(2)} L ${(bX + bW).toFixed(2)} ${(bY + bracketLen).toFixed(2)}" fill="none" stroke="${colors.borderHairline}" stroke-width="${m.strokeW.toFixed(2)}"/>`,
    `<path d="M ${bX.toFixed(2)} ${(bY + bH - bracketLen).toFixed(2)} L ${bX.toFixed(2)} ${(bY + bH).toFixed(2)} L ${(bX + bracketLen).toFixed(2)} ${(bY + bH).toFixed(2)}" fill="none" stroke="${colors.borderHairline}" stroke-width="${m.strokeW.toFixed(2)}"/>`,
    `<path d="M ${(bX + bW - bracketLen).toFixed(2)} ${(bY + bH).toFixed(2)} L ${(bX + bW).toFixed(2)} ${(bY + bH).toFixed(2)} L ${(bX + bW).toFixed(2)} ${(bY + bH - bracketLen).toFixed(2)}" fill="none" stroke="${colors.borderHairline}" stroke-width="${m.strokeW.toFixed(2)}"/>`,
    `</g>`,
  ];

  return elements.join('\n');
}

/**
 * Generates typographic museum plate header.
 */
export function generateColophonHeader(
  sim: TreeSimulationResult,
  m: ColophonLayoutMetrics,
  colors: ColophonPaletteColors,
  options: ColophonOptions
): string {
  const profile = SPECIES_PROFILES[sim.params.species];
  const units = options.unitSystem ?? 'us';
  const centerX = m.plateViewBox.x + m.plateViewBox.width / 2;
  let curY = m.headerY;

  const eyebrow = 'XYLEM · ARBOREAL CLIMATE MEMORY ARCHIVE · DENDROCHRONOLOGY SERIES';
  const defaultPlateTitle = `PLATE I · ${profile.commonName.toUpperCase()}`;
  const plateTitle = options.plateTitle ?? defaultPlateTitle;
  const stumpHeightStr = formatStumpHeightShort(sim.stumpHeightM, units);
  const defaultSubtitle = `${profile.scientificName} · Anatomical Cross-Section at Stump Height (h = ${stumpHeightStr})`;
  const plateSubtitle = options.plateSubtitle ?? defaultSubtitle;

  const elements: string[] = [
    `<g id="colophon-header" pointer-events="none" text-anchor="middle">`,
    // Eyebrow series label
    `<text x="${centerX.toFixed(2)}" y="${curY.toFixed(2)}" fill="${colors.textColorDim}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${m.fontSizeSmall.toFixed(2)}" font-weight="600" letter-spacing="0.12em">${escapeXml(eyebrow)}</text>`,
  ];

  curY += m.fontSizeTitle * 1.15;
  // Main Plate Title
  elements.push(
    `<text x="${centerX.toFixed(2)}" y="${curY.toFixed(2)}" fill="${colors.textColor}" font-family="Georgia, 'Times New Roman', serif" font-size="${m.fontSizeTitle.toFixed(2)}" font-weight="700" letter-spacing="0.04em">${escapeXml(plateTitle)}</text>`
  );

  curY += m.fontSizeSub * 1.25;
  // Subtitle
  elements.push(
    `<text x="${centerX.toFixed(2)}" y="${curY.toFixed(2)}" fill="${colors.textColorMid}" font-family="Georgia, 'Times New Roman', serif" font-size="${m.fontSizeSub.toFixed(2)}" font-style="italic">${escapeXml(plateSubtitle)}</text>`,
    `</g>`
  );

  return elements.join('\n');
}

/**
 * Generates 3-column curatorial metadata grid, climate narrative, and permalink.
 */
export function generateColophonFooter(
  sim: TreeSimulationResult,
  m: ColophonLayoutMetrics,
  colors: ColophonPaletteColors,
  options: ColophonOptions
): string {
  const profile = SPECIES_PROFILES[sim.params.species];
  const units = options.unitSystem ?? 'us';
  const leftX = m.plateViewBox.x + m.outerPad * 1.8;
  const totalW = m.plateViewBox.width - m.outerPad * 3.6;
  const colW = totalW / 3;

  const latLabel = `${Math.abs(sim.params.latitude).toFixed(4)}°${sim.params.latitude >= 0 ? 'N' : 'S'}`;
  const lonLabel = `${Math.abs(sim.params.longitude).toFixed(4)}°${sim.params.longitude >= 0 ? 'E' : 'W'}`;
  const elevLabel = `${Math.round(sim.environment.terrain.elevationM)} m (${Math.round(sim.environment.terrain.elevationM * 3.28084)} ft) · Slope ${Math.round(sim.environment.terrain.slopeDeg)}°`;

  const col1X = leftX;
  const col2X = leftX + colW;
  const col3X = leftX + colW * 2;
  let curY = m.footerY;

  const narrative =
    options.narrative ?? generateEnvironmentalNarrative(sim, units).story;

  const permalink =
    options.permalinkUrl ??
    buildShareableUrl({
      sp: sim.params.species,
      lat: sim.params.latitude,
      lon: sim.params.longitude,
      age: sim.params.totalAge,
      death: sim.params.deathYear,
      mode: 'peel',
      pal: options.paletteId ?? 'aged-wood',
    });

  const elements: string[] = [
    `<g id="colophon-footer" pointer-events="none">`,
    // Divider rule above 3-column metadata
    `<line x1="${leftX.toFixed(2)}" y1="${(curY - m.fontSizeSmall * 1.5).toFixed(2)}" x2="${(leftX + totalW).toFixed(2)}" y2="${(curY - m.fontSizeSmall * 1.5).toFixed(2)}" stroke="${colors.borderHairline}" stroke-width="${(m.strokeW * 0.6).toFixed(2)}" stroke-opacity="0.5"/>`,

    // Column 1: Provenance
    `<text x="${col1X.toFixed(2)}" y="${curY.toFixed(2)}" fill="${colors.textColorDim}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${m.fontSizeSmall.toFixed(2)}" font-weight="700" letter-spacing="0.08em">I. PROVENANCE &amp; TAXONOMY</text>`,
    `<text x="${col1X.toFixed(2)}" y="${(curY + m.fontSizeBody * 1.25).toFixed(2)}" fill="${colors.textColor}" font-family="Georgia, serif" font-size="${m.fontSizeBody.toFixed(2)}" font-style="italic">${escapeXml(profile.scientificName)}</text>`,
    `<text x="${col1X.toFixed(2)}" y="${(curY + m.fontSizeBody * 2.35).toFixed(2)}" fill="${colors.textColorMid}" font-family="Georgia, serif" font-size="${m.fontSizeBody.toFixed(2)}">${escapeXml(profile.commonName)} (Pinaceae)</text>`,
    `<text x="${col1X.toFixed(2)}" y="${(curY + m.fontSizeBody * 3.45).toFixed(2)}" fill="${colors.textColorDim}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${m.fontSizeSmall.toFixed(2)}">${latLabel}, ${lonLabel}</text>`,
    `<text x="${col1X.toFixed(2)}" y="${(curY + m.fontSizeBody * 4.45).toFixed(2)}" fill="${colors.textColorDim}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${m.fontSizeSmall.toFixed(2)}">${elevLabel}</text>`,

    // Column 2: Chronology Extent
    `<text x="${col2X.toFixed(2)}" y="${curY.toFixed(2)}" fill="${colors.textColorDim}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${m.fontSizeSmall.toFixed(2)}" font-weight="700" letter-spacing="0.08em">II. CHRONOLOGY EXTENT</text>`,
    `<text x="${col2X.toFixed(2)}" y="${(curY + m.fontSizeBody * 1.25).toFixed(2)}" fill="${colors.textColor}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${m.fontSizeBody.toFixed(2)}" font-weight="600">${sim.firstRingYear}–${sim.params.deathYear} CE</text>`,
    `<text x="${col2X.toFixed(2)}" y="${(curY + m.fontSizeBody * 2.35).toFixed(2)}" fill="${colors.textColorMid}" font-family="Georgia, serif" font-size="${m.fontSizeBody.toFixed(2)}">Total Lifespan: ${sim.params.totalAge} Years</text>`,
    `<text x="${col2X.toFixed(2)}" y="${(curY + m.fontSizeBody * 3.45).toFixed(2)}" fill="${colors.textColorDim}" font-family="Georgia, serif" font-size="${m.fontSizeBody.toFixed(2)}">${sim.visibleRingCount} Annual Rings · Germination ${sim.germinationYear} CE</text>`,
    `<text x="${col2X.toFixed(2)}" y="${(curY + m.fontSizeBody * 4.45).toFixed(2)}" fill="${colors.textColorDim}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${m.fontSizeSmall.toFixed(2)}">Eccentricity ${(sim.eccentricity).toFixed(3)} · Lean Azimuth ${Math.round(sim.leanAzimuthDeg)}°</text>`,

    // Column 3: Ecological Ledger
    `<text x="${col3X.toFixed(2)}" y="${curY.toFixed(2)}" fill="${colors.textColorDim}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${m.fontSizeSmall.toFixed(2)}" font-weight="700" letter-spacing="0.08em">III. ECOLOGICAL LEDGER</text>`,
    `<text x="${col3X.toFixed(2)}" y="${(curY + m.fontSizeBody * 1.25).toFixed(2)}" fill="${colors.textColor}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${m.fontSizeBody.toFixed(2)}" font-weight="600">Specimen Seed #${sim.seedHex}</text>`,
    `<text x="${col3X.toFixed(2)}" y="${(curY + m.fontSizeBody * 2.35).toFixed(2)}" fill="${colors.textColorMid}" font-family="Georgia, serif" font-size="${m.fontSizeBody.toFixed(2)}">Limiting Stress: ${escapeXml(sim.viability?.summary ?? 'Climatic Precipitation')}</text>`,
    `<text x="${col3X.toFixed(2)}" y="${(curY + m.fontSizeBody * 3.45).toFixed(2)}" fill="${colors.textColorDim}" font-family="Georgia, serif" font-size="${m.fontSizeBody.toFixed(2)}">Biophysical VS-Lite &amp; PRISM Climatology</text>`,
    `<text x="${col3X.toFixed(2)}" y="${(curY + m.fontSizeBody * 4.45).toFixed(2)}" fill="${colors.textColorDim}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${m.fontSizeSmall.toFixed(2)}">Anatomical Tree Ring Archive</text>`,
  ];

  curY += m.fontSizeBody * 5.4;

  // Climate narrative prose
  elements.push(
    `<line x1="${leftX.toFixed(2)}" y1="${(curY - m.fontSizeSmall * 0.8).toFixed(2)}" x2="${(leftX + totalW).toFixed(2)}" y2="${(curY - m.fontSizeSmall * 0.8).toFixed(2)}" stroke="${colors.borderHairline}" stroke-width="${(m.strokeW * 0.5).toFixed(2)}" stroke-opacity="0.4"/>`,
    `<text x="${leftX.toFixed(2)}" y="${curY.toFixed(2)}" fill="${colors.textColorMid}" font-family="Georgia, serif" font-size="${m.fontSizeBody.toFixed(2)}" font-style="italic">Ecological Site History: ${escapeXml(narrative)}</text>`
  );

  curY += m.fontSizeBody * 1.5;

  // Imprint and permalink URL line
  elements.push(
    `<text x="${leftX.toFixed(2)}" y="${curY.toFixed(2)}" fill="${colors.textColorDim}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${m.fontSizeSmall.toFixed(2)}">Curatorial Permanent Archive Link: ${escapeXml(permalink)}</text>`,
    `</g>`
  );

  return elements.join('\n');
}

/**
 * Composites tree cross-section SVG into a museum archival typographic print plate.
 */
export function wrapInColophonPlate(
  sim: TreeSimulationResult,
  treeSvgOrBundle: string | GeneratedSvgBundle,
  options?: ColophonOptions
): ColophonPlateBundle {
  const profile = SPECIES_PROFILES[sim.params.species];
  const colors = getColophonPaletteColors(options?.paletteId, options?.customColors);

  // Extract inner markup and original art viewBox
  let innerArtMarkup = '';
  let artViewBox: SvgViewBox;

  if (typeof treeSvgOrBundle === 'object' && 'innerMarkup' in treeSvgOrBundle) {
    innerArtMarkup = treeSvgOrBundle.innerMarkup;
    artViewBox = treeSvgOrBundle.viewBox;
  } else {
    const rawSvg = typeof treeSvgOrBundle === 'string' ? treeSvgOrBundle : (treeSvgOrBundle as any).svgMarkup;
    // Parse viewBox from raw SVG
    const vbMatch = rawSvg.match(/viewBox="([^"]+)"/);
    if (vbMatch) {
      const [vx, vy, vw, vh] = vbMatch[1].split(/\s+/).map(Number);
      artViewBox = { x: vx, y: vy, width: vw, height: vh };
    } else {
      artViewBox = { x: -200, y: -200, width: 400, height: 400 };
    }
    // Strip <?xml...>, <svg...>, and </svg>
    innerArtMarkup = rawSvg
      .replace(/<\?xml[^>]*\?>/gi, '')
      .replace(/<svg[^>]*>/gi, '')
      .replace(/<\/svg>/gi, '');
  }

  const metrics = computeColophonLayout(artViewBox, options?.aspectRatio);
  const pVb = metrics.plateViewBox;
  const title = `XYLEM PLATE · ${profile.commonName.toUpperCase()} · ${sim.firstRingYear}–${sim.params.deathYear} CE`;

  const borderMarkup = generateColophonBorderRules(metrics, colors);
  const headerMarkup = generateColophonHeader(sim, metrics, colors, options ?? {});
  const footerMarkup = generateColophonFooter(sim, metrics, colors, options ?? {});

  const fullSvgMarkup = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision" preserveAspectRatio="xMidYMid meet" viewBox="${pVb.x} ${pVb.y} ${pVb.width} ${pVb.height}" width="100%" height="100%">`,
    `<title>${escapeXml(title)}</title>`,
    `<rect x="${pVb.x}" y="${pVb.y}" width="${pVb.width}" height="${pVb.height}" fill="${colors.background}"/>`,
    borderMarkup,
    headerMarkup,
    innerArtMarkup,
    footerMarkup,
    `</svg>`,
  ].join('\n');

  return {
    svgMarkup: fullSvgMarkup,
    viewBox: pVb,
    title,
  };
}

/**
 * Flexible alias supporting either (sim, bundle, options) or (bundle, metadata/sim, options)
 */
export function createColophonPlateSvg(
  first: TreeSimulationResult | GeneratedSvgBundle | string,
  second: any,
  third?: ColophonOptions
): ColophonPlateBundle {
  if (typeof first === 'object' && 'params' in first && 'seedHex' in first) {
    return wrapInColophonPlate(first as TreeSimulationResult, second, third);
  }
  // Called as createColophonPlateSvg(treeSvgBundle, sim, options)
  return wrapInColophonPlate(second as TreeSimulationResult, first as GeneratedSvgBundle | string, third);
}
