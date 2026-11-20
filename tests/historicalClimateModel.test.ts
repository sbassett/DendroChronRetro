import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDisturbanceTraumaTags } from '../src/components/SvgViewport';
import { simulateTreeCrossSection } from '../src/model/growthEngine';
import { getRelevantClimateLandmarks } from '../src/model/narrative';
import { RETROSPECTIVE_PRESETS } from '../src/model/presets';
import { LOCATION_PRESETS } from '../src/model/species';
import { getVolcanicAod } from '../src/model/volcanicForcing';
import {
  parseClimateAtlasBuffer,
  queryNClimDivMonthly,
  queryPaleoYear,
  resetClimateAtlasForTesting,
  setClimateAtlasFromBuffer,
} from '../src/services/climateAtlas';
import {
  getCachedEnvironmentDataset,
  loadEnvironmentDataset,
} from '../src/services/environmentApi';

const ATLAS_PATH = path.resolve(
  process.cwd(),
  'public/data/western-climate-atlas.bin'
);

function loadRealAtlasBuffer(): Buffer {
  return fs.readFileSync(ATLAS_PATH);
}

/**
 * Builds deterministic daily ERA5 (1940-1990) and monthly NASA POWER (1981-2025)
 * mock payloads modeled on Flagstaff seasonal climate (dry May-Jun, wet Jul-Aug monsoon).
 */
function buildMockReanalysisPayloads() {
  const baseTemp = [-1.2, 0.1, 3.5, 7.2, 12.1, 17.6, 19.8, 18.9, 15.1, 9.3, 3.2, -0.9];
  const basePrecip = [42, 38, 36, 22, 16, 10, 62, 74, 40, 36, 32, 44];
  const dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  const t2m: Record<string, number> = {};
  const prec: Record<string, number> = {};
  for (let y = 1981; y <= 2025; y++) {
    // Include realistic inter-annual drought/pluvial modulation (1983 wet, 2002 dry)
    const pFactor = y === 1983 ? 1.55 : y === 2002 ? 0.42 : 0.72 + ((y * 17) % 11) * 0.06;
    const tOffset = y === 2002 ? 1.3 : y === 1983 ? -0.9 : (((y * 7) % 9) - 4) * 0.35;
    for (let m = 0; m < 12; m++) {
      const key = `${y}${String(m + 1).padStart(2, '0')}`;
      t2m[key] = Number((baseTemp[m] + tOffset).toFixed(2));
      prec[key] = Number(((basePrecip[m] * pFactor) / dim[m]).toFixed(3));
    }
  }

  const dailyTimes: string[] = [];
  const dailyTemp: number[] = [];
  const dailyPrecip: number[] = [];
  for (let y = 1940; y <= 1990; y++) {
    const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const pFactor = y === 1956 ? 0.55 : y === 1983 ? 1.55 : y === 1941 ? 1.45 : 0.72 + ((y * 13) % 11) * 0.06;
    const tOffset = (y === 1956 ? 1.0 : (((y * 11) % 9) - 4) * 0.35) + 0.6; // Slight ERA5 offset to verify bias alignment
    for (let m = 0; m < 12; m++) {
      const days = m === 1 && isLeap ? 29 : dim[m];
      const mmPerDay = (basePrecip[m] * pFactor) / days;
      for (let d = 1; d <= days; d++) {
        dailyTimes.push(
          `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        );
        dailyTemp.push(Number((baseTemp[m] + tOffset).toFixed(2)));
        dailyPrecip.push(Number(mmPerDay.toFixed(3)));
      }
    }
  }

  return { t2m, prec, dailyTimes, dailyTemp, dailyPrecip };
}

describe('Multi-Tier Historical Climate Model & Binary Atlas', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetClimateAtlasForTesting();
  });

  it('parses western-climate-atlas.bin cleanly and resolves all preset sites across WNA', () => {
    const buf = loadRealAtlasBuffer();
    const atlas = parseClimateAtlasBuffer(buf);

    expect(atlas.nclimStartYear).toBe(1895);
    expect(atlas.nclimEndYear).toBe(1980);
    expect(atlas.lbdaStartYear).toBe(1200);
    expect(atlas.lbdaEndYear).toBe(1894);
    expect(atlas.wnataStartYear).toBe(1553);
    expect(atlas.wnataEndYear).toBe(1894);
    expect(atlas.ntrendStartYear).toBe(1200);
    expect(atlas.ntrendEndYear).toBe(1552);
    expect(atlas.volcStartYear).toBe(1200);
    expect(atlas.volcEndYear).toBe(2000);
    expect(atlas.numDivisions).toBeGreaterThanOrEqual(90);

    for (const loc of LOCATION_PRESETS) {
      const nclim = queryNClimDivMonthly(atlas, loc.latitude, loc.longitude, 1934);
      expect(nclim).not.toBeNull();
      expect(nclim!.tempAnomC).toHaveLength(12);
      expect(nclim!.precipMultiplier).toHaveLength(12);

      const paleo = queryPaleoYear(atlas, loc.latitude, loc.longitude, 1816);
      expect(paleo).not.toBeNull();
      expect(paleo!.pmdi).not.toBeNull();
      expect(paleo!.tempAnomC).not.toBeNull();
      expect(paleo!.tempSource).toBe('wnata');
    }

    for (const preset of RETROSPECTIVE_PRESETS) {
      const nclim = queryNClimDivMonthly(
        atlas,
        preset.coordinates.latitude,
        preset.coordinates.longitude,
        1910
      );
      expect(nclim).not.toBeNull();

      const paleo1650 = queryPaleoYear(
        atlas,
        preset.coordinates.latitude,
        preset.coordinates.longitude,
        1650
      );
      expect(paleo1650).not.toBeNull();
      expect(paleo1650!.pmdi).not.toBeNull();
    }

    // Outside WNA returns null cleanly while volcanic forcing remains available globally
    expect(queryNClimDivMonthly(atlas, 40.7128, -74.006, 1934)).toBeNull();
    expect(queryPaleoYear(atlas, 40.7128, -74.006, 1816)).toBeNull();
    expect(getVolcanicAod(1816, 40.7128)).toBeGreaterThan(0.25);
  });

  it('preserves historical drought, pluvial, rain-shadow, and volcanic signals from real NOAA data', () => {
    const atlas = parseClimateAtlasBuffer(loadRealAtlasBuffer());

    // 1. Flagstaff AZ: 1905-1919 wet pluvial vs 1934 & 1956 droughts + 1580s megadrought + 1816 Tambora
    const flagWeights = [42, 38, 36, 22, 16, 10, 62, 74, 40, 36, 32, 44];
    const weightedAnnualMult = (yr: number) => {
      const rec = queryNClimDivMonthly(atlas, 35.2645, -111.7442, yr)!;
      let num = 0;
      let den = 0;
      for (let m = 0; m < 12; m++) {
        num += rec.precipMultiplier[m] * flagWeights[m];
        den += flagWeights[m];
      }
      const meanDt = rec.tempAnomC.reduce((a, b) => a + b, 0) / 12;
      return { pRatio: num / den, meanDt };
    };

    let pluvialSum = 0;
    for (let y = 1905; y <= 1919; y++) {
      pluvialSum += weightedAnnualMult(y).pRatio;
    }
    const meanPluvial = pluvialSum / 15;
    const d1934 = weightedAnnualMult(1934);
    const d1956 = weightedAnnualMult(1956);

    expect(meanPluvial).toBeGreaterThan(1.05);
    expect(d1934.pRatio).toBeLessThan(0.90);
    expect(d1934.meanDt).toBeGreaterThan(0.4);
    expect(d1956.pRatio).toBeLessThan(0.80);

    let pmdi1580Sum = 0;
    for (let y = 1579; y <= 1587; y++) {
      pmdi1580Sum += queryPaleoYear(atlas, 35.2645, -111.7442, y)!.pmdi!;
    }
    expect(pmdi1580Sum / 9).toBeLessThan(-1.0);

    const p1816 = queryPaleoYear(atlas, 35.2645, -111.7442, 1816)!;
    expect(p1816.volcanicAod).toBeGreaterThan(0.25);

    // 2. N-TREND fallback for 1200-1552 inside WNA
    const p1450 = queryPaleoYear(atlas, 35.2645, -111.7442, 1450);
    expect(p1450).not.toBeNull();
    expect(p1450!.tempSource).toBe('ntrend');
    expect(p1450!.tempAnomC).not.toBeNull();

    // 3. H.J. Andrews (West Cascades) vs Metolius (East Cascades) must map to distinct climate divisions
    const hja1977 = queryNClimDivMonthly(atlas, 44.2124, -122.2557, 1977)!;
    const hja1976 = queryNClimDivMonthly(atlas, 44.2124, -122.2557, 1976)!;
    const met1977 = queryNClimDivMonthly(atlas, 44.4622, -121.6358, 1977)!;
    expect(hja1977.divisionCode).not.toBe(met1977.divisionCode);

    // Water-year 1977 (Oct-Dec 1976 + Jan-Sep 1977) West Coast drought
    const hjaBase = [225, 178, 162, 108, 74, 46, 18, 20, 50, 122, 218, 245];
    let wyNum = 0;
    let wyDen = 0;
    for (let m = 9; m < 12; m++) {
      wyNum += hja1976.precipMultiplier[m] * hjaBase[m];
      wyDen += hjaBase[m];
    }
    for (let m = 0; m < 9; m++) {
      wyNum += hja1977.precipMultiplier[m] * hjaBase[m];
      wyDen += hjaBase[m];
    }
    expect(wyNum / wyDen).toBeLessThan(0.75);
  });

  it('stitches 4 real tiers with Method of Fragments and upgrades pre-seeded benchmark sites', async () => {
    // 1. Frame-1 synchronous cache hit on Flagstaff remains instantaneous
    const syncPreSeeded = getCachedEnvironmentDataset(35.2645, -111.7442, 1764, 2024);
    expect(syncPreSeeded).not.toBeNull();
    expect(syncPreSeeded!.source).toBe('offline-climatology');

    // 2. Stub network endpoints + load real binary atlas
    setClimateAtlasFromBuffer(loadRealAtlasBuffer());
    const { t2m, prec, dailyTimes, dailyTemp, dailyPrecip } =
      buildMockReanalysisPayloads();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('open-meteo.com/v1/elevation')) {
        return new Response(
          JSON.stringify({ elevation: [2185, 2195, 2175, 2190, 2180] }),
          { status: 200 }
        );
      }
      if (url.includes('power.larc.nasa.gov')) {
        return new Response(
          JSON.stringify({
            geometry: { coordinates: [-111.7442, 35.2645, 2185] },
            properties: { parameter: { T2M: t2m, PRECTOTCORR: prec } },
          }),
          { status: 200 }
        );
      }
      if (url.includes('archive-api.open-meteo.com')) {
        return new Response(
          JSON.stringify({
            elevation: 2185,
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
    vi.stubGlobal('fetch', fetchMock);

    // Pre-seeded Flagstaff upgrades cleanly to live MERRA-2 + ERA5 + nClimDiv + Paleo Atlas
    const env = await loadEnvironmentDataset(35.2645, -111.7442, 1550, 2024);
    expect(env.source).toBe('nasa-power-merra2');
    expect(env.hasHistoricalLayers).toBe(true);
    expect(env.provenanceTiers).toContain('paleo-atlas');
    expect(env.provenanceTiers).toContain('instrumental-nclimdiv');
    expect(env.provenanceTiers).toContain('reanalysis-era5');
    expect(env.provenanceTiers).toContain('reanalysis-merra2');

    const byYear = new Map(env.years.map((y) => [y.year, y]));
    expect(byYear.get(1580)!.provenance).toBe('paleo-atlas');
    expect(byYear.get(1580)!.isSynthetic).toBe(false);
    expect(byYear.get(1816)!.provenance).toBe('paleo-atlas');
    expect(byYear.get(1816)!.volcanicAod).toBeGreaterThan(0.25);
    expect(byYear.get(1934)!.provenance).toBe('instrumental-nclimdiv');
    expect(byYear.get(1956)!.provenance).toBe('reanalysis-era5');
    expect(byYear.get(2002)!.provenance).toBe('reanalysis-merra2');

    // Verify zero NaNs, non-negative precipitation, and preserved Flagstaff monsoon seasonality in paleo years
    let paleoMonsoonSum = 0;
    let paleoEarlySummerSum = 0;
    let paleoCount = 0;
    for (const yr of env.years) {
      expect(yr.tempC).toHaveLength(12);
      expect(yr.precipMm).toHaveLength(12);
      for (let m = 0; m < 12; m++) {
        expect(Number.isFinite(yr.tempC[m])).toBe(true);
        expect(Number.isFinite(yr.precipMm[m])).toBe(true);
        expect(yr.precipMm[m]).toBeGreaterThanOrEqual(0);
      }
      if (yr.provenance === 'paleo-atlas') {
        paleoEarlySummerSum += yr.precipMm[4] + yr.precipMm[5]; // May + Jun
        paleoMonsoonSum += yr.precipMm[6] + yr.precipMm[7]; // Jul + Aug
        paleoCount++;
      }
    }
    expect(paleoCount).toBeGreaterThan(300);
    expect(paleoMonsoonSum).toBeGreaterThan(paleoEarlySummerSum * 2.5);

    // Smooth bias-aligned ERA5 -> MERRA-2 transition across 1980/1981
    const y1980 = byYear.get(1980)!;
    const y1981 = byYear.get(1981)!;
    const meanT80 = y1980.tempC.reduce((a, b) => a + b, 0) / 12;
    const meanT81 = y1981.tempC.reduce((a, b) => a + b, 0) / 12;
    expect(Math.abs(meanT80 - meanT81)).toBeLessThan(3.0);
  });

  it('drives authentic retrospective preset chronologies, volcanic frost trauma, and non-intersecting geometry', async () => {
    setClimateAtlasFromBuffer(loadRealAtlasBuffer());
    const { t2m, prec, dailyTimes, dailyTemp, dailyPrecip } =
      buildMockReanalysisPayloads();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('open-meteo.com/v1/elevation')) {
          return new Response(
            JSON.stringify({ elevation: [2200, 2205, 2195, 2202, 2198] }),
            { status: 200 }
          );
        }
        if (url.includes('power.larc.nasa.gov')) {
          return new Response(
            JSON.stringify({
              geometry: { coordinates: [-111.7442, 35.2645, 2200] },
              properties: { parameter: { T2M: t2m, PRECTOTCORR: prec } },
            }),
            { status: 200 }
          );
        }
        if (url.includes('archive-api.open-meteo.com')) {
          return new Response(
            JSON.stringify({
              elevation: 2200,
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
      })
    );

    for (const preset of RETROSPECTIVE_PRESETS) {
      const startYr = preset.temporal.deathYear - preset.temporal.totalAge;
      const env = await loadEnvironmentDataset(
        preset.coordinates.latitude,
        preset.coordinates.longitude,
        startYr,
        preset.temporal.deathYear
      );

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

      expect(sim.rings.length).toBe(sim.visibleRingCount);

      // Strictly non-intersecting ring radii
      for (let k = 0; k < sim.rings.length; k++) {
        const r = sim.rings[k];
        for (let j = 0; j < sim.anglesRad.length; j += 15) {
          expect(r.outerRadiusMm[j]).toBeGreaterThanOrEqual(r.innerRadiusMm[j]);
        }
      }

      if (preset.id === 'pluvial-megadrought') {
        const pluvialRings = sim.rings.filter(
          (r) => r.record.calendarYear >= 1905 && r.record.calendarYear <= 1919
        );
        const r1934 = sim.rings.find((r) => r.record.calendarYear === 1934)!;
        const r1956 = sim.rings.find((r) => r.record.calendarYear === 1956)!;
        const pluvialMean =
          pluvialRings.reduce((s, r) => s + r.record.meanWidthMm, 0) /
          pluvialRings.length;
        expect(r1956.record.meanWidthMm).toBeLessThan(pluvialMean);
        expect(r1934.record.meanWidthMm).toBeLessThan(pluvialMean);
      }

      if (
        preset.id === 'bristlecone-ancient' ||
        preset.id === 'volcanic-frost-shock'
      ) {
        const r1816 = sim.rings.find((r) => r.record.calendarYear === 1816)!;
        const r1783 = sim.rings.find((r) => r.record.calendarYear === 1783)!;
        expect(r1816.record.hasFrostRing).toBe(true);
        expect(r1783.record.hasFrostRing).toBe(true);
        expect(getDisturbanceTraumaTags(r1816.record, [])).toContain(
          'Traumatic cold shock'
        );
      }
    }

    // Historical landmarks include pre-1934 additions
    const swLandmarks = getRelevantClimateLandmarks(1560, 2024, 35.2645, -111.7442);
    const swYears = swLandmarks.map((l) => l.year);
    expect(swYears).toContain(1580);
    expect(swYears).toContain(1816);
    expect(swYears).toContain(1905);
    expect(swYears).toContain(1934);
    expect(swYears).toContain(2002);

    const mtLandmarks = getRelevantClimateLandmarks(1680, 1920, 46.1294, -114.2531);
    expect(mtLandmarks.map((l) => l.year)).toContain(1783);
    expect(mtLandmarks.map((l) => l.year)).toContain(1816);
  });
});
