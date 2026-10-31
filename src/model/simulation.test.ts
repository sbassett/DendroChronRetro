import { describe, expect, it } from 'vitest';
import { simulateTreeCrossSection } from './growthEngine';
import { generateCrossSectionSvg } from './svgGenerator';
import { EnvironmentDataset, MonthlyClimateYear } from './types';

function makeMockEnvironment(
  baseTempC = 10.5,
  annualPrecipMm = 1100,
  slopeDeg = 14,
  aspectDeg = 195
): EnvironmentDataset {
  const years: MonthlyClimateYear[] = [];
  for (let y = 1870; y <= 2026; y++) {
    const droughtFactor = y === 1977 || y === 2002 || y === 2015 ? 0.42 : 1.0;
    const tempC: number[] = [];
    const precipMm: number[] = [];
    for (let m = 0; m < 12; m++) {
      const seasonal = -Math.cos(((m - 0.5) / 12) * 2 * Math.PI) * 9.5;
      tempC.push(baseTempC + seasonal);
      const wetShare = 1 + 0.5 * Math.cos(((m - 0.5) / 12) * 2 * Math.PI);
      precipMm.push(((annualPrecipMm / 12) * wetShare) * droughtFactor);
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
      elevationM: 780,
      slopeDeg,
      aspectDeg,
      isWaterOrInvalid: false,
    },
    years,
    source: 'open-meteo-era5',
    meanAnnualTempC: baseTempC,
    meanAnnualPrecipMm: annualPrecipMm,
    summerPrecipShare: 0.14,
  };
}

describe('Tree Cross-Section Simulation & SVG Engine', () => {
  it('produces 100% byte-identical SVG for identical species, location, age, and deathYear', () => {
    const env = makeMockEnvironment();
    const params = {
      species: 'douglas-fir' as const,
      latitude: 44.2124,
      longitude: -122.2557,
      totalAge: 50,
      deathYear: 2026,
    };

    const simA = simulateTreeCrossSection(params, env);
    const simB = simulateTreeCrossSection({ ...params }, env);

    const opts = {
      showBark: true,
      showMedullaryRays: true,
      showAnnotations: true,
      transparentBackground: false,
    };

    const svgA = generateCrossSectionSvg(simA, opts);
    const svgB = generateCrossSectionSvg(simB, opts);

    expect(simA.seedHex).toBe(simB.seedHex);
    expect(svgA).toBe(svgB);
  });

  it('models biologically faithful seedling years-to-stump-height (e.g. 46-48 rings for Age 50)', () => {
    const env = makeMockEnvironment();
    const sim = simulateTreeCrossSection(
      {
        species: 'douglas-fir',
        latitude: 44.2124,
        longitude: -122.2557,
        totalAge: 50,
        deathYear: 2026,
      },
      env
    );

    expect(sim.stumpHeightM).toBeCloseTo(0.3, 3);
    expect(sim.yearsToStumpHeight).toBeGreaterThanOrEqual(2);
    expect(sim.yearsToStumpHeight).toBeLessThanOrEqual(5);
    expect(sim.visibleRingCount).toBe(50 - sim.yearsToStumpHeight);
    expect(sim.rings.length).toBe(sim.visibleRingCount);
  });

  it('guarantees strictly non-intersecting concentric rings across both species and old trees', () => {
    const env = makeMockEnvironment(8.5, 520, 22, 210);

    for (const species of ['douglas-fir', 'ponderosa-pine'] as const) {
      const sim = simulateTreeCrossSection(
        {
          species,
          latitude: 35.2645,
          longitude: -111.7442,
          totalAge: 140,
          deathYear: 2020,
        },
        env
      );

      for (let k = 0; k < sim.rings.length; k++) {
        const ring = sim.rings[k];
        for (let j = 0; j < sim.anglesRad.length; j++) {
          expect(ring.outerRadiusMm[j]).toBeGreaterThan(ring.lwInnerRadiusMm[j]);
          expect(ring.lwInnerRadiusMm[j]).toBeGreaterThan(ring.innerRadiusMm[j]);
          if (k > 0) {
            expect(ring.innerRadiusMm[j]).toBeCloseTo(
              sim.rings[k - 1].outerRadiusMm[j],
              6
            );
          }
        }
      }

      // Drought marker year 2002 should be narrower than neighbor 2000
      const r2000 = sim.rings.find((r) => r.record.calendarYear === 2000);
      const r2002 = sim.rings.find((r) => r.record.calendarYear === 2002);
      expect(r2000).toBeDefined();
      expect(r2002).toBeDefined();
      expect(r2002!.record.meanWidthMm).toBeLessThan(r2000!.record.meanWidthMm);
    }
  });

  it('differentiates Douglas-fir and Ponderosa pine anatomy and grayscale SVG output', () => {
    const env = makeMockEnvironment(9.5, 680);
    const df = simulateTreeCrossSection(
      {
        species: 'douglas-fir',
        latitude: 44.4622,
        longitude: -121.6358,
        totalAge: 80,
        deathYear: 2026,
      },
      env
    );
    const pp = simulateTreeCrossSection(
      {
        species: 'ponderosa-pine',
        latitude: 44.4622,
        longitude: -121.6358,
        totalAge: 80,
        deathYear: 2026,
      },
      env
    );

    const dfMeanLw =
      df.rings.reduce((s, r) => s + r.record.latewoodFraction, 0) /
      df.rings.length;
    const ppMeanLw =
      pp.rings.reduce((s, r) => s + r.record.latewoodFraction, 0) /
      pp.rings.length;

    // Douglas-fir has higher mean latewood fraction than Ponderosa pine
    expect(dfMeanLw).toBeGreaterThan(ppMeanLw);

    const svg = generateCrossSectionSvg(pp, {
      showBark: true,
      showMedullaryRays: true,
      showAnnotations: true,
      transparentBackground: false,
    });
    expect(svg).toContain('<svg');
    expect(svg).toContain('Pinus ponderosa');
    expect(svg).toContain('id="bark-layer"');
    expect(svg).toContain('id="rhytidome-anatomy"');
    expect(svg).toContain('id="inner-phloem"');
    expect(svg).toContain('id="annual-rings"');
    expect(df.bark.morphology).toBe('furrowed-corky');
    expect(pp.bark.morphology).toBe('plated-scaly');
    expect(df.bark.rhytidomeCells.length).toBeGreaterThan(10);
    expect(pp.bark.rhytidomeCells.length).toBeGreaterThan(30);
  });
});
