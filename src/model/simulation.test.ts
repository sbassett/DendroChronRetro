import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCachedEnvironmentDataset,
  loadEnvironmentDataset,
} from '../services/environmentApi';
import { simulateTreeCrossSection } from './growthEngine';
import {
  generateEnvironmentalNarrative,
  getRelevantClimateLandmarks,
} from './narrative';
import {
  isWithinSpeciesNativeRange,
  projectToLocatorMap,
} from './locatorMapData';
import { LOCATION_PRESETS } from './species';
import {
  generateCrossSectionSvg,
  generateCrossSectionSvgBundle,
} from './svgGenerator';
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

  it('renders top-left North America species range locator map and classifies native range accurately', () => {
    // H.J. Andrews, OR is inside Douglas-fir native range
    expect(isWithinSpeciesNativeRange('douglas-fir', 44.2124, -122.2557)).toBe(true);
    // Flagstaff, AZ & Black Hills, SD are inside Ponderosa pine native range
    expect(isWithinSpeciesNativeRange('ponderosa-pine', 35.2645, -111.7442)).toBe(true);
    expect(isWithinSpeciesNativeRange('ponderosa-pine', 43.8791, -103.4591)).toBe(true);
    // New York City is in the North America frame, but outside both western conifer ranges
    const nyProj = projectToLocatorMap(40.7128, -74.006);
    expect(nyProj.inFrame).toBe(true);
    expect(isWithinSpeciesNativeRange('douglas-fir', 40.7128, -74.006)).toBe(false);
    expect(isWithinSpeciesNativeRange('ponderosa-pine', 40.7128, -74.006)).toBe(false);

    const env = makeMockEnvironment();
    const sim = simulateTreeCrossSection(
      {
        species: 'douglas-fir',
        latitude: 44.2124,
        longitude: -122.2557,
        totalAge: 65,
        deathYear: 2026,
      },
      env
    );

    const svgWithMap = generateCrossSectionSvg(sim, {
      showBark: true,
      showMedullaryRays: true,
      showAnnotations: true,
      showLocatorMap: true,
      transparentBackground: false,
    });
    expect(svgWithMap).toContain('id="locator-map"');
    expect(svgWithMap).toContain('data-species-range="douglas-fir"');
    expect(svgWithMap).toContain('id="locator-cookie-pin"');
    expect(svgWithMap).not.toContain('N. AMERICA');
    expect(svgWithMap).not.toContain('locator-map-clip');

    const svgWithoutMap = generateCrossSectionSvg(sim, {
      showBark: true,
      showMedullaryRays: true,
      showAnnotations: true,
      showLocatorMap: false,
      transparentBackground: false,
    });
    expect(svgWithoutMap).not.toContain('id="locator-map"');
  });

  it('keeps scale bar, compass, and cross-section strictly inside viewBox across all US reference forest sites and ages', () => {
    const xericEnv = makeMockEnvironment(8.8, 390, 18, 225);
    const mesicEnv = makeMockEnvironment(10.2, 2600, 12, 140);

    for (const preset of LOCATION_PRESETS) {
      const env =
        preset.recommendedSpecies === 'ponderosa-pine' ? xericEnv : mesicEnv;
      for (const totalAge of [12, 65, 160]) {
        const sim = simulateTreeCrossSection(
          {
            species: preset.recommendedSpecies,
            latitude: preset.latitude,
            longitude: preset.longitude,
            totalAge,
            deathYear: 2026,
          },
          env
        );

        for (const showLocatorMap of [true, false]) {
          const bundle = generateCrossSectionSvgBundle(sim, {
            showBark: true,
            showMedullaryRays: true,
            showAnnotations: true,
            showLocatorMap,
            transparentBackground: false,
            unitSystem: 'us',
          });

          const { x: vbX, y: vbY, width: vbW, height: vbH } = bundle.viewBox;
          const vbRight = vbX + vbW;
          const vbBottom = vbY + vbH;

          // Extract scale bar horizontal line (first <line> in #annotations)
          const annotMatch = bundle.innerMarkup.match(
            /<g id="annotations"[^>]*>\s*<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/
          );
          expect(annotMatch).not.toBeNull();
          const barX1 = Number(annotMatch![1]);
          const barY1 = Number(annotMatch![2]);
          const barX2 = Number(annotMatch![3]);

          expect(barX1).toBeGreaterThan(vbX);
          expect(barX2).toBeLessThan(vbRight);
          expect(barY1).toBeGreaterThan(vbY);
          expect(barY1).toBeLessThan(vbBottom);

          // Every outer bark vertex must also sit comfortably inside viewBox
          for (let i = 0; i < sim.bark.outerBarkRadiusMm.length; i++) {
            const r = sim.bark.outerBarkRadiusMm[i];
            const th = sim.bark.barkAnglesRad[i];
            const px = r * Math.cos(th);
            const py = r * Math.sin(th);
            expect(px).toBeGreaterThan(vbX);
            expect(px).toBeLessThan(vbRight);
            expect(py).toBeGreaterThan(vbY);
            expect(py).toBeLessThan(vbBottom);
          }
        }
      }
    }
  });

  it('scales internal rhytidome bark plates and cork tiers to the full exterior bark thickness across all ages', () => {
    const mesicEnv = makeMockEnvironment(10.5, 1450, 10, 180);

    for (const species of ['ponderosa-pine', 'douglas-fir'] as const) {
      for (const totalAge of [20, 50, 85, 160, 320]) {
        const sim = simulateTreeCrossSection(
          {
            species,
            latitude: 44.2124,
            longitude: -122.2557,
            totalAge,
            deathYear: 2026,
          },
          mesicEnv
        );

        const { barkAnglesRad, phloemOuterRadiusMm, outerBarkRadiusMm, rhytidomeCells } =
          sim.bark;

        let maxRhytidomeThickMm = 0;
        for (let i = 0; i < barkAnglesRad.length; i++) {
          const rhyt = outerBarkRadiusMm[i] - phloemOuterRadiusMm[i];
          if (rhyt > maxRhytidomeThickMm) {
            maxRhytidomeThickMm = rhyt;
          }
        }

        let maxCellRadialOffsetMm = 0;
        const twoPi = 2 * Math.PI;
        for (const cell of rhytidomeCells) {
          for (const pt of cell.pointsPolar) {
            const normTheta = ((pt.theta % twoPi) + twoPi) % twoPi;
            const idx = Math.floor(
              (normTheta / twoPi) * barkAnglesRad.length
            );
            const offset = pt.r - phloemOuterRadiusMm[idx];
            if (offset > maxCellRadialOffsetMm) {
              maxCellRadialOffsetMm = offset;
            }
          }
        }

        // Internal bark plates/cork tiers must never stall behind the growing exterior bark contour
        // (Ponderosa puzzle scales form the 100% exterior plate top; Douglas-fir cork lenses reach >90% into ridge tips)
        const minCoverageFrac = species === 'ponderosa-pine' ? 1.0 : 0.9;
        expect(maxCellRadialOffsetMm).toBeGreaterThanOrEqual(
          maxRhytidomeThickMm * minCoverageFrac
        );
      }
    }
  });

  it('persists primary bark grooves at fixed compass angles and evolves secondary splits monotonically across age', () => {
    const env = makeMockEnvironment(9.2, 620, 12, 190);

    const findGrooveAngles = (
      barkAngles: number[],
      rhytThick: number[],
      prominenceFrac = 0.22
    ): number[] => {
      const n = rhytThick.length;
      const maxT = Math.max(...rhytThick);
      const minWin = 14; // ~4.7 deg local minimum uniqueness
      const promWin = 36; // ~12 deg reach onto flanking plate crests
      const troughs: number[] = [];

      for (let i = 0; i < n; i++) {
        const cur = rhytThick[i];
        let isLocalMin = true;
        for (let d = -minWin; d <= minWin; d++) {
          if (rhytThick[(i + d + n) % n] < cur) {
            isLocalMin = false;
            break;
          }
        }
        if (!isLocalMin) continue;

        let localMax = cur;
        for (let d = -promWin; d <= promWin; d++) {
          const v = rhytThick[(i + d + n) % n];
          if (v > localMax) localMax = v;
        }
        if (localMax - cur >= maxT * prominenceFrac) {
          if (
            troughs.length === 0 ||
            Math.abs(barkAngles[i] - troughs[troughs.length - 1]) > 0.08
          ) {
            troughs.push(barkAngles[i]);
          }
        }
      }
      return troughs;
    };

    const ages = [28, 55, 95, 160, 260];
    const grooveSets: number[][] = [];

    for (const totalAge of ages) {
      const sim = simulateTreeCrossSection(
        {
          species: 'ponderosa-pine',
          latitude: 44.4622,
          longitude: -121.6358,
          totalAge,
          deathYear: 2026,
        },
        env
      );
      const rhyt = sim.bark.outerBarkRadiusMm.map(
        (r, i) => r - sim.bark.phloemOuterRadiusMm[i]
      );
      grooveSets.push(findGrooveAngles(sim.bark.barkAnglesRad, rhyt));
    }

    const juvenileGrooves = grooveSets[0];
    expect(juvenileGrooves.length).toBeGreaterThanOrEqual(8);

    // Every juvenile primary groove must persist at the same compass angle (+/- 3.5 deg) at all older ages
    for (let s = 1; s < grooveSets.length; s++) {
      const matureGrooves = grooveSets[s];
      expect(matureGrooves.length).toBeGreaterThanOrEqual(
        juvenileGrooves.length
      );
      for (const g0 of juvenileGrooves) {
        const minAngularDist = Math.min(
          ...matureGrooves.map((gm) => {
            const diff = Math.abs(gm - g0) % (2 * Math.PI);
            return Math.min(diff, 2 * Math.PI - diff);
          })
        );
        expect(minAngularDist).toBeLessThan(0.062); // < ~3.5 degrees across 230+ years of growth
      }
    }

    // Even on slow-growing xeric sites, bark-to-diameter ratio stays bounded by bifacial cambial allometry
    const xericEnv = makeMockEnvironment(8.5, 360, 16, 210);
    const ratios: number[] = [];
    for (const totalAge of [30, 70, 140, 260]) {
      const sim = simulateTreeCrossSection(
        {
          species: 'ponderosa-pine',
          latitude: 35.2645,
          longitude: -111.7442,
          totalAge,
          deathYear: 2026,
        },
        xericEnv
      );
      ratios.push(sim.bark.meanThicknessMm / sim.diameterInsideBarkMm);
    }
    // Single bark thickness stays realistic (~4.5% to 9.5% of DIB) and never balloons relative to wood diameter
    for (const r of ratios) {
      expect(r).toBeGreaterThan(0.035);
      expect(r).toBeLessThan(0.11);
    }
    expect(ratios[ratios.length - 1]).toBeLessThanOrEqual(ratios[0] * 1.05);
  });

  it('maintains C0 year-to-year continuity in ridge width (arc-seconds) and thickness across secondary cleavage initiation', () => {
    const env = makeMockEnvironment(9.5, 680, 12, 195);

    for (const cfg of [
      { species: 'ponderosa-pine' as const, lat: 44.4622, lon: -121.6358 },
      { species: 'douglas-fir' as const, lat: 47.8609, lon: -123.9348 },
    ]) {
      let prevRhyt: number[] | null = null;
      let prevOuterArcSec = 0;

      // Step 1 year at a time across the entire secondary cleavage wave (ages 36..72)
      for (let totalAge = 36; totalAge <= 72; totalAge++) {
        const sim = simulateTreeCrossSection(
          {
            species: cfg.species,
            latitude: cfg.lat,
            longitude: cfg.lon,
            totalAge,
            deathYear: 1900 + totalAge,
          },
          env
        );

        const rhyt = sim.bark.outerBarkRadiusMm.map(
          (rOut, i) => rOut - sim.bark.phloemOuterRadiusMm[i]
        );
        const maxRhyt = Math.max(...rhyt);
        const arcSecPerStep = (360 * 3600) / rhyt.length;
        const outerArcSec =
          rhyt.reduce((sum, h) => {
            const t = Math.max(
              0,
              Math.min(1, (h - 0.65 * maxRhyt) / Math.max(1e-6, 0.2 * maxRhyt))
            );
            return sum + t * t * (3 - 2 * t);
          }, 0) * arcSecPerStep;

        if (prevRhyt !== null) {
          let maxSingleYearGainMm = -Infinity;
          let maxSingleYearDropMm = Infinity;
          for (let i = 0; i < rhyt.length; i++) {
            const delta = rhyt[i] - prevRhyt[i];
            if (delta > maxSingleYearGainMm) maxSingleYearGainMm = delta;
            if (delta < maxSingleYearDropMm) maxSingleYearDropMm = delta;
          }

          // No bark angle may jump upward in thickness when a secondary fissure initiates
          expect(maxSingleYearGainMm).toBeLessThan(2.5);
          // Progressive inward cleavage prevents instantaneous full-depth chasm drops
          expect(maxSingleYearDropMm).toBeGreaterThan(-12.0);
          // Smooth outer ridge angular occupancy never jumps magically wider
          expect(outerArcSec - prevOuterArcSec).toBeLessThan(6 * 3600);
        }

        // Deep primary groove troughs must contain only the thin nascent innermost bark layer
        // (zero elevated conveyor-belt cohort stacks pushing through the groove floor!)
        if (cfg.species === 'ponderosa-pine' && totalAge >= 45) {
          const minRhyt = Math.min(...rhyt);
          const minIdx = rhyt.indexOf(minRhyt);
          const troughAngle = sim.bark.barkAnglesRad[minIdx];
          const twoPi = 2 * Math.PI;
          let cellsAtTroughCenter = 0;
          for (const cell of sim.bark.rhytidomeCells) {
            for (const pt of cell.pointsPolar) {
              const diff = Math.abs(((pt.theta - troughAngle) % twoPi + twoPi) % twoPi);
              const angDist = Math.min(diff, twoPi - diff);
              if (angDist < 0.0025) {
                cellsAtTroughCenter++;
                break;
              }
            }
          }
          expect(cellsAtTroughCenter).toBeLessThanOrEqual(1);
        }

        prevRhyt = rhyt;
        prevOuterArcSec = outerArcSec;
      }
    }
  });

  it('produces tabular flat-topped Ponderosa tectonic plates and anatomically layered innermost bark', () => {
    const env = makeMockEnvironment(9.5, 680, 12, 195);

    const pp = simulateTreeCrossSection(
      {
        species: 'ponderosa-pine',
        latitude: 44.4622,
        longitude: -121.6358,
        totalAge: 140,
        deathYear: 2026,
      },
      env
    );
    const df = simulateTreeCrossSection(
      {
        species: 'douglas-fir',
        latitude: 44.4622,
        longitude: -121.6358,
        totalAge: 140,
        deathYear: 2026,
      },
      env
    );

    const ppRhyt = pp.bark.outerBarkRadiusMm.map(
      (r, i) => r - pp.bark.phloemOuterRadiusMm[i]
    );
    const dfRhyt = df.bark.outerBarkRadiusMm.map(
      (r, i) => r - df.bark.phloemOuterRadiusMm[i]
    );
    const ppMaxRhyt = Math.max(...ppRhyt);
    const dfMaxRhyt = Math.max(...dfRhyt);

    // Tabular Ponderosa armor maintains broad flat plateaus (>58% of circumference above 78% of max height),
    // sharply contrasting with V-ridged Douglas-fir cork furrows
    const ppPlateauFrac =
      ppRhyt.filter((h) => h >= 0.78 * ppMaxRhyt).length / ppRhyt.length;
    const dfPlateauFrac =
      dfRhyt.filter((h) => h >= 0.78 * dfMaxRhyt).length / dfRhyt.length;
    expect(ppPlateauFrac).toBeGreaterThan(0.58);
    expect(ppPlateauFrac).toBeGreaterThan(dfPlateauFrac * 1.8);

    // Living inner bark (secondary phloem) is thin, strictly positive outside wood cambium,
    // and gently compressed beneath deep fissures compared to plate plateaus
    expect(pp.bark.phloemThicknessMm).toBeGreaterThanOrEqual(0.95);
    expect(pp.bark.phloemThicknessMm).toBeLessThanOrEqual(2.7);

    const sampleWoodAt = (theta: number): number => {
      const n = pp.anglesRad.length;
      const twoPi = 2 * Math.PI;
      const pos = (((theta % twoPi) + twoPi) % twoPi) / twoPi * n;
      const i0 = Math.floor(pos) % n;
      const i1 = (i0 + 1) % n;
      const f = pos - Math.floor(pos);
      return (
        pp.bark.cambiumRadiusMm[i0] * (1 - f) +
        pp.bark.cambiumRadiusMm[i1] * f
      );
    };

    const ppPhloemThick = pp.bark.barkAnglesRad.map(
      (th, i) => pp.bark.phloemOuterRadiusMm[i] - sampleWoodAt(th)
    );
    for (const ptThick of ppPhloemThick) {
      expect(ptThick).toBeGreaterThan(0.65);
    }
    const minRhytIdx = ppRhyt.indexOf(Math.min(...ppRhyt));
    const maxRhytIdx = ppRhyt.indexOf(ppMaxRhyt);
    expect(ppPhloemThick[minRhytIdx]).toBeLessThan(ppPhloemThick[maxRhytIdx]);

    // Innermost dead rhytidome cohort cells sit flush against the active innermost periderm
    let minAbovePhloemMm = Infinity;
    const twoPi = 2 * Math.PI;
    for (const cell of pp.bark.rhytidomeCells) {
      for (const pt of cell.pointsPolar) {
        const idx =
          Math.floor(
            ((((pt.theta % twoPi) + twoPi) % twoPi) / twoPi) *
              pp.bark.barkAnglesRad.length
          ) % pp.bark.barkAnglesRad.length;
        const distAbovePhloem = Math.abs(pt.r - pp.bark.phloemOuterRadiusMm[idx]);
        if (distAbovePhloem < minAbovePhloemMm) {
          minAbovePhloemMm = distAbovePhloem;
        }
      }
    }
    expect(minAbovePhloemMm).toBeLessThan(0.15);

    // SVG z-order renders #bark-layer (#inner-phloem + #phloem-rays) beneath #annual-rings,
    // and #vascular-cambium ON TOP of #annual-rings so outermost latewood never clips the cambium stroke
    const svg = generateCrossSectionSvg(pp, {
      showBark: true,
      showMedullaryRays: true,
      showAnnotations: false,
      transparentBackground: false,
    });
    const innerPhloemIdx = svg.indexOf('id="inner-phloem"');
    const phloemRaysIdx = svg.indexOf('id="phloem-rays"');
    const ringsIdx = svg.indexOf('id="annual-rings"');
    const cambiumIdx = svg.indexOf('id="vascular-cambium"');

    expect(innerPhloemIdx).toBeGreaterThan(0);
    expect(phloemRaysIdx).toBeGreaterThan(innerPhloemIdx);
    expect(ringsIdx).toBeGreaterThan(phloemRaysIdx);
    expect(cambiumIdx).toBeGreaterThan(ringsIdx);
  });

  it('generates rich environmental storytelling narratives and flags landmark regional climate signals', () => {
    const envCascades = makeMockEnvironment(9.5, 950, 18, 90); // 18 deg eastern slope, 950mm precip
    const simCascades = simulateTreeCrossSection(
      {
        species: 'douglas-fir',
        latitude: 44.2124,
        longitude: -122.2557,
        totalAge: 80,
        deathYear: 2026,
      },
      envCascades
    );

    const narrativeCascades = generateEnvironmentalNarrative(simCascades, 'us');
    expect(narrativeCascades.story).toContain('Oregon Cascades');
    expect(narrativeCascades.story).toContain('slope');
    expect(narrativeCascades.story).toContain('yielding lush earlywood growth');

    // Coconino Plateau Flagstaff narrative
    const envFlagstaff = makeMockEnvironment(8.2, 480, 3.5, 180);
    const simFlagstaff = simulateTreeCrossSection(
      {
        species: 'ponderosa-pine',
        latitude: 35.2645,
        longitude: -111.7442,
        totalAge: 250,
        deathYear: 2026,
      },
      envFlagstaff
    );
    const narrativeFlagstaff = generateEnvironmentalNarrative(simFlagstaff, 'us');
    expect(narrativeFlagstaff.story).toContain('Coconino Plateau');
    expect(narrativeFlagstaff.story).toContain('climate-sensitive');
    expect(narrativeFlagstaff.story).toContain('regional droughts');

    // Climate Landmarks: Flagstaff (1776–2026) must include 2002 Southwest Megadrought & 1956 drought
    const landmarksSW = getRelevantClimateLandmarks(1776, 2026, 35.2645, -111.7442);
    const yearsSW = landmarksSW.map((lm) => lm.year);
    expect(yearsSW).toContain(2002);
    expect(yearsSW).toContain(1956);
    expect(yearsSW).toContain(1934);

    // Default pre-seeded Coconino Plateau benchmark must be ecologically viable for Ponderosa Pine
    const cachedFlagstaff = getCachedEnvironmentDataset(35.2645, -111.7442, 1776, 2026);
    expect(cachedFlagstaff).not.toBeNull();
    const simCachedFlagstaff = simulateTreeCrossSection(
      {
        species: 'ponderosa-pine',
        latitude: 35.2645,
        longitude: -111.7442,
        totalAge: 250,
        deathYear: 2026,
      },
      cachedFlagstaff!
    );
    expect(simCachedFlagstaff.viability.viable).toBe(true);
    expect(simCachedFlagstaff.viability.stressLevel).not.toBe('unsuitable');
    expect(simCachedFlagstaff.viability.summary).not.toContain('severely stunted');

    // Cascades (1963–2026) must include 1977 West Coast Drought and 2015 Snow Drought
    const landmarksNW = getRelevantClimateLandmarks(1963, 2026, 44.2124, -122.2557);
    const yearsNW = landmarksNW.map((lm) => lm.year);
    expect(yearsNW).toContain(1977);
    expect(yearsNW).toContain(2015);
    expect(yearsNW).toContain(2021);
    // Southwest-only 2002 megadrought should not be flagged for mesic Oregon Cascades
    expect(yearsNW).not.toContain(2002);
  });
});
