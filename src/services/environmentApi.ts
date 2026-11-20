import {
  buildRegionalClimateSeedKey,
  SeededRNG,
} from '../model/prng';
import {
  ClimateProvenance,
  EnvironmentDataset,
  MonthlyClimateYear,
  TerrainInfo,
} from '../model/types';
import { getVolcanicAod } from '../model/volcanicForcing';
import {
  getLoadedClimateAtlas,
  hasAttemptedClimateAtlasLoad,
  loadClimateAtlas,
  ParsedClimateAtlas,
  queryNClimDivMonthly,
  queryPaleoYear,
} from './climateAtlas';

const TERRAIN_TIMEOUT_MS = 3500;
const CLIMATE_TIMEOUT_MS = 4500;
const ERA5_TIMEOUT_MS = 4500;
const ATLAS_TIMEOUT_MS = 3500;

interface CachedTerrain {
  info: TerrainInfo;
  isFallback: boolean;
}

interface ObservedYearRecord {
  tempC: number[];
  precipMm: number[];
  validMonths: boolean[];
}

interface Era5FetchResult {
  years: Map<number, ObservedYearRecord>;
  elevationM: number | null;
}

interface CachedClimateGrid {
  observedYears: Map<number, ObservedYearRecord>;
  climMeanTemp: number[];
  climStdTemp: number[];
  climMeanPrecip: number[];
  climStdPrecip: number[];
  gridElevationM: number | null;
  source: EnvironmentDataset['source'];
  isSeedPlaceholder?: boolean;
  nasaAttempted?: boolean;
  era5Years?: Map<number, ObservedYearRecord>;
  era5ElevationM?: number | null;
  era5Attempted?: boolean;
}

interface NasaPowerMonthlyResponse {
  geometry?: {
    coordinates?: number[];
  };
  properties?: {
    parameter?: {
      T2M?: Record<string, number>;
      PRECTOTCORR?: Record<string, number>;
    };
  };
}

interface OpenMeteoEra5DailyResponse {
  elevation?: number;
  daily?: {
    time?: string[];
    temperature_2m_mean?: Array<number | null>;
    precipitation_sum?: Array<number | null>;
  };
}

const terrainCache = new Map<string, CachedTerrain>();
const terrainInFlight = new Map<string, Promise<CachedTerrain>>();

const climateCache = new Map<string, CachedClimateGrid>();
const climateInFlight = new Map<string, Promise<CachedClimateGrid | null>>();
const era5InFlight = new Map<string, Promise<Era5FetchResult | null>>();

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function terrainCacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)}:${lon.toFixed(4)}`;
}

function climateCacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)}:${lon.toFixed(2)}`;
}

function daysInMonth(year: number, monthIndex0: number): number {
  if (monthIndex0 === 1) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 29 : 28;
  }
  return [3, 5, 8, 10].includes(monthIndex0) ? 30 : 31;
}

/**
 * Performs a JSON fetch bounded by a strict AbortController timeout covering
 * both connection/headers and response body download so stalled sockets or
 * rate-limiting proxies can never hang the UI.
 */
async function fetchJsonWithTimeout<T>(
  url: string,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function buildFallbackTerrain(lat: number, lon: number): CachedTerrain {
  const fallbackRng = new SeededRNG(`terrain:${lat.toFixed(4)}:${lon.toFixed(4)}`);
  const estElev = Math.max(
    50,
    900 - Math.abs(lat - 42) * 28 + fallbackRng.range(-200, 450)
  );
  return {
    info: {
      elevationM: Math.round(estElev),
      slopeDeg: fallbackRng.range(2, 18),
      aspectDeg: fallbackRng.range(0, 360),
      isWaterOrInvalid: false,
    },
    isFallback: true,
  };
}

async function fetchTerrainCached(
  lat: number,
  lon: number
): Promise<CachedTerrain> {
  const key = terrainCacheKey(lat, lon);
  const hit = terrainCache.get(key);
  if (hit) return hit;

  const active = terrainInFlight.get(key);
  if (active) return active;

  const reqPromise = (async (): Promise<CachedTerrain> => {
    const dLat = 0.00081; // ~90m North/South
    const cosLat = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
    const dLon = 0.00081 / cosLat; // ~90m East/West

    const lats = [lat, lat + dLat, lat - dLat, lat, lat]
      .map((v) => clamp(v, -89.99, 89.99).toFixed(5))
      .join(',');
    const lons = [lon, lon, lon, lon + dLon, lon - dLon]
      .map((v) => (((((v + 180) % 360) + 360) % 360) - 180).toFixed(5))
      .join(',');

    try {
      const data = await fetchJsonWithTimeout<{ elevation?: number[] }>(
        `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`,
        TERRAIN_TIMEOUT_MS
      );
      const el = data.elevation;
      if (
        !el ||
        el.length < 5 ||
        el.some((x) => typeof x !== 'number' || Number.isNaN(x))
      ) {
        throw new Error('Malformed elevation response');
      }

      const [zC, zN, zS, zE, zW] = el;
      const allZero = zC === 0 && zN === 0 && zS === 0 && zE === 0 && zW === 0;

      const dzDx = (zE - zW) / 180.0; // Eastward rise per meter
      const dzDy = (zN - zS) / 180.0; // Northward rise per meter
      const slopeRad = Math.atan(Math.hypot(dzDx, dzDy));
      const slopeDeg = (slopeRad * 180) / Math.PI;

      // Downhill vector is (-dzDx, -dzDy). Compass azimuth: 0=N, 90=E, 180=S, 270=W
      let aspectDeg = (Math.atan2(-dzDx, -dzDy) * 180) / Math.PI;
      if (aspectDeg < 0) aspectDeg += 360;

      const resolved: CachedTerrain = {
        info: {
          elevationM: zC,
          slopeDeg,
          aspectDeg: slopeDeg < 0.25 ? 180 : aspectDeg,
          isWaterOrInvalid: allZero,
        },
        isFallback: false,
      };
      terrainCache.set(key, resolved);
      return resolved;
    } catch {
      const fallback = buildFallbackTerrain(lat, lon);
      terrainCache.set(key, fallback);
      return fallback;
    } finally {
      terrainInFlight.delete(key);
    }
  })();

  terrainInFlight.set(key, reqPromise);
  return reqPromise;
}

/**
 * Fetches 5-point 90m DEM elevation stencil from Open-Meteo to compute
 * exact local elevation, slope angle, and aspect (downhill compass direction).
 */
export async function fetchTerrainInfo(
  lat: number,
  lon: number
): Promise<TerrainInfo> {
  const cached = await fetchTerrainCached(lat, lon);
  return cached.info;
}

/**
 * Computes deterministic offline baseline climatology if network/API is unreachable.
 */
function buildOfflineClimatology(
  lat: number,
  lon: number,
  elevationM: number
): CachedClimateGrid {
  const absLat = Math.abs(lat);
  const hemisphereSign = lat >= 0 ? 1 : -1;
  // Sea-level equivalent temperature across Western North America (~22°C at 32°N to ~9°C at 49°N)
  const seaLevelMeanT = 44.5 - 0.72 * absLat;
  const meanAnnualT = seaLevelMeanT - (elevationM / 1000) * 5.0;
  const seasonalAmp = clamp(4 + 0.28 * absLat, 5, 19);

  const isMaritimeWest = lon < -121.8 && lat > 37 && lat < 52;
  const baseAnnualPrecip = isMaritimeWest
    ? clamp(1350 + (lat - 37) * 50 + elevationM * 0.35, 1100, 2600)
    : clamp(
        380 - Math.abs(lon - -117) * 20 + (lat > 42 ? 70 : 0) + elevationM * 0.08,
        250,
        750
      );

  const climMeanTemp: number[] = [];
  const climStdTemp: number[] = [];
  const climMeanPrecip: number[] = [];
  const climStdPrecip: number[] = [];

  for (let m = 0; m < 12; m++) {
    const phase = ((m - 6) / 12) * 2 * Math.PI * hemisphereSign;
    climMeanTemp.push(meanAnnualT + seasonalAmp * Math.cos(phase));
    climStdTemp.push(1.6 + (m <= 2 || m >= 10 ? 0.8 : 0.2));

    const winterWeight =
      1 + 0.55 * Math.cos(((m - 0.5) / 12) * 2 * Math.PI * hemisphereSign);
    const monsoonBump =
      lat < 38 && lon > -114 && (m === 6 || m === 7) ? 1.55 : 1.0;
    const rawShare =
      (isMaritimeWest ? winterWeight : 0.85 + 0.2 * winterWeight) * monsoonBump;
    climMeanPrecip.push((baseAnnualPrecip / 12) * rawShare);
    climStdPrecip.push((baseAnnualPrecip / 12) * rawShare * 0.48);
  }

  return {
    observedYears: new Map(),
    climMeanTemp,
    climStdTemp,
    climMeanPrecip,
    climStdPrecip,
    gridElevationM: elevationM,
    source: 'offline-climatology',
    nasaAttempted: true,
    era5Attempted: false,
  };
}

// Pre-seed default benchmark locations so initial frame renders instantly with 0ms delay
(function seedDefaultCaches() {
  const seedSite = (
    lat: number,
    lon: number,
    elevM: number,
    slopeDeg: number,
    aspectDeg: number,
    climate?: CachedClimateGrid
  ) => {
    terrainCache.set(terrainCacheKey(lat, lon), {
      info: {
        elevationM: elevM,
        slopeDeg,
        aspectDeg,
        isWaterOrInvalid: false,
      },
      isFallback: false,
    });
    const grid = climate ?? buildOfflineClimatology(lat, lon, elevM);
    grid.isSeedPlaceholder = true;
    grid.nasaAttempted = false;
    grid.era5Attempted = false;
    climateCache.set(climateCacheKey(lat, lon), grid);
  };

  // Flagstaff / Coconino Plateau (Ponderosa Pine default benchmark, 2,185 m)
  // NOAA / NASA POWER 30-year normals: Mean annual temp 8.9°C (48.0°F), Annual precip 462 mm (18.2 in)
  seedSite(35.2645, -111.7442, 2185, 3.8, 195, {
    observedYears: new Map(),
    climMeanTemp: [-1.2, 0.1, 3.5, 7.2, 12.1, 17.6, 19.8, 18.9, 15.1, 9.3, 3.2, -0.9],
    climStdTemp: [2.1, 2.0, 1.8, 1.5, 1.4, 1.4, 1.2, 1.1, 1.3, 1.6, 1.9, 2.2],
    climMeanPrecip: [42, 38, 36, 22, 16, 10, 62, 74, 40, 36, 32, 44],
    climStdPrecip: [24, 22, 20, 15, 12, 8, 32, 36, 25, 22, 20, 26],
    gridElevationM: 2185,
    source: 'offline-climatology',
  });

  // H.J. Andrews Forest (Douglas-fir default benchmark, 454 m)
  // PRISM / NOAA 30-year normals: Mean annual temp 10.1°C (50.2°F), Annual precip 1,465 mm (57.7 in)
  seedSite(44.2124, -122.2557, 454, 21.4, 268, {
    observedYears: new Map(),
    climMeanTemp: [2.8, 4.1, 6.2, 8.8, 12.4, 15.6, 19.2, 19.0, 15.4, 10.2, 5.5, 2.5],
    climStdTemp: [1.8, 1.6, 1.4, 1.3, 1.4, 1.5, 1.3, 1.2, 1.3, 1.4, 1.7, 1.9],
    climMeanPrecip: [225, 178, 162, 108, 74, 46, 18, 20, 50, 122, 218, 245],
    climStdPrecip: [85, 72, 65, 48, 38, 26, 14, 15, 32, 60, 82, 95],
    gridElevationM: 454,
    source: 'offline-climatology',
  });
})();

function computeClimatologyStats(observedYears: Map<number, ObservedYearRecord>): {
  climMeanTemp: number[];
  climStdTemp: number[];
  climMeanPrecip: number[];
  climStdPrecip: number[];
} | null {
  const monthTempSamples: number[][] = Array.from({ length: 12 }, () => []);
  const monthPrecipSamples: number[][] = Array.from({ length: 12 }, () => []);

  for (const rec of observedYears.values()) {
    for (let m = 0; m < 12; m++) {
      if (rec.validMonths[m]) {
        monthTempSamples[m].push(rec.tempC[m]);
        monthPrecipSamples[m].push(rec.precipMm[m]);
      }
    }
  }

  if (monthTempSamples.some((arr) => arr.length < 5)) {
    return null;
  }

  const climMeanTemp: number[] = [];
  const climStdTemp: number[] = [];
  const climMeanPrecip: number[] = [];
  const climStdPrecip: number[] = [];

  for (let m = 0; m < 12; m++) {
    const tArr = monthTempSamples[m];
    const pArr = monthPrecipSamples[m];
    const tMean = tArr.reduce((a, b) => a + b, 0) / tArr.length;
    const pMean = pArr.reduce((a, b) => a + b, 0) / pArr.length;
    const tVar =
      tArr.reduce((acc, v) => acc + (v - tMean) * (v - tMean), 0) /
      Math.max(1, tArr.length - 1);
    const pVar =
      pArr.reduce((acc, v) => acc + (v - pMean) * (v - pMean), 0) /
      Math.max(1, pArr.length - 1);

    climMeanTemp.push(tMean);
    climStdTemp.push(Math.max(0.6, Math.sqrt(tVar)));
    climMeanPrecip.push(pMean);
    climStdPrecip.push(Math.max(2.0, Math.sqrt(pVar)));
  }

  return { climMeanTemp, climStdTemp, climMeanPrecip, climStdPrecip };
}

/**
 * Fetches pre-aggregated monthly temperature (T2M, °C) and bias-corrected
 * precipitation (PRECTOTCORR, mm/day) from NASA POWER MERRA-2 (1981–present).
 * Payload is ~17 KB and typically resolves in ~400–500 ms with CORS `*`.
 */
async function fetchNasaPowerClimate(
  lat: number,
  lon: number
): Promise<CachedClimateGrid | null> {
  const key = climateCacheKey(lat, lon);
  const hit = climateCache.get(key);
  if (hit && hit.source === 'nasa-power-merra2' && !hit.isSeedPlaceholder) {
    return hit;
  }

  const active = climateInFlight.get(key);
  if (active) return active;

  const reqPromise = (async (): Promise<CachedClimateGrid | null> => {
    // Lag 75 days so early-January/February requests never exceed MERRA-2 monthly availability
    const safeEndYear = Math.max(
      2024,
      new Date(Date.now() - 75 * 86400_000).getUTCFullYear()
    );

    const buildUrl = (endYr: number) =>
      `https://power.larc.nasa.gov/api/temporal/monthly/point` +
      `?parameters=T2M,PRECTOTCORR&community=AG` +
      `&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}` +
      `&start=1981&end=${endYr}&format=JSON`;

    try {
      let json: NasaPowerMonthlyResponse;
      try {
        json = await fetchJsonWithTimeout<NasaPowerMonthlyResponse>(
          buildUrl(safeEndYear),
          CLIMATE_TIMEOUT_MS
        );
      } catch (err) {
        if (err instanceof Error && err.message.includes('422')) {
          json = await fetchJsonWithTimeout<NasaPowerMonthlyResponse>(
            buildUrl(safeEndYear - 1),
            2500
          );
        } else {
          throw err;
        }
      }

      const t2m = json.properties?.parameter?.T2M;
      const prec = json.properties?.parameter?.PRECTOTCORR;
      if (!t2m || !prec) {
        throw new Error('Malformed NASA POWER monthly payload');
      }

      const rawElev = json.geometry?.coordinates?.[2];
      const gridElevationM =
        typeof rawElev === 'number' && !Number.isNaN(rawElev) ? rawElev : null;

      const observedYears = new Map<number, ObservedYearRecord>();

      for (const ymKey of Object.keys(t2m)) {
        if (ymKey.length !== 6) continue;
        const y = Number(ymKey.slice(0, 4));
        const mNum = Number(ymKey.slice(4, 6));
        // NASA POWER includes month "13" for annual summary; keep 1..12 only
        if (!Number.isFinite(y) || mNum < 1 || mNum > 12) continue;

        const m = mNum - 1;
        const tVal = t2m[ymKey];
        const pRateMmPerDay = prec[ymKey];
        if (
          typeof tVal !== 'number' ||
          typeof pRateMmPerDay !== 'number' ||
          tVal <= -900 ||
          pRateMmPerDay < 0
        ) {
          continue;
        }

        const pTotalMm = pRateMmPerDay * daysInMonth(y, m);

        let rec = observedYears.get(y);
        if (!rec) {
          rec = {
            tempC: new Array(12).fill(0),
            precipMm: new Array(12).fill(0),
            validMonths: new Array(12).fill(false),
          };
          observedYears.set(y, rec);
        }

        rec.tempC[m] = tVal;
        rec.precipMm[m] = pTotalMm;
        rec.validMonths[m] = true;
      }

      const stats = computeClimatologyStats(observedYears);
      if (!stats) {
        throw new Error('Insufficient NASA POWER monthly history');
      }

      const existing = climateCache.get(key);
      const resolved: CachedClimateGrid = {
        observedYears,
        climMeanTemp: stats.climMeanTemp,
        climStdTemp: stats.climStdTemp,
        climMeanPrecip: stats.climMeanPrecip,
        climStdPrecip: stats.climStdPrecip,
        gridElevationM,
        source: 'nasa-power-merra2',
        isSeedPlaceholder: false,
        nasaAttempted: true,
        era5Years: existing?.era5Years,
        era5ElevationM: existing?.era5ElevationM,
        era5Attempted: existing?.era5Attempted ?? false,
      };
      climateCache.set(key, resolved);
      return resolved;
    } catch {
      return null;
    } finally {
      climateInFlight.delete(key);
    }
  })();

  climateInFlight.set(key, reqPromise);
  return reqPromise;
}

/**
 * Fetches historical ECMWF ERA5 daily data (1940-1990) from Open-Meteo Archive API
 * and aggregates into monthly records (requiring >= 25 valid days per month).
 */
async function fetchOpenMeteoEra5Climate(
  lat: number,
  lon: number
): Promise<Era5FetchResult | null> {
  const key = climateCacheKey(lat, lon);
  const hit = climateCache.get(key);
  if (hit?.era5Attempted) {
    return hit.era5Years
      ? { years: hit.era5Years, elevationM: hit.era5ElevationM ?? null }
      : null;
  }

  const active = era5InFlight.get(key);
  if (active) return active;

  const reqPromise = (async (): Promise<Era5FetchResult | null> => {
    const url =
      `https://archive-api.open-meteo.com/v1/archive` +
      `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&start_date=1940-01-01&end_date=1990-12-31` +
      `&daily=temperature_2m_mean,precipitation_sum&timezone=UTC`;

    try {
      const json = await fetchJsonWithTimeout<OpenMeteoEra5DailyResponse>(
        url,
        ERA5_TIMEOUT_MS
      );
      const times = json.daily?.time;
      const temps = json.daily?.temperature_2m_mean;
      const precs = json.daily?.precipitation_sum;
      if (
        !times ||
        !temps ||
        !precs ||
        times.length === 0 ||
        times.length !== temps.length ||
        times.length !== precs.length
      ) {
        throw new Error('Malformed Open-Meteo ERA5 payload');
      }

      const accum = new Map<
        number,
        {
          tSum: number[];
          tCnt: number[];
          pSum: number[];
          pCnt: number[];
        }
      >();

      for (let i = 0; i < times.length; i++) {
        const dtStr = times[i];
        if (typeof dtStr !== 'string' || dtStr.length < 7) continue;
        const y = Number(dtStr.slice(0, 4));
        const m = Number(dtStr.slice(5, 7)) - 1;
        if (!Number.isFinite(y) || m < 0 || m > 11) continue;

        let yrAcc = accum.get(y);
        if (!yrAcc) {
          yrAcc = {
            tSum: new Array(12).fill(0),
            tCnt: new Array(12).fill(0),
            pSum: new Array(12).fill(0),
            pCnt: new Array(12).fill(0),
          };
          accum.set(y, yrAcc);
        }

        const t = temps[i];
        const p = precs[i];
        if (typeof t === 'number' && !Number.isNaN(t)) {
          yrAcc.tSum[m] += t;
          yrAcc.tCnt[m]++;
        }
        if (typeof p === 'number' && !Number.isNaN(p) && p >= 0) {
          yrAcc.pSum[m] += p;
          yrAcc.pCnt[m]++;
        }
      }

      const years = new Map<number, ObservedYearRecord>();
      for (const [y, acc] of accum.entries()) {
        const tempC = new Array(12).fill(0);
        const precipMm = new Array(12).fill(0);
        const validMonths = new Array(12).fill(false);
        let hasAny = false;

        for (let m = 0; m < 12; m++) {
          if (acc.tCnt[m] >= 25 && acc.pCnt[m] >= 25) {
            const dim = daysInMonth(y, m);
            tempC[m] = acc.tSum[m] / acc.tCnt[m];
            precipMm[m] = acc.pSum[m] * (dim / acc.pCnt[m]);
            validMonths[m] = true;
            hasAny = true;
          }
        }

        if (hasAny) {
          years.set(y, { tempC, precipMm, validMonths });
        }
      }

      if (years.size < 10) {
        throw new Error('Insufficient Open-Meteo ERA5 history');
      }

      const rawElev = json.elevation;
      const elevationM =
        typeof rawElev === 'number' && !Number.isNaN(rawElev) ? rawElev : null;
      return { years, elevationM };
    } catch {
      return null;
    } finally {
      era5InFlight.delete(key);
    }
  })();

  era5InFlight.set(key, reqPromise);
  return reqPromise;
}

/**
 * Generates a deterministic synthetic monthly climate record for any year outside
 * observed/instrumental/paleo records, preserving regional PDO/ENSO multi-decadal
 * drought waves plus Crowley volcanic cooling when available.
 */
function synthesizeClimateYear(
  year: number,
  latitude: number,
  regionalSeedKey: string,
  climMeanTemp: number[],
  climStdTemp: number[],
  climMeanPrecip: number[],
  climStdPrecip: number[],
  volcanicAodOverride?: number
): MonthlyClimateYear {
  const baseRegionalRng = new SeededRNG(regionalSeedKey);
  const phasePdo = baseRegionalRng.range(0, Math.PI * 2);
  const phaseEnso = baseRegionalRng.range(0, Math.PI * 2);
  const phaseCentennial = baseRegionalRng.range(0, Math.PI * 2);

  // Quasi-periodic regional moisture/temp regime for calendar year
  const regimeWave =
    0.42 * Math.sin((2 * Math.PI * year) / 24.5 + phasePdo) +
    0.34 * Math.sin((2 * Math.PI * year) / 5.7 + phaseEnso) +
    0.24 * Math.sin((2 * Math.PI * year) / 62.0 + phaseCentennial);

  const yearRng = new SeededRNG(`${regionalSeedKey}:year:${year}`);
  const annualMoistureShock = yearRng.gaussian(0, 0.72) + 0.45 * regimeWave;
  const annualTempShock = yearRng.gaussian(0, 0.55) - 0.22 * regimeWave;

  // Historical cooler baseline adjustment prior to 1981 (~ -0.055 °C/decade up to -0.65 °C)
  const preIndustrialOffset =
    year < 1981 ? -clamp((1981 - year) * 0.0055, 0, 0.65) : 0;

  const volcanicAod = volcanicAodOverride ?? getVolcanicAod(year, latitude);
  const volcCoolC =
    volcanicAod > 0.05 ? -clamp((volcanicAod - 0.04) * 5.2, 0, 2.2) : 0;

  const tempC: number[] = [];
  const precipMm: number[] = [];

  for (let m = 0; m < 12; m++) {
    const seasonalVolcWeight = m >= 3 && m <= 8 ? 1.0 : 0.45;
    const tZ = 0.55 * annualTempShock + yearRng.gaussian(0, 0.82);
    tempC.push(
      climMeanTemp[m] +
        preIndustrialOffset +
        volcCoolC * seasonalVolcWeight +
        tZ * climStdTemp[m]
    );

    // Skewed multiplier so droughts stay >= 0 and wet months tail upward
    const pZ = 0.6 * annualMoistureShock + yearRng.gaussian(0, 0.8);
    const meanP = climMeanPrecip[m];
    const cv = clamp(climStdPrecip[m] / Math.max(1, meanP), 0.2, 1.35);
    const multiplier = Math.exp(pZ * cv * 0.78 - 0.22 * cv * cv);
    precipMm.push(Math.max(0, meanP * multiplier));
  }

  return {
    year,
    tempC,
    precipMm,
    isSynthetic: true,
    provenance: 'synthetic',
    volcanicAod: volcanicAod > 0 ? volcanicAod : undefined,
  };
}

interface AnalogYearSample {
  year: number;
  tempC: number[];
  precipMm: number[];
  zP: number;
  dTJja: number;
}

/**
 * Disaggregates annual/seasonal paleoclimate targets (LBDA PMDI, WNATA/N-TREND
 * temperature anomaly, and Crowley volcanic SAOD) into monthly (T, P) series using
 * Method of Fragments over observed modern analogs (or conditioned synthesis when
 * fewer than 10 observed years are available).
 */
function reconstructPaleoClimateYear(
  year: number,
  regionalSeedKey: string,
  siteMeanTemp: number[],
  climStdTemp: number[],
  climMeanPrecip: number[],
  climStdPrecip: number[],
  siteJjaMeanTemp: number,
  siteMeanAnnualP: number,
  siteAnnualStdP: number,
  analogBank: AnalogYearSample[],
  pmdi: number | null,
  tempAnomC: number | null,
  tempSource: 'wnata' | 'ntrend' | null,
  volcanicAod: number
): MonthlyClimateYear {
  const zPTarget = pmdi !== null ? clamp(pmdi / 2.25, -2.6, 2.6) : 0;
  const volcCoolC =
    volcanicAod > 0.05 ? -clamp((volcanicAod - 0.04) * 5.2, 0, 2.2) : 0;
  const basePaleoDt =
    tempAnomC !== null
      ? tempSource === 'wnata'
        ? tempAnomC * 0.82
        : tempAnomC
      : null;
  const dTTarget =
    basePaleoDt !== null ? basePaleoDt + 0.45 * volcCoolC : volcCoolC;

  const yearRng = new SeededRNG(`${regionalSeedKey}:paleo:${year}`);

  if (analogBank.length >= 10) {
    let best1 = analogBank[0];
    let best2 = analogBank[1];
    let bestDist1 = Infinity;
    let bestDist2 = Infinity;

    for (const sample of analogBank) {
      const dp = sample.zP - zPTarget;
      const dt = (sample.dTJja - dTTarget) / 1.2;
      const dist = dp * dp + 0.35 * dt * dt;
      if (dist < bestDist1) {
        bestDist2 = bestDist1;
        best2 = best1;
        bestDist1 = dist;
        best1 = sample;
      } else if (dist < bestDist2) {
        bestDist2 = dist;
        best2 = sample;
      }
    }

    const w = yearRng.range(0.68, 0.86);
    const rawT: number[] = new Array(12);
    const rawP: number[] = new Array(12);
    let rawAnnualP = 0;

    for (let m = 0; m < 12; m++) {
      rawT[m] = w * best1.tempC[m] + (1 - w) * best2.tempC[m];
      const pBlend = w * best1.precipMm[m] + (1 - w) * best2.precipMm[m];
      const jitter = clamp(1 + yearRng.gaussian(0, 0.04), 0.85, 1.15);
      rawP[m] = Math.max(0, pBlend * jitter);
      rawAnnualP += rawP[m];
    }

    const cvAnnual = clamp(
      siteAnnualStdP / Math.max(20, siteMeanAnnualP),
      0.14,
      0.55
    );
    const targetAnnualP =
      siteMeanAnnualP *
      Math.exp(zPTarget * cvAnnual - 0.5 * cvAnnual * cvAnnual);
    const pScale = clamp(targetAnnualP / Math.max(1, rawAnnualP), 0.35, 2.4);

    const rawJja = (rawT[5] + rawT[6] + rawT[7]) / 3;
    const residualJjaShift = clamp(
      siteJjaMeanTemp + dTTarget - rawJja,
      -3.5,
      3.5
    );

    const tempC: number[] = new Array(12);
    const precipMm: number[] = new Array(12);
    for (let m = 0; m < 12; m++) {
      const seasonalWeight = m >= 3 && m <= 8 ? 1.0 : 0.55;
      tempC[m] =
        rawT[m] +
        residualJjaShift * seasonalWeight +
        yearRng.gaussian(0, 0.25);
      precipMm[m] = Math.max(0, rawP[m] * pScale);
    }

    return {
      year,
      tempC,
      precipMm,
      isSynthetic: false,
      provenance: 'paleo-atlas',
      volcanicAod: volcanicAod > 0 ? volcanicAod : undefined,
      pmdi: pmdi ?? undefined,
    };
  }

  // Conditioned stochastic disaggregation when no observed analogs exist (offline mode)
  const tempC: number[] = new Array(12);
  const precipMm: number[] = new Array(12);
  const preIndustrialOffset =
    basePaleoDt === null ? -clamp((1981 - year) * 0.004, 0, 0.45) : 0;

  for (let m = 0; m < 12; m++) {
    const seasonalWeight = m >= 3 && m <= 8 ? 1.0 : 0.55;
    tempC[m] =
      siteMeanTemp[m] +
      preIndustrialOffset +
      dTTarget * seasonalWeight +
      yearRng.gaussian(0, 0.65) * climStdTemp[m];

    const pZ = 0.72 * zPTarget + yearRng.gaussian(0, 0.55);
    const meanP = climMeanPrecip[m];
    const cv = clamp(climStdPrecip[m] / Math.max(1, meanP), 0.2, 1.35);
    const multiplier = Math.exp(pZ * cv * 0.78 - 0.22 * cv * cv);
    precipMm[m] = Math.max(0, meanP * multiplier);
  }

  return {
    year,
    tempC,
    precipMm,
    isSynthetic: false,
    provenance: 'paleo-atlas',
    volcanicAod: volcanicAod > 0 ? volcanicAod : undefined,
    pmdi: pmdi ?? undefined,
  };
}

function resolveYearVolcanicAod(
  atlas: ParsedClimateAtlas | null,
  year: number,
  latitude: number
): number {
  if (atlas && year >= atlas.volcStartYear && year <= atlas.volcEndYear) {
    const aodNh = atlas.volcAod[year - atlas.volcStartYear] / 500;
    return latitude >= 0
      ? aodNh
      : aodNh >= 0.18
        ? Number((aodNh * 0.55).toFixed(4))
        : 0;
  }
  return getVolcanicAod(year, latitude);
}

function assembleEnvironmentDataset(
  cachedTerrain: CachedTerrain,
  grid: CachedClimateGrid,
  atlas: ParsedClimateAtlas | null,
  latitude: number,
  longitude: number,
  startYear: number,
  endYear: number
): EnvironmentDataset {
  // If 90m DEM endpoint was unreachable, refine fallback elevation with reanalysis surface elevation
  const terrain: TerrainInfo =
    cachedTerrain.isFallback &&
    grid.gridElevationM !== null &&
    grid.gridElevationM >= 0
      ? {
          ...cachedTerrain.info,
          elevationM: Math.round(grid.gridElevationM),
        }
      : cachedTerrain.info;

  // Downscale coarse grid temperature to exact 90m DEM point elevation via environmental lapse rate
  const elevDeltaM =
    (grid.source === 'nasa-power-merra2' || grid.source === 'open-meteo-era5') &&
    grid.gridElevationM !== null &&
    !terrain.isWaterOrInvalid
      ? clamp(terrain.elevationM - grid.gridElevationM, -2200, 2200)
      : 0;
  const lapseOffsetC = -(elevDeltaM / 1000) * 5.5;

  const era5ElevDeltaM =
    grid.era5ElevationM !== null &&
    grid.era5ElevationM !== undefined &&
    !terrain.isWaterOrInvalid
      ? clamp(terrain.elevationM - grid.era5ElevationM, -2200, 2200)
      : 0;
  const era5LapseOffsetC = -(era5ElevDeltaM / 1000) * 5.5;

  // Compute monthly bias alignment between ERA5 and MERRA-2 over 1981-1990 overlap
  const era5DeltaT = new Array(12).fill(0);
  const era5ScaleP = new Array(12).fill(1);
  if (grid.era5Years && grid.observedYears.size > 0) {
    for (let m = 0; m < 12; m++) {
      let tDiffSum = 0;
      let tPairCount = 0;
      let obsPSum = 0;
      let eraPSum = 0;
      for (let y = 1981; y <= 1990; y++) {
        const obs = grid.observedYears.get(y);
        const era = grid.era5Years.get(y);
        if (obs?.validMonths[m] && era?.validMonths[m]) {
          tDiffSum += obs.tempC[m] + lapseOffsetC - (era.tempC[m] + era5LapseOffsetC);
          tPairCount++;
          obsPSum += obs.precipMm[m];
          eraPSum += era.precipMm[m];
        }
      }
      if (tPairCount >= 3) {
        era5DeltaT[m] = clamp(tDiffSum / tPairCount, -4.0, 4.0);
        era5ScaleP[m] = clamp((obsPSum + 5) / (eraPSum + 5), 0.55, 1.85);
      }
    }
  }

  const siteMeanTemp = grid.climMeanTemp.map((t) => t + lapseOffsetC);
  const siteJjaMeanTemp =
    (siteMeanTemp[5] + siteMeanTemp[6] + siteMeanTemp[7]) / 3;
  const siteMeanAnnualP = grid.climMeanPrecip.reduce((a, b) => a + b, 0);
  const regionalKey = buildRegionalClimateSeedKey(latitude, longitude);

  // Build observed analog bank (MERRA-2 1981+ and bias-aligned ERA5 1940-1980) for Method of Fragments
  const rawAnalogs: Array<{ year: number; tempC: number[]; precipMm: number[]; annualP: number; jjaT: number }> = [];
  for (const [y, obs] of grid.observedYears.entries()) {
    if (!obs.validMonths.every(Boolean)) continue;
    const tArr = obs.tempC.map((t) => t + lapseOffsetC);
    const pArr = obs.precipMm.slice();
    const annualP = pArr.reduce((a, b) => a + b, 0);
    const jjaT = (tArr[5] + tArr[6] + tArr[7]) / 3;
    rawAnalogs.push({ year: y, tempC: tArr, precipMm: pArr, annualP, jjaT });
  }
  if (grid.era5Years) {
    for (const [y, era] of grid.era5Years.entries()) {
      if (y > 1980 || !era.validMonths.every(Boolean)) continue;
      const tArr = era.tempC.map((t, m) => t + era5LapseOffsetC + era5DeltaT[m]);
      const pArr = era.precipMm.map((p, m) => Math.max(0, p * era5ScaleP[m]));
      const annualP = pArr.reduce((a, b) => a + b, 0);
      const jjaT = (tArr[5] + tArr[6] + tArr[7]) / 3;
      rawAnalogs.push({ year: y, tempC: tArr, precipMm: pArr, annualP, jjaT });
    }
  }

  let siteAnnualStdP = Math.max(
    25,
    Math.sqrt(
      grid.climStdPrecip.reduce((acc, s) => acc + s * s, 0)
    ) * 1.45
  );
  if (rawAnalogs.length >= 10) {
    const meanAnalogP =
      rawAnalogs.reduce((acc, a) => acc + a.annualP, 0) / rawAnalogs.length;
    const varAnalogP =
      rawAnalogs.reduce(
        (acc, a) => acc + (a.annualP - meanAnalogP) * (a.annualP - meanAnalogP),
        0
      ) / Math.max(1, rawAnalogs.length - 1);
    siteAnnualStdP = Math.max(siteMeanAnnualP * 0.14, Math.sqrt(varAnalogP));
  }

  const analogBank: AnalogYearSample[] = rawAnalogs.map((a) => ({
    year: a.year,
    tempC: a.tempC,
    precipMm: a.precipMm,
    zP: (a.annualP - siteMeanAnnualP) / Math.max(20, siteAnnualStdP),
    dTJja: a.jjaT - siteJjaMeanTemp,
  }));

  const years: MonthlyClimateYear[] = [];
  const tierSet = new Set<ClimateProvenance>();

  for (let y = startYear - 1; y <= endYear; y++) {
    const volcanicAod = resolveYearVolcanicAod(atlas, y, latitude);
    const obs = grid.observedYears.get(y);

    // Tier 1: NASA POWER MERRA-2 (1981+)
    if (obs && obs.validMonths.every(Boolean)) {
      const prov: ClimateProvenance = 'reanalysis-merra2';
      tierSet.add(prov);
      years.push({
        year: y,
        tempC: obs.tempC.map((t) => t + lapseOffsetC),
        precipMm: obs.precipMm.slice(),
        isSynthetic: false,
        provenance: prov,
        volcanicAod: volcanicAod > 0 ? volcanicAod : undefined,
      });
      continue;
    }

    // Tier 2: ECMWF ERA5 (1940-1980, or fallback when MERRA-2 absent)
    const era = grid.era5Years?.get(y);
    if (era && era.validMonths.every(Boolean)) {
      const prov: ClimateProvenance = 'reanalysis-era5';
      tierSet.add(prov);
      years.push({
        year: y,
        tempC: era.tempC.map((t, m) => t + era5LapseOffsetC + era5DeltaT[m]),
        precipMm: era.precipMm.map((p, m) => Math.max(0, p * era5ScaleP[m])),
        isSynthetic: false,
        provenance: prov,
        volcanicAod: volcanicAod > 0 ? volcanicAod : undefined,
      });
      continue;
    }

    // Partial current calendar year in MERRA-2: splice observed months + deterministic remainder
    if (obs && obs.validMonths.some(Boolean)) {
      const synth = synthesizeClimateYear(
        y,
        latitude,
        regionalKey,
        siteMeanTemp,
        grid.climStdTemp,
        grid.climMeanPrecip,
        grid.climStdPrecip,
        volcanicAod
      );
      const tempC = obs.tempC.map((t, m) =>
        obs.validMonths[m] ? t + lapseOffsetC : synth.tempC[m]
      );
      const precipMm = obs.precipMm.map((p, m) =>
        obs.validMonths[m] ? p : synth.precipMm[m]
      );
      const prov: ClimateProvenance = 'reanalysis-merra2';
      tierSet.add(prov);
      years.push({
        year: y,
        tempC,
        precipMm,
        isSynthetic: false,
        provenance: prov,
        volcanicAod: volcanicAod > 0 ? volcanicAod : undefined,
      });
      continue;
    }

    // Tier 3: NOAA nClimDiv Monthly Instrumental (1895-1980)
    const nclim = atlas
      ? queryNClimDivMonthly(atlas, latitude, longitude, y)
      : null;
    if (nclim) {
      const prov: ClimateProvenance = 'instrumental-nclimdiv';
      tierSet.add(prov);
      years.push({
        year: y,
        tempC: siteMeanTemp.map((t, m) => t + nclim.tempAnomC[m]),
        precipMm: grid.climMeanPrecip.map((p, m) =>
          Math.max(0, p * nclim.precipMultiplier[m])
        ),
        isSynthetic: false,
        provenance: prov,
        volcanicAod: volcanicAod > 0 ? volcanicAod : undefined,
      });
      continue;
    }

    // Tier 4: Paleoclimate Atlas (LBDA v2 PMDI + WNATA/N-TREND Temp + Crowley Volcanic AOD)
    const paleo = atlas ? queryPaleoYear(atlas, latitude, longitude, y) : null;
    if (paleo) {
      tierSet.add('paleo-atlas');
      years.push(
        reconstructPaleoClimateYear(
          y,
          regionalKey,
          siteMeanTemp,
          grid.climStdTemp,
          grid.climMeanPrecip,
          grid.climStdPrecip,
          siteJjaMeanTemp,
          siteMeanAnnualP,
          siteAnnualStdP,
          analogBank,
          paleo.pmdi,
          paleo.tempAnomC,
          paleo.tempSource,
          paleo.volcanicAod
        )
      );
      continue;
    }

    // Tier 5: Synthetic Fallback (with Crowley volcanic cooling when applicable)
    tierSet.add('synthetic');
    years.push(
      synthesizeClimateYear(
        y,
        latitude,
        regionalKey,
        siteMeanTemp,
        grid.climStdTemp,
        grid.climMeanPrecip,
        grid.climStdPrecip,
        volcanicAod
      )
    );
  }

  const meanAnnualTempC = siteMeanTemp.reduce((a, b) => a + b, 0) / 12;
  const meanAnnualPrecipMm = siteMeanAnnualP;
  const jjaPrecip =
    grid.climMeanPrecip[5] + grid.climMeanPrecip[6] + grid.climMeanPrecip[7];
  const summerPrecipShare = jjaPrecip / Math.max(1, meanAnnualPrecipMm);

  return {
    terrain,
    years,
    source: grid.source,
    hasHistoricalLayers: Boolean(grid.era5Attempted || atlas !== null),
    provenanceTiers: Array.from(tierSet),
    meanAnnualTempC,
    meanAnnualPrecipMm,
    summerPrecipShare,
  };
}

/**
 * Synchronously builds the EnvironmentDataset if both terrain and climate cells
 * for (latitude, longitude) are already in memory cache, enabling 0ms updates
 * when dragging the age slider or switching presets.
 */
export function getCachedEnvironmentDataset(
  latitude: number,
  longitude: number,
  startYear: number,
  endYear: number
): EnvironmentDataset | null {
  const cachedTerrain = terrainCache.get(terrainCacheKey(latitude, longitude));
  const cachedClimate = climateCache.get(climateCacheKey(latitude, longitude));
  if (!cachedTerrain || !cachedClimate) {
    return null;
  }
  return assembleEnvironmentDataset(
    cachedTerrain,
    cachedClimate,
    getLoadedClimateAtlas(),
    latitude,
    longitude,
    startYear,
    endYear
  );
}

/**
 * Builds complete annual monthly climate series covering [startYear - 1 .. endYear]
 * (including one prior year for soil-moisture and carbohydrate carryover initialization).
 * Runs terrain, MERRA-2, ERA5, and static paleoclimate atlas requests in parallel
 * with strict timeouts and deterministic offline fallbacks so loading never hangs.
 */
export async function loadEnvironmentDataset(
  latitude: number,
  longitude: number,
  startYear: number,
  endYear: number
): Promise<EnvironmentDataset> {
  const needsHistorical = startYear - 1 < 1981;
  const tKey = terrainCacheKey(latitude, longitude);
  const cKey = climateCacheKey(latitude, longitude);

  const existingTerrain = terrainCache.get(tKey);
  const existingClimate = climateCache.get(cKey);
  const existingAtlas = getLoadedClimateAtlas();

  const needTerrain = !existingTerrain;
  const needNasa =
    !existingClimate ||
    Boolean(existingClimate.isSeedPlaceholder) ||
    !existingClimate.nasaAttempted;
  const needEra5 =
    needsHistorical &&
    endYear >= 1940 &&
    !(existingClimate?.era5Attempted ?? false);
  const needAtlas =
    needsHistorical && !existingAtlas && !hasAttemptedClimateAtlasLoad();

  if (!needTerrain && !needNasa && !needEra5 && !needAtlas && existingTerrain && existingClimate) {
    return assembleEnvironmentDataset(
      existingTerrain,
      existingClimate,
      existingAtlas,
      latitude,
      longitude,
      startYear,
      endYear
    );
  }

  const [cachedTerrain, nasaGrid, era5Result, atlas] = await Promise.all([
    needTerrain
      ? fetchTerrainCached(latitude, longitude)
      : Promise.resolve(existingTerrain!),
    needNasa
      ? fetchNasaPowerClimate(latitude, longitude)
      : Promise.resolve(existingClimate ?? null),
    needEra5
      ? fetchOpenMeteoEra5Climate(latitude, longitude)
      : Promise.resolve(
          existingClimate?.era5Years
            ? {
                years: existingClimate.era5Years,
                elevationM: existingClimate.era5ElevationM ?? null,
              }
            : null
        ),
    needAtlas
      ? loadClimateAtlas(ATLAS_TIMEOUT_MS)
      : Promise.resolve(existingAtlas),
  ]);

  let grid: CachedClimateGrid | null = nasaGrid;
  if (!grid && existingClimate && !existingClimate.isSeedPlaceholder) {
    grid = existingClimate;
  }

  if (!grid && era5Result) {
    const eraStats = computeClimatologyStats(era5Result.years);
    if (eraStats) {
      grid = {
        observedYears: new Map(),
        climMeanTemp: eraStats.climMeanTemp,
        climStdTemp: eraStats.climStdTemp,
        climMeanPrecip: eraStats.climMeanPrecip,
        climStdPrecip: eraStats.climStdPrecip,
        gridElevationM: era5Result.elevationM,
        source: 'open-meteo-era5',
        isSeedPlaceholder: false,
        nasaAttempted: true,
        era5Years: era5Result.years,
        era5ElevationM: era5Result.elevationM,
        era5Attempted: true,
      };
      climateCache.set(cKey, grid);
    }
  }

  if (!grid) {
    if (existingClimate?.isSeedPlaceholder) {
      grid = {
        ...existingClimate,
        isSeedPlaceholder: false,
        nasaAttempted: true,
      };
    } else {
      grid = buildOfflineClimatology(
        latitude,
        longitude,
        cachedTerrain.info.elevationM
      );
    }
    climateCache.set(cKey, grid);
  }

  if (needEra5) {
    grid.era5Attempted = true;
    if (era5Result) {
      grid.era5Years = era5Result.years;
      grid.era5ElevationM = era5Result.elevationM;
    }
  }

  return assembleEnvironmentDataset(
    cachedTerrain,
    grid,
    atlas,
    latitude,
    longitude,
    startYear,
    endYear
  );
}
