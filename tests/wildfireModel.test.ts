import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { angularDiff } from '../src/model/biologicalDisturbances';
import { simulateTreeCrossSection } from '../src/model/growthEngine';
import { PALETTES } from '../src/model/palettes';
import { getPresetById } from '../src/model/presets';
import { SeededRNG } from '../src/model/prng';
import { SPECIES_PROFILES } from '../src/model/species';
import { generateCrossSectionSvg } from '../src/model/svgGenerator';
import { EnvironmentDataset, MonthlyClimateYear } from '../src/model/types';
import {
  computeScarAzimuthRad,
  evaluateTreeFireDamage,
  simulateStandWildfires,
  StandFireEvent,
  WildfireClimateInputYear,
} from '../src/model/wildfireModel';
import {
  resetClimateAtlasForTesting,
  setClimateAtlasFromBuffer,
} from '../src/services/climateAtlas';
import { loadEnvironmentDataset } from '../src/services/environmentApi';

const ATLAS_PATH = path.resolve(
  process.cwd(),
  'public/data/western-climate-atlas.bin'
);

function buildMockDryPineEnv(
  startYear: number,
  endYear: number,
  slopeDeg = 16,
  aspectDeg = 180
): EnvironmentDataset {
  const baseTemp = [-1.2, 0.1, 3.5, 7.2, 12.1, 17.6, 19.8, 18.9, 15.1, 9.3, 3.2, -0.9];
  const basePrecip = [42, 38, 36, 22, 16, 10, 62, 74, 40, 36, 32, 44];
  const years: MonthlyClimateYear[] = [];
  for (let y = startYear - 1; y <= endYear; y++) {
    // Alternating multi-year wet pulses followed by acute drought years
    const cycle = y % 12;
    const isDry = cycle === 0 || cycle === 6;
    const isWet = cycle === 10 || cycle === 11 || cycle === 4 || cycle === 5;
    const pMult = isDry ? 0.42 : isWet ? 1.55 : 0.95;
    const tShift = isDry ? 1.6 : isWet ? -0.7 : 0;
    years.push({
      year: y,
      tempC: baseTemp.map((t) => t + tShift),
      precipMm: basePrecip.map((p) => p * pMult),
      isSynthetic: false,
      provenance: 'paleo-atlas',
      pmdi: isDry ? -3.4 : isWet ? 2.4 : 0.1,
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
    provenanceTiers: ['paleo-atlas'],
    meanAnnualTempC: 8.7,
    meanAnnualPrecipMm: 452,
    summerPrecipShare: 0.32,
  };
}

function buildMockReanalysisFetch() {
  const dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const siteNormals = (lat: number) => {
    if (lat > 43) {
      // H.J. Andrews Forest (mesic Cascades, 1465 mm/yr)
      return {
        elev: 454,
        temp: [2.8, 4.1, 6.2, 8.8, 12.4, 15.6, 19.2, 19.0, 15.4, 10.2, 5.5, 2.5],
        precip: [225, 178, 162, 108, 74, 46, 18, 20, 50, 122, 218, 245],
      };
    }
    if (lat > 36.5) {
      // White Mountains CA (subalpine dolomite, 312 mm/yr)
      return {
        elev: 3120,
        temp: [-7.5, -6.8, -4.5, -1.2, 3.4, 8.2, 11.4, 10.8, 7.2, 2.1, -3.4, -6.9],
        precip: [44, 38, 34, 24, 18, 12, 14, 16, 14, 24, 34, 40],
      };
    }
    // Flagstaff AZ (dry Ponderosa, 474 mm/yr)
    return {
      elev: 2150,
      temp: [-1.2, 0.1, 3.5, 7.2, 12.1, 17.6, 19.8, 18.9, 15.1, 9.3, 3.2, -0.9],
      precip: [42, 38, 36, 22, 16, 10, 62, 74, 40, 36, 32, 44],
    };
  };

  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const latMatch = url.match(/latitude=([-\d.]+)/);
    const lat = latMatch ? Number(latMatch[1]) : 35.2645;
    const { elev, temp, precip } = siteNormals(lat);

    if (url.includes('open-meteo.com/v1/elevation')) {
      return new Response(
        JSON.stringify({ elevation: [elev, elev + 10, elev - 10, elev + 5, elev - 5] }),
        { status: 200 }
      );
    }
    if (url.includes('power.larc.nasa.gov')) {
      const t2m: Record<string, number> = {};
      const prec: Record<string, number> = {};
      for (let y = 1981; y <= 2024; y++) {
        const pFactor = y === 2002 ? 0.42 : y === 1983 ? 1.55 : 0.8 + ((y * 13) % 7) * 0.06;
        for (let m = 0; m < 12; m++) {
          const key = `${y}${String(m + 1).padStart(2, '0')}`;
          t2m[key] = temp[m];
          prec[key] = (precip[m] * pFactor) / dim[m];
        }
      }
      return new Response(
        JSON.stringify({
          geometry: { coordinates: [-111.7442, lat, elev] },
          properties: { parameter: { T2M: t2m, PRECTOTCORR: prec } },
        }),
        { status: 200 }
      );
    }
    if (url.includes('archive-api.open-meteo.com')) {
      const dailyTimes: string[] = [];
      const dailyTemp: number[] = [];
      const dailyPrecip: number[] = [];
      for (let y = 1940; y <= 1990; y++) {
        const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
        const pFactor = y === 1956 ? 0.55 : 0.8 + ((y * 11) % 7) * 0.06;
        for (let m = 0; m < 12; m++) {
          const days = m === 1 && isLeap ? 29 : dim[m];
          const mmPerDay = (precip[m] * pFactor) / days;
          for (let d = 1; d <= days; d++) {
            dailyTimes.push(
              `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
            );
            dailyTemp.push(temp[m]);
            dailyPrecip.push(mmPerDay);
          }
        }
      }
      return new Response(
        JSON.stringify({
          elevation: elev,
          daily: {
            time: dailyTimes,
            temperature_2m_mean: dailyTemp,
            precipitation_sum: dailyPrecip,
          },
        }),
        { status: 200 }
      );
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  });
}

describe('Wildfire Paleoclimate Model, Recorder-Tree Re-Scarring & Anatomical Scar Rendering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetClimateAtlasForTesting();
  });

  it('eliminates the black pith-originating quarter-circle wedge and renders contour-hugging char ribbons', () => {
    const env = buildMockDryPineEnv(1804, 2024, 18, 135);
    const preset = getPresetById('wildfire-scar-healing')!;
    const sim = simulateTreeCrossSection(
      {
        species: preset.species,
        latitude: preset.coordinates.latitude,
        longitude: preset.coordinates.longitude,
        totalAge: preset.temporal.totalAge,
        deathYear: preset.temporal.deathYear,
        disturbance: preset.disturbance,
      },
      env
    );

    expect(sim.fireScars).toBeDefined();
    expect(sim.fireScars!.length).toBeGreaterThanOrEqual(1);

    const svg = generateCrossSectionSvg(sim, {
      showBark: true,
      showMedullaryRays: true,
      showAnnotations: false,
      transparentBackground: false,
      paletteId: 'charred-subalpine',
    });

    expect(svg).toContain('id="fire-scars"');
    expect(svg).toContain('data-fire-year="1910"');
    expect(svg).toContain(PALETTES['charred-subalpine'].fireCharColor);

    // Must never start a fire-scar path at the pith origin (0, 0)
    const fireGroupMatch = svg.match(/<g id="fire-scars">([\s\S]*?)<\/g>/);
    expect(fireGroupMatch).not.toBeNull();
    const fireGroupMarkup = fireGroupMatch![1];
    expect(fireGroupMarkup).not.toMatch(/d="M\s*0\s+0\s+L/);

    // Every vertex in #fire-scars must stay out near the scar ring radius, never masking inner rings
    const pathMatches = Array.from(fireGroupMarkup.matchAll(/d="([^"]+)"/g));
    expect(pathMatches.length).toBeGreaterThanOrEqual(1);
    const minScarRadius = Math.min(
      ...sim.fireScars!.map((s) => s.exposedWoodRadiusMm)
    );
    for (const m of pathMatches) {
      const nums = (m[1].match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      expect(nums.length).toBeGreaterThanOrEqual(8);
      for (let i = 0; i < nums.length - 1; i += 2) {
        const r = Math.hypot(nums[i], nums[i + 1]);
        expect(r).toBeGreaterThan(minScarRadius * 0.65);
      }
    }
  });

  it('pinches outer bark and living phloem smoothly to zero across an open unhealed catface', () => {
    const env = buildMockDryPineEnv(1880, 2024, 18, 135);
    // Late fire in 2012 with wide 1.3 rad arc ensures catface remains open at 2024
    const sim = simulateTreeCrossSection(
      {
        species: 'ponderosa-pine',
        latitude: 35.2645,
        longitude: -111.7442,
        totalAge: 140,
        deathYear: 2024,
        disturbance: {
          fireScarYear: 2012,
          fireScarAzimuthRad: 2.356,
          fireScarArcRad: 1.3,
          enableClimateWildfires: false,
        },
      },
      env
    );

    expect(sim.fireScars).toHaveLength(1);
    const scar = sim.fireScars![0];
    expect(scar.healedYear).toBeUndefined();
    expect(scar.finalOpenArcRad).toBeGreaterThan(0.15);

    const { barkAnglesRad, outerBarkRadiusMm, phloemOuterRadiusMm, cambiumRadiusMm } =
      sim.bark;
    const nWood = sim.anglesRad.length;
    const twoPi = 2 * Math.PI;
    const sampleWoodR = (theta: number) => {
      const pos = ((((theta % twoPi) + twoPi) % twoPi) / twoPi) * nWood;
      const i0 = Math.floor(pos) % nWood;
      const i1 = (i0 + 1) % nWood;
      const f = pos - Math.floor(pos);
      return cambiumRadiusMm[i0] * (1 - f) + cambiumRadiusMm[i1] * f;
    };

    const centerIdx = Math.round((2.356 / twoPi) * barkAnglesRad.length) % barkAnglesRad.length;
    const oppIdx = (centerIdx + Math.floor(barkAnglesRad.length / 2)) % barkAnglesRad.length;

    const deadBarkThick =
      outerBarkRadiusMm[centerIdx] - sampleWoodR(barkAnglesRad[centerIdx]);
    const deadPhloemThick =
      phloemOuterRadiusMm[centerIdx] - sampleWoodR(barkAnglesRad[centerIdx]);
    const livingBarkThick =
      outerBarkRadiusMm[oppIdx] - sampleWoodR(barkAnglesRad[oppIdx]);

    expect(deadBarkThick).toBeLessThan(0.1);
    expect(deadPhloemThick).toBeLessThan(0.1);
    expect(livingBarkThick).toBeGreaterThan(5.0);
  });

  it('models paleoclimate fire frequency gradients, wet-then-dry fuel sensitivity, and regional synchronization', async () => {
    setClimateAtlasFromBuffer(fs.readFileSync(ATLAS_PATH));
    vi.stubGlobal('fetch', buildMockReanalysisFetch());

    // 1. Compare real atlas fire counts: dry Flagstaff Ponderosa vs wet Cascades Douglas-fir vs alpine Bristlecone
    const envFlagstaff = await loadEnvironmentDataset(35.2645, -111.7442, 1764, 2024);
    const envAndrews = await loadEnvironmentDataset(44.2124, -122.2557, 1764, 2024);
    const envWhiteMts = await loadEnvironmentDataset(37.3855, -118.1788, 1644, 2024);

    const simFlag = simulateTreeCrossSection(
      {
        species: 'ponderosa-pine',
        latitude: 35.2645,
        longitude: -111.7442,
        totalAge: 260,
        deathYear: 2024,
      },
      envFlagstaff
    );
    const simHja = simulateTreeCrossSection(
      {
        species: 'douglas-fir',
        latitude: 44.2124,
        longitude: -122.2557,
        totalAge: 260,
        deathYear: 2024,
      },
      envAndrews
    );
    const simBristle = simulateTreeCrossSection(
      {
        species: 'bristlecone-pine',
        latitude: 37.3855,
        longitude: -118.1788,
        totalAge: 380,
        deathYear: 2024,
      },
      envWhiteMts
    );

    const flagStandCount = simFlag.standFireYears?.length ?? 0;
    const hjaStandCount = simHja.standFireYears?.length ?? 0;
    const bristleStandCount = simBristle.standFireYears?.length ?? 0;

    expect(flagStandCount).toBeGreaterThan(hjaStandCount);
    expect(flagStandCount).toBeGreaterThan(bristleStandCount);
    expect(flagStandCount).toBeGreaterThanOrEqual(2);
    expect(simFlag.fireScars?.length ?? 0).toBeLessThanOrEqual(30);

    // 2. Nearby coordinates share identical regional stand fire years while remaining 100% deterministic
    const envFlagNear = await loadEnvironmentDataset(35.275, -111.735, 1764, 2024);
    const simFlagNear = simulateTreeCrossSection(
      {
        species: 'ponderosa-pine',
        latitude: 35.275,
        longitude: -111.735,
        totalAge: 260,
        deathYear: 2024,
      },
      envFlagNear
    );
    expect(simFlagNear.standFireYears).toEqual(simFlag.standFireYears);

    // 3. Wet-then-dry antecedent fuel boost raises wildfire probability on dry Ponderosa
    const mkSeries = (antecedentPmdi: number): WildfireClimateInputYear[] => {
      const arr: WildfireClimateInputYear[] = [];
      for (let y = 1750; y <= 1900; y++) {
        const isTargetDry = y % 10 === 5;
        arr.push({
          year: y,
          annualG: isTargetDry ? 0.55 : antecedentPmdi > 0 ? 1.45 : 0.85,
          summerMoistureG: isTargetDry ? 0.15 : 0.45,
          summerTempC: isTargetDry ? 20.5 : 18.0,
          pmdi: isTargetDry ? -2.8 : antecedentPmdi,
        });
      }
      return arr;
    };

    const wetThenDryFires = simulateStandWildfires({
      yearlyClimate: mkSeries(2.4),
      species: 'ponderosa-pine',
      latitude: 35.2645,
      longitude: -111.7442,
      meanAnnualPrecipMm: 462,
      elevationM: 2150,
      equatorwardExposure: 0.15,
      meanAnnualG: 1.0,
      meanSummerTempC: 18.2,
    });
    const dryAfterDryFires = simulateStandWildfires({
      yearlyClimate: mkSeries(-1.6),
      species: 'ponderosa-pine',
      latitude: 35.2645,
      longitude: -111.7442,
      meanAnnualPrecipMm: 462,
      elevationM: 2150,
      equatorwardExposure: 0.15,
      meanAnnualG: 1.0,
      meanSummerTempC: 18.2,
    });

    const meanWetFuelProb =
      Array.from(wetThenDryFires.values()).reduce((s, e) => s + e.probability, 0) /
      Math.max(1, wetThenDryFires.size);
    const meanDryFuelProb =
      Array.from(dryAfterDryFires.values()).reduce((s, e) => s + e.probability, 0) /
      Math.max(1, dryAfterDryFires.size);
    expect(wetThenDryFires.size).toBeGreaterThan(0);
    expect(meanWetFuelProb).toBeGreaterThan(meanDryFuelProb);
  });

  it('implements recorder-tree elevated re-scarring and preserves non-intersecting concentric rings across multi-scar lifespans', () => {
    const profile = SPECIES_PROFILES['ponderosa-pine'];
    const sampleStandFire: StandFireEvent = {
      year: 1850,
      intensity: 0.65,
      probability: 0.12,
      aridityIndex: 1.4,
      fuelSwitch: 0.6,
      yearsSincePrevFire: 12,
    };

    let intactScars = 0;
    let rescarCount = 0;
    const trials = 400;
    for (let i = 0; i < trials; i++) {
      const intactOutcome = evaluateTreeFireDamage({
        seedKey: `trial-${i}`,
        year: 1850,
        cambialAge: 90,
        meanWoodRadiusMm: 140,
        profile,
        slopeDeg: 14,
        uphillScreenRad: 1.2,
        windScreenRad: 2.5,
        standFire: sampleStandFire,
        openCatface: null,
        yearsSinceClosure: null,
      });
      if (intactOutcome.scarred) intactScars++;

      const openOutcome = evaluateTreeFireDamage({
        seedKey: `trial-${i}`,
        year: 1850,
        cambialAge: 90,
        meanWoodRadiusMm: 140,
        profile,
        slopeDeg: 14,
        uphillScreenRad: 1.2,
        windScreenRad: 2.5,
        standFire: sampleStandFire,
        openCatface: {
          centerAngleRad: 1.2,
          openHalfArcRad: 0.35,
          maxEverHalfArcRad: 0.5,
          isClosed: false,
          scarIndices: [0],
        },
        yearsSinceClosure: null,
      });
      if (openOutcome.scarred) {
        expect(openOutcome.isRescar).toBe(true);
        rescarCount++;
      }
    }

    // Open unhealed catfaces re-scar dramatically more frequently than intact bark-insulated trees
    expect(rescarCount).toBeGreaterThan(intactScars * 2.5);
    expect(rescarCount / trials).toBeGreaterThan(0.6);

    // Multi-scar simulation maintains strict radial monotonicity and non-girdling arcs
    const dryEnv = buildMockDryPineEnv(1740, 2024, 16, 180);
    let multiScarSim = null;
    for (let offset = 0; offset < 12; offset++) {
      const candidate = simulateTreeCrossSection(
        {
          species: 'ponderosa-pine',
          latitude: 35.2 + offset * 0.03,
          longitude: -111.7 - offset * 0.03,
          totalAge: 280,
          deathYear: 2024,
          disturbance: { enableClimateWildfires: true },
        },
        dryEnv
      );
      if ((candidate.fireScars?.length ?? 0) >= 2 && candidate.fireScars!.some((s) => s.isRescar)) {
        multiScarSim = candidate;
        break;
      }
    }

    expect(multiScarSim).not.toBeNull();
    const sim = multiScarSim!;
    expect(sim.fireScars!.length).toBeGreaterThanOrEqual(2);
    expect(sim.fireScars!.some((s) => s.isRescar)).toBe(true);
    expect(sim.rings.some((r) => r.record.hasFireScar && r.record.isFireRescar)).toBe(true);

    for (let k = 0; k < sim.rings.length; k++) {
      const r = sim.rings[k];
      for (let j = 0; j < sim.anglesRad.length; j += 10) {
        expect(r.outerRadiusMm[j]).toBeGreaterThanOrEqual(r.innerRadiusMm[j]);
        if (k > 0) {
          expect(r.innerRadiusMm[j]).toBeCloseTo(sim.rings[k - 1].outerRadiusMm[j], 6);
        }
      }
    }
    for (const scar of sim.fireScars!) {
      let span = scar.catfaceArcEndRad - scar.catfaceArcStartRad;
      if (span < 0) span += 2 * Math.PI;
      expect(span).toBeGreaterThan(0);
      expect(span).toBeLessThan(Math.PI);
    }
  });

  it('concentrates scars uphill on steep terrain and distributes them downwind with wider dispersion on flat ground', () => {
    const uphillRad = 0;
    const windRad = Math.PI;
    const n = 300;

    const measureCircularStats = (slopeDeg: number) => {
      const rng = new SeededRNG(`azimuth-test-${slopeDeg}`);
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < n; i++) {
        const a = computeScarAzimuthRad(uphillRad, windRad, slopeDeg, rng);
        sx += Math.cos(a);
        sy += Math.sin(a);
      }
      const R = Math.hypot(sx, sy) / n;
      const meanAngle = Math.atan2(sy, sx);
      return { R, meanAngle };
    };

    const steep = measureCircularStats(22);
    const flat = measureCircularStats(0.5);

    expect(Math.abs(angularDiff(steep.meanAngle, uphillRad))).toBeLessThan(0.25);
    expect(steep.R).toBeGreaterThan(0.88);

    expect(Math.abs(angularDiff(flat.meanAngle, windRad))).toBeLessThan(0.25);
    expect(flat.R).toBeLessThan(steep.R);
  });
});
