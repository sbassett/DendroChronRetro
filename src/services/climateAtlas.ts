import { getVolcanicAod } from '../model/volcanicForcing';

const ATLAS_MAGIC = 'XYCA';
const ATLAS_HEADER_BYTES = 64;
const MISSING_I8 = -128;

export interface ParsedClimateAtlas {
  nclimStartYear: number;
  nclimEndYear: number;
  numDivisions: number;
  divGridRows: number;
  divGridCols: number;
  divLatMin: number;
  divLonMin: number;
  paleoLatMin: number;
  paleoLonMin: number;
  paleoRows: number;
  paleoCols: number;
  numLbdaCells: number;
  lbdaStartYear: number;
  lbdaEndYear: number;
  numWnataCells: number;
  wnataStartYear: number;
  wnataEndYear: number;
  ntrendStartYear: number;
  ntrendEndYear: number;
  volcStartYear: number;
  volcEndYear: number;
  divIds: Uint16Array;
  divCentroidsLatX100: Int16Array;
  divCentroidsLonX100: Int16Array;
  lbdaCellMap: Int16Array;
  wnataCellMap: Int16Array;
  divMap: Uint8Array;
  nclimTempAnom: Int8Array;
  nclimPrecipLogRatio: Int8Array;
  lbdaPmdi: Int8Array;
  wnataTempAnom: Int8Array;
  ntrendTempAnom: Int8Array;
  volcAod: Uint8Array;
}

export interface NClimDivMonthlyAnomaly {
  tempAnomC: number[];
  precipMultiplier: number[];
  divisionCode: number;
}

export interface PaleoYearQueryResult {
  pmdi: number | null;
  tempAnomC: number | null;
  tempSource: 'wnata' | 'ntrend' | null;
  volcanicAod: number;
}

let cachedAtlas: ParsedClimateAtlas | null = null;
let atlasInFlight: Promise<ParsedClimateAtlas | null> | null = null;
let atlasLoadAttempted = false;

/**
 * Parses a raw ArrayBuffer or Uint8Array containing the XYCA v1 binary climate atlas.
 */
export function parseClimateAtlasBuffer(
  input: ArrayBuffer | ArrayBufferView
): ParsedClimateAtlas {
  let buffer: ArrayBuffer;
  if (input instanceof ArrayBuffer) {
    buffer = input;
  } else {
    // Copy slice if byteOffset is not 2-byte aligned or backing buffer is shared (e.g. Node Buffer pool)
    buffer = input.buffer.slice(
      input.byteOffset,
      input.byteOffset + input.byteLength
    );
  }

  if (buffer.byteLength < ATLAS_HEADER_BYTES) {
    throw new Error(`Climate atlas too small (${buffer.byteLength} bytes)`);
  }

  const headerBytes = new Uint8Array(buffer, 0, 4);
  const magic = String.fromCharCode(
    headerBytes[0],
    headerBytes[1],
    headerBytes[2],
    headerBytes[3]
  );
  if (magic !== ATLAS_MAGIC) {
    throw new Error(`Invalid climate atlas magic: ${magic}`);
  }

  const dv = new DataView(buffer);
  const version = dv.getUint16(4, true);
  if (version !== 1) {
    throw new Error(`Unsupported climate atlas version: ${version}`);
  }

  const nclimStartYear = dv.getInt16(8, true);
  const nclimEndYear = dv.getInt16(10, true);
  const numDivisions = dv.getUint16(12, true);
  const divGridRows = dv.getUint16(14, true);
  const divGridCols = dv.getUint16(16, true);
  const divLatMin = dv.getInt16(18, true) / 10;
  const divLonMin = dv.getInt16(20, true) / 10;
  const paleoLatMin = dv.getInt16(22, true) / 10;
  const paleoLonMin = dv.getInt16(24, true) / 10;
  const paleoRows = dv.getUint16(26, true);
  const paleoCols = dv.getUint16(28, true);
  const numLbdaCells = dv.getUint16(30, true);
  const lbdaStartYear = dv.getInt16(32, true);
  const lbdaEndYear = dv.getInt16(34, true);
  const numWnataCells = dv.getUint16(36, true);
  const wnataStartYear = dv.getInt16(38, true);
  const wnataEndYear = dv.getInt16(40, true);
  const ntrendStartYear = dv.getInt16(42, true);
  const ntrendEndYear = dv.getInt16(44, true);
  const volcStartYear = dv.getInt16(46, true);
  const volcEndYear = dv.getInt16(48, true);

  const nclimYears = nclimEndYear - nclimStartYear + 1;
  const lbdaYears = lbdaEndYear - lbdaStartYear + 1;
  const wnataYears = wnataEndYear - wnataStartYear + 1;
  const ntrendYears = ntrendEndYear - ntrendStartYear + 1;
  const volcYears = volcEndYear - volcStartYear + 1;
  const divGridLen = divGridRows * divGridCols;
  const paleoGridLen = paleoRows * paleoCols;

  const expectedBytes =
    ATLAS_HEADER_BYTES +
    numDivisions * 2 +
    numDivisions * 2 +
    numDivisions * 2 +
    paleoGridLen * 2 +
    paleoGridLen * 2 +
    divGridLen +
    numDivisions * nclimYears * 12 +
    numDivisions * nclimYears * 12 +
    numLbdaCells * lbdaYears +
    numWnataCells * wnataYears +
    ntrendYears +
    volcYears;

  if (buffer.byteLength !== expectedBytes) {
    throw new Error(
      `Climate atlas byte size mismatch: expected ${expectedBytes}, got ${buffer.byteLength}`
    );
  }

  let off = ATLAS_HEADER_BYTES;
  const takeU16 = (count: number) => {
    const view = new Uint16Array(buffer, off, count);
    off += count * 2;
    return view;
  };
  const takeI16 = (count: number) => {
    const view = new Int16Array(buffer, off, count);
    off += count * 2;
    return view;
  };
  const takeU8 = (count: number) => {
    const view = new Uint8Array(buffer, off, count);
    off += count;
    return view;
  };
  const takeI8 = (count: number) => {
    const view = new Int8Array(buffer, off, count);
    off += count;
    return view;
  };

  const divIds = takeU16(numDivisions);
  const divCentroidsLatX100 = takeI16(numDivisions);
  const divCentroidsLonX100 = takeI16(numDivisions);
  const lbdaCellMap = takeI16(paleoGridLen);
  const wnataCellMap = takeI16(paleoGridLen);

  const divMap = takeU8(divGridLen);
  const nclimTempAnom = takeI8(numDivisions * nclimYears * 12);
  const nclimPrecipLogRatio = takeI8(numDivisions * nclimYears * 12);
  const lbdaPmdi = takeI8(numLbdaCells * lbdaYears);
  const wnataTempAnom = takeI8(numWnataCells * wnataYears);
  const ntrendTempAnom = takeI8(ntrendYears);
  const volcAod = takeU8(volcYears);

  return {
    nclimStartYear,
    nclimEndYear,
    numDivisions,
    divGridRows,
    divGridCols,
    divLatMin,
    divLonMin,
    paleoLatMin,
    paleoLonMin,
    paleoRows,
    paleoCols,
    numLbdaCells,
    lbdaStartYear,
    lbdaEndYear,
    numWnataCells,
    wnataStartYear,
    wnataEndYear,
    ntrendStartYear,
    ntrendEndYear,
    volcStartYear,
    volcEndYear,
    divIds,
    divCentroidsLatX100,
    divCentroidsLonX100,
    lbdaCellMap,
    wnataCellMap,
    divMap,
    nclimTempAnom,
    nclimPrecipLogRatio,
    lbdaPmdi,
    wnataTempAnom,
    ntrendTempAnom,
    volcAod,
  };
}

function resolveAtlasAssetUrl(): string {
  let base = './';
  try {
    const metaEnv = (import.meta as { env?: { BASE_URL?: string } }).env;
    if (metaEnv?.BASE_URL) {
      base = metaEnv.BASE_URL;
    }
  } catch {
    base = './';
  }
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return `${normalized}data/western-climate-atlas.bin`;
}

export function getLoadedClimateAtlas(): ParsedClimateAtlas | null {
  return cachedAtlas;
}

export function hasAttemptedClimateAtlasLoad(): boolean {
  return atlasLoadAttempted;
}

export function setClimateAtlasFromBuffer(
  buffer: ArrayBuffer | ArrayBufferView
): ParsedClimateAtlas {
  const parsed = parseClimateAtlasBuffer(buffer);
  cachedAtlas = parsed;
  atlasLoadAttempted = true;
  return parsed;
}

export function resetClimateAtlasForTesting(): void {
  cachedAtlas = null;
  atlasInFlight = null;
  atlasLoadAttempted = false;
}

/**
 * Lazily fetches and parses the Western North America historical climate atlas
 * with a strict AbortController timeout. Returns null cleanly if offline or unavailable.
 */
export async function loadClimateAtlas(
  timeoutMs = 3500
): Promise<ParsedClimateAtlas | null> {
  if (cachedAtlas) return cachedAtlas;
  if (atlasInFlight) return atlasInFlight;
  if (atlasLoadAttempted) return null;

  atlasInFlight = (async (): Promise<ParsedClimateAtlas | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = resolveAtlasAssetUrl();
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const buf = await resp.arrayBuffer();
      const parsed = parseClimateAtlasBuffer(buf);
      cachedAtlas = parsed;
      return parsed;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      atlasLoadAttempted = true;
      atlasInFlight = null;
    }
  })();

  return atlasInFlight;
}

/**
 * Queries NOAA nClimDiv monthly temperature anomalies (C) and precipitation
 * multipliers for a given Western US coordinate and year (1895-1980).
 */
export function queryNClimDivMonthly(
  atlas: ParsedClimateAtlas,
  lat: number,
  lon: number,
  year: number
): NClimDivMonthlyAnomaly | null {
  if (year < atlas.nclimStartYear || year > atlas.nclimEndYear) {
    return null;
  }

  const r = Math.round((lat - atlas.divLatMin) / 0.5);
  const c = Math.round((lon - atlas.divLonMin) / 0.5);
  if (r < 0 || r >= atlas.divGridRows || c < 0 || c >= atlas.divGridCols) {
    return null;
  }

  const divIdx = atlas.divMap[r * atlas.divGridCols + c];
  if (divIdx === 255 || divIdx >= atlas.numDivisions) {
    return null;
  }

  const nYears = atlas.nclimEndYear - atlas.nclimStartYear + 1;
  const yi = year - atlas.nclimStartYear;
  const baseOffset = (divIdx * nYears + yi) * 12;

  const tempAnomC: number[] = new Array(12);
  const precipMultiplier: number[] = new Array(12);
  let validMonths = 0;

  for (let m = 0; m < 12; m++) {
    const tQ = atlas.nclimTempAnom[baseOffset + m];
    const pQ = atlas.nclimPrecipLogRatio[baseOffset + m];
    if (tQ !== MISSING_I8 && pQ !== MISSING_I8) {
      validMonths++;
    }
    tempAnomC[m] = tQ === MISSING_I8 ? 0 : tQ / 10;
    precipMultiplier[m] = pQ === MISSING_I8 ? 1 : Math.exp(pQ / 50);
  }

  if (validMonths < 9) {
    return null;
  }

  return {
    tempAnomC,
    precipMultiplier,
    divisionCode: atlas.divIds[divIdx],
  };
}

function samplePaleoBilinear(
  atlas: ParsedClimateAtlas,
  cellMap: Int16Array,
  data: Int8Array,
  startYear: number,
  endYear: number,
  lat: number,
  lon: number,
  year: number,
  scaleDivisor: number
): number | null {
  if (year < startYear || year > endYear) {
    return null;
  }

  const rFloat = lat - atlas.paleoLatMin;
  const cFloat = lon - atlas.paleoLonMin;
  if (
    rFloat < -0.5 ||
    rFloat > atlas.paleoRows - 0.5 ||
    cFloat < -0.5 ||
    cFloat > atlas.paleoCols - 0.5
  ) {
    return null;
  }

  const r0 = Math.floor(rFloat);
  const c0 = Math.floor(cFloat);
  const fr = rFloat - r0;
  const fc = cFloat - c0;

  const corners: Array<[number, number, number]> = [
    [r0, c0, (1 - fr) * (1 - fc)],
    [r0, c0 + 1, (1 - fr) * fc],
    [r0 + 1, c0, fr * (1 - fc)],
    [r0 + 1, c0 + 1, fr * fc],
  ];

  const nYears = endYear - startYear + 1;
  const yi = year - startYear;

  let weightedSum = 0;
  let weightSum = 0;

  for (const [r, c, w] of corners) {
    if (
      w <= 0 ||
      r < 0 ||
      r >= atlas.paleoRows ||
      c < 0 ||
      c >= atlas.paleoCols
    ) {
      continue;
    }
    const cellIdx = cellMap[r * atlas.paleoCols + c];
    if (cellIdx < 0) continue;
    const q = data[cellIdx * nYears + yi];
    if (q === MISSING_I8) continue;
    weightedSum += w * (q / scaleDivisor);
    weightSum += w;
  }

  if (weightSum <= 0) {
    return null;
  }
  return weightedSum / weightSum;
}

/**
 * Queries bilinearly interpolated LBDA v2 PMDI (1200-1894), King et al. (2024)
 * WNATA temperature anomaly (1553-1894), Wilson et al. (2016) N-TREND fallback
 * (1200-1552), and Crowley & Unterman (2013) volcanic AOD (1200-2000).
 */
export function queryPaleoYear(
  atlas: ParsedClimateAtlas,
  lat: number,
  lon: number,
  year: number
): PaleoYearQueryResult | null {
  const pmdi = samplePaleoBilinear(
    atlas,
    atlas.lbdaCellMap,
    atlas.lbdaPmdi,
    atlas.lbdaStartYear,
    atlas.lbdaEndYear,
    lat,
    lon,
    year,
    10
  );

  let tempAnomC = samplePaleoBilinear(
    atlas,
    atlas.wnataCellMap,
    atlas.wnataTempAnom,
    atlas.wnataStartYear,
    atlas.wnataEndYear,
    lat,
    lon,
    year,
    20
  );
  let tempSource: PaleoYearQueryResult['tempSource'] =
    tempAnomC !== null ? 'wnata' : null;

  // For 1200-1552 inside Western US (where LBDA PMDI is present), fall back to N-TREND MJJA anomaly
  if (
    tempAnomC === null &&
    pmdi !== null &&
    year >= atlas.ntrendStartYear &&
    year <= atlas.ntrendEndYear
  ) {
    const q = atlas.ntrendTempAnom[year - atlas.ntrendStartYear];
    if (q !== MISSING_I8) {
      tempAnomC = q / 20;
      tempSource = 'ntrend';
    }
  }

  let volcanicAod = 0;
  if (year >= atlas.volcStartYear && year <= atlas.volcEndYear) {
    const aodNh = atlas.volcAod[year - atlas.volcStartYear] / 500;
    volcanicAod =
      lat >= 0 ? aodNh : aodNh >= 0.18 ? Number((aodNh * 0.55).toFixed(4)) : 0;
  } else {
    volcanicAod = getVolcanicAod(year, lat);
  }

  if (pmdi === null && tempAnomC === null) {
    return null;
  }

  return {
    pmdi,
    tempAnomC,
    tempSource,
    volcanicAod,
  };
}
