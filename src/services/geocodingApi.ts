import { RETROSPECTIVE_PRESETS } from '../model/presets';
import { LOCATION_PRESETS } from '../model/species';
import { SpeciesId } from '../model/types';

export interface PlaceSearchResult {
  id: string;
  name: string;
  subtitle: string;
  displayLabel: string;
  latitude: number;
  longitude: number;
  elevationM?: number;
  recommendedSpecies?: SpeciesId;
  source: 'preset' | 'geocoder';
}

interface OpenMeteoGeoItem {
  id?: number;
  name?: string;
  latitude?: number;
  longitude?: number;
  elevation?: number;
  country_code?: string;
  country?: string;
  admin1?: string;
  admin2?: string;
}

const REGION_ABBR_MAP: Record<string, string> = {
  al: 'alabama',
  ak: 'alaska',
  az: 'arizona',
  ar: 'arkansas',
  ca: 'california',
  co: 'colorado',
  ct: 'connecticut',
  de: 'delaware',
  fl: 'florida',
  ga: 'georgia',
  hi: 'hawaii',
  id: 'idaho',
  il: 'illinois',
  in: 'indiana',
  ia: 'iowa',
  ks: 'kansas',
  ky: 'kentucky',
  la: 'louisiana',
  me: 'maine',
  md: 'maryland',
  ma: 'massachusetts',
  mi: 'michigan',
  mn: 'minnesota',
  ms: 'mississippi',
  mo: 'missouri',
  mt: 'montana',
  ne: 'nebraska',
  nv: 'nevada',
  nh: 'new hampshire',
  nj: 'new jersey',
  nm: 'new mexico',
  ny: 'new york',
  nc: 'north carolina',
  nd: 'north dakota',
  oh: 'ohio',
  ok: 'oklahoma',
  or: 'oregon',
  pa: 'pennsylvania',
  ri: 'rhode island',
  sc: 'south carolina',
  sd: 'south dakota',
  tn: 'tennessee',
  tx: 'texas',
  ut: 'utah',
  vt: 'vermont',
  va: 'virginia',
  wa: 'washington',
  wv: 'west virginia',
  wi: 'wisconsin',
  wy: 'wyoming',
  bc: 'british columbia',
  ab: 'alberta',
  sk: 'saskatchewan',
  yt: 'yukon',
};

function parseQueryParts(rawQuery: string): {
  trimmed: string;
  primaryQuery: string;
  regionHint: string | null;
} {
  const trimmed = rawQuery.trim();
  const commaIdx = trimmed.indexOf(',');
  if (commaIdx === -1) {
    return { trimmed, primaryQuery: trimmed, regionHint: null };
  }
  const cityPart = trimmed.slice(0, commaIdx).trim();
  const rawHint = trimmed.slice(commaIdx + 1).trim().toLowerCase();
  const expandedHint = REGION_ABBR_MAP[rawHint] ?? rawHint;
  return {
    trimmed,
    primaryQuery: cityPart.length >= 2 ? cityPart : trimmed,
    regionHint: expandedHint.length > 0 ? expandedHint : null,
  };
}

function searchLocalPresets(rawQuery: string): PlaceSearchResult[] {
  const q = rawQuery.trim().toLowerCase();
  const tokens = q
    .split(/[\s,]+/)
    .map((t) => REGION_ABBR_MAP[t] ?? t)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return [];

  const matches: PlaceSearchResult[] = [];

  for (const preset of LOCATION_PRESETS) {
    const haystack = `${preset.name} ${preset.region} ${preset.note}`.toLowerCase();
    if (haystack.includes(q) || tokens.every((t) => haystack.includes(t))) {
      matches.push({
        id: `preset-loc-${preset.name}`,
        name: preset.name,
        subtitle: `${preset.region} · Reference Site`,
        displayLabel: preset.name,
        latitude: preset.latitude,
        longitude: preset.longitude,
        recommendedSpecies: preset.recommendedSpecies,
        source: 'preset',
      });
    }
  }

  for (const scenario of RETROSPECTIVE_PRESETS) {
    const nearExisting = matches.some(
      (m) =>
        Math.abs(m.latitude - scenario.latitude) < 0.05 &&
        Math.abs(m.longitude - scenario.longitude) < 0.05
    );
    if (nearExisting) continue;
    const haystack = `${scenario.coordinates.siteName} ${scenario.coordinates.region} ${scenario.name}`.toLowerCase();
    if (haystack.includes(q) || tokens.every((t) => haystack.includes(t))) {
      matches.push({
        id: `preset-scen-${scenario.id}`,
        name: scenario.coordinates.siteName,
        subtitle: `${scenario.coordinates.region} · Featured Site`,
        displayLabel: scenario.coordinates.siteName,
        latitude: scenario.latitude,
        longitude: scenario.longitude,
        elevationM: scenario.coordinates.elevationM,
        recommendedSpecies: scenario.species,
        source: 'preset',
      });
    }
  }

  return matches.slice(0, 3);
}

/**
 * Searches curated dendrochronology presets alongside Open-Meteo's global geocoder
 * so users can jump immediately to any town, peak, or mountain range by name.
 */
export async function searchPlaces(
  rawQuery: string,
  signal?: AbortSignal
): Promise<PlaceSearchResult[]> {
  const { trimmed, primaryQuery, regionHint } = parseQueryParts(rawQuery);
  if (trimmed.length < 2) return [];

  const localResults = searchLocalPresets(trimmed);

  let remoteRaw: OpenMeteoGeoItem[] = [];
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(primaryQuery)}&count=8&language=en&format=json`;
    const res = await fetch(url, { signal });
    if (res.ok) {
      const json = (await res.json()) as { results?: OpenMeteoGeoItem[] };
      if (Array.isArray(json.results)) {
        remoteRaw = json.results;
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return [];
    }
    // Network errors gracefully degrade to instant local preset results
    return localResults;
  }

  if (signal?.aborted) return [];

  const scoredRemote: Array<{ item: PlaceSearchResult; score: number }> = [];
  for (const item of remoteRaw) {
    if (
      typeof item.latitude !== 'number' ||
      typeof item.longitude !== 'number' ||
      !item.name
    ) {
      continue;
    }

    const nearLocal = localResults.some(
      (loc) =>
        Math.abs(loc.latitude - item.latitude!) < 0.05 &&
        Math.abs(loc.longitude - item.longitude!) < 0.05
    );
    if (nearLocal) continue;

    const regionParts = [item.admin1, item.country_code || item.country].filter(
      Boolean
    );
    const subtitle = regionParts.join(', ');
    const displayLabel = item.admin1
      ? `${item.name}, ${item.admin1}`
      : subtitle
      ? `${item.name}, ${subtitle}`
      : item.name;

    let score = 0;
    const regionSearch = `${item.admin1 ?? ''} ${item.country ?? ''} ${item.country_code ?? ''}`.toLowerCase();
    if (regionHint) {
      score += regionSearch.includes(regionHint) ? 50 : -15;
    }
    if (item.country_code === 'US' || item.country_code === 'CA' || item.country_code === 'MX') {
      score += 10;
    }
    if (item.name.toLowerCase() === primaryQuery.toLowerCase()) {
      score += 8;
    }

    scoredRemote.push({
      score,
      item: {
        id: `geo-${item.id ?? `${item.latitude.toFixed(4)}-${item.longitude.toFixed(4)}`}`,
        name: item.name,
        subtitle,
        displayLabel,
        latitude: Number(item.latitude.toFixed(4)),
        longitude: Number(item.longitude.toFixed(4)),
        elevationM:
          typeof item.elevation === 'number' ? Math.round(item.elevation) : undefined,
        source: 'geocoder',
      },
    });
  }

  scoredRemote.sort((a, b) => b.score - a.score);

  return [
    ...localResults,
    ...scoredRemote.map((s) => s.item),
  ].slice(0, 6);
}
