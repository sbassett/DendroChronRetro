import {
  buildRegionalClimateSeedKey,
  SeededRNG,
} from '../model/prng';
import {
  EnvironmentDataset,
  MonthlyClimateYear,
  TerrainInfo,
} from '../model/types';

interface CachedEra5 {
  observedYears: Map<number, { tempC: number[]; precipMm: number[]; monthCounts: number[] }>;
  climMeanTemp: number[];
  climStdTemp: number[];
  climMeanPrecip: number[];
  climStdPrecip: number[];
  source: 'open-meteo-era5' | 'offline-climatology';
}

const terrainCache = new Map<string, TerrainInfo>();
const climateCache = new Map<string, CachedEra5>();

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Fetches 5-point 90m DEM elevation stencil from Open-Meteo to compute
 * exact local elevation, slope angle, and aspect (downhill compass direction).
 */
export async function fetchTerrainInfo(
  lat: number,
  lon: number
): Promise<TerrainInfo> {
  const key = `${lat.toFixed(4)}:${lon.toFixed(4)}`;
  const cached = terrainCache.get(key);
  if (cached) return cached;

  const dLat = 0.00081; // ~90m North/South
  const cosLat = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
  const dLon = 0.00081 / cosLat; // ~90m East/West

  const lats = [lat, lat + dLat, lat - dLat, lat, lat]
    .map((v) => clamp(v, -89.99, 89.99).toFixed(5))
    .join(',');
  const lons = [lon, lon, lon, lon + dLon, lon - dLon]
    .map((v) => ((((v + 180) % 360) + 360) % 360 - 180).toFixed(5))
    .join(',');

  try {
    const resp = await fetch(
      `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`
    );
    if (!resp.ok) throw new Error(`Elevation HTTP ${resp.status}`);
    const data = (await resp.json()) as { elevation?: number[] };
    const el = data.elevation;
    if (!el || el.length < 5 || el.some((x) => typeof x !== 'number' || Number.isNaN(x))) {
      throw new Error('Malformed elevation response');
    }

    const [zC, zN, zS, zE, zW] = el;
    // Open-Meteo returns 0 across all 5 stencil points over open ocean
    const allZero =
      zC === 0 && zN === 0 && zS === 0 && zE === 0 && zW === 0;

    const dzDx = (zE - zW) / 180.0; // Eastward rise per meter
    const dzDy = (zN - zS) / 180.0; // Northward rise per meter
    const slopeRad = Math.atan(Math.hypot(dzDx, dzDy));
    const slopeDeg = (slopeRad * 180) / Math.PI;

    // Downhill vector is (-dzDx, -dzDy). Compass azimuth: 0=N, 90=E, 180=S, 270=W
    let aspectDeg = (Math.atan2(-dzDx, -dzDy) * 180) / Math.PI;
    if (aspectDeg < 0) aspectDeg += 360;

    const info: TerrainInfo = {
      elevationM: zC,
      slopeDeg,
      aspectDeg: slopeDeg < 0.25 ? 180 : aspectDeg,
      isWaterOrInvalid: allZero,
    };
    terrainCache.set(key, info);
    return info;
  } catch {
    // Deterministic procedural fallback if offline
    const fallbackRng = new SeededRNG(`terrain:${lat.toFixed(4)}:${lon.toFixed(4)}`);
    const estElev = Math.max(50, 900 - Math.abs(lat - 42) * 28 + fallbackRng.range(-200, 450));
    const info: TerrainInfo = {
      elevationM: Math.round(estElev),
      slopeDeg: fallbackRng.range(2, 18),
      aspectDeg: fallbackRng.range(0, 360),
      isWaterOrInvalid: false,
    };
    terrainCache.set(key, info);
    return info;
  }
}

/**
 * Computes deterministic offline baseline climatology if network/API is unreachable.
 */
function buildOfflineClimatology(lat: number, lon: number, elevationM: number): CachedEra5 {
  const absLat = Math.abs(lat);
  const hemisphereSign = lat >= 0 ? 1 : -1;
  // Approximate lapse-adjusted annual mean temperature
  const seaLevelMeanT = 27.5 - 0.56 * absLat;
  const meanAnnualT = seaLevelMeanT - (elevationM / 1000) * 5.8;
  const seasonalAmp = clamp(4 + 0.28 * absLat, 5, 19);

  // Maritime vs interior Western US approximation
  const isMaritimeWest = lon < -121.8 && lat > 37 && lat < 52;
  const baseAnnualPrecip = isMaritimeWest ? 1650 : clamp(580 - (absLat - 42) * 8 + elevationM * 0.22, 220, 1400);

  const climMeanTemp: number[] = [];
  const climStdTemp: number[] = [];
  const climMeanPrecip: number[] = [];
  const climStdPrecip: number[] = [];

  for (let m = 0; m < 12; m++) {
    // Peak summer in July (m=6) in Northern Hemisphere
    const phase = ((m - 6) / 12) * 2 * Math.PI * hemisphereSign;
    climMeanTemp.push(meanAnnualT + seasonalAmp * Math.cos(phase));
    climStdTemp.push(1.6 + (m <= 2 || m >= 10 ? 0.8 : 0.2));

    const winterWeight = 1 + 0.55 * Math.cos(((m - 0.5) / 12) * 2 * Math.PI * hemisphereSign);
    const monsoonBump = lat < 38 && lon > -114 && (m === 6 || m === 7) ? 1.55 : 1.0;
    const rawShare = (isMaritimeWest ? winterWeight : 0.85 + 0.2 * winterWeight) * monsoonBump;
    climMeanPrecip.push((baseAnnualPrecip / 12) * rawShare);
    climStdPrecip.push(((baseAnnualPrecip / 12) * rawShare) * 0.48);
  }

  return {
    observedYears: new Map(),
    climMeanTemp,
    climStdTemp,
    climMeanPrecip,
    climStdPrecip,
    source: 'offline-climatology',
  };
}

async function fetchBaseClimateGrid(
  lat: number,
  lon: number,
  elevationM: number
): Promise<CachedEra5> {
  // ~2.2km ERA5 cache cell
  const cacheKey = `${lat.toFixed(2)}:${lon.toFixed(2)}`;
  const hit = climateCache.get(cacheKey);
  if (hit) return hit;

  const safeEnd = new Date(Date.now() - 9 * 86400_000);
  const endDateStr = safeEnd.toISOString().slice(0, 10);

  try {
    const url =
      `https://archive-api.open-meteo.com/v1/archive` +
      `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&start_date=1940-01-01&end_date=${endDateStr}` +
      `&daily=temperature_2m_mean,precipitation_sum&timezone=UTC`;

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Archive HTTP ${resp.status}`);
    const json = (await resp.json()) as {
      daily?: {
        time?: string[];
        temperature_2m_mean?: Array<number | null>;
        precipitation_sum?: Array<number | null>;
      };
    };

    const times = json.daily?.time;
    const temps = json.daily?.temperature_2m_mean;
    const precips = json.daily?.precipitation_sum;
    if (!times || !temps || !precips || times.length < 365) {
      throw new Error('Incomplete ERA5 archive payload');
    }

    const accum = new Map<
      number,
      { tempSum: number[]; tempDays: number[]; precipSum: number[]; precipDays: number[] }
    >();

    for (let i = 0; i < times.length; i++) {
      const dateStr = times[i];
      const y = Number(dateStr.slice(0, 4));
      const m = Number(dateStr.slice(5, 7)) - 1;
      let rec = accum.get(y);
      if (!rec) {
        rec = {
          tempSum: new Array(12).fill(0),
          tempDays: new Array(12).fill(0),
          precipSum: new Array(12).fill(0),
          precipDays: new Array(12).fill(0),
        };
        accum.set(y, rec);
      }
      const tVal = temps[i];
      const pVal = precips[i];
      if (tVal !== null && tVal !== undefined && !Number.isNaN(tVal)) {
        rec.tempSum[m] += tVal;
        rec.tempDays[m] += 1;
      }
      if (pVal !== null && pVal !== undefined && !Number.isNaN(pVal)) {
        rec.precipSum[m] += pVal;
        rec.precipDays[m] += 1;
      }
    }

    const observedYears = new Map<
      number,
      { tempC: number[]; precipMm: number[]; monthCounts: number[] }
    >();

    // Collect complete years (1940..last complete calendar year) for baseline climatology
    const monthTempSamples: number[][] = Array.from({ length: 12 }, () => []);
    const monthPrecipSamples: number[][] = Array.from({ length: 12 }, () => []);

    for (const [y, rec] of accum.entries()) {
      const tempC = new Array(12).fill(0);
      const precipMm = new Array(12).fill(0);
      for (let m = 0; m < 12; m++) {
        if (rec.tempDays[m] >= 20) {
          tempC[m] = rec.tempSum[m] / rec.tempDays[m];
          // Scale partial month precip slightly if 20..27 days
          const fullDays = m === 1 ? 28.25 : [3, 5, 8, 10].includes(m) ? 30 : 31;
          precipMm[m] =
            rec.precipDays[m] >= 27
              ? rec.precipSum[m]
              : (rec.precipSum[m] / rec.precipDays[m]) * fullDays;

          if (y >= 1940 && y <= 2025) {
            monthTempSamples[m].push(tempC[m]);
            monthPrecipSamples[m].push(precipMm[m]);
          }
        }
      }
      observedYears.set(y, {
        tempC,
        precipMm,
        monthCounts: rec.tempDays,
      });
    }

    const climMeanTemp: number[] = [];
    const climStdTemp: number[] = [];
    const climMeanPrecip: number[] = [];
    const climStdPrecip: number[] = [];

    for (let m = 0; m < 12; m++) {
      const tArr = monthTempSamples[m];
      const pArr = monthPrecipSamples[m];
      const tMean = tArr.reduce((a, b) => a + b, 0) / Math.max(1, tArr.length);
      const pMean = pArr.reduce((a, b) => a + b, 0) / Math.max(1, pArr.length);
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

    const result: CachedEra5 = {
      observedYears,
      climMeanTemp,
      climStdTemp,
      climMeanPrecip,
      climStdPrecip,
      source: 'open-meteo-era5',
    };
    climateCache.set(cacheKey, result);
    return result;
  } catch {
    const fallback = buildOfflineClimatology(lat, lon, elevationM);
    climateCache.set(cacheKey, fallback);
    return fallback;
  }
}

/**
 * Generates a deterministic synthetic monthly climate record for any year outside
 * the instrumental ERA5 archive (e.g., pre-1940), preserving regional PDO/ENSO
 * multi-decadal drought waves so nearby trees cross-date authentically.
 */
function synthesizeClimateYear(
  year: number,
  regionalSeedKey: string,
  era: CachedEra5
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

  // Pre-industrial cooler baseline adjustment prior to 1940 (~ -0.35 to -0.6 C)
  const preIndustrialOffset = year < 1940 ? -clamp((1945 - year) * 0.0055, 0, 0.65) : 0;

  const tempC: number[] = [];
  const precipMm: number[] = [];

  for (let m = 0; m < 12; m++) {
    const tZ = 0.55 * annualTempShock + yearRng.gaussian(0, 0.82);
    tempC.push(era.climMeanTemp[m] + preIndustrialOffset + tZ * era.climStdTemp[m]);

    // Gamma/lognormal-like skewed precipitation so droughts stay >= 0 and wet months tail upward
    const pZ = 0.6 * annualMoistureShock + yearRng.gaussian(0, 0.8);
    const meanP = era.climMeanPrecip[m];
    const cv = clamp(era.climStdPrecip[m] / Math.max(1, meanP), 0.2, 1.35);
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

/**
 * Builds complete annual monthly climate series covering [startYear - 1 .. endYear]
 * (including one prior year for soil-moisture and carbohydrate carryover initialization).
 */
export async function loadEnvironmentDataset(
  latitude: number,
  longitude: number,
  startYear: number,
  endYear: number
): Promise<EnvironmentDataset> {
  const terrain = await fetchTerrainInfo(latitude, longitude);
  const era = await fetchBaseClimateGrid(latitude, longitude, terrain.elevationM);
  const regionalKey = buildRegionalClimateSeedKey(latitude, longitude);

  const years: MonthlyClimateYear[] = [];
  for (let y = startYear - 1; y <= endYear; y++) {
    const obs = era.observedYears.get(y);
    if (obs && obs.monthCounts.every((c) => c >= 20)) {
      years.push({
        year: y,
        tempC: obs.tempC.slice(),
        precipMm: obs.precipMm.slice(),
        isSynthetic: false,
      });
    } else if (obs && obs.monthCounts.some((c) => c >= 20)) {
      // Partial year (e.g. current year missing Nov/Dec): splice observed + deterministic synthesis
      const synth = synthesizeClimateYear(y, regionalKey, era);
      const tempC = obs.tempC.map((v, m) => (obs.monthCounts[m] >= 20 ? v : synth.tempC[m]));
      const precipMm = obs.precipMm.map((v, m) =>
        obs.monthCounts[m] >= 20 ? v : synth.precipMm[m]
      );
      years.push({
        year: y,
        tempC,
        precipMm,
        isSynthetic: false,
      });
    } else {
      years.push(synthesizeClimateYear(y, regionalKey, era));
    }
  }

  const meanAnnualTempC =
    era.climMeanTemp.reduce((a, b) => a + b, 0) / 12;
  const meanAnnualPrecipMm =
    era.climMeanPrecip.reduce((a, b) => a + b, 0);
  const jjaPrecip = era.climMeanPrecip[5] + era.climMeanPrecip[6] + era.climMeanPrecip[7];
  const summerPrecipShare = jjaPrecip / Math.max(1, meanAnnualPrecipMm);

  return {
    terrain,
    years,
    source: era.source,
    meanAnnualTempC,
    meanAnnualPrecipMm,
    summerPrecipShare,
  };
}
