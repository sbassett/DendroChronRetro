import { SeededRNG } from './prng';
import { SPECIES_PROFILES } from './species';
import { PolarPoint, TreeSimulationResult } from './types';

export interface SvgRenderOptions {
  showBark: boolean;
  showMedullaryRays: boolean;
  showAnnotations: boolean;
  transparentBackground: boolean;
  highlightedRingIndex?: number | null;
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

function chooseNiceScaleBarMm(diameterMm: number): number {
  const target = diameterMm * 0.24;
  const candidates = [5, 10, 20, 25, 50, 100, 200, 250, 500];
  let best = candidates[0];
  for (const c of candidates) {
    if (Math.abs(c - target) < Math.abs(best - target)) {
      best = c;
    }
  }
  return best;
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
  const outerRefRadii = options.showBark
    ? sim.bark.outerBarkRadiusMm
    : sim.bark.cambiumRadiusMm;
  const outerRefAngles = options.showBark
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
  const pad = maxSpan * (options.showAnnotations ? 0.13 : 0.06);
  const bottomExtra = options.showAnnotations ? maxSpan * 0.08 : 0;

  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = spanX + pad * 2;
  const vbH = spanY + pad * 2 + bottomExtra;

  const elements: string[] = [];

  // Background rect (extended generously so panning in interactive viewport stays clean)
  if (!options.transparentBackground) {
    const bgPad = Math.max(vbW, vbH) * 2;
    elements.push(
      `<rect x="${(vbX - bgPad).toFixed(2)}" y="${(vbY - bgPad).toFixed(2)}" width="${(vbW + bgPad * 2).toFixed(2)}" height="${(vbH + bgPad * 2).toFixed(2)}" fill="#f6f6f4"/>`
    );
  }

  // Definitions: wood clip path + annular rhytidome clip path
  const cambiumSmoothD = polarSmoothClosedPath(
    sim.bark.cambiumRadiusMm,
    sim.anglesRad,
    1
  );
  const outerBarkD = polarPolygonClosedPath(
    sim.bark.outerBarkRadiusMm,
    sim.bark.barkAnglesRad,
    false
  );
  const phloemOuterD = polarPolygonClosedPath(
    sim.bark.phloemOuterRadiusMm,
    sim.bark.barkAnglesRad,
    false
  );
  const phloemReverseD = polarPolygonClosedPath(
    sim.bark.phloemOuterRadiusMm,
    sim.bark.barkAnglesRad,
    true
  );

  elements.push(
    `<defs>` +
      `<clipPath id="wood-clip"><path d="${cambiumSmoothD}"/></clipPath>` +
      (options.showBark
        ? `<clipPath id="rhytidome-clip"><path clip-rule="evenodd" d="${outerBarkD}${phloemReverseD}"/></clipPath>`
        : '') +
      `</defs>`
  );

  // Layer 1: Anatomical Outer Rhytidome & Living Inner Phloem
  if (options.showBark) {
    elements.push(`<g id="bark-layer">`);

    // 1a. Dead rhytidome base matrix (crushed dark secondary phloem / periderm ground)
    const matrixGray =
      sim.bark.morphology === 'furrowed-corky' ? 44 : 36;
    elements.push(`<path d="${outerBarkD}" fill="${grayHex(matrixGray)}"/>`);

    // 1b. Clipped internal sequential periderm compartments (cork wedges or interlocking puzzle scales)
    elements.push(`<g id="rhytidome-anatomy" clip-path="url(#rhytidome-clip)">`);
    for (const cell of sim.bark.rhytidomeCells) {
      const cellD = polarPointsPath(cell.pointsPolar, true);
      if (cellD) {
        elements.push(
          `<path d="${cellD}" fill="${grayHex(cell.fillGray)}" stroke="${grayHex(cell.strokeGray)}" stroke-width="${cell.strokeWidthMm.toFixed(2)}" stroke-linejoin="round"/>`
        );
      }
    }
    for (const seam of sim.bark.peridermSeams) {
      const seamD = polarPointsPath(seam.pointsPolar, false);
      if (seamD) {
        elements.push(
          `<path d="${seamD}" fill="none" stroke="${grayHex(seam.gray)}" stroke-width="${seam.widthMm.toFixed(2)}" stroke-linecap="round"/>`
        );
      }
    }
    elements.push(`</g>`);

    // 1c. Crisp weathered outer bark surface & fissure floor outline
    const outerStrokeW = Math.max(0.22, maxSpan * 0.0016);
    elements.push(
      `<path d="${outerBarkD}" fill="none" stroke="${grayHex(profile.palette.barkFissureGray)}" stroke-width="${outerStrokeW.toFixed(2)}" stroke-linejoin="round"/>`
    );

    // 1d. Living inner bark (secondary phloem) bounded on outside by dark active innermost periderm
    const innerPeridermW = Math.max(0.2, maxSpan * 0.0013);
    elements.push(
      `<path id="inner-phloem" d="${phloemOuterD}" fill="#8f8f8a" stroke="#1e1e1e" stroke-width="${innerPeridermW.toFixed(2)}" stroke-linejoin="round"/>`
    );

    // Thin vascular cambium boundary line
    elements.push(
      `<path d="${cambiumSmoothD}" fill="none" stroke="#3a3a38" stroke-width="${Math.max(0.14, maxSpan * 0.0008).toFixed(2)}"/>`
    );
    elements.push(`</g>`);
  } else {
    elements.push(
      `<path d="${cambiumSmoothD}" fill="none" stroke="#222222" stroke-width="${Math.max(0.3, maxSpan * 0.002).toFixed(2)}"/>`
    );
  }

  // Layer 2: Smooth Cubic-Bezier Annual Growth Rings from outermost (N) inward to (1)
  elements.push(`<g id="annual-rings">`);
  for (let i = sim.rings.length - 1; i >= 0; i--) {
    const ring = sim.rings[i];
    const rec = ring.record;
    const approxR = ring.outerRadiusMm[0];
    // High angular smoothness with smooth cubic Bezier curves
    const stride = approxR > 45 ? 1 : 2;

    const isHighlighted = options.highlightedRingIndex === rec.ringIndex;
    const outerD = polarSmoothClosedPath(
      ring.outerRadiusMm,
      sim.anglesRad,
      stride
    );

    // Latewood outer disk
    const lwFill = isHighlighted ? '#0a0a0a' : grayHex(rec.latewoodGray);
    elements.push(
      `<path data-ring="${rec.ringIndex}" data-year="${rec.calendarYear}" d="${outerD}" fill="${lwFill}"/>`
    );

    // Optional intermediate transition wood band for semi-gradual species (Ponderosa pine)
    if (
      profile.ewLwTransition === 'semi-gradual' &&
      rec.meanWidthMm > 0.42
    ) {
      const lwInnerD = polarSmoothClosedPath(
        ring.lwInnerRadiusMm,
        sim.anglesRad,
        stride
      );
      elements.push(
        `<path data-ring="${rec.ringIndex}" d="${lwInnerD}" fill="${grayHex(rec.transitionGray)}"/>`
      );
      const ewBoundD = polarSmoothClosedPath(
        ring.ewBoundaryRadiusMm,
        sim.anglesRad,
        stride
      );
      elements.push(
        `<path data-ring="${rec.ringIndex}" d="${ewBoundD}" fill="${isHighlighted ? '#ffffff' : grayHex(rec.earlywoodGray)}"/>`
      );
    } else {
      // Abrupt EW -> LW transition (Douglas-fir)
      const lwInnerD = polarSmoothClosedPath(
        ring.lwInnerRadiusMm,
        sim.anglesRad,
        stride
      );
      elements.push(
        `<path data-ring="${rec.ringIndex}" d="${lwInnerD}" fill="${isHighlighted ? '#ffffff' : grayHex(rec.earlywoodGray)}"/>`
      );
    }

    // Intra-annual density fluctuation (false ring) inside earlywood
    if (ring.falseRingRadiusMm) {
      const falseD = polarSmoothClosedPath(
        ring.falseRingRadiusMm,
        sim.anglesRad,
        stride
      );
      const falseWidth = Math.max(0.08, rec.meanWidthMm * 0.085);
      elements.push(
        `<path pointer-events="none" d="${falseD}" fill="none" stroke="${grayHex(rec.latewoodGray + 38)}" stroke-width="${falseWidth.toFixed(2)}" stroke-opacity="0.45"/>`
      );
    }
  }

  // Central Pith
  if (sim.rings.length > 0) {
    const pithD = polarSmoothClosedPath(
      sim.rings[0].innerRadiusMm,
      sim.anglesRad,
      2
    );
    elements.push(`<path id="pith" d="${pithD}" fill="#2b2b2b"/>`);
    elements.push(
      `<circle cx="0" cy="0" r="${(sim.pithRadiusMm * 0.42).toFixed(2)}" fill="#4d4d4d"/>`
    );
  }
  elements.push(`</g>`);

  // Layer 3: Subtle Radial Medullary Rays
  if (options.showMedullaryRays && sim.rings.length > 0) {
    const rayRng = new SeededRNG(`${sim.seedKey}:rays`);
    const rayCount = Math.min(240, Math.max(96, Math.round(maxSpan * 0.48)));
    const rayPaths: string[] = [];
    const maxOuterR = Math.max(...sim.bark.cambiumRadiusMm);

    for (let rIdx = 0; rIdx < rayCount; rIdx++) {
      const baseTheta =
        (rIdx / rayCount) * 2 * Math.PI + rayRng.range(-0.012, 0.012);
      const startFrac =
        rIdx % 3 === 0
          ? 0.03
          : rIdx % 3 === 1
            ? rayRng.range(0.18, 0.45)
            : rayRng.range(0.45, 0.75);
      const rStart = Math.max(sim.pithRadiusMm * 1.2, maxOuterR * startFrac);
      const rEnd = maxOuterR * 1.05;
      const x1 = rStart * Math.cos(baseTheta);
      const y1 = rStart * Math.sin(baseTheta);
      const x2 = rEnd * Math.cos(baseTheta);
      const y2 = rEnd * Math.sin(baseTheta);
      rayPaths.push(
        `M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`
      );
    }

    const rayStrokeW = Math.max(0.07, maxSpan * 0.00055);
    elements.push(
      `<path id="medullary-rays" pointer-events="none" clip-path="url(#wood-clip)" d="${rayPaths.join('')}" fill="none" stroke="#1f1f1f" stroke-width="${rayStrokeW.toFixed(2)}" stroke-opacity="0.11"/>`
    );
  }

  // Layer 4: Scientific Scale Bar, Orientation Compass, & Specimen Metadata
  if (options.showAnnotations) {
    const fontSize = Math.max(2.4, maxSpan * 0.024);
    const smallFont = fontSize * 0.78;
    const strokeW = Math.max(0.25, maxSpan * 0.0024);

    const scaleMm = chooseNiceScaleBarMm(maxSpan);
    const barX = vbX + pad * 0.55;
    const barY = vbY + vbH - pad * 0.62;
    const scaleLabel =
      scaleMm >= 10 ? `${scaleMm / 10} cm (${scaleMm} mm)` : `${scaleMm} mm`;

    elements.push(
      `<g id="annotations" pointer-events="none" fill="#1c1c1c" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">`
    );
    elements.push(
      `<line x1="${barX.toFixed(2)}" y1="${barY.toFixed(2)}" x2="${(barX + scaleMm).toFixed(2)}" y2="${barY.toFixed(2)}" stroke="#1c1c1c" stroke-width="${(strokeW * 1.35).toFixed(2)}"/>` +
        `<line x1="${barX.toFixed(2)}" y1="${(barY - fontSize * 0.35).toFixed(2)}" x2="${barX.toFixed(2)}" y2="${(barY + fontSize * 0.35).toFixed(2)}" stroke="#1c1c1c" stroke-width="${strokeW.toFixed(2)}"/>` +
        `<line x1="${(barX + scaleMm).toFixed(2)}" y1="${(barY - fontSize * 0.35).toFixed(2)}" x2="${(barX + scaleMm).toFixed(2)}" y2="${(barY + fontSize * 0.35).toFixed(2)}" stroke="#1c1c1c" stroke-width="${strokeW.toFixed(2)}"/>` +
        `<text x="${barX.toFixed(2)}" y="${(barY - fontSize * 0.58).toFixed(2)}" font-size="${smallFont.toFixed(2)}" font-weight="600">${scaleLabel}</text>`
    );

    const latLabel = `${Math.abs(sim.params.latitude).toFixed(4)}°${sim.params.latitude >= 0 ? 'N' : 'S'}`;
    const lonLabel = `${Math.abs(sim.params.longitude).toFixed(4)}°${sim.params.longitude >= 0 ? 'E' : 'W'}`;
    const rightX = vbX + vbW - pad * 0.55;
    elements.push(
      `<text x="${rightX.toFixed(2)}" y="${(barY - smallFont * 0.95).toFixed(2)}" text-anchor="end" font-size="${smallFont.toFixed(2)}" font-style="italic">${profile.scientificName} (${profile.commonName})</text>` +
        `<text x="${rightX.toFixed(2)}" y="${(barY + smallFont * 0.35).toFixed(2)}" text-anchor="end" font-size="${(smallFont * 0.88).toFixed(2)}" fill="#444444">${latLabel}, ${lonLabel} · h=${sim.stumpHeightM.toFixed(2)}m · Age ${sim.params.totalAge}y (${sim.visibleRingCount} rings, ${sim.firstRingYear}–${sim.params.deathYear})</text>`
    );

    const compR = fontSize * 1.45;
    const compX = vbX + vbW - pad * 0.55 - compR;
    const compY = vbY + pad * 0.58 + compR;
    const leanRad = ((sim.leanAzimuthDeg - 90) * Math.PI) / 180;
    const lx = compX + compR * 0.82 * Math.cos(leanRad);
    const ly = compY + compR * 0.82 * Math.sin(leanRad);

    elements.push(
      `<circle cx="${compX.toFixed(2)}" cy="${compY.toFixed(2)}" r="${compR.toFixed(2)}" fill="none" stroke="#555555" stroke-width="${(strokeW * 0.75).toFixed(2)}"/>` +
        `<line x1="${compX.toFixed(2)}" y1="${(compY + compR * 0.65).toFixed(2)}" x2="${compX.toFixed(2)}" y2="${(compY - compR * 0.82).toFixed(2)}" stroke="#1c1c1c" stroke-width="${strokeW.toFixed(2)}"/>` +
        `<text x="${compX.toFixed(2)}" y="${(compY - compR * 1.08).toFixed(2)}" text-anchor="middle" font-size="${smallFont.toFixed(2)}" font-weight="700">N</text>` +
        `<line x1="${compX.toFixed(2)}" y1="${compY.toFixed(2)}" x2="${lx.toFixed(2)}" y2="${ly.toFixed(2)}" stroke="#666666" stroke-width="${(strokeW * 0.9).toFixed(2)}" stroke-dasharray="${(strokeW * 1.8).toFixed(2)} ${(strokeW * 1.2).toFixed(2)}"/>`
    );
    elements.push(`</g>`);
  }

  // Standalone SVG export keeps exact bounding viewBox crop
  const standaloneBg = !options.transparentBackground
    ? `<rect x="${vbX.toFixed(2)}" y="${vbY.toFixed(2)}" width="${vbW.toFixed(2)}" height="${vbH.toFixed(2)}" fill="#f6f6f4"/>`
    : '';
  const standaloneBody = [
    standaloneBg,
    ...elements.slice(!options.transparentBackground ? 1 : 0),
  ].join('\n');

  const svgMarkup = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision" viewBox="${vbX.toFixed(2)} ${vbY.toFixed(2)} ${vbW.toFixed(2)} ${vbH.toFixed(2)}" width="100%" height="100%">`,
    `<title>${profile.commonName} (${profile.scientificName}) Stump Cross-Section — Seed ${sim.seedHex}</title>`,
    standaloneBody,
    `</svg>`,
  ].join('\n');

  return {
    svgMarkup,
    innerMarkup: elements.join('\n'),
    viewBox: { x: vbX, y: vbY, width: vbW, height: vbH },
  };
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
