import { SpeciesId } from './types';

export type PaletteId = 'aged-wood' | 'charred-subalpine' | 'skeleton-plot';

export interface SerializedState {
  sp: SpeciesId | string;
  lat: number;
  lon: number;
  age: number;
  death: number;
  mode: 'peel' | 'grow';
  year?: number;
  preset?: string;
  pal?: PaletteId;
}

const VALID_SPECIES: Record<string, SpeciesId> = {
  'douglas-fir': 'douglas-fir',
  'ponderosa-pine': 'ponderosa-pine',
  'bristlecone-pine': 'bristlecone-pine',
};

const VALID_MODES: Record<string, 'peel' | 'grow'> = {
  peel: 'peel',
  grow: 'grow',
};

const VALID_PALETTES: Record<string, PaletteId> = {
  'aged-wood': 'aged-wood',
  'charred-subalpine': 'charred-subalpine',
  'skeleton-plot': 'skeleton-plot',
};

/**
 * Serializes application state into URL search/query parameters string.
 * Example output: "?sp=ponderosa-pine&lat=35.2645&lon=-111.7442&age=250&death=2026&mode=peel&year=1934"
 */
export function serializePermalink(state: Partial<SerializedState>): string {
  const params = new URLSearchParams();

  if (
    state.sp &&
    (Object.prototype.hasOwnProperty.call(VALID_SPECIES, state.sp) ||
      (typeof state.sp === 'string' &&
        state.sp.trim() &&
        !Object.prototype.hasOwnProperty.call(Object.prototype, state.sp.trim())))
  ) {
    if (Object.prototype.hasOwnProperty.call(VALID_SPECIES, state.sp)) {
      params.set('sp', state.sp);
    } else if (
      typeof state.sp === 'string' &&
      state.sp.trim() &&
      !Object.prototype.hasOwnProperty.call(Object.prototype, state.sp.trim())
    ) {
      params.set('sp', state.sp.trim());
    }
  }
  if (state.lat !== undefined && !Number.isNaN(state.lat)) {
    params.set('lat', Number(state.lat.toFixed(4)).toString());
  }
  if (state.lon !== undefined && !Number.isNaN(state.lon)) {
    params.set('lon', Number(state.lon.toFixed(4)).toString());
  }
  if (state.age !== undefined && !Number.isNaN(state.age)) {
    params.set('age', Math.round(state.age).toString());
  }
  if (state.death !== undefined && !Number.isNaN(state.death)) {
    params.set('death', Math.round(state.death).toString());
  }
  if (state.mode && Object.prototype.hasOwnProperty.call(VALID_MODES, state.mode)) {
    params.set('mode', state.mode);
  }
  if (state.year !== undefined && !Number.isNaN(state.year) && state.year >= 0 && state.year <= 3000) {
    params.set('year', Math.round(state.year).toString());
  }
  if (state.preset && typeof state.preset === 'string' && state.preset.trim()) {
    params.set('preset', state.preset.trim());
  }
  if (state.pal && Object.prototype.hasOwnProperty.call(VALID_PALETTES, state.pal)) {
    params.set('pal', state.pal);
  }

  const queryString = params.toString();
  return queryString ? `?${queryString}` : '';
}

/**
 * Deserializes URL search, hash, or full URL string into partial application state.
 * Validates, clamps, and type-checks all parameters.
 */
export function deserializePermalink(
  searchOrHash: string
): Partial<SerializedState> {
  if (!searchOrHash || typeof searchOrHash !== 'string') {
    return {};
  }

  let rawQuery = searchOrHash.trim();

  // If full URL was passed, extract search or hash
  if (rawQuery.includes('?')) {
    rawQuery = rawQuery.substring(rawQuery.indexOf('?') + 1);
    if (rawQuery.includes('#')) {
      rawQuery = rawQuery.substring(0, rawQuery.indexOf('#'));
    }
  } else if (rawQuery.startsWith('#')) {
    rawQuery = rawQuery.substring(1);
    if (rawQuery.includes('?')) {
      rawQuery = rawQuery.substring(rawQuery.indexOf('?') + 1);
      if (rawQuery.includes('#')) {
        rawQuery = rawQuery.substring(0, rawQuery.indexOf('#'));
      }
    }
  } else if (rawQuery.includes('#')) {
    rawQuery = rawQuery.substring(0, rawQuery.indexOf('#'));
  }

  const params = new URLSearchParams(rawQuery);
  const result: Partial<SerializedState> = {};

  // Species
  const sp = params.get('sp');
  if (sp && Object.prototype.hasOwnProperty.call(VALID_SPECIES, sp)) {
    result.sp = VALID_SPECIES[sp];
  } else if (
    sp &&
    sp.trim() &&
    !Object.prototype.hasOwnProperty.call(Object.prototype, sp.trim())
  ) {
    result.sp = sp.trim();
  }

  // Latitude
  const latStr = params.get('lat');
  if (latStr !== null) {
    const lat = parseFloat(latStr);
    if (!Number.isNaN(lat) && lat >= -90 && lat <= 90) {
      result.lat = Number(lat.toFixed(4));
    }
  }

  // Longitude
  const lonStr = params.get('lon');
  if (lonStr !== null) {
    const lon = parseFloat(lonStr);
    if (!Number.isNaN(lon) && lon >= -180 && lon <= 180) {
      result.lon = Number(lon.toFixed(4));
    }
  }

  // Age (clamped between 5 and 500)
  const ageStr = params.get('age');
  if (ageStr !== null) {
    const age = parseInt(ageStr, 10);
    if (!Number.isNaN(age)) {
      result.age = Math.max(5, Math.min(500, age));
    }
  }

  // Death Year (clamped between 1400 and 2100)
  const deathStr = params.get('death');
  if (deathStr !== null) {
    const death = parseInt(deathStr, 10);
    if (!Number.isNaN(death)) {
      result.death = Math.max(1400, Math.min(2100, death));
    }
  }

  // Mode ('peel' | 'grow')
  const mode = params.get('mode');
  if (mode && Object.prototype.hasOwnProperty.call(VALID_MODES, mode)) {
    result.mode = VALID_MODES[mode];
  }

  // Active Year (clamped between 0 and 3000)
  const yearStr = params.get('year');
  if (yearStr !== null) {
    const year = parseInt(yearStr, 10);
    if (!Number.isNaN(year) && year >= 0 && year <= 3000) {
      result.year = year;
    }
  }

  // Preset
  const preset = params.get('preset');
  if (preset && preset.trim()) {
    result.preset = preset.trim();
  }

  // Palette
  const pal = params.get('pal');
  if (pal && Object.prototype.hasOwnProperty.call(VALID_PALETTES, pal)) {
    result.pal = VALID_PALETTES[pal];
  }

  return result;
}

/**
 * Builds a full shareable URL with origin, path, and serialized state parameters.
 */
export function buildShareableUrl(
  state: Partial<SerializedState>,
  baseUrl?: string
): string {
  const query = serializePermalink(state);
  const base =
    baseUrl ||
    (typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : 'https://xylem-archive.art/');
  return `${base}${query}`;
}
