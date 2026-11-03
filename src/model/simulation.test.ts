import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCachedEnvironmentDataset,
  loadEnvironmentDataset,
} from '../services/environmentApi';
import { simulateTreeCrossSection } from './growthEngine';
import { generateCrossSectionSvg } from './svgGenerator';
import { EnvironmentDataset, MonthlyClimateYear } from './types';
import {
  chooseScaleBar,
  formatAnnualPrecip,
  formatDiameter,
  formatElevation,
  formatTemperature,
  parseCoordinateInput,
} from './units';

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
    // Default SVG export uses US Customary scale & stump height
    expect(svg).toContain('h=1.0 ft');
  });

  it('formats US Customary and Metric units and parses compass coordinates', () => {
    expect(formatDiameter(508, 'us')).toBe('20.0 in');
    expect(formatDiameter(508, 'metric')).toBe('50.8 cm');
    expect(formatElevation(2245, 'us')).toBe('7,365 ft');
    expect(formatTemperature(10, 'us')).toBe('50.0 °F');
    expect(formatAnnualPrecip(635, 'us')).toBe('25.0 in/yr');

    const usScale = chooseScaleBar(450, 'us');
    expect(usScale.label).toBe('4 in');
    expect(usScale.lengthMm).toBeCloseTo(101.6, 4);

    expect(parseCoordinateInput('111.7442 W', 'lon')).toBeCloseTo(-111.7442, 5);
    expect(parseCoordinateInput('-122.2557', 'lon')).toBeCloseTo(-122.2557, 5);
    expect(parseCoordinateInput('44.2124 N', 'lat')).toBeCloseTo(44.2124, 5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('parses NASA POWER monthly records and serves subsequent age changes synchronously from cache', async () => {
    const t2m: Record<string, number> = {};
    const prec: Record<string, number> = {};
    for (let y = 2018; y <= 2025; y++) {
      for (let m = 1; m <= 12; m++) {
        const key = `${y}${String(m).padStart(2, '0')}`;
        t2m[key] = 10 + (m === 7 ? 8 : 0);
        prec[key] = 2.0; // 2 mm/day
      }
      t2m[`${y}13`] = 10.6; // annual summary key to ignore
      prec[`${y}13`] = 2.0;
    }
    t2m['202601'] = 4.0;
    prec['202601'] = 3.0;
    t2m['202602'] = -999; // missing future month sentinel
    prec['202602'] = -999;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('open-meteo.com/v1/elevation')) {
        return new Response(
          JSON.stringify({ elevation: [800, 810, 790, 805, 795] }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          geometry: { coordinates: [-120.55, 43.55, 800] },
          properties: { parameter: { T2M: t2m, PRECTOTCORR: prec } },
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const ds = await loadEnvironmentDataset(43.5512, -120.5512, 2019, 2026);
    expect(ds.source).toBe('nasa-power-merra2');
    // 2.0 mm/day * 365.25 days + 1/9th of Jan 2026 (3.0 mm/day) = ~733.94 mm/yr
    expect(ds.meanAnnualPrecipMm).toBeGreaterThan(730);
    expect(ds.meanAnnualPrecipMm).toBeLessThan(735);

    // Partial year 2026 splices Jan observed + Feb..Dec synthesized without failing
    const y2026 = ds.years.find((yr) => yr.year === 2026);
    expect(y2026).toBeDefined();
    expect(y2026!.tempC[0]).toBeCloseTo(4.0, 3);
    expect(y2026!.precipMm[0]).toBeCloseTo(93.0, 3); // 3 mm/day * 31 Jan days

    // Synchronous cache hit for a wider age span at the same coordinates
    const syncDs = getCachedEnvironmentDataset(43.5512, -120.5512, 1950, 2026);
    expect(syncDs).not.toBeNull();
    expect(syncDs!.years[0].year).toBe(1949);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts hung sockets via AbortController timeout and falls back cleanly without hanging', async () => {
    vi.useFakeTimers();

    const stalledFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        })
    );
    vi.stubGlobal('fetch', stalledFetch);

    const pending = loadEnvironmentDataset(38.9123, -106.4123, 1980, 2026);
    await vi.advanceTimersByTimeAsync(5000);
    const fallbackDs = await pending;

    expect(fallbackDs.source).toBe('offline-climatology');
    expect(fallbackDs.years.length).toBe(2026 - 1979 + 1);
    expect(fallbackDs.terrain.elevationM).toBeGreaterThan(50);
  });
});
