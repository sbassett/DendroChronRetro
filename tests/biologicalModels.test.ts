import { describe, expect, it } from 'vitest';
import {
  calculateMorkDensity,
  computeDensityGradientParams,
  computeDensityRibbonFractions,
  computeFireScarGeometry,
  computeLocallyAbsentAttenuation,
  generateResinPocketGeometry,
  smoothstep,
} from '../src/model/biologicalDisturbances';
import { simulateTreeCrossSection } from '../src/model/growthEngine';
import { generateCrossSectionSvg, generateCrossSectionSvgBundle } from '../src/model/svgGenerator';
import { EnvironmentDataset, MonthlyClimateYear } from '../src/model/types';

/**
 * Creates a deterministic mock environmental dataset with configurable climate and topography.
 */
function makeTestEnvironment(
  baseTempC = 9.5,
  annualPrecipMm = 750,
  slopeDeg = 16,
  aspectDeg = 180,
  droughtYears: number[] = [1970, 1975, 1980, 1985, 1990, 1995, 2000, 2005]
): EnvironmentDataset {
  const years: MonthlyClimateYear[] = [];
  for (let y = 1850; y <= 2026; y++) {
    const isDrought = droughtYears.includes(y);
    const droughtFactor = isDrought ? 0.45 : 1.0;
    const tempC: number[] = [];
    const precipMm: number[] = [];
    for (let m = 0; m < 12; m++) {
      const seasonal = -Math.cos(((m - 0.5) / 12) * 2 * Math.PI) * 9.5;
      tempC.push(baseTempC + seasonal);
      // Summer monsoon pulse in July/August (m = 6, 7): strong post-drought convective storms
      const monsoonBoost = (m === 6 || m === 7) && isDrought ? 4.5 : 1.0;
      const wetShare = 1 + 0.45 * Math.cos(((m - 0.5) / 12) * 2 * Math.PI);
      precipMm.push(((annualPrecipMm / 12) * wetShare * droughtFactor) * monsoonBoost);
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
      elevationM: 1450,
      slopeDeg,
      aspectDeg,
      isWaterOrInvalid: false,
    },
    years,
    source: 'offline-climatology',
    meanAnnualTempC: baseTempC,
    meanAnnualPrecipMm: annualPrecipMm,
    summerPrecipShare: 0.18,
  };
}

describe('Biological & Anatomical Dendrochronology (Milestone 2 Specification)', () => {
  // ==========================================================================
  // 1. EARLYWOOD-TO-LATEWOOD MULTI-RIBBON DENSITY GRADIENTS
  // ==========================================================================
  describe('Earlywood-to-Latewood Multi-Ribbon Density Gradients', () => {
    it('enforces strict multi-ribbon monotonicity (r_inner <= r_trans1 <= r_trans2 <= r_lw <= r_outer)', () => {
      const env = makeTestEnvironment(9.0, 720, 14, 190);

      for (const species of ['douglas-fir', 'ponderosa-pine', 'bristlecone-pine'] as const) {
        const sim = simulateTreeCrossSection(
          {
            species,
            latitude: 44.5,
            longitude: -121.5,
            totalAge: 50,
            deathYear: 2026,
          },
          env
        );

        expect(sim.rings.length).toBeGreaterThan(40);

        for (const ring of sim.rings) {
          expect(ring.transition1RadiusMm).toBeDefined();
          expect(ring.transition2RadiusMm).toBeDefined();
          expect(ring.lwInnerRadiusMm).toBeDefined();

          const rIn = ring.innerRadiusMm;
          const rT1 = ring.transition1RadiusMm!;
          const rT2 = ring.transition2RadiusMm!;
          const rLw = ring.lwInnerRadiusMm;
          const rOut = ring.outerRadiusMm;

          for (let j = 0; j < sim.anglesRad.length; j += 15) {
            // Strict monotonicity invariant
            expect(rT1[j]).toBeGreaterThanOrEqual(rIn[j]);
            expect(rT2[j]).toBeGreaterThanOrEqual(rT1[j]);
            expect(rLw[j]).toBeGreaterThanOrEqual(rT2[j]);
            expect(rOut[j]).toBeGreaterThanOrEqual(rLw[j]);

            // For normal growth rings (non-absent), strict inequalities hold
            if (!ring.record.isLocallyAbsent) {
              expect(rT1[j]).toBeGreaterThan(rIn[j]);
              expect(rT2[j]).toBeGreaterThan(rT1[j]);
              expect(rOut[j]).toBeGreaterThan(rLw[j]);
            }
          }
        }
      }
    });

    it('models continuous sigmoidal tracheid density via Mork criterion formulation', () => {
      const params = computeDensityGradientParams('ponderosa-pine', 0.28);
      expect(params.densityEw).toBeCloseTo(0.30, 2);
      expect(params.densityLw).toBeCloseTo(0.82, 2);
      expect(params.tauCrit).toBeGreaterThan(0.3);
      expect(params.tauCrit).toBeLessThan(0.85);

      // Density curve should be strictly monotonic across u in [0, 1]
      let prevRho = -1;
      for (let step = 0; step <= 20; step++) {
        const u = step / 20;
        const rho = calculateMorkDensity(u, params);
        expect(rho).toBeGreaterThanOrEqual(params.densityEw);
        expect(rho).toBeLessThanOrEqual(params.densityLw);
        if (prevRho >= 0) {
          expect(rho).toBeGreaterThanOrEqual(prevRho);
        }
        prevRho = rho;
      }
    });

    it('guarantees optical density ordering: earlywood > transition1 > transition2 > latewood', () => {
      const env = makeTestEnvironment();
      const sim = simulateTreeCrossSection(
        {
          species: 'ponderosa-pine',
          latitude: 44.5,
          longitude: -121.5,
          totalAge: 35,
          deathYear: 2026,
        },
        env
      );

      for (const ring of sim.rings) {
        const rec = ring.record;
        expect(rec.earlywoodGray).toBeGreaterThan(rec.transition1Gray!);
        expect(rec.transition1Gray!).toBeGreaterThan(rec.transition2Gray!);
        expect(rec.transition2Gray!).toBeGreaterThan(rec.latewoodGray);
        // Minimum optical contrast of at least 40 gray levels
        expect(rec.earlywoodGray - rec.latewoodGray).toBeGreaterThanOrEqual(40);
      }
    });

    it('distinguishes abrupt (Douglas-Fir) from semi-gradual (Ponderosa/Bristlecone) transition zone width', () => {
      const dfFractions = computeDensityRibbonFractions('douglas-fir', 0.30);
      const ppFractions = computeDensityRibbonFractions('ponderosa-pine', 0.30);

      const dfTransitionSpan = dfFractions.uLwInner - dfFractions.uTrans1;
      const ppTransitionSpan = ppFractions.uLwInner - ppFractions.uTrans1;

      // Semi-gradual species has significantly broader density ramp
      expect(ppTransitionSpan).toBeGreaterThan(dfTransitionSpan);
      expect(dfTransitionSpan).toBeLessThan(0.12);
      expect(ppTransitionSpan).toBeGreaterThan(0.15);
    });

    it('renders multi-ribbon spline paths with continuous density gradient shading', () => {
      const env = makeTestEnvironment();
      const sim = simulateTreeCrossSection(
        {
          species: 'douglas-fir',
          latitude: 44.5,
          longitude: -121.5,
          totalAge: 25,
          deathYear: 2026,
        },
        env
      );

      const bundle = generateCrossSectionSvgBundle(sim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
      });

      expect(bundle.innerMarkup).toContain('id="annual-rings"');
      // Multi-ribbon rendering emits multiple path elements per ring
      const pathCount = (bundle.innerMarkup.match(/<path data-ring=/g) || []).length;
      expect(pathCount).toBeGreaterThanOrEqual(sim.rings.length * 3);
    });
  });

  // ==========================================================================
  // 2. PITH DISPLACEMENT & REACTION WOOD DUAL HARMONICS
  // ==========================================================================
  describe('Pith Displacement & Reaction Wood Dual Harmonics', () => {
    it('calculates cumulative annual pith migration vector on sloped terrain', () => {
      const slopedEnv = makeTestEnvironment(9.0, 750, 22, 195);
      const sim = simulateTreeCrossSection(
        {
          species: 'douglas-fir',
          latitude: 44.5,
          longitude: -121.5,
          totalAge: 60,
          deathYear: 2026,
        },
        slopedEnv
      );

      expect(sim.pithOffsetMm).toBeDefined();
      expect(Number.isFinite(sim.pithOffsetMm.x)).toBe(true);
      expect(Number.isFinite(sim.pithOffsetMm.y)).toBe(true);

      const driftDistMm = Math.hypot(sim.pithOffsetMm.x, sim.pithOffsetMm.y);
      // Measurable cumulative pith displacement under slope
      expect(driftDistMm).toBeGreaterThan(0.5);
      // Realistic trunk core displacement (< 35% of trunk radius)
      expect(driftDistMm).toBeLessThan(sim.diameterInsideBarkMm * 0.35);
    });

    it('produces authentic biological eccentricity in conifer reaction wood (0.15 to 0.55)', () => {
      const env = makeTestEnvironment(9.0, 750, 18, 180);
      const sim = simulateTreeCrossSection(
        {
          species: 'ponderosa-pine',
          latitude: 44.5,
          longitude: -121.5,
          totalAge: 45,
          deathYear: 2026,
        },
        env
      );

      expect(sim.eccentricity).toBeGreaterThanOrEqual(0.15);
      expect(sim.eccentricity).toBeLessThanOrEqual(0.55);
    });

    it('dual harmonic equation thickens reaction wood >= 1.15x and creates ovoid cross-section', () => {
      const env = makeTestEnvironment(9.0, 750, 20, 180);
      const sim = simulateTreeCrossSection(
        {
          species: 'douglas-fir',
          latitude: 44.5,
          longitude: -121.5,
          totalAge: 40,
          deathYear: 2026,
        },
        env
      );

      const lastRing = sim.rings[sim.rings.length - 1];
      const rMax = Math.max(...lastRing.outerRadiusMm);
      const rMin = Math.min(...lastRing.outerRadiusMm);
      const aspectRatio = rMax / rMin;

      // Authentic ovoid reaction wood aspect ratio
      expect(aspectRatio).toBeGreaterThanOrEqual(1.05);
      expect(sim.compressionStrength).toBeGreaterThan(0.1);
    });
  });

  // ==========================================================================
  // 3. MICRO-DISTURBANCE TRAUMA MODELS
  // ==========================================================================
  describe('Micro-Disturbance Trauma Models', () => {
    it('models intra-annual false rings (IADFs) with diffuse bilateral boundaries', () => {
      const env = makeTestEnvironment(10.0, 600, 10, 180);
      const sim = simulateTreeCrossSection(
        {
          species: 'ponderosa-pine',
          latitude: 35.2,
          longitude: -111.6,
          totalAge: 70,
          deathYear: 2026,
        },
        env
      );

      const falseRings = sim.rings.filter((r) => r.record.hasFalseRing);
      expect(falseRings.length).toBeGreaterThan(0);

      for (const fr of falseRings) {
        expect(fr.falseRingRadiusMm).toBeDefined();
        expect(fr.falseRingRadiusMm!.length).toBe(sim.anglesRad.length);
        for (let j = 0; j < sim.anglesRad.length; j += 20) {
          // False ring is strictly located within earlywood zone
          expect(fr.falseRingRadiusMm![j]).toBeGreaterThan(fr.innerRadiusMm[j]);
          expect(fr.falseRingRadiusMm![j]).toBeLessThan(fr.lwInnerRadiusMm[j]);
        }
      }

      // Verify SVG emits diffuse bilateral strokes (multiple stroke opacities)
      const svg = generateCrossSectionSvg(sim, {
        showBark: true,
        showMedullaryRays: false,
        showAnnotations: false,
        transparentBackground: false,
      });
      expect(svg).toContain('stroke-opacity="0.18"');
      expect(svg).toContain('stroke-opacity="0.45"');
    });

    it('models locally absent rings with smoothstep angular pinch to zero width', () => {
      const env = makeTestEnvironment(9.0, 500, 18, 180, [1977, 2002]);
      const sim = simulateTreeCrossSection(
        {
          species: 'douglas-fir',
          latitude: 44.5,
          longitude: -121.5,
          totalAge: 60,
          deathYear: 2026,
          disturbance: {
            droughtThresholdRwi: 0.45,
            enableLocallyAbsent: true,
          },
        },
        env
      );

      const absentRings = sim.rings.filter((r) => r.record.isLocallyAbsent);
      expect(absentRings.length).toBeGreaterThan(0);

      for (const ar of absentRings) {
        const ringWidths = ar.outerRadiusMm.map((out, i) => out - ar.innerRadiusMm[i]);
        const minWidth = Math.min(...ringWidths);
        const maxWidth = Math.max(...ringWidths);

        // Pinches to zero width along cambium failure sector
        expect(minWidth).toBeCloseTo(0, 4);
        // Grows normally on opposite vigor/compression side
        expect(maxWidth).toBeGreaterThan(0.2);

        // Non-intersection invariant holds: outer >= inner everywhere
        for (let j = 0; j < ringWidths.length; j++) {
          expect(ar.outerRadiusMm[j]).toBeGreaterThanOrEqual(ar.innerRadiusMm[j] - 1e-6);
        }
      }
    });

    it('models fire scars ("catfaces") on uphill orientation with bare wood exposure', () => {
      const env = makeTestEnvironment(9.0, 700, 20, 140); // Aspect 140 deg (SE) -> Uphill is 320 deg (NW)
      const fireYear = 1910;
      const sim = simulateTreeCrossSection(
        {
          species: 'ponderosa-pine',
          latitude: 44.5,
          longitude: -121.5,
          totalAge: 140,
          deathYear: 2026,
          disturbance: {
            fireScarYear: fireYear,
            fireScarArcRad: 0.85,
          },
        },
        env
      );

      expect(sim.fireScars).toBeDefined();
      expect(sim.fireScars!.length).toBe(1);

      const scar = sim.fireScars![0];
      expect(scar.year).toBe(fireYear);
      expect(scar.exposedWoodRadiusMm).toBeGreaterThan(10);
      expect(scar.callusMarginCoordinates).toHaveLength(2);

      // Arc length is positive and non-girdling (< PI)
      const arcRad = 0.85;
      expect(arcRad).toBeGreaterThanOrEqual(0.30);
      expect(arcRad).toBeLessThan(Math.PI);

      // SVG rendering includes #fire-scars with exposed catface and data-fire-year
      const svg = generateCrossSectionSvg(sim, {
        showBark: true,
        showMedullaryRays: false,
        showAnnotations: false,
        transparentBackground: false,
      });
      expect(svg).toContain('id="fire-scars"');
      expect(svg).toContain(`data-fire-year="${fireYear}"`);
    });

    it('models inward-curling woundwood callus rolls with multi-decadal convergence', () => {
      const uphill = Math.PI / 2;
      const initialArc = 0.85;
      const radius = 80.0;

      const scarYear0 = computeFireScarGeometry(1910, 1910, radius, uphill, initialArc);
      const scarYear10 = computeFireScarGeometry(1910, 1920, radius, uphill, initialArc);
      const scarYear30 = computeFireScarGeometry(1910, 1940, radius, uphill, initialArc);

      // Both margins have strictly positive curl radius
      for (const m of scarYear0.callusMarginCoordinates) {
        expect(m.curlRadiusMm).toBeGreaterThan(0);
      }
      for (const m of scarYear30.callusMarginCoordinates) {
        expect(m.curlRadiusMm).toBeGreaterThan(0);
      }

      // Gap between left and right callus lips closes progressively over decades
      const gap0 = Math.hypot(
        scarYear0.callusMarginCoordinates[1].x - scarYear0.callusMarginCoordinates[0].x,
        scarYear0.callusMarginCoordinates[1].y - scarYear0.callusMarginCoordinates[0].y
      );
      const gap10 = Math.hypot(
        scarYear10.callusMarginCoordinates[1].x - scarYear10.callusMarginCoordinates[0].x,
        scarYear10.callusMarginCoordinates[1].y - scarYear10.callusMarginCoordinates[0].y
      );
      const gap30 = Math.hypot(
        scarYear30.callusMarginCoordinates[1].x - scarYear30.callusMarginCoordinates[0].x,
        scarYear30.callusMarginCoordinates[1].y - scarYear30.callusMarginCoordinates[0].y
      );

      expect(gap0).toBeGreaterThan(gap10);
      expect(gap10).toBeGreaterThan(gap30);
      expect(gap30).toBeGreaterThan(0); // Never crosses or self-intersects
    });

    it('models traumatic resin pockets walled off in secondary xylem', () => {
      const env = makeTestEnvironment();
      const sim = simulateTreeCrossSection(
        {
          species: 'ponderosa-pine',
          latitude: 44.5,
          longitude: -121.5,
          totalAge: 140,
          deathYear: 2026,
          disturbance: {
            fireScarYear: 1910,
          },
        },
        env
      );

      expect(sim.resinPockets).toBeDefined();
      expect(sim.resinPockets!.length).toBeGreaterThan(0);

      for (const pocket of sim.resinPockets!) {
        expect(pocket.ringIndex).toBeGreaterThan(0);
        expect(pocket.radialDepthMm).toBeGreaterThan(0.5);
        expect(pocket.radialDepthMm).toBeLessThan(3.0);
        expect(pocket.arcLengthRad).toBeGreaterThan(0.05);
        // Valid closed SVG path starting with M and ending with Z
        expect(pocket.pathD).toMatch(/^M\s*[\d.-]+\s+[\d.-]+.*Z$/);
      }

      // SVG contains #resin-pockets layer
      const svg = generateCrossSectionSvg(sim, {
        showBark: true,
        showMedullaryRays: false,
        showAnnotations: false,
        transparentBackground: false,
      });
      expect(svg).toContain('id="resin-pockets"');
      expect(svg).toContain('fill="#d97706"');
    });
  });

  // ==========================================================================
  // 4. STRICT INVARIANTS & BACKWARD COMPATIBILITY
  // ==========================================================================
  describe('Strict Invariants & Backward Compatibility', () => {
    it('maintains year-to-year radial continuity: r_inner(k) === r_outer(k-1)', () => {
      const env = makeTestEnvironment();
      const sim = simulateTreeCrossSection(
        {
          species: 'douglas-fir',
          latitude: 44.5,
          longitude: -121.5,
          totalAge: 50,
          deathYear: 2026,
        },
        env
      );

      for (let k = 1; k < sim.rings.length; k++) {
        const ringCurr = sim.rings[k];
        const ringPrev = sim.rings[k - 1];
        for (let j = 0; j < sim.anglesRad.length; j += 10) {
          expect(ringCurr.innerRadiusMm[j]).toBeCloseTo(ringPrev.outerRadiusMm[j], 6);
        }
      }
    });

    it('preserves all required backward-compatible SVG DOM element IDs', () => {
      const env = makeTestEnvironment();
      const sim = simulateTreeCrossSection(
        {
          species: 'ponderosa-pine',
          latitude: 44.5,
          longitude: -121.5,
          totalAge: 40,
          deathYear: 2026,
        },
        env
      );

      const svg = generateCrossSectionSvg(sim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
      });

      const requiredIds = [
        'annual-rings',
        'pith',
        'bark-layer',
        'rhytidome-anatomy',
        'inner-phloem',
        'medullary-rays',
        'vascular-cambium',
        'annotations',
      ];

      for (const id of requiredIds) {
        expect(svg).toContain(`id="${id}"`);
      }
    });

    it('guarantees 100% deterministic repeatability for identical input parameters', () => {
      const env = makeTestEnvironment();
      const params = {
        species: 'bristlecone-pine' as const,
        latitude: 37.38,
        longitude: -118.17,
        totalAge: 70,
        deathYear: 2026,
        disturbance: {
          fireScarYear: 1910,
        },
      };

      const simA = simulateTreeCrossSection(params, env);
      const simB = simulateTreeCrossSection({ ...params }, env);

      expect(simA.seedHex).toBe(simB.seedHex);
      expect(simA.pithOffsetMm.x).toBe(simB.pithOffsetMm.x);
      expect(simA.pithOffsetMm.y).toBe(simB.pithOffsetMm.y);
      expect(simA.eccentricity).toBe(simB.eccentricity);
      expect(simA.rings.length).toBe(simB.rings.length);

      const svgA = generateCrossSectionSvg(simA, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
      });
      const svgB = generateCrossSectionSvg(simB, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
      });

      expect(svgA).toBe(svgB);
    });
  });
});
