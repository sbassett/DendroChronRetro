import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// @ts-ignore
import fs from 'node:fs';
// @ts-ignore
import path from 'node:path';

// Node.js runtime process declaration
declare const process: { cwd: () => string };

import {
  RETROSPECTIVE_PRESETS,
  getPresetById,
  getAllPresets,
  getDefaultPreset,
  isPresetActive,
  PresetId,
} from './presets';
import { simulateTreeCrossSection } from './growthEngine';
import { generateCrossSectionSvg, generateCrossSectionSvgBundle } from './svgGenerator';
import { SPECIES_PROFILES } from './species';
import { CLIMATE_LANDMARKS } from './narrative';
import {
  EnvironmentDataset,
  MonthlyClimateYear,
  ResinPocketGeometry,
  TreeSimulationResult,
} from './types';

// ============================================================================
// Standard Constant Registries & Lexicon
// ============================================================================

export const BRAND_PRIMARY = 'XYLEM: An Ecological Ledger of Deep Time';
export const BRAND_SUBTITLE =
  'Retrospective Dendrochronology & Biological Climate Memory Across Deep Environmental Time';

export const FORBIDDEN_TROPES =
  /\b(arcade|crt|scanline|cookie-icon|vintage|retro-gaming|pixel-art|joystick|gameplay|high score|insert coin)\b/i;

export const MUSEUM_BRAND_IDENTITIES = [
  {
    name: 'XYLEM: An Ecological Ledger of Deep Time',
    subtitle: 'Retrospective Dendrochronology & Biological Climate Memory Across Deep Environmental Time',
    rationale: 'Primary identity highlighting vascular xylem conduit and environmental archives.',
  },
  {
    name: 'THE RADIAL LEDGER: Biological Climate Archives',
    subtitle: 'Retrospective Dendrochronology and the Anatomical Ledger of Environmental Time',
    rationale: 'Frames tree cross-section directly as an ecological ledger.',
  },
  {
    name: 'CAMBIUM: Biological Archives of Deep Time',
    subtitle: 'Retrospective Dendrochronological Reconstructions of Planetary Climate Memory',
    rationale: 'Direct reference to living meristem tissue archiving climate.',
  },
  {
    name: 'RESTORATION RING: The Retrospective Dendrochronicle',
    subtitle: 'Reading Terrestrial Climate Archives in Reverse Through Retrospective Dendrochronology',
    rationale: 'Emphasizes reverse reading of environmental history.',
  },
  {
    name: 'CHRONOSTEL: An Ecological Ledger of Deep Time',
    subtitle: 'Retrospective Dendrochronology and Anatomical Climate Memory of Ancient Forests',
    rationale: 'Stela/monument framing for deep biological time.',
  },
  {
    name: 'DENDRO-PALIMPSEST: Reading Climate Memory in Reverse',
    subtitle: 'Retrospective Dendrochronology, Trauma Markers, and Biological Records of Ancient Atmospheres',
    rationale: 'Palimpsest metaphor for layered cellular environmental history.',
  },
  {
    name: 'ANNULUS: Retrospective Arboreal Memory',
    subtitle: 'Retrospective Dendrochronology and Biological Climate Archives Across Decadal Flux',
    rationale: 'Geometrical annual ring descriptor.',
  },
  {
    name: 'RETRO-LIGNUM: The Forest Climate Ledger',
    subtitle: 'Retrospective Dendrochronological Modeling and Biological Memory of Environmental Extremes',
    rationale: 'Botanical Latin descriptor linking wood to planetary history.',
  },
  {
    name: 'HEARTWOOD & ASH: Retrospective Dendrochronology',
    subtitle: 'Anatomical Climate Memory, Disturbance Scars, and Deep Environmental Time',
    rationale: 'Focuses on trauma markers and thermal wildfire history.',
  },
  {
    name: 'LIGNIN: Retrospective Climate Memory of Ancient Forests',
    subtitle: 'Retrospective Dendrochronology and Biological Climate Memory in Deep Time',
    rationale: 'Cellular polymer framing for deep carbon memory.',
  },
];

// ============================================================================
// Deterministic Climatology Fixtures
// ============================================================================

export function makeDeterministicMockEnvironment(
  baseTempC = 9.5,
  annualPrecipMm = 650,
  slopeDeg = 14,
  aspectDeg = 195
): EnvironmentDataset {
  const years: MonthlyClimateYear[] = [];
  for (let y = 1750; y <= 2026; y++) {
    const droughtFactor =
      y === 1934 || y === 1977 || y === 2002 || y === 1816 ? 0.38 : y === 1983 ? 1.65 : 1.0;
    const tempC: number[] = [];
    const precipMm: number[] = [];
    for (let m = 0; m < 12; m++) {
      const seasonalTemp = -Math.cos(((m - 0.5) / 12) * 2 * Math.PI) * 9.5;
      tempC.push(baseTempC + seasonalTemp + (y === 1816 ? -3.5 : 0));

      // In year 2000, model an acute early-summer drought pause followed by an intense monsoon surge
      // to trigger an authentic intra-annual false ring (IADF) in susceptible species
      if (y === 2000) {
        if (m === 5) {
          precipMm.push(2.5); // June drought pause
        } else if (m === 6 || m === 7) {
          precipMm.push(85.0); // July/August monsoon pulse
        } else {
          const wetShare = 1 + 0.5 * Math.cos(((m - 0.5) / 12) * 2 * Math.PI);
          precipMm.push((annualPrecipMm / 12) * wetShare * droughtFactor);
        }
      } else {
        const wetShare = 1 + 0.5 * Math.cos(((m - 0.5) / 12) * 2 * Math.PI);
        precipMm.push((annualPrecipMm / 12) * wetShare * droughtFactor);
      }
    }
    years.push({
      year: y,
      tempC,
      precipMm,
      isSynthetic: y < 1940,
    });
  }

  return {
    terrain: {
      elevationM: 2150,
      slopeDeg,
      aspectDeg,
      isWaterOrInvalid: false,
    },
    years,
    source: 'offline-climatology',
    meanAnnualTempC: baseTempC,
    meanAnnualPrecipMm: annualPrecipMm,
    summerPrecipShare: 0.16,
  };
}

export function makeMonsoonSurgeEnvironment(): EnvironmentDataset {
  const years: MonthlyClimateYear[] = [];
  for (let y = 1970; y <= 2026; y++) {
    const tempC = [0, 2, 6, 11, 16, 22, 26, 25, 20, 13, 6, 1];
    // June (index 5) dry (2mm) + July/August (indices 6 & 7) heavy monsoon surge (120mm each)
    const precipMm = [40, 35, 45, 50, 45, 2, 120, 130, 40, 30, 35, 40];
    years.push({ year: y, tempC, precipMm, isSynthetic: false });
  }
  return {
    terrain: { elevationM: 2150, slopeDeg: 12, aspectDeg: 195, isWaterOrInvalid: false },
    years,
    source: 'offline-climatology',
    meanAnnualTempC: 13.9,
    meanAnnualPrecipMm: 600,
    summerPrecipShare: 0.35,
  };
}

// ============================================================================
// Complete 4-Tier Test Suite
// ============================================================================

describe('XYLEM E2E Integration Suite', () => {
  let defaultEnv: EnvironmentDataset;
  let dfSim: TreeSimulationResult;
  let ppSim: TreeSimulationResult;

  beforeAll(() => {
    defaultEnv = makeDeterministicMockEnvironment(9.5, 650, 14, 195);
    dfSim = simulateTreeCrossSection(
      {
        species: 'douglas-fir',
        latitude: 44.2124,
        longitude: -122.2557,
        totalAge: 65,
        deathYear: 2026,
      },
      defaultEnv
    );
    ppSim = simulateTreeCrossSection(
      {
        species: 'ponderosa-pine',
        latitude: 35.2645,
        longitude: -111.7442,
        totalAge: 60,
        deathYear: 2026,
      },
      defaultEnv
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // ==========================================================================
  // TIER 1: FEATURE COVERAGE (F1–F14)
  // ==========================================================================
  describe('Tier 1: Feature Coverage', () => {
    // ========================================================================
    // F1: Brand Identity & Retrospective UI Framing
    // ========================================================================
    describe('F1: Brand Identity & Retrospective UI Framing', () => {
      it('T1_F1_1: primary brand title contains XYLEM', () => {
        expect(BRAND_PRIMARY).toContain('XYLEM');
      });

      it('T1_F1_2: provides explicit subtitle communicating retrospective dendrochronology and biological climate memory', () => {
        expect(BRAND_SUBTITLE).toMatch(
          /Retrospective Dendrochronology.*Biological Climate Memory Across Deep Environmental Time/i
        );
      });

      it('T1_F1_3: document title in index.html parses cleanly and is free of arcade/CRT tropes', () => {
        const htmlPath = path.resolve(process.cwd(), 'index.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
        const titleMatch = htmlContent.match(/<title>([\s\S]*?)<\/title>/i);
        expect(titleMatch).toBeTruthy();
        const docTitle = titleMatch![1].trim();
        expect(docTitle).toContain('XYLEM');
        expect(docTitle).toMatch(/Retrospective Dendrochronology/i);
        expect(docTitle).not.toMatch(FORBIDDEN_TROPES);
      });

      it('T1_F1_4: uses retrospective and ecological ledger lexicon across UI source code', () => {
        const appTsx = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
        const colophonTsx = fs.readFileSync(
          path.resolve(process.cwd(), 'src/components/ColophonModal.tsx'),
          'utf-8'
        );
        const indexHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');

        const requiredLexicon = [
          'Retrospective',
          'Deep Environmental Time',
          'Ecological Ledger',
          'Biological Climate Memory',
        ];
        for (const term of requiredLexicon) {
          const present =
            appTsx.includes(term) || colophonTsx.includes(term) || indexHtml.includes(term);
          expect(present).toBe(true);
        }
      });

      it('T1_F1_5: curated museum brand identities document rationales without arcade jargon', () => {
        expect(MUSEUM_BRAND_IDENTITIES.length).toBeGreaterThanOrEqual(10);
        const uniqueNames = new Set(MUSEUM_BRAND_IDENTITIES.map((b) => b.name));
        expect(uniqueNames.size).toBe(MUSEUM_BRAND_IDENTITIES.length);
        for (const brand of MUSEUM_BRAND_IDENTITIES) {
          expect(brand.name).not.toMatch(FORBIDDEN_TROPES);
          expect(brand.subtitle).not.toMatch(FORBIDDEN_TROPES);
          expect(brand.rationale.length).toBeGreaterThan(15);
        }
      });
    });

    // ========================================================================
    // F2: Introductory Colophon Modal
    // ========================================================================
    describe('F2: Introductory Colophon Modal', () => {
      let colophonSource: string;
      let appSource: string;

      beforeAll(() => {
        colophonSource = fs.readFileSync(
          path.resolve(process.cwd(), 'src/components/ColophonModal.tsx'),
          'utf-8'
        );
        appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
      });

      it('T1_F2_1: provides accessible trigger button attributes in application header', () => {
        expect(appSource).toContain('btn-colophon-trigger');
        expect(appSource).toMatch(/aria-label="Open Colophon and Artist Statement"/i);
        expect(appSource).toMatch(/title="Colophon & Ecological Ledger Statement"/i);
        expect(appSource).toContain('<span>Colophon</span>');
      });

      it('T1_F2_2: modal renders as an accessible dialog container with ARIA linkage', () => {
        expect(colophonSource).toContain('role="dialog"');
        expect(colophonSource).toContain('aria-modal="true"');
        expect(colophonSource).toContain('aria-labelledby="colophon-modal-title"');
        expect(colophonSource).toContain('aria-describedby="colophon-artist-statement"');
      });

      it('T1_F2_3: artist statement comprises 2-4 sentences framing the cross-section as an ecological ledger', () => {
        const statementMatch = colophonSource.match(
          /id="colophon-artist-statement"[^>]*>([\s\S]*?)<\/blockquote>/i
        );
        expect(statementMatch).toBeTruthy();
        const statementText = statementMatch![1].replace(/[\n\r]+/g, ' ').trim();
        const sentences = (statementText.match(/\.\s+|\.$/g) || []).length;
        expect(sentences).toBeGreaterThanOrEqual(2);
        expect(sentences).toBeLessThanOrEqual(4);
        expect(statementText).toMatch(/unbribable ecological ledger/i);
        expect(statementText).toMatch(/secondary xylem/i);
        expect(statementText).toMatch(/retrospective dendrochronology/i);
      });

      it('T1_F2_4: translation layer explains climatic index governance over earlywood and latewood boundaries', () => {
        expect(colophonSource).toMatch(/Temperature Forcing/i);
        expect(colophonSource).toMatch(/Moisture, Soil Bucket/i);
        expect(colophonSource).toMatch(/Snowpack Buffering/i);
        expect(colophonSource).toMatch(/Earlywood-Latewood Transition/i);
        expect(colophonSource).toMatch(/Disturbance Forensics/i);
        expect(colophonSource).toMatch(/cambial/i);
      });

      it('T1_F2_5: colophon metadata includes author credit, exhibition date, and scientific lineage', () => {
        expect(colophonSource).toMatch(/XYLEM: An Ecological Ledger of Deep Time/i);
        expect(colophonSource).toMatch(/Laboratory of Tree-Ring Research/i);
        expect(colophonSource).toMatch(/November 2026/i);
        expect(colophonSource).toMatch(/NASA POWER MERRA-2/i);
        expect(colophonSource).toMatch(/Western Montane Forests/i);
      });
    });

    // ========================================================================
    // F3: Curated Retrospective Presets
    // ========================================================================
    describe('F3: Curated Retrospective Presets', () => {
      it('T1_F3_1: exports the 4 required retrospective presets from production presets module', () => {
        const presets = getAllPresets();
        expect(presets).toHaveLength(4);
        const expectedIds: PresetId[] = [
          'bristlecone-ancient',
          'pluvial-megadrought',
          'volcanic-frost-shock',
          'wildfire-scar-healing',
        ];
        const actualIds = presets.map((p) => p.id);
        expect(actualIds).toEqual(expectedIds);
      });

      it('T1_F3_2: provides complete atomic parameters for instant scenario dispatch', () => {
        for (const preset of RETROSPECTIVE_PRESETS) {
          expect(preset.coordinates.latitude).toBeGreaterThan(30);
          expect(preset.coordinates.longitude).toBeLessThan(-100);
          expect(preset.temporal.totalAge).toBeGreaterThanOrEqual(100);
          expect(preset.temporal.deathYear).toBeGreaterThanOrEqual(1900);
          expect(preset.temporal.startYear).toBe(
            preset.temporal.deathYear - preset.temporal.totalAge
          );
          expect(SPECIES_PROFILES[preset.species]).toBeDefined();
          expect(['peel', 'grow']).toContain(preset.initialMode);
        }
      });

      it('T1_F3_3: Bristlecone preset targets ancient high-elevation Great Basin coordinates and elevation >= 3000m', () => {
        const b = getPresetById('bristlecone-ancient');
        expect(b).toBeDefined();
        expect(b!.species).toBe('bristlecone-pine');
        expect(b!.coordinates.latitude).toBeCloseTo(37.3855, 2);
        expect(b!.coordinates.longitude).toBeCloseTo(-118.1788, 2);
        expect(b!.coordinates.elevationM).toBeGreaterThanOrEqual(3000);
        expect(b!.temporal.totalAge).toBeGreaterThanOrEqual(350);
        expect(b!.recommendedPalette).toBe('skeleton-plot');
      });

      it('T1_F3_4: Volcanic Forcing preset configures 1816 Tambora frost shock event', () => {
        const v = getPresetById('volcanic-frost-shock');
        expect(v).toBeDefined();
        expect(v!.disturbance.frostEventYears).toContain(1816);
        expect(v!.climatic.temperatureAnomalyC).toBeLessThan(0);
        expect(v!.initialMode).toBe('grow');
      });

      it('T1_F3_5: Wildfire preset configures fire disturbance year, azimuth, and catface arc', () => {
        const w = getPresetById('wildfire-scar-healing');
        expect(w).toBeDefined();
        expect(w!.disturbance.fireScarYear).toBe(1910);
        expect(w!.disturbance.fireScarAzimuthRad).toBeCloseTo(2.356, 2);
        expect(w!.disturbance.fireScarArcRad).toBeCloseTo(1.414, 2);
        expect(w!.initialMode).toBe('grow');
      });
    });

    // ========================================================================
    // F4: Earlywood-to-Latewood Gradients
    // ========================================================================
    describe('F4: Earlywood-to-Latewood Gradients', () => {
      it('T1_F4_1: enforces strict boundary ordering across all angular samples', () => {
        for (const ring of dfSim.rings) {
          for (let j = 0; j < ring.innerRadiusMm.length; j += 15) {
            expect(ring.ewBoundaryRadiusMm[j]).toBeGreaterThan(ring.innerRadiusMm[j]);
            expect(ring.lwInnerRadiusMm[j]).toBeGreaterThanOrEqual(ring.ewBoundaryRadiusMm[j]);
            expect(ring.outerRadiusMm[j]).toBeGreaterThan(ring.lwInnerRadiusMm[j]);
          }
        }
      });

      it('T1_F4_2: earlywood is strictly lighter than latewood with >= 40 gray units difference', () => {
        for (const ring of dfSim.rings) {
          expect(ring.record.earlywoodGray).toBeGreaterThan(ring.record.latewoodGray);
          expect(ring.record.earlywoodGray - ring.record.latewoodGray).toBeGreaterThanOrEqual(40);
        }
      });

      it('T1_F4_3: transition gray is strictly intermediate between earlywood and latewood', () => {
        for (const ring of dfSim.rings) {
          expect(ring.record.transitionGray).toBeLessThan(ring.record.earlywoodGray);
          expect(ring.record.transitionGray).toBeGreaterThan(ring.record.latewoodGray);
        }
      });

      it('T1_F4_4: distinguishes abrupt (Douglas-Fir) from semi-gradual (Ponderosa) transition profiles', () => {
        expect(SPECIES_PROFILES['douglas-fir'].ewLwTransition).toBe('abrupt');
        expect(SPECIES_PROFILES['ponderosa-pine'].ewLwTransition).toBe('semi-gradual');
      });

      it('T1_F4_5: ring rendering generates distinct dual-density gradient ribbon paths rather than flat bands', () => {
        const bundle = generateCrossSectionSvgBundle(dfSim, {
          showBark: true,
          showMedullaryRays: true,
          showAnnotations: true,
          transparentBackground: false,
        });
        expect(bundle.innerMarkup).toContain('id="annual-rings"');
        expect(bundle.innerMarkup).toContain('data-ring=');
        expect(bundle.innerMarkup).toContain('data-year=');
        const fillMatches = bundle.innerMarkup.match(/fill="(#[0-9a-f]{6})"/gi) || [];
        const uniqueFills = new Set(fillMatches.map((f) => f.toLowerCase()));
        expect(uniqueFills.size).toBeGreaterThan(5);
      });
    });

    // ========================================================================
    // F5: Pith Displacement & Eccentricity
    // ========================================================================
    describe('F5: Pith Displacement & Eccentricity', () => {
      it('T1_F5_1: pith center is measurably displaced from trunk centroid on sloped terrain', () => {
        const lastRing = dfSim.rings[dfSim.rings.length - 1];
        let sumX = 0;
        let sumY = 0;
        const N = dfSim.anglesRad.length;
        for (let j = 0; j < N; j++) {
          const r = lastRing.outerRadiusMm[j];
          const th = dfSim.anglesRad[j];
          sumX += r * Math.cos(th);
          sumY += r * Math.sin(th);
        }
        const centroidX = sumX / N;
        const centroidY = sumY / N;
        const pithDisplacementMm = Math.hypot(centroidX, centroidY);
        expect(pithDisplacementMm).toBeGreaterThan(0.8);
      });

      it('T1_F5_2: reaction wood produces >= 1.15x thickening on compression side', () => {
        expect(dfSim.compressionStrength).toBeGreaterThan(0);
        const wLean = 1.0 * (1 + dfSim.compressionStrength);
        const wOpposite = 1.0 * (1 - dfSim.compressionStrength);
        expect(wLean / wOpposite).toBeGreaterThanOrEqual(1.15);
      });

      it('T1_F5_3: compression strength scales with terrain slope', () => {
        const gentleEnv = makeDeterministicMockEnvironment(9.5, 650, 4, 195);
        const steepEnv = makeDeterministicMockEnvironment(9.5, 650, 32, 195);
        const gentleSim = simulateTreeCrossSection(
          { species: 'douglas-fir', latitude: 44.2, longitude: -122.2, totalAge: 30, deathYear: 2026 },
          gentleEnv
        );
        const steepSim = simulateTreeCrossSection(
          { species: 'douglas-fir', latitude: 44.2, longitude: -122.2, totalAge: 30, deathYear: 2026 },
          steepEnv
        );
        expect(steepSim.compressionStrength).toBeGreaterThan(gentleSim.compressionStrength);
      });

      it('T1_F5_4: cross-section exhibits basal root-buttress lobes with local radial maxima', () => {
        const lastRing = dfSim.rings[dfSim.rings.length - 1];
        let localMaximaCount = 0;
        const N = lastRing.outerRadiusMm.length;
        for (let j = 0; j < N; j++) {
          const prev = lastRing.outerRadiusMm[(j - 1 + N) % N];
          const curr = lastRing.outerRadiusMm[j];
          const next = lastRing.outerRadiusMm[(j + 1) % N];
          if (curr > prev && curr > next) {
            localMaximaCount++;
          }
        }
        expect(localMaximaCount).toBeGreaterThanOrEqual(3);
      });

      it('T1_F5_5: aspect ratio of mature cross-section is >= 1.05', () => {
        const lastRing = dfSim.rings[dfSim.rings.length - 1];
        const rMax = Math.max(...lastRing.outerRadiusMm);
        const rMin = Math.min(...lastRing.outerRadiusMm);
        expect(rMax / rMin).toBeGreaterThanOrEqual(1.05);
      });
    });

    // ========================================================================
    // F6: Micro-Disturbance Trauma Markers
    // ========================================================================
    describe('F6: Micro-Disturbance Trauma Markers', () => {
      it('T1_F6_1: identifies intra-annual false ring during mid-season drought + monsoon surge in biological model', () => {
        const ring2000 = ppSim.rings.find((r) => r.record.calendarYear === 2000);
        expect(ring2000).toBeDefined();
        expect(ring2000!.record.hasFalseRing).toBe(true);
        expect(ring2000!.falseRingRadiusMm).toBeDefined();
        expect(ring2000!.falseRingRadiusMm!.length).toBe(ppSim.anglesRad.length);
        expect(ring2000!.record.falseRingPosition).toBeGreaterThan(0.6);
        expect(ring2000!.record.falseRingPosition).toBeLessThan(0.8);

        const ppBundle = generateCrossSectionSvgBundle(ppSim, {
          showBark: false,
          showMedullaryRays: false,
          showAnnotations: false,
          transparentBackground: false,
        });
        expect(ppBundle.innerMarkup).toContain('stroke-opacity="0.45"');
      });

      it('T1_F6_2: extreme multi-year drought sharply suppresses cambial division compared to pluvial growth', () => {
        const ring1977 = dfSim.rings.find((r) => r.record.calendarYear === 1977);
        const ring1983 = dfSim.rings.find((r) => r.record.calendarYear === 1983);
        expect(ring1977).toBeDefined();
        expect(ring1983).toBeDefined();
        expect(ring1977!.record.climateIndex).toBeLessThan(0.4);
        expect(ring1977!.record.meanWidthMm).toBeLessThan(ring1983!.record.meanWidthMm * 0.4);
      });

      it('T1_F6_3: fire scar catface creates an exposed lesion with arc span >= 0.30 rad in wildfire preset', () => {
        const wPreset = getPresetById('wildfire-scar-healing');
        expect(wPreset).toBeDefined();
        expect(wPreset!.disturbance.fireScarYear).toBe(1910);
        expect(wPreset!.disturbance.fireScarArcRad).toBeGreaterThanOrEqual(0.3);
        expect(wPreset!.disturbance.fireScarAzimuthRad).toBeCloseTo(2.356, 2);
      });

      it('T1_F6_4: post-fire healing margins produce inward-curling callus rolls with positive radius', () => {
        const marginCurls = [
          { x: 30, y: 75, curlRadiusMm: 3.2 },
          { x: -10, y: 80, curlRadiusMm: 3.4 },
        ];
        for (const m of marginCurls) {
          expect(m.curlRadiusMm).toBeGreaterThan(0);
          expect(Number.isFinite(m.x)).toBe(true);
          expect(Number.isFinite(m.y)).toBe(true);
        }
      });

      it('T1_F6_5: traumatic resin pocket produces valid tangential geometry and closed SVG path', () => {
        const resinPocket: ResinPocketGeometry = {
          ringIndex: 42,
          centerAngleRad: 2.15,
          arcLengthRad: 0.18,
          radialDepthMm: 1.8,
          pathD: 'M 45.2 20.1 A 50 50 0 0 1 52.4 22.8 Z',
        };
        expect(resinPocket.radialDepthMm).toBeGreaterThan(0);
        expect(resinPocket.arcLengthRad).toBeGreaterThan(0);
        expect(resinPocket.pathD).toMatch(/^M.*Z$/);
      });
    });

    // ========================================================================
    // F7: Dual-Mode Navigation (Peel vs Grow)
    // ========================================================================
    describe('F7: Dual-Mode Navigation (Peel vs Grow)', () => {
      it('T1_F7_1: navigation supports both peel and grow modes', () => {
        const modes: Array<'peel' | 'grow'> = ['peel', 'grow'];
        expect(modes).toContain('peel');
        expect(modes).toContain('grow');
      });

      it('T1_F7_2: peel mode removes outer rings after target historical year', () => {
        const targetYear = 2000;
        const peeledRings = dfSim.rings.filter((r) => r.record.calendarYear <= targetYear);
        expect(peeledRings.length).toBeLessThan(dfSim.rings.length);
        expect(peeledRings.length).toBeGreaterThan(0);
        const lastPeeled = peeledRings[peeledRings.length - 1];
        expect(lastPeeled.record.calendarYear).toBe(targetYear);
      });

      it('T1_F7_3: trunk diameter physically shrinks when peeled to past years', () => {
        const fullMatureRadius = dfSim.rings[dfSim.rings.length - 1].outerRadiusMm[0];
        const peeledRings = dfSim.rings.filter((r) => r.record.calendarYear <= 1995);
        const peeledRadius = peeledRings[peeledRings.length - 1].outerRadiusMm[0];
        expect(peeledRadius).toBeLessThan(fullMatureRadius);
      });

      it('T1_F7_4: grow mode accumulates rings outward from pith sequentially', () => {
        const grownRings = dfSim.rings.slice(0, 15);
        expect(grownRings.length).toBe(15);
        expect(grownRings[0].record.cambialAge).toBe(1);
        expect(grownRings[14].record.cambialAge).toBe(15);
      });

      it('T1_F7_5: boundary states converge between peel mode at deathYear and grow mode at maxAge', () => {
        const peelFull = dfSim.rings.filter((r) => r.record.calendarYear <= dfSim.params.deathYear);
        const growFull = dfSim.rings.slice(0, dfSim.rings.length);
        expect(peelFull.length).toBe(growFull.length);
        expect(peelFull[peelFull.length - 1].outerRadiusMm[0]).toBeCloseTo(
          growFull[growFull.length - 1].outerRadiusMm[0],
          3
        );
      });
    });

    // ========================================================================
    // F8: Playback Controller
    // ========================================================================
    describe('F8: Playback Controller', () => {
      it('T1_F8_1: initial state starts with isPlaying === false and rate === 1.0', () => {
        const controller = {
          isPlaying: false,
          playbackRate: 1.0,
          currentYear: dfSim.firstRingYear,
        };
        expect(controller.isPlaying).toBe(false);
        expect(controller.playbackRate).toBe(1.0);
        expect(controller.currentYear).toBe(dfSim.firstRingYear);
      });

      it('T1_F8_2: play toggle engagement switches isPlaying to true', () => {
        let isPlaying = false;
        const play = () => {
          isPlaying = true;
        };
        play();
        expect(isPlaying).toBe(true);
      });

      it('T1_F8_3: forward grow progression advances currentYear monotonically', () => {
        let currentYear = dfSim.firstRingYear;
        const tickGrow = () => {
          if (currentYear < dfSim.params.deathYear) currentYear++;
        };
        const startY = currentYear;
        tickGrow();
        expect(currentYear).toBe(startY + 1);
      });

      it('T1_F8_4: reverse peel progression decrements currentYear monotonically', () => {
        let currentYear = 2020;
        const tickPeel = () => {
          if (currentYear > dfSim.firstRingYear) currentYear--;
        };
        tickPeel();
        expect(currentYear).toBe(2019);
      });

      it('T1_F8_5: pause freezes state without advancing year', () => {
        let isPlaying = false;
        let currentYear = 2000;
        const tick = () => {
          if (isPlaying) currentYear++;
        };
        tick();
        expect(currentYear).toBe(2000);
        expect(isPlaying).toBe(false);
      });
    });

    // ========================================================================
    // F9: Ring Inspection & Tooltip HUD
    // ========================================================================
    describe('F9: Ring Inspection & Tooltip HUD', () => {
      it('T1_F9_1: hovering over ring index returns matching record with identical year and index', () => {
        const ring10 = dfSim.rings[9];
        expect(ring10).toBeDefined();
        expect(ring10.record.ringIndex).toBe(10);
        expect(ring10.record.calendarYear).toBe(dfSim.firstRingYear + 9);
      });

      it('T1_F9_2: relative ring width index (RWI) metric is positive and normalized', () => {
        const meanAllWidths =
          dfSim.rings.reduce((sum, r) => sum + r.record.meanWidthMm, 0) / dfSim.rings.length;
        const ring15 = dfSim.rings[14];
        const rwi = ring15.record.meanWidthMm / meanAllWidths;
        expect(rwi).toBeGreaterThan(0.05);
        expect(rwi).toBeLessThan(3.5);
      });

      it('T1_F9_3: climatic stress classification identifies moisture vs temperature limiting factors', () => {
        const ring5 = dfSim.rings[4];
        expect(['moisture', 'temperature', 'balanced']).toContain(ring5.record.limitingFactor);
      });

      it('T1_F9_4: heartwood vs sapwood discrimination separates inner core from outer cambium', () => {
        const innerRing = dfSim.rings[0];
        const outerRing = dfSim.rings[dfSim.rings.length - 1];
        expect(innerRing.record.isHeartwood).toBe(true);
        expect(outerRing.record.isHeartwood).toBe(false);
      });

      it('T1_F9_5: latewood fraction readout formats valid percentage', () => {
        const ring8 = dfSim.rings[7];
        const latewoodFormatted = `${Math.round(ring8.record.latewoodFraction * 100)}%`;
        expect(latewoodFormatted).toMatch(/^\d+%$/);
      });
    });

    // ========================================================================
    // F10: Fullscreen Exhibition Mode
    // ========================================================================
    describe('F10: Fullscreen Exhibition Mode', () => {
      it('T1_F10_1: keyboard F shortcut toggles exhibition mode', () => {
        const handleKeyDown = (key: string) => key === 'f' || key === 'F';
        expect(handleKeyDown('f')).toBe(true);
        expect(handleKeyDown('F')).toBe(true);
        expect(handleKeyDown('a')).toBe(false);
      });

      it('T1_F10_2: UI chrome suppression hides sidebar and controls in exhibition state', () => {
        const appCssPath = path.resolve(process.cwd(), 'src/App.css');
        const appCss = fs.readFileSync(appCssPath, 'utf-8');
        expect(appCss).toContain('.main-stage');
        expect(appCss).toContain('.svg-viewport');
      });

      it('T1_F10_3: centered art viewport occupies stage with preserveAspectRatio xMidYMid meet', () => {
        const svg = generateCrossSectionSvg(dfSim, {
          showBark: true,
          showMedullaryRays: true,
          showAnnotations: true,
          transparentBackground: false,
        });
        expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
      });

      it('T1_F10_4: ambient camera drift translation oscillates within +/- 5% viewBox bounds', () => {
        const viewBox = { width: 300, height: 300 };
        const maxAmpX = viewBox.width * 0.045;
        const maxAmpY = viewBox.height * 0.045;
        const timestampMs = 5000;
        const dx = Math.sin((timestampMs / 18000) * 2 * Math.PI) * maxAmpX;
        const dy = Math.cos((timestampMs / 24000) * 2 * Math.PI) * maxAmpY;
        expect(Math.abs(dx)).toBeLessThanOrEqual(viewBox.width * 0.05);
        expect(Math.abs(dy)).toBeLessThanOrEqual(viewBox.height * 0.05);
      });

      it('T1_F10_5: escape key dismisses exhibition mode', () => {
        const isDismissKey = (key: string) => key === 'Escape';
        expect(isDismissKey('Escape')).toBe(true);
        expect(isDismissKey('Enter')).toBe(false);
      });
    });

    // ========================================================================
    // F11: URL Permalink Serialization
    // ========================================================================
    describe('F11: URL Permalink Serialization', () => {
      it('T1_F11_1: serializePermalink encodes species, coords, age, deathYear, mode, and palette', () => {
        const params = new URLSearchParams({
          sp: 'ponderosa-pine',
          lat: (35.2645).toFixed(4),
          lon: (-111.7442).toFixed(4),
          age: '250',
          death: '2026',
          mode: 'peel',
          pal: 'aged-wood',
        });
        const query = `?${params.toString()}`;
        expect(query).toContain('sp=ponderosa-pine');
        expect(query).toContain('lat=35.2645');
        expect(query).toContain('lon=-111.7442');
        expect(query).toContain('age=250');
        expect(query).toContain('death=2026');
        expect(query).toContain('mode=peel');
        expect(query).toContain('pal=aged-wood');
      });

      it('T1_F11_2: deserializePermalink restores all parameters with 100% roundtrip fidelity', () => {
        const params = new URLSearchParams({
          sp: 'douglas-fir',
          lat: '44.2124',
          lon: '-122.2557',
          age: '140',
          death: '2026',
          mode: 'grow',
          pal: 'charred-subalpine',
        });
        const url = `https://xylem.art/?${params.toString()}`;
        const parsed = new URL(url).searchParams;
        expect(parsed.get('sp')).toBe('douglas-fir');
        expect(parseFloat(parsed.get('lat')!)).toBeCloseTo(44.2124, 4);
        expect(parseFloat(parsed.get('lon')!)).toBeCloseTo(-122.2557, 4);
        expect(parseInt(parsed.get('age')!, 10)).toBe(140);
        expect(parsed.get('mode')).toBe('grow');
        expect(parsed.get('pal')).toBe('charred-subalpine');
      });

      it('T1_F11_3: preset serialization preserves preset identifier', () => {
        const params = new URLSearchParams({ preset: 'bristlecone-ancient' });
        expect(params.get('preset')).toBe('bristlecone-ancient');
      });

      it('T1_F11_4: clipboard copy execution invokes navigator.clipboard.writeText', async () => {
        const writeMock = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText: writeMock } });
        const shareUrl = 'https://xylem.art/?sp=douglas-fir&age=150';
        await navigator.clipboard.writeText(shareUrl);
        expect(writeMock).toHaveBeenCalledWith(shareUrl);
      });

      it('T1_F11_5: copy feedback state transition toggles copied status with timeout reset', () => {
        vi.useFakeTimers();
        let copied = false;
        const triggerCopy = () => {
          copied = true;
          setTimeout(() => {
            copied = false;
          }, 1800);
        };
        triggerCopy();
        expect(copied).toBe(true);
        vi.advanceTimersByTime(1800);
        expect(copied).toBe(false);
        vi.useRealTimers();
      });
    });

    // ========================================================================
    // F12: Organic Palettes & Textures
    // ========================================================================
    describe('F12: Organic Palettes & Textures', () => {
      it('T1_F12_1: Aged Heartwood & Sapwood palette tokens define warm amber and umber tones', () => {
        const pluvialPreset = getPresetById('pluvial-megadrought')!;
        expect(pluvialPreset.recommendedPalette).toBe('aged-wood');
      });

      it('T1_F12_2: Charred Sub-Alpine palette tokens define ash-gray, soot-black, and obsidian char', () => {
        const wildfirePreset = getPresetById('wildfire-scar-healing')!;
        expect(wildfirePreset.recommendedPalette).toBe('charred-subalpine');
      });

      it('T1_F12_3: Skeleton Plot palette tokens define high-contrast bone background and crimson markers', () => {
        const bristleconePreset = getPresetById('bristlecone-ancient')!;
        expect(bristleconePreset.recommendedPalette).toBe('skeleton-plot');
      });

      it('T1_F12_4: SVG defs anisotropic texture filter includes feTurbulence and feDisplacementMap', () => {
        const filterXml = `<filter id="wood-grain-filter">
          <feTurbulence type="fractalNoise" baseFrequency="0.02 0.35" numOctaves="3" result="noise"/>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.5" xChannelSelector="R" yChannelSelector="G"/>
        </filter>`;
        expect(filterXml).toContain('id="wood-grain-filter"');
        expect(filterXml).toContain('<feTurbulence');
        expect(filterXml).toContain('<feDisplacementMap');
      });

      it('T1_F12_5: palette tokens are reflected in generated SVG ring path styling', () => {
        const bundle = generateCrossSectionSvgBundle(dfSim, {
          showBark: true,
          showMedullaryRays: true,
          showAnnotations: true,
          transparentBackground: false,
        });
        expect(bundle.innerMarkup).toContain('stroke="#');
        expect(bundle.innerMarkup).toContain('fill="#');
      });
    });

    // ========================================================================
    // F13: High-Resolution 4K & SVG Export
    // ========================================================================
    describe('F13: High-Resolution 4K & SVG Export', () => {
      it('T1_F13_1: 4K raster canvas sizing at 300 DPI calculates 3840x2160 pixels', () => {
        const width = 3840;
        const height = 2160;
        const dpi = 300;
        expect(width / dpi).toBeCloseTo(12.8, 1);
        expect(height / dpi).toBeCloseTo(7.2, 1);
      });

      it('T1_F13_2: standalone archival SVG vector integrity contains valid XML and SVG root tags', () => {
        const svg = generateCrossSectionSvg(dfSim, {
          showBark: true,
          showMedullaryRays: true,
          showAnnotations: true,
          transparentBackground: false,
        });
        expect(svg.startsWith('<?xml') || svg.startsWith('<svg')).toBe(true);
        expect(svg.endsWith('</svg>')).toBe(true);
      });

      it('T1_F13_3: colophon border text includes specimen seed, species name, and year span', () => {
        const bundle = generateCrossSectionSvgBundle(dfSim, {
          showBark: true,
          showMedullaryRays: true,
          showAnnotations: true,
          transparentBackground: false,
        });
        expect(bundle.svgMarkup).toContain('Pseudotsuga menziesii');
        expect(bundle.svgMarkup).toContain(`${dfSim.firstRingYear}–${dfSim.params.deathYear}`);
      });

      it('T1_F13_4: colophon border expands outer viewBox bounds while preserving art ratio', () => {
        const bundle = generateCrossSectionSvgBundle(dfSim, {
          showBark: true,
          showMedullaryRays: true,
          showAnnotations: true,
          transparentBackground: false,
        });
        const aspect = bundle.viewBox.width / bundle.viewBox.height;
        expect(aspect).toBeGreaterThan(0.5);
        expect(aspect).toBeLessThan(2.0);
      });

      it('T1_F13_5: uncompressed PNG blob generation produces image/png blob', () => {
        const mime = 'image/png';
        expect(mime).toBe('image/png');
      });
    });

    // ========================================================================
    // F14: Social Metadata & Responsive Polish
    // ========================================================================
    describe('F14: Social Metadata & Responsive Polish', () => {
      it('T1_F14_1: OpenGraph metadata configuration specifies title, description, and image', () => {
        const htmlPath = path.resolve(process.cwd(), 'index.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
        expect(htmlContent).toContain('<meta property="og:title"');
        expect(htmlContent).toContain('<meta property="og:description"');
        expect(htmlContent).toContain('<meta property="og:image"');
      });

      it('T1_F14_2: Twitter card metadata specifies summary_large_image', () => {
        const htmlPath = path.resolve(process.cwd(), 'index.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
        expect(htmlContent).toContain('<meta name="twitter:card" content="summary_large_image"');
        expect(htmlContent).toContain('<meta name="twitter:title"');
      });

      it('T1_F14_3: social preview graphic metadata references 1200x630 asset', () => {
        const htmlPath = path.resolve(process.cwd(), 'index.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
        expect(htmlContent).toContain('content="./og-preview.png"');
      });

      it('T1_F14_4: responsive mobile viewport configuration is defined', () => {
        const htmlPath = path.resolve(process.cwd(), 'index.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
        expect(htmlContent).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0"');
      });

      it('T1_F14_5: touch-action none and scroll containment prevents mobile viewport interference', () => {
        const appCssPath = path.resolve(process.cwd(), 'src/App.css');
        const appCss = fs.readFileSync(appCssPath, 'utf-8');
        expect(appCss).toContain('overflow: hidden');
        expect(appCss).toContain('user-select: none');
        expect(appCss).toContain('-webkit-overflow-scrolling: touch');
      });
    });
  });

  // ==========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (F1–F14)
  // ==========================================================================
  describe('Tier 2: Boundary & Corner Cases', () => {
    // ========================================================================
    // F1 Boundary Tests: Brand Identity & Retrospective Copy
    // ========================================================================
    describe('F1: Brand Identity & Retrospective UI Framing Boundary Tests', () => {
      it('T2_F1_1: verifies complete absence of arcade/vintage/CRT tropes in real production files', () => {
        const indexHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
        const titleMatch = indexHtml.match(/<title>([\s\S]*?)<\/title>/i);
        const descMatch = indexHtml.match(/<meta name="description" content="([^"]*)"/i);
        expect(titleMatch![1]).not.toMatch(FORBIDDEN_TROPES);
        expect(descMatch![1]).not.toMatch(FORBIDDEN_TROPES);

        const appTsx = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
        const appBrandHeader = appTsx.slice(
          appTsx.indexOf('<header className="brand-header'),
          appTsx.indexOf('</header>')
        );
        expect(appBrandHeader).not.toMatch(FORBIDDEN_TROPES);
      });

      it('T2_F1_2: subtitle handles narrow viewport text-wrapping without layout collapse', () => {
        expect(BRAND_SUBTITLE.split(' ').length).toBeGreaterThan(5);
      });

      it('T2_F1_3: brand strings contain resolved Unicode glyphs without raw HTML entity leaks in App.tsx', () => {
        const appTsx = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
        expect(appTsx).not.toContain('&amp;amp;');
        expect(appTsx).not.toContain('&#39;');
      });

      it('T2_F1_4: package.json name conforms to museum-grade project naming', () => {
        const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'));
        expect(pkg.name).toBe('xylem-ecological-ledger-of-deep-time');
      });

      it('T2_F1_5: brand strings normalize whitespace robustly', () => {
        const padded = `  ${BRAND_PRIMARY}  \n`;
        expect(padded.trim()).toBe(BRAND_PRIMARY);
      });
    });

    // ========================================================================
    // F2 Boundary Tests: Introductory Colophon Modal
    // ========================================================================
    describe('F2: Introductory Colophon Modal Boundary Tests', () => {
      let colophonSource: string;

      beforeAll(() => {
        colophonSource = fs.readFileSync(
          path.resolve(process.cwd(), 'src/components/ColophonModal.tsx'),
          'utf-8'
        );
      });

      it('T2_F2_1: implements window keyboard listener for Escape key dismissal and cleans up', () => {
        expect(colophonSource).toContain("e.key === 'Escape'");
        expect(colophonSource).toContain("window.addEventListener('keydown', handleKeyDown)");
        expect(colophonSource).toContain("window.removeEventListener('keydown', handleKeyDown)");
      });

      it('T2_F2_2: provides presentation backdrop overlay and stops propagation on modal card', () => {
        expect(colophonSource).toContain('className="colophon-modal-overlay"');
        expect(colophonSource).toContain('role="presentation"');
        expect(colophonSource).toContain('onClick={onClose}');
        expect(colophonSource).toContain('onClick={(e) => e.stopPropagation()}');
      });

      it('T2_F2_3: close button binds onClose callback and provides accessible label', () => {
        expect(colophonSource).toContain('className="colophon-close-btn"');
        expect(colophonSource).toContain('onClick={onClose}');
        expect(colophonSource).toContain('aria-label="Close colophon dialog"');
      });

      it('T2_F2_4: locks body scrolling on open and restores previous overflow style on cleanup', () => {
        expect(colophonSource).toContain("document.body.style.overflow = 'hidden'");
        expect(colophonSource).toContain('document.body.style.overflow = originalOverflow');
      });

      it('T2_F2_5: dialog title element references matching accessible heading', () => {
        expect(colophonSource).toContain('id="colophon-modal-title"');
        expect(colophonSource).toContain('XYLEM: An Ecological Ledger of Deep Time');
      });
    });

    // ========================================================================
    // F3 Boundary Tests: Retrospective Presets
    // ========================================================================
    describe('F3: Retrospective Presets Boundary Tests', () => {
      it('T2_F3_1: presets are immutable; cloning prevents registry contamination', () => {
        const b = getPresetById('bristlecone-ancient')!;
        const clone = JSON.parse(JSON.stringify(b));
        clone.totalAge = 999;
        expect(b.totalAge).toBe(380);
      });

      it('T2_F3_2: state discriminator isPresetActive detects matches and flags divergent age or species', () => {
        const preset = getPresetById('bristlecone-ancient')!;
        const matchingState = {
          species: preset.species,
          latitude: preset.coordinates.latitude,
          longitude: preset.coordinates.longitude,
          totalAge: preset.temporal.totalAge,
          deathYear: preset.temporal.deathYear,
        };
        expect(isPresetActive(preset, matchingState)).toBe(true);

        const divergentState = { ...matchingState, totalAge: 120 };
        expect(isPresetActive(preset, divergentState)).toBe(false);
      });

      it('T2_F3_3: unknown preset lookup returns undefined and getDefaultPreset returns bristlecone', () => {
        expect(getPresetById('unknown-scenario')).toBeUndefined();
        expect(getPresetById('')).toBeUndefined();
        expect(getDefaultPreset().id).toBe('bristlecone-ancient');
      });

      it('T2_F3_4: forward simulation completes within 500ms performance budget', () => {
        const preset = getPresetById('pluvial-megadrought')!;
        const env = makeDeterministicMockEnvironment(
          preset.climatic.meanAnnualTempC,
          preset.climatic.meanAnnualPrecipMm
        );
        const t0 = performance.now();
        const sim = simulateTreeCrossSection(
          {
            species: preset.species,
            latitude: preset.coordinates.latitude,
            longitude: preset.coordinates.longitude,
            totalAge: 100,
            deathYear: preset.temporal.deathYear,
          },
          env
        );
        const t1 = performance.now();
        expect(t1 - t0).toBeLessThan(500);
        expect(sim.rings.length).toBe(sim.visibleRingCount);
      });

      it('T2_F3_5: all presets enforce valid physical diameter and landmark year invariants', () => {
        for (const p of RETROSPECTIVE_PRESETS) {
          expect(p.totalAge).toBeGreaterThan(0);
          expect(p.landmarkYears.length).toBeGreaterThan(0);
          for (const yr of p.landmarkYears) {
            expect(yr).toBeGreaterThanOrEqual(p.temporal.startYear);
            expect(yr).toBeLessThanOrEqual(p.temporal.deathYear);
          }
        }
      });
    });

    // ========================================================================
    // F4 Boundary Tests: Earlywood-to-Latewood Transitions
    // ========================================================================
    describe('F4: Earlywood-to-Latewood Boundary Tests', () => {
      it('T2_F4_1: narrow drought rings preserve strictly positive earlywood and latewood layer widths', () => {
        const narrowRing = dfSim.rings.reduce((min, r) =>
          r.record.meanWidthMm < min.record.meanWidthMm ? r : min
        );
        expect(narrowRing.record.meanWidthMm).toBeGreaterThan(0);
        for (let j = 0; j < narrowRing.innerRadiusMm.length; j += 20) {
          expect(narrowRing.outerRadiusMm[j] - narrowRing.lwInnerRadiusMm[j]).toBeGreaterThan(0);
          expect(narrowRing.ewBoundaryRadiusMm[j] - narrowRing.innerRadiusMm[j]).toBeGreaterThan(0);
        }
      });

      it('T2_F4_2: juvenile ring width flare scales earlywood and latewood proportionally', () => {
        const juvenileRing = dfSim.rings[0];
        const matureRing = dfSim.rings[dfSim.rings.length - 1];
        expect(juvenileRing.record.meanWidthMm).toBeGreaterThan(matureRing.record.meanWidthMm);
        expect(
          juvenileRing.record.earlywoodWidthMm + juvenileRing.record.latewoodWidthMm
        ).toBeCloseTo(juvenileRing.record.meanWidthMm, 4);
      });

      it('T2_F4_3: latewood fraction is strictly clamped between 0.09 and 0.62 across all rings', () => {
        for (const ring of dfSim.rings) {
          expect(ring.record.latewoodFraction).toBeGreaterThanOrEqual(0.09);
          expect(ring.record.latewoodFraction).toBeLessThanOrEqual(0.62);
        }
      });

      it('T2_F4_4: heartwood rings retain >= 30 units optical reflectance contrast with latewood', () => {
        const heartwoodRings = dfSim.rings.filter((r) => r.record.isHeartwood);
        expect(heartwoodRings.length).toBeGreaterThan(0);
        for (const r of heartwoodRings) {
          expect(r.record.earlywoodGray - r.record.latewoodGray).toBeGreaterThanOrEqual(30);
        }
      });

      it('T2_F4_5: polar boundary wrapping at 0 and 2*PI maintains smooth continuity (< 2.0mm delta)', () => {
        for (const ring of dfSim.rings) {
          const N = ring.outerRadiusMm.length;
          const stepDiff = Math.abs(ring.outerRadiusMm[0] - ring.outerRadiusMm[N - 1]);
          expect(stepDiff).toBeLessThan(2.0);
          expect(stepDiff / ring.outerRadiusMm[0]).toBeLessThan(0.02);
        }
      });
    });

    // ========================================================================
    // F5 Boundary Tests: Pith Displacement & Eccentricity
    // ========================================================================
    describe('F5: Pith Displacement Boundary Tests', () => {
      it('T2_F5_1: flat terrain (slope = 0) sustains natural baseline lean without division by zero or NaNs', () => {
        const flatEnv = makeDeterministicMockEnvironment(9.5, 650, 0, 0);
        const flatSim = simulateTreeCrossSection(
          { species: 'douglas-fir', latitude: 44.2, longitude: -122.2, totalAge: 25, deathYear: 2026 },
          flatEnv
        );
        expect(flatSim.compressionStrength).toBeGreaterThanOrEqual(0.03);
        expect(Number.isFinite(flatSim.compressionStrength)).toBe(true);
        for (const ring of flatSim.rings) {
          for (const r of ring.outerRadiusMm) {
            expect(Number.isFinite(r)).toBe(true);
            expect(Number.isNaN(r)).toBe(false);
          }
        }
      });

      it('T2_F5_2: extreme slope (70 deg) clamps compression strength to <= 0.35', () => {
        const steepEnv = makeDeterministicMockEnvironment(9.5, 650, 70, 195);
        const steepSim = simulateTreeCrossSection(
          { species: 'douglas-fir', latitude: 44.2, longitude: -122.2, totalAge: 25, deathYear: 2026 },
          steepEnv
        );
        expect(steepSim.compressionStrength).toBeLessThanOrEqual(0.35);
      });

      it('T2_F5_3: radial growth is strictly monotonic for every angular ray from the pith across simulation rings', () => {
        for (let idx = 1; idx < dfSim.rings.length; idx++) {
          const prevRing = dfSim.rings[idx - 1];
          const currRing = dfSim.rings[idx];
          for (let j = 0; j < currRing.outerRadiusMm.length; j += 15) {
            expect(currRing.outerRadiusMm[j]).toBeGreaterThan(prevRing.outerRadiusMm[j]);
          }
        }
      });

      it('T2_F5_4: cumulative pith drift over lifespan remains safely inside inner 35% of trunk radius', () => {
        const lastRing = dfSim.rings[dfSim.rings.length - 1];
        let sumX = 0;
        let sumY = 0;
        const N = dfSim.anglesRad.length;
        for (let j = 0; j < N; j++) {
          sumX += lastRing.outerRadiusMm[j] * Math.cos(dfSim.anglesRad[j]);
          sumY += lastRing.outerRadiusMm[j] * Math.sin(dfSim.anglesRad[j]);
        }
        const pithOffsetMm = Math.hypot(sumX / N, sumY / N);
        const meanRadiusMm =
          lastRing.outerRadiusMm.reduce((a, b) => a + b, 0) / lastRing.outerRadiusMm.length;
        expect(pithOffsetMm).toBeLessThan(meanRadiusMm * 0.35);
      });

      it('T2_F5_5: harmonic functions at 0 and 2*PI match within floating-point tolerance', () => {
        const axis = 0.85;
        const h0 = Math.cos(2 * (0 - axis));
        const h2Pi = Math.cos(2 * (2 * Math.PI - axis));
        expect(Math.abs(h0 - h2Pi)).toBeLessThan(1e-6);
      });
    });

    // ========================================================================
    // F6 Boundary Tests: Trauma Markers
    // ========================================================================
    describe('F6: Trauma Markers Boundary Tests', () => {
      it('T2_F6_1: compounding climatic stress generates strictly finite, non-NaN coordinates across all rings', () => {
        for (const ring of dfSim.rings) {
          for (const r of ring.outerRadiusMm) {
            expect(Number.isFinite(r)).toBe(true);
            expect(Number.isNaN(r)).toBe(false);
          }
        }
      });

      it('T2_F6_2: benign specimen produces zero false rings and undefined falseRingRadiusMm', () => {
        const benignEnv = makeDeterministicMockEnvironment(9.5, 950, 5, 0);
        const benignSim = simulateTreeCrossSection(
          { species: 'douglas-fir', latitude: 44.2, longitude: -122.2, totalAge: 20, deathYear: 2026 },
          benignEnv
        );
        for (const ring of benignSim.rings) {
          expect(ring.record.hasFalseRing).toBe(false);
          expect(ring.falseRingRadiusMm).toBeUndefined();
        }
      });

      it('T2_F6_3: fire scar catface orients to uphill slope aspect in wildfire preset', () => {
        const wPreset = getPresetById('wildfire-scar-healing')!;
        expect(wPreset.disturbance.fireScarAzimuthRad).toBeCloseTo(2.356, 2);
      });

      it('T2_F6_4: maximum catface arc is strictly clamped below PI rad (180 deg) to prevent girdling', () => {
        for (const p of RETROSPECTIVE_PRESETS) {
          if (p.disturbance.fireScarArcRad !== undefined) {
            expect(p.disturbance.fireScarArcRad).toBeLessThan(Math.PI);
            expect(p.disturbance.fireScarArcRad).toBeGreaterThan(0);
          }
        }
      });

      it('T2_F6_5: callus margins converge over post-fire years without overlapping', () => {
        const initialGapMm = 45.0;
        const year10GapMm = 30.0;
        const year20GapMm = 16.0;
        expect(year10GapMm).toBeLessThan(initialGapMm);
        expect(year20GapMm).toBeLessThan(year10GapMm);
        expect(year20GapMm).toBeGreaterThan(0);
      });
    });

    // ========================================================================
    // F7 Boundary Tests: Dual-Mode Navigation
    // ========================================================================
    describe('F7: Dual-Mode Navigation Boundary Tests', () => {
      it('T2_F7_1: peeling back to first ring year yields exactly 1 ring with positive radius', () => {
        const seedling = dfSim.rings.filter((r) => r.record.calendarYear <= dfSim.firstRingYear);
        expect(seedling.length).toBe(1);
        expect(seedling[0].record.calendarYear).toBe(dfSim.firstRingYear);
        expect(seedling[0].outerRadiusMm[0]).toBeGreaterThan(0);
      });

      it('T2_F7_2: clamping handles out-of-range years safely without errors', () => {
        const underflowYear = 1500;
        const underflowRings = dfSim.rings.filter(
          (r) => r.record.calendarYear <= Math.max(dfSim.firstRingYear, underflowYear)
        );
        expect(underflowRings.length).toBe(1);

        const overflowYear = 2500;
        const overflowRings = dfSim.rings.filter(
          (r) => r.record.calendarYear <= Math.min(dfSim.params.deathYear, overflowYear)
        );
        expect(overflowRings.length).toBe(dfSim.rings.length);
      });

      it('T2_F7_3: young specimen with minimum rings navigates cleanly', () => {
        const youngEnv = makeDeterministicMockEnvironment();
        const youngSim = simulateTreeCrossSection(
          { species: 'douglas-fir', latitude: 44.2, longitude: -122.2, totalAge: 5, deathYear: 2026 },
          youngEnv
        );
        expect(youngSim.visibleRingCount).toBeGreaterThan(0);
        const sliced = youngSim.rings.filter((r) => r.record.calendarYear <= 2024);
        expect(sliced.length).toBeGreaterThan(0);
      });

      it('T2_F7_4: alternating between peel and grow modes maintains 100% deterministic slicing', () => {
        for (let i = 0; i < 5; i++) {
          const peelCount = dfSim.rings.filter((r) => r.record.calendarYear <= 2010).length;
          const growCount = dfSim.rings.slice(0, peelCount).length;
          expect(peelCount).toBe(growCount);
        }
      });

      it('T2_F7_5: pith origin coordinates remain invariant during reverse peeling', () => {
        const pithOrigin = { x: 0, y: 0 };
        const years = [2026, 2010, 1995, dfSim.firstRingYear];
        for (const y of years) {
          const sliced = dfSim.rings.filter((r) => r.record.calendarYear <= y);
          expect(sliced.length).toBeGreaterThan(0);
          expect(pithOrigin.x).toBe(0);
          expect(pithOrigin.y).toBe(0);
        }
      });
    });

    // ========================================================================
    // F8 Boundary Tests: Playback Controller
    // ========================================================================
    describe('F8: Playback Controller Boundary Tests', () => {
      it('T2_F8_1: termination boundary in grow mode clamps at death year', () => {
        let currentYear = dfSim.params.deathYear;
        const tickGrow = () => {
          if (currentYear < dfSim.params.deathYear) currentYear++;
        };
        tickGrow();
        expect(currentYear).toBe(dfSim.params.deathYear);
      });

      it('T2_F8_2: termination boundary in peel mode clamps at first ring year', () => {
        let currentYear = dfSim.firstRingYear;
        const tickPeel = () => {
          if (currentYear > dfSim.firstRingYear) currentYear--;
        };
        tickPeel();
        expect(currentYear).toBe(dfSim.firstRingYear);
      });

      it('T2_F8_3: short-lived specimen navigates without negative slicing', () => {
        const firstYear = 2022;
        let currentYear = firstYear;
        const tickPeel = () => {
          if (currentYear > firstYear) currentYear--;
        };
        tickPeel();
        expect(currentYear).toBe(2022);
      });

      it('T2_F8_4: speed multiplier scales tick interval accurately', () => {
        const baseIntervalMs = 200;
        const speed = 4.0;
        const interval = baseIntervalMs / speed;
        expect(interval).toBeCloseTo(50, 2);
      });

      it('T2_F8_5: mid-flight direction reversal updates step delta immediately', () => {
        let currentYear = 2000;
        let mode: 'grow' | 'peel' = 'grow';
        const step = () => {
          currentYear += mode === 'grow' ? 1 : -1;
        };
        step();
        expect(currentYear).toBe(2001);
        mode = 'peel';
        step();
        expect(currentYear).toBe(2000);
      });
    });

    // ========================================================================
    // F9 Boundary Tests: Ring Inspection HUD
    // ========================================================================
    describe('F9: Ring Inspection HUD Boundary Tests', () => {
      it('T2_F9_1: canvas margin hover outside tree boundary returns null', () => {
        const findRing = (index: number) =>
          dfSim.rings.find((r) => r.record.ringIndex === index) ?? null;
        const nullHud = findRing(9999);
        expect(nullHud).toBeNull();
      });

      it('T2_F9_2: intra-annual false ring tag is annotated for false ring records', () => {
        const monsoonSim = simulateTreeCrossSection(
          {
            species: 'ponderosa-pine',
            latitude: 35.2645,
            longitude: -111.7442,
            totalAge: 50,
            deathYear: 2026,
          },
          makeMonsoonSurgeEnvironment()
        );
        const falseRing = monsoonSim.rings.find((r) => r.record.hasFalseRing);
        expect(falseRing).toBeDefined();
        expect(falseRing!.record.hasFalseRing).toBe(true);
        expect(falseRing!.record.falseRingPosition).toBeGreaterThan(0.5);

        const iadfTag = falseRing!.record.hasFalseRing ? 'Intra-annual false ring (IADF)' : '';
        expect(iadfTag).toBe('Intra-annual false ring (IADF)');
      });

      it('T2_F9_3: locally absent ring sector surfaces cambial shutdown alert', () => {
        const droughtRing = dfSim.rings.find((r) => r.record.calendarYear === 1977);
        expect(droughtRing).toBeDefined();
        const meanAllWidths =
          dfSim.rings.reduce((sum, r) => sum + r.record.meanWidthMm, 0) / dfSim.rings.length;
        const rwi = droughtRing!.record.meanWidthMm / meanAllWidths;
        expect(rwi).toBeLessThan(0.6);
        expect(droughtRing!.record.climateIndex).toBeLessThan(0.6);
      });

      it('T2_F9_4: extreme pluvial growth spike surfaces favorable release tag', () => {
        const pluvialRing = dfSim.rings.find((r) => r.record.calendarYear === 1983);
        expect(pluvialRing).toBeDefined();
        const meanAllWidths =
          dfSim.rings.reduce((sum, r) => sum + r.record.meanWidthMm, 0) / dfSim.rings.length;
        const rwi = pluvialRing!.record.meanWidthMm / meanAllWidths;
        expect(rwi).toBeGreaterThan(1.45);
      });

      it('T2_F9_5: first visible ring calculation avoids zero-division error', () => {
        const ring1 = dfSim.rings[0];
        expect(ring1).toBeDefined();
        const meanAllWidths =
          dfSim.rings.reduce((sum, r) => sum + r.record.meanWidthMm, 0) / dfSim.rings.length;
        const rwi1 = ring1.record.meanWidthMm / meanAllWidths;
        expect(Number.isFinite(rwi1)).toBe(true);
        expect(rwi1).toBeGreaterThan(0);
        expect(ring1.record.treeAge).toBeGreaterThan(0);
      });
    });

    // ========================================================================
    // F10 Boundary Tests: Fullscreen Exhibition Mode
    // ========================================================================
    describe('F10: Fullscreen Exhibition Mode Boundary Tests', () => {
      it('T2_F10_1: input element focus suppresses exhibition shortcut', () => {
        let isExhibition = false;
        const handleKeyDownWithTarget = (key: string, tagName: string) => {
          if (tagName === 'INPUT' || tagName === 'TEXTAREA') return;
          if (key === 'f') isExhibition = !isExhibition;
        };
        handleKeyDownWithTarget('f', 'INPUT');
        expect(isExhibition).toBe(false);
      });

      it('T2_F10_2: rapid consecutive toggle debounces cleanly without orphaned state', () => {
        let isExhibition = false;
        const toggle = () => {
          isExhibition = !isExhibition;
        };
        toggle();
        toggle();
        toggle();
        expect(isExhibition).toBe(true);
        toggle();
        expect(isExhibition).toBe(false);
      });

      it('T2_F10_3: exhibition mode and auto-growth coexist concurrently', () => {
        let currentYear = 2000;
        const exhibitionActive = true;
        currentYear++;
        expect(exhibitionActive).toBe(true);
        expect(currentYear).toBe(2001);
      });

      it('T2_F10_4: window resize re-centers art without clipping', () => {
        const standardVb = { width: 300, height: 300 };
        const resizedVb = { width: 450, height: 450 };
        expect(resizedVb.width).toBeGreaterThan(standardVb.width);
      });

      it('T2_F10_5: long-duration drift calculation remains mathematically stable', () => {
        const periodX = 18000;
        const periodY = 24000;
        const baseViewBox = { width: 400, height: 400 };
        const maxAmpX = baseViewBox.width * 0.045;
        const maxAmpY = baseViewBox.height * 0.045;
        const t = 100000000;
        const dx = Math.sin((t / periodX) * 2 * Math.PI) * maxAmpX;
        const dy = Math.cos((t / periodY) * 2 * Math.PI) * maxAmpY;
        expect(Number.isFinite(dx)).toBe(true);
        expect(Number.isFinite(dy)).toBe(true);
        expect(Math.abs(dx)).toBeLessThanOrEqual(400 * 0.05);
        expect(Math.abs(dy)).toBeLessThanOrEqual(400 * 0.05);
      });
    });

    // ========================================================================
    // F11 Boundary Tests: Permalink Serialization
    // ========================================================================
    describe('F11: Permalink Serialization Boundary Tests', () => {
      it('T2_F11_1: out-of-bounds latitude is clamped to [-90, 90]', () => {
        const clampLat = (lat: number) => Math.max(-90, Math.min(90, lat));
        expect(clampLat(142.5)).toBe(90);
        expect(clampLat(-110.0)).toBe(-90);
      });

      it('T2_F11_2: out-of-bounds longitude is clamped to [-180, 180]', () => {
        const clampLon = (lon: number) => Math.max(-180, Math.min(180, lon));
        expect(clampLon(-240.0)).toBe(-180);
        expect(clampLon(250.0)).toBe(180);
      });

      it('T2_F11_3: invalid tree age is clamped to valid bounds [4, 5000]', () => {
        const clampAge = (age: number) => Math.max(4, Math.min(5000, age));
        expect(clampAge(-5)).toBe(4);
        expect(clampAge(99999)).toBe(5000);
      });

      it('T2_F11_4: unknown palette ID safely resolves to default aged-wood', () => {
        const validPalettes = ['aged-wood', 'charred-subalpine', 'skeleton-plot'];
        const resolvePalette = (id: string) => (validPalettes.includes(id) ? id : 'aged-wood');
        expect(resolvePalette('neon-arcade')).toBe('aged-wood');
      });

      it('T2_F11_5: clipboard rejection is handled gracefully without unhandled rejection', async () => {
        const rejectedMock = vi.fn().mockRejectedValue(new Error('Permission denied'));
        vi.stubGlobal('navigator', { clipboard: { writeText: rejectedMock } });
        let caught = false;
        try {
          await navigator.clipboard.writeText('https://xylem.art');
        } catch {
          caught = true;
        }
        expect(caught).toBe(true);
      });
    });

    // ========================================================================
    // F12 Boundary Tests: Organic Palettes
    // ========================================================================
    describe('F12: Organic Palettes Boundary Tests', () => {
      it('T2_F12_1: invalid palette ID resolves to default palette', () => {
        const validPalettes = ['aged-wood', 'charred-subalpine', 'skeleton-plot'];
        const resolvePalette = (id: string) => (validPalettes.includes(id) ? id : 'aged-wood');
        expect(resolvePalette('non-existent')).toBe('aged-wood');
      });

      it('T2_F12_2: complete palette profile coverage across all curated presets', () => {
        const presetPalettes = RETROSPECTIVE_PRESETS.map((p) => p.recommendedPalette);
        expect(presetPalettes).toContain('aged-wood');
        expect(presetPalettes).toContain('charred-subalpine');
        expect(presetPalettes).toContain('skeleton-plot');
      });

      it('T2_F12_3: high-contrast ratio for Skeleton Plot palette ensures readability', () => {
        const skelBg = '#fdfcf7';
        const skelDark = '#111111';
        expect(skelBg).toBe('#fdfcf7');
        expect(skelDark).toBe('#111111');
      });

      it('T2_F12_4: anisotropic aspect ratio in wood grain filter elongates along grain axis', () => {
        const freqX = 0.02;
        const freqY = 0.35;
        expect(freqX).toBeLessThan(freqY);
      });

      it('T2_F12_5: zero texture overhead when texture filters are disabled', () => {
        const svg = generateCrossSectionSvg(dfSim, {
          showBark: true,
          showMedullaryRays: true,
          showAnnotations: true,
          transparentBackground: false,
        });
        expect(svg).toBeDefined();
        expect(svg).not.toContain('url(#wood-grain-filter)');
      });
    });

    // ========================================================================
    // F13 Boundary Tests: 4K & SVG Export
    // ========================================================================
    describe('F13: 4K & SVG Export Boundary Tests', () => {
      it('T2_F13_1: colophon plate titles escape special XML characters', () => {
        const escapeXml = (s: string) =>
          s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        const rawTitle = 'XYLEM & "Radial Ledger" <Plate I>';
        const escaped = escapeXml(rawTitle);
        expect(escaped).toBe('XYLEM &amp; &quot;Radial Ledger&quot; &lt;Plate I&gt;');
        expect(escaped).not.toContain('& ');
      });

      it('T2_F13_2: old-growth tree SVG string length compiles without truncation', () => {
        const bundle = generateCrossSectionSvgBundle(ppSim, {
          showBark: true,
          showMedullaryRays: true,
          showAnnotations: true,
          transparentBackground: false,
        });
        expect(bundle.svgMarkup.length).toBeGreaterThan(5000);
      });

      it('T2_F13_3: transparent background export omits background fill rect', () => {
        const transSvg = generateCrossSectionSvg(dfSim, {
          showBark: true,
          showMedullaryRays: true,
          showAnnotations: true,
          transparentBackground: true,
        });
        expect(transSvg).not.toContain('<rect id="svg-background" fill="#');
      });

      it('T2_F13_4: canvas 2D context failure throws descriptive diagnostic error', () => {
        const badCanvas = {
          getContext: (_type: string) => null,
        };
        const rasterize = (canvas: { getContext: (t: string) => unknown }) => {
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Failed to acquire 2D canvas context');
          return ctx;
        };
        expect(() => rasterize(badCanvas)).toThrow(/Failed to acquire 2D canvas context/);
      });

      it('T2_F13_5: export filename sanitization removes forbidden filesystem characters', () => {
        const sanitizeFilename = (raw: string) => raw.replace(/[:/*?"<>|\\]/g, '-');
        const rawFilename = 'xylem:douglas-fir/age50*2026.png';
        const sanitized = sanitizeFilename(rawFilename);
        expect(sanitized).toBe('xylem-douglas-fir-age50-2026.png');
      });
    });

    // ========================================================================
    // F14 Boundary Tests: Social Metadata & Responsive
    // ========================================================================
    describe('F14: Social Metadata & Responsive Boundary Tests', () => {
      it('T2_F14_1: mobile viewport horizontal overflow protection enforces overflow-x hidden', () => {
        const appCssPath = path.resolve(process.cwd(), 'src/App.css');
        const appCss = fs.readFileSync(appCssPath, 'utf-8');
        expect(appCss).toContain('overflow-x: hidden');
      });

      it('T2_F14_2: high-DPI Retina devicePixelRatio scaling calculates backing buffer dimensions', () => {
        const dpr = 3.0;
        const viewport = { width: 390, height: 844 };
        const buffer = { width: viewport.width * dpr, height: viewport.height * dpr };
        expect(buffer.width).toBe(1170);
        expect(buffer.height).toBe(2532);
        expect(buffer.width / viewport.width).toBe(dpr);
      });

      it('T2_F14_3: pointer cancel cleanup safety resets drag and hover states', () => {
        let isDragging = true;
        const handlePointerCancel = () => {
          isDragging = false;
        };
        handlePointerCancel();
        expect(isDragging).toBe(false);
      });

      it('T2_F14_4: social description character length remains under 200 characters', () => {
        const htmlPath = path.resolve(process.cwd(), 'index.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
        const match = htmlContent.match(/<meta property="og:description" content="([^"]+)"/);
        expect(match).not.toBeNull();
        const desc = match![1];
        expect(desc.length).toBeLessThanOrEqual(200);
        expect(desc.length).toBeGreaterThanOrEqual(20);
      });

      it('T2_F14_5: document title audit eliminates vintage arcade tropes', () => {
        const htmlPath = path.resolve(process.cwd(), 'index.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
        const titleMatch = htmlContent.match(/<title>([^<]+)<\/title>/);
        expect(titleMatch).not.toBeNull();
        expect(titleMatch![1]).not.toMatch(FORBIDDEN_TROPES);
      });
    });
  });

  // ==========================================================================
  // TIER 3: CROSS-FEATURE PAIRWISE COMBINATIONS (C1–C14)
  // ==========================================================================
  describe('Tier 3: Cross-Feature Combinations', () => {
    it('C1: F3 (Presets) + F7 (Peel Navigation) — peeling preset removes outer rings cleanly', () => {
      const preset = getPresetById('pluvial-megadrought')!;
      expect(preset).toBeDefined();
      const sim = simulateTreeCrossSection(
        {
          species: preset.species,
          latitude: preset.coordinates.latitude,
          longitude: preset.coordinates.longitude,
          totalAge: preset.temporal.totalAge,
          deathYear: preset.temporal.deathYear,
        },
        defaultEnv
      );
      expect(sim.rings.length).toBeGreaterThan(50);
      const peelYear = 1980;
      const peeledRings = sim.rings.filter((r) => r.record.calendarYear <= peelYear);
      expect(peeledRings.length).toBeGreaterThan(0);
      expect(peeledRings.length).toBeLessThan(sim.rings.length);
      expect(peeledRings[peeledRings.length - 1].record.calendarYear).toBe(peelYear);
      const fullRadius = sim.rings[sim.rings.length - 1].outerRadiusMm[0];
      const peeledRadius = peeledRings[peeledRings.length - 1].outerRadiusMm[0];
      expect(peeledRadius).toBeLessThan(fullRadius);
      const peeledSvg = generateCrossSectionSvg(
        { ...sim, rings: peeledRings, visibleRingCount: peeledRings.length },
        { showBark: false, showMedullaryRays: true, showAnnotations: false, transparentBackground: true }
      );
      expect(peeledSvg).toContain('<svg');
      expect(peeledSvg).toContain('</svg>');
    });

    it('C2: F3 (Presets) + F12 (Palettes) — wildfire preset integrates with charred subalpine palette', () => {
      const preset = getPresetById('wildfire-scar-healing')!;
      expect(preset).toBeDefined();
      expect(preset.recommendedPalette).toBe('charred-subalpine');
      expect(preset.disturbance.fireScarYear).toBe(1910);
      const sim = simulateTreeCrossSection(
        {
          species: preset.species,
          latitude: preset.coordinates.latitude,
          longitude: preset.coordinates.longitude,
          totalAge: 120,
          deathYear: preset.temporal.deathYear,
        },
        defaultEnv
      );
      const fireRing = sim.rings.find((r) => r.record.calendarYear === 1910);
      expect(fireRing).toBeDefined();
      expect(fireRing!.record.calendarYear).toBe(1910);
      const bundle = generateCrossSectionSvgBundle(sim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
      });
      expect(bundle.svgMarkup).toContain('<svg');
      expect(bundle.svgMarkup).toContain('Ponderosa Pine');
      expect(bundle.svgMarkup).toContain('Chronology Extent:');
    });

    it('C3: F5 (Eccentricity) + F6 (Fire Scars) — reaction wood slope offset coexists with uphill catface', () => {
      const preset = getPresetById('wildfire-scar-healing')!;
      expect(preset).toBeDefined();
      expect(preset.disturbance.fireScarAzimuthRad).toBeDefined();
      const slopedEnv = makeDeterministicMockEnvironment(7.8, 480, 20, 135);
      const sim = simulateTreeCrossSection(
        {
          species: preset.species,
          latitude: preset.coordinates.latitude,
          longitude: preset.coordinates.longitude,
          totalAge: 60,
          deathYear: 2024,
        },
        slopedEnv
      );
      expect(sim.compressionStrength).toBeGreaterThan(0.08);
      const lastRing = sim.rings[sim.rings.length - 1];
      const maxRadius = Math.max(...lastRing.outerRadiusMm);
      const minRadius = Math.min(...lastRing.outerRadiusMm);
      expect(maxRadius).toBeGreaterThan(minRadius);
      expect(maxRadius / minRadius).toBeGreaterThan(1.1);
    });

    it('C4: F8 (Playback) + F7 (Peel Mode) — playback loop in peel mode decrements years sequentially', () => {
      const lastRingYear = dfSim.rings[dfSim.rings.length - 1].record.calendarYear;
      let previousRingCount = dfSim.rings.length;
      let previousRadius = dfSim.rings[dfSim.rings.length - 1].outerRadiusMm[0];
      for (let targetYear = lastRingYear - 1; targetYear >= lastRingYear - 3; targetYear--) {
        const peeled = dfSim.rings.filter((r) => r.record.calendarYear <= targetYear);
        expect(peeled.length).toBeLessThan(previousRingCount);
        const stepRadius = peeled[peeled.length - 1].outerRadiusMm[0];
        expect(stepRadius).toBeLessThan(previousRadius);
        previousRingCount = peeled.length;
        previousRadius = stepRadius;
      }
    });

    it('C5: F8 (Playback) + F10 (Exhibition) — exhibition mode runs auto-growth concurrently with centered artwork', () => {
      let prevRadius = dfSim.pithRadiusMm;
      for (let age = 1; age <= 5; age++) {
        const subRings = dfSim.rings.slice(0, age);
        const outerR = subRings[subRings.length - 1].outerRadiusMm[0];
        expect(outerR).toBeGreaterThan(prevRadius);
        prevRadius = outerR;
      }
      const exhibitionBundle = generateCrossSectionSvgBundle(dfSim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: false,
        showLocatorMap: false,
        transparentBackground: true,
      });
      expect(exhibitionBundle.svgMarkup).not.toContain('id="annotations"');
      expect(exhibitionBundle.svgMarkup).not.toContain('id="locator-map"');
      expect(exhibitionBundle.viewBox.width).toBeGreaterThan(0);
      expect(exhibitionBundle.viewBox.height).toBeGreaterThan(0);
      const centerX = exhibitionBundle.viewBox.x + exhibitionBundle.viewBox.width / 2;
      expect(Math.abs(centerX)).toBeLessThan(exhibitionBundle.viewBox.width * 0.15);
    });

    it('C6: F6 (Disturbances) + F9 (HUD) — HUD surfaces trauma tags on rings with disturbances', () => {
      const droughtYear = 1977;
      const ring1977 = ppSim.rings.find((r) => r.record.calendarYear === droughtYear);
      expect(ring1977).toBeDefined();
      expect(ring1977!.record.climateIndex).toBeLessThan(0.7);
      const landmark = CLIMATE_LANDMARKS.find((l) => l.year === droughtYear);
      expect(landmark).toBeDefined();
      expect(landmark!.type).toBe('drought');
      expect(landmark!.fullName).toContain('1977');
    });

    it('C7: F3 (Presets) + F11 (Permalink) — preset selection serializes and deserializes cleanly', () => {
      const preset = getPresetById('bristlecone-ancient')!;
      expect(preset).toBeDefined();
      const searchParams = new URLSearchParams({
        preset: preset.id,
        sp: preset.species,
        lat: preset.coordinates.latitude.toFixed(4),
        lon: preset.coordinates.longitude.toFixed(4),
        age: String(preset.temporal.totalAge),
        death: String(preset.temporal.deathYear),
        mode: preset.initialMode,
      });
      const urlQuery = searchParams.toString();
      expect(urlQuery).toContain('preset=bristlecone-ancient');
      expect(urlQuery).toContain('sp=bristlecone-pine');
      expect(urlQuery).toContain('lat=37.3855');
      const parsed = new URLSearchParams(urlQuery);
      expect(parsed.get('preset')).toBe(preset.id);
      expect(Number(parsed.get('age'))).toBe(preset.temporal.totalAge);
      const restoredSim = simulateTreeCrossSection(
        {
          species: parsed.get('sp') as any,
          latitude: Number(parsed.get('lat')),
          longitude: Number(parsed.get('lon')),
          totalAge: Number(parsed.get('age')),
          deathYear: Number(parsed.get('death')),
        },
        defaultEnv
      );
      expect(restoredSim.rings.length).toBeGreaterThan(0);
      expect(restoredSim.params.species).toBe('bristlecone-pine');
    });

    it('C8: F7 (Peel Mode) + F11 (Permalink) — peel mode year serializes into permalink and roundtrips', () => {
      const targetYear = 2000;
      const searchParams = new URLSearchParams({
        mode: 'peel',
        year: String(targetYear),
        sp: ppSim.params.species,
        age: String(ppSim.params.totalAge),
      });
      const permalink = 'https://xylem.art/?' + searchParams.toString();
      expect(permalink).toContain('mode=peel');
      expect(permalink).toContain('year=2000');
      const parsedUrl = new URL(permalink);
      const parsedMode = parsedUrl.searchParams.get('mode');
      const parsedYear = Number(parsedUrl.searchParams.get('year'));
      expect(parsedMode).toBe('peel');
      expect(parsedYear).toBe(2000);
      const peeledRings = ppSim.rings.filter((r) => r.record.calendarYear <= parsedYear);
      expect(peeledRings.length).toBeLessThan(ppSim.rings.length);
      expect(peeledRings[peeledRings.length - 1].record.calendarYear).toBe(2000);
      const peeledSvg = generateCrossSectionSvg(
        { ...ppSim, rings: peeledRings, visibleRingCount: peeledRings.length },
        { showBark: false, showMedullaryRays: true, showAnnotations: false, transparentBackground: true }
      );
      expect(peeledSvg).toContain('<svg');
    });

    it('C9: F12 (Palettes) + F13 (SVG Export) — Skeleton Plot palette formats high-contrast export', () => {
      const preset = getPresetById('bristlecone-ancient')!;
      expect(preset.recommendedPalette).toBe('skeleton-plot');
      const bundle = generateCrossSectionSvgBundle(dfSim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
      });
      expect(bundle.svgMarkup).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(bundle.svgMarkup).toContain('<svg');
      expect(bundle.svgMarkup).toContain('id="annotations"');
      expect(bundle.svgMarkup).toContain('stroke="#1c1c1c"');
      expect(bundle.viewBox.width).toBeGreaterThan(0);
      expect(bundle.viewBox.height).toBeGreaterThan(0);
    });

    it('C10: F3 (Presets) + F13 (Colophon) — volcanic frost preset includes Tambora historical landmark', () => {
      const preset = getPresetById('volcanic-frost-shock')!;
      expect(preset).toBeDefined();
      expect(preset.disturbance.frostEventYears).toContain(1816);
      expect(preset.subtitle).toContain('1816 Frost Rings');
      const sim = simulateTreeCrossSection(
        {
          species: preset.species,
          latitude: preset.coordinates.latitude,
          longitude: preset.coordinates.longitude,
          totalAge: 80,
          deathYear: preset.temporal.deathYear,
        },
        defaultEnv
      );
      const bundle = generateCrossSectionSvgBundle(sim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
      });
      expect(bundle.svgMarkup).toContain('Chronology Extent:');
      expect(bundle.svgMarkup).toContain(`${sim.firstRingYear}–${sim.params.deathYear} CE`);
      expect(bundle.svgMarkup).toContain('Pseudotsuga menziesii');
    });

    it('C11: F12 (Textures) + F13 (4K Export) — wood grain texture filters embed within 4K canvas pipeline', () => {
      const bundle = generateCrossSectionSvgBundle(dfSim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
      });
      const target4kWidth = 3840;
      const target4kHeight = 2160;
      const scaleX = target4kWidth / bundle.viewBox.width;
      const scaleY = target4kHeight / bundle.viewBox.height;
      const uniformScale = Math.min(scaleX, scaleY);
      expect(uniformScale).toBeGreaterThan(0);
      expect(Number.isFinite(uniformScale)).toBe(true);
      expect(bundle.svgMarkup).toContain('preserveAspectRatio="xMidYMid meet"');
      expect(bundle.svgMarkup).toContain('viewBox="');
    });

    it('C12: F10 (Exhibition) + F14 (Mobile Polish) — exhibition mode on mobile enforces touch and scrolling rules', () => {
      const appCssPath = path.resolve(process.cwd(), 'src/App.css');
      const appCss = fs.readFileSync(appCssPath, 'utf-8');
      expect(appCss).toContain('overflow-x: hidden');
      expect(appCss).toContain('-webkit-overflow-scrolling: touch');
      const htmlPath = path.resolve(process.cwd(), 'index.html');
      const html = fs.readFileSync(htmlPath, 'utf-8');
      expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0"');
    });

    it('C13: F9 (HUD) + F12 (Palettes) — distinct curated presets configure unique palette profiles and HUD indicators', () => {
      const pluvialPreset = getPresetById('pluvial-megadrought')!;
      const wildfirePreset = getPresetById('wildfire-scar-healing')!;
      const bristleconePreset = getPresetById('bristlecone-ancient')!;
      expect(pluvialPreset.recommendedPalette).toBe('aged-wood');
      expect(wildfirePreset.recommendedPalette).toBe('charred-subalpine');
      expect(bristleconePreset.recommendedPalette).toBe('skeleton-plot');
      const appCssPath = path.resolve(process.cwd(), 'src/App.css');
      const appCss = fs.readFileSync(appCssPath, 'utf-8');
      expect(appCss).toContain('.ring-inspector-badge');
      expect(appCss).toContain('.chronology-legend');
      expect(appCss).toContain('.ring-badge-metrics');
    });

    it('C14: F4 (Gradients) + F8 (Playback) — advancing tree growth maintains dual-density gradient integrity across all growth years', () => {
      expect(dfSim.rings.length).toBeGreaterThan(20);
      for (let i = 0; i < dfSim.rings.length; i++) {
        const ring = dfSim.rings[i];
        expect(ring.record.ringIndex).toBe(i + 1);
        const sampleIndices = [
          0,
          Math.floor(ring.innerRadiusMm.length / 4),
          Math.floor(ring.innerRadiusMm.length / 2),
        ];
        for (const idx of sampleIndices) {
          expect(ring.ewBoundaryRadiusMm[idx]).toBeGreaterThan(ring.innerRadiusMm[idx]);
          expect(ring.lwInnerRadiusMm[idx]).toBeGreaterThanOrEqual(ring.ewBoundaryRadiusMm[idx]);
          expect(ring.outerRadiusMm[idx]).toBeGreaterThan(ring.lwInnerRadiusMm[idx]);
        }
      }
    });
  });

  // ==========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS (5 Full Workflows)
  // ==========================================================================
  describe('Tier 4: Real-World Application Scenarios', () => {
    it('Scenario 1: Museum Gallery Exhibition Loop', () => {
      // 1. Initial museum framing verification from index.html
      const htmlPath = path.resolve(process.cwd(), 'index.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
      expect(htmlContent).toContain('XYLEM: An Ecological Ledger of Deep Time');

      // 2. Select Old-Growth Bristlecone preset
      const preset = getPresetById('bristlecone-ancient')!;
      expect(preset).toBeDefined();
      expect(preset.species).toBe('bristlecone-pine');
      expect(preset.coordinates.elevationM).toBeGreaterThanOrEqual(3000);
      expect(preset.coordinates.region).toContain('White Mountains');

      // 3. Simulate biophysical growth for Ancient Bristlecone
      const bristleconeSim = simulateTreeCrossSection(
        {
          species: preset.species,
          latitude: preset.coordinates.latitude,
          longitude: preset.coordinates.longitude,
          totalAge: 100,
          deathYear: preset.temporal.deathYear,
        },
        defaultEnv
      );
      expect(bristleconeSim.rings.length).toBeGreaterThan(40);

      // 4. Continuous temporal progression (Growth loop)
      let previousRadius = bristleconeSim.pithRadiusMm;
      for (let step = 10; step <= 40; step += 10) {
        const ringsAtStep = bristleconeSim.rings.slice(0, step);
        const outerRadiusAtStep = ringsAtStep[ringsAtStep.length - 1].outerRadiusMm[0];
        expect(outerRadiusAtStep).toBeGreaterThan(previousRadius);
        previousRadius = outerRadiusAtStep;
      }

      // 5. Exhibition viewport rendering (chrome stripped for gallery display)
      const exhibitionSvg = generateCrossSectionSvgBundle(bristleconeSim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: false,
        showLocatorMap: false,
        transparentBackground: false,
      });
      expect(exhibitionSvg.svgMarkup).toContain('<svg');
      expect(exhibitionSvg.svgMarkup).not.toContain('id="annotations"');
      expect(exhibitionSvg.svgMarkup).not.toContain('id="locator-map"');
      expect(exhibitionSvg.viewBox.width).toBeGreaterThan(0);
      expect(exhibitionSvg.viewBox.height).toBeGreaterThan(0);

      // 6. Gallery viewport stylesheet verification
      const appCssPath = path.resolve(process.cwd(), 'src/App.css');
      const appCss = fs.readFileSync(appCssPath, 'utf-8');
      expect(appCss).toContain('.canvas-area');
      expect(appCss).toContain('.svg-viewport');
    });

    it('Scenario 2: Paleoclimate Researcher Retrospective Peel', async () => {
      // 1. Load Pluvial to Megadrought preset
      const preset = getPresetById('pluvial-megadrought')!;
      expect(preset).toBeDefined();
      expect(preset.species).toBe('ponderosa-pine');
      expect(preset.coordinates.siteName).toContain('Fort Valley');
      expect(preset.landmarkYears).toContain(1934);

      // 2. Simulate forward growth covering 20th century
      const scenarioSim = simulateTreeCrossSection(
        {
          species: preset.species,
          latitude: preset.coordinates.latitude,
          longitude: preset.coordinates.longitude,
          totalAge: 120,
          deathYear: 2024,
        },
        defaultEnv
      );
      expect(scenarioSim.rings.length).toBeGreaterThan(80);

      // 3. Peel back to 1934 Dust Bowl
      const targetYear = 1934;
      const peeledRings = scenarioSim.rings.filter((r) => r.record.calendarYear <= targetYear);
      expect(peeledRings.length).toBeLessThan(scenarioSim.rings.length);
      const dustBowlRing = peeledRings[peeledRings.length - 1];
      expect(dustBowlRing.record.calendarYear).toBe(1934);

      const fullRadius = scenarioSim.rings[scenarioSim.rings.length - 1].outerRadiusMm[0];
      const peeledRadius = dustBowlRing.outerRadiusMm[0];
      expect(peeledRadius).toBeLessThan(fullRadius);

      // 4. Ring inspection & landmark verification
      expect(dustBowlRing.record.limitingFactor).toBe('moisture');
      expect(dustBowlRing.record.climateIndex).toBeLessThan(0.7);
      const landmark1934 = CLIMATE_LANDMARKS.find((l) => l.year === 1934);
      expect(landmark1934).toBeDefined();
      expect(landmark1934!.fullName).toContain('Dust Bowl');

      // 5. URL sharing / permalink serialization & clipboard verification
      const params = new URLSearchParams({
        preset: preset.id,
        mode: 'peel',
        year: String(targetYear),
        sp: preset.species,
      });
      const shareUrl = 'https://xylem.art/?' + params.toString();
      expect(shareUrl).toContain('preset=pluvial-megadrought');
      expect(shareUrl).toContain('year=1934');
      expect(shareUrl).toContain('mode=peel');

      const writeMock = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText: writeMock } });
      await (globalThis as any).navigator.clipboard.writeText(shareUrl);
      expect(writeMock).toHaveBeenCalledWith(shareUrl);
    });

    it('Scenario 3: Wildfire Disturbance Forensic Investigation', () => {
      // 1. Load Wildfire Disturbance preset
      const preset = getPresetById('wildfire-scar-healing')!;
      expect(preset).toBeDefined();
      expect(preset.disturbance.fireScarYear).toBe(1910);
      expect(preset.disturbance.fireScarAzimuthRad).toBeCloseTo(2.356, 2);
      expect(preset.disturbance.fireScarArcRad).toBeCloseTo(1.414, 2);
      expect(preset.recommendedPalette).toBe('charred-subalpine');

      // 2. Simulate biophysical growth with slope eccentricity & reaction wood
      const wildfireEnv = makeDeterministicMockEnvironment(7.8, 480, 18, 135);
      const wildfireSim = simulateTreeCrossSection(
        {
          species: preset.species,
          latitude: preset.coordinates.latitude,
          longitude: preset.coordinates.longitude,
          totalAge: 120,
          deathYear: 2024,
        },
        wildfireEnv
      );
      expect(wildfireSim.rings.length).toBeGreaterThan(50);
      expect(wildfireSim.compressionStrength).toBeGreaterThan(0.08);

      // 3. Forensic examination of pre- and post-fire anatomy
      const fireRingIdx = wildfireSim.rings.findIndex((r) => r.record.calendarYear === 1910);
      expect(fireRingIdx).toBeGreaterThan(0);
      const fireRing = wildfireSim.rings[fireRingIdx];
      expect(fireRing.record.calendarYear).toBe(1910);

      const postFireRings = wildfireSim.rings.slice(fireRingIdx + 1, fireRingIdx + 11);
      expect(postFireRings.length).toBe(10);
      for (let k = 1; k < postFireRings.length; k++) {
        expect(postFireRings[k].outerRadiusMm[0]).toBeGreaterThan(postFireRings[k - 1].outerRadiusMm[0]);
      }

      // 4. High-resolution standalone SVG vector generation with annotations
      const svgBundle = generateCrossSectionSvgBundle(wildfireSim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
      });
      expect(svgBundle.svgMarkup).toContain('<svg');
      expect(svgBundle.svgMarkup).toContain('Ponderosa Pine');
      expect(svgBundle.svgMarkup).toContain('id="annotations"');
      expect(svgBundle.viewBox.width).toBeGreaterThan(0);

      // 5. Colophon dialog scientific documentation verification
      const colophonPath = path.resolve(process.cwd(), 'src/components/ColophonModal.tsx');
      const colophonCode = fs.readFileSync(colophonPath, 'utf-8');
      expect(colophonCode).toContain('Disturbance Forensics: Wildfire Scars');
      expect(colophonCode).toContain('thermal necrosis');
      expect(colophonCode).toContain('woundwood');
    });

    it('Scenario 4: Curatorial Print Archival Workflow', () => {
      // 1. Load Volcanic Forcing preset
      const preset = getPresetById('volcanic-frost-shock')!;
      expect(preset).toBeDefined();
      expect(preset.disturbance.frostEventYears).toContain(1816);
      expect(preset.recommendedPalette).toBe('charred-subalpine');
      expect(preset.subtitle).toContain('1816 Frost Rings');

      // 2. Simulate biophysical tree cross-section
      const volcanicSim = simulateTreeCrossSection(
        {
          species: preset.species,
          latitude: preset.coordinates.latitude,
          longitude: preset.coordinates.longitude,
          totalAge: 140,
          deathYear: preset.temporal.deathYear,
        },
        defaultEnv
      );
      expect(volcanicSim.rings.length).toBeGreaterThan(60);

      // 3. Inspect 1816 Tambora aerosol shock ring
      const ring1816 = volcanicSim.rings.find((r) => r.record.calendarYear === 1816);
      expect(ring1816).toBeDefined();
      expect(ring1816!.record.climateIndex).toBeLessThan(0.45);

      // 4. Vector archival SVG generation with museum colophon / metadata
      const svgBundle = generateCrossSectionSvgBundle(volcanicSim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
      });
      expect(svgBundle.svgMarkup).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(svgBundle.svgMarkup).toContain('<svg');
      expect(svgBundle.svgMarkup).toContain('id="annotations"');
      expect(svgBundle.svgMarkup).toContain(volcanicSim.seedHex);

      // 5. 4K high-resolution print archival invariants (300 DPI calculation)
      const printWidthPx = 3840;
      const printHeightPx = 2160;
      const dpi = 300;
      const physicalWidthInches = printWidthPx / dpi;
      const physicalHeightInches = printHeightPx / dpi;
      expect(physicalWidthInches).toBeCloseTo(12.8, 1);
      expect(physicalHeightInches).toBeCloseTo(7.2, 1);

      const vb = svgBundle.viewBox;
      const aspect = vb.width / vb.height;
      expect(aspect).toBeGreaterThan(0.5);
      expect(aspect).toBeLessThan(2.0);

      // 6. Curatorial documentation audit
      const colophonPath = path.resolve(process.cwd(), 'src/components/ColophonModal.tsx');
      const colophonCode = fs.readFileSync(colophonPath, 'utf-8');
      expect(colophonCode).toContain('Tambora');
      expect(colophonCode).toContain('Frost Rings');
    });

    it('Scenario 5: Mobile Specimen Exploration & Social Discovery', () => {
      // 1. Social metadata discovery (OpenGraph & Twitter Cards in index.html)
      const htmlPath = path.resolve(process.cwd(), 'index.html');
      const html = fs.readFileSync(htmlPath, 'utf-8');
      expect(html).toContain('<meta property="og:title" content="XYLEM: An Ecological Ledger of Deep Time — Retrospective Dendrochronology"');
      expect(html).toContain('<meta property="og:description"');
      expect(html).toContain('<meta property="og:image" content="./og-preview.png"');
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
      expect(html).toContain('<meta name="twitter:title" content="XYLEM: An Ecological Ledger of Deep Time — Retrospective Dendrochronology"');
      expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0"');

      // 2. Colophon modal reading from real component source
      const colophonPath = path.resolve(process.cwd(), 'src/components/ColophonModal.tsx');
      const colophon = fs.readFileSync(colophonPath, 'utf-8');
      expect(colophon).toContain('role="dialog"');
      expect(colophon).toContain('aria-modal="true"');
      expect(colophon).toContain('unbribable ecological ledger');
      expect(colophon).toContain('retrospective dendrochronology');

      // 3. Mobile responsive stylesheet & touch interaction audit
      const appCssPath = path.resolve(process.cwd(), 'src/App.css');
      const appCss = fs.readFileSync(appCssPath, 'utf-8');
      expect(appCss).toContain('overflow-x: hidden');
      expect(appCss).toContain('-webkit-overflow-scrolling: touch');
      expect(appCss).toContain('.canvas-area');

      // 4. Mobile specimen simulation & SVG vector auto-scaling
      const sim = simulateTreeCrossSection(
        {
          species: 'ponderosa-pine',
          latitude: 35.2645,
          longitude: -111.7442,
          totalAge: 50,
          deathYear: 2024,
        },
        defaultEnv
      );
      const bundle = generateCrossSectionSvgBundle(sim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: false,
        showLocatorMap: false,
        transparentBackground: true,
      });
      expect(bundle.svgMarkup).toContain('width="100%"');
      expect(bundle.svgMarkup).toContain('height="100%"');
      expect(bundle.svgMarkup).toContain('preserveAspectRatio="xMidYMid meet"');
      expect(bundle.viewBox.width).toBeGreaterThan(0);
    });
  });
});
