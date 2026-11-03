import {
  buildRegionalClimateSeedKey,
  SeededRNG,
} from '../model/prng';
import {
  EnvironmentDataset,
  MonthlyClimateYear,
  TerrainInfo,
} from '../model/types';

const TERRAIN_TIMEOUT_MS = 3500;
const CLIMATE_TIMEOUT_MS = 4500;

interface CachedTerrain {
  info: TerrainInfo;
  isFallback: boolean;
}

interface ObservedYearRecord {
  tempC: number[];
  precipMm: number[];
  validMonths: boolean[];
}

interface CachedClimateGrid {
  observedYears: Map<number, ObservedYearRecord>;
  climMeanTemp: number[];
  climStdTemp: number[];
  climMeanPrecip: number[];
  climStdPrecip: number[];
  gridElevationM: number | null;
  source: EnvironmentDataset['source'];
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

const terrainCache = new Map<string, CachedTerrain>();
const terrainInFlight = new Map<string, Promise<CachedTerrain>>();

const climateCache = new Map<string, CachedClimateGrid>();
const climateInFlight = new Map<string, Promise<CachedClimateGrid | null>>();

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
  const seaLevelMeanT = 27.5 - 0.56 * absLat;
  const meanAnnualT = seaLevelMeanT - (elevationM / 1000) * 5.8;
  const seasonalAmp = clamp(4 + 0.28 * absLat, 5, 19);

  const isMaritimeWest = lon < -121.8 && lat > 37 && lat < 52;
  const baseAnnualPrecip = isMaritimeWest
    ? 1650
    : clamp(580 - (absLat - 42) * 8 + elevationM * 0.22, 220, 1400);

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
  };
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
  if (hit) return hit;

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
      const monthTempSamples: number[][] = Array.from({ length: 12 }, () => []);
      const monthPrecipSamples: number[][] = Array.from({ length: 12 }, () => []);

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

        monthTempSamples[m].push(tVal);
        monthPrecipSamples[m].push(pTotalMm);
      }

      if (monthTempSamples.some((arr) => arr.length < 5)) {
        throw new Error('Insufficient NASA POWER monthly history');
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

      const resolved: CachedClimateGrid = {
        observedYears,
        climMeanTemp,
        climStdTemp,
        climMeanPrecip,
        climStdPrecip,
        gridElevationM,
        source: 'nasa-power-merra2',
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
 * Generates a deterministic synthetic monthly climate record for any year outside
 * the observed satellite/instrumental archive (e.g., pre-1981), preserving regional
 * PDO/ENSO multi-decadal drought waves so nearby trees cross-date authentically.
 */
function synthesizeClimateYear(
  year: number,
  regionalSeedKey: string,
  climMeanTemp: number[],
  climStdTemp: number[],
  climMeanPrecip: number[],
  climStdPrecip: number[]
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

  const tempC: number[] = [];
  const precipMm: number[] = [];

  for (let m = 0; m < 12; m++) {
    const tZ = 0.55 * annualTempShock + yearRng.gaussian(0, 0.82);
    tempC.push(climMeanTemp[m] + preIndustrialOffset + tZ * climStdTemp[m]);

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
  };
}

function assembleEnvironmentDataset(
  cachedTerrain: CachedTerrain,
  grid: CachedClimateGrid,
  latitude: number,
  longitude: number,
  startYear: number,
  endYear: number
): EnvironmentDataset {
  // If 90m DEM endpoint was unreachable, refine fallback elevation with MERRA-2 surface elevation
  const terrain: TerrainInfo =
    cachedTerrain.isFallback &&
    grid.gridElevationM !== null &&
    grid.gridElevationM >= 0
      ? {
          ...cachedTerrain.info,
          elevationM: Math.round(grid.gridElevationM),
        }
      : cachedTerrain.info;

  // Downscale coarse ~50km MERRA-2 temperature to exact 90m DEM point elevation via environmental lapse rate
  const elevDeltaM =
    grid.source === 'nasa-power-merra2' &&
    grid.gridElevationM !== null &&
    !terrain.isWaterOrInvalid
      ? clamp(terrain.elevationM - grid.gridElevationM, -2200, 2200)
      : 0;
  const lapseOffsetC = -(elevDeltaM / 1000) * 5.5;

  const siteMeanTemp = grid.climMeanTemp.map((t) => t + lapseOffsetC);
  const regionalKey = buildRegionalClimateSeedKey(latitude, longitude);

  const years: MonthlyClimateYear[] = [];
  for (let y = startYear - 1; y <= endYear; y++) {
    const obs = grid.observedYears.get(y);
    if (obs && obs.validMonths.every(Boolean)) {
      years.push({
        year: y,
        tempC: obs.tempC.map((t) => t + lapseOffsetC),
        precipMm: obs.precipMm.slice(),
        isSynthetic: false,
      });
    } else if (obs && obs.validMonths.some(Boolean)) {
      // Partial current calendar year: splice observed months + deterministic synthesis for remaining months
      const synth = synthesizeClimateYear(
        y,
        regionalKey,
        siteMeanTemp,
        grid.climStdTemp,
        grid.climMeanPrecip,
        grid.climStdPrecip
      );
      const tempC = obs.tempC.map((t, m) =>
        obs.validMonths[m] ? t + lapseOffsetC : synth.tempC[m]
      );
      const precipMm = obs.precipMm.map((p, m) =>
        obs.validMonths[m] ? p : synth.precipMm[m]
      );
      years.push({
        year: y,
        tempC,
        precipMm,
        isSynthetic: false,
      });
    } else {
      years.push(
        synthesizeClimateYear(
          y,
          regionalKey,
          siteMeanTemp,
          grid.climStdTemp,
          grid.climMeanPrecip,
          grid.climStdPrecip
        )
      );
    }
  }

  const meanAnnualTempC = siteMeanTemp.reduce((a, b) => a + b, 0) / 12;
  const meanAnnualPrecipMm = grid.climMeanPrecip.reduce((a, b) => a + b, 0);
  const jjaPrecip =
    grid.climMeanPrecip[5] + grid.climMeanPrecip[6] + grid.climMeanPrecip[7];
  const summerPrecipShare = jjaPrecip / Math.max(1, meanAnnualPrecipMm);

  return {
    terrain,
    years,
    source: grid.source,
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
    latitude,
    longitude,
    startYear,
    endYear
  );
}

/**
 * Builds complete annual monthly climate series covering [startYear - 1 .. endYear]
 * (including one prior year for soil-moisture and carbohydrate carryover initialization).
 * Runs terrain and climate network requests in parallel with strict timeouts and
 * deterministic offline fallbacks so loading never hangs.
 */
export async function loadEnvironmentDataset(
  latitude: number,
  longitude: number,
  startYear: number,
  endYear: number
): Promise<EnvironmentDataset> {
  const syncHit = getCachedEnvironmentDataset(
    latitude,
    longitude,
    startYear,
    endYear
  );
  if (syncHit) return syncHit;

  const [cachedTerrain, nasaGrid] = await Promise.all([
    fetchTerrainCached(latitude, longitude),
    fetchNasaPowerClimate(latitude, longitude),
  ]);

  let grid = nasaGrid;
  if (!grid) {
    grid = buildOfflineClimatology(
      latitude,
      longitude,
      cachedTerrain.info.elevationM
    );
    climateCache.set(climateCacheKey(latitude, longitude), grid);
  }

  return assembleEnvironmentDataset(
    cachedTerrain,
    grid,
    latitude,
    longitude,
    startYear,
    endYear
  );
}
