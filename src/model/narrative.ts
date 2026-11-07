import { TreeSimulationResult } from './types';
import {
  formatElevation,
  formatSlope,
  UnitSystem,
} from './units';

export interface ClimateLandmark {
  year: number;
  shortLabel: string;
  fullName: string;
  type: 'drought' | 'heat' | 'pluvial';
  description: string;
  matchesLocation: (lat: number, lon: number) => boolean;
}

export const CLIMATE_LANDMARKS: ClimateLandmark[] = [
  {
    year: 1977,
    shortLabel: '’77 Drought',
    fullName: '1977 West Coast Drought',
    type: 'drought',
    description:
      'Historic winter precipitation collapse across the Pacific Northwest, California, and Great Basin; severe growth suppression.',
    matchesLocation: (_lat, lon) => lon < -114.5,
  },
  {
    year: 2002,
    shortLabel: '’02 Megadrought',
    fullName: '2002 Southwest Megadrought',
    type: 'drought',
    description:
      'Record-setting aridification and extreme summer heat across Arizona, New Mexico, Utah, and Colorado; classic hairline marker ring.',
    matchesLocation: (lat, lon) => lat < 42.5 && lon > -116.5,
  },
  {
    year: 2015,
    shortLabel: '’15 Snow Drought',
    fullName: '2015 Pacific Northwest "Snow Drought"',
    type: 'heat',
    description:
      'Warmest winter on record with record-low mountain snowpack, triggering early water stress across Oregon and Washington.',
    matchesLocation: (lat, lon) => lat > 41.0 && lon < -114.0,
  },
  {
    year: 2021,
    shortLabel: '’21 Heat Dome',
    fullName: '2021 Pacific Northwest Heat Dome',
    type: 'heat',
    description:
      'Unprecedented late-June atmospheric ridge bringing 115°F+ temperatures and intense evaporative demand across the Northwest.',
    matchesLocation: (lat, lon) => lat > 41.0 && lon < -113.0,
  },
  {
    year: 1988,
    shortLabel: '’88 Drought',
    fullName: '1988 Northern Rockies Drought',
    type: 'drought',
    description:
      'Catastrophic spring and summer drought fueling the historic Yellowstone fires and suppressing radial growth across the Northern Rockies.',
    matchesLocation: (lat, lon) => lat > 43.0 && lon > -116.0,
  },
  {
    year: 1956,
    shortLabel: '’56 Drought',
    fullName: '1956 Severe Southwest Drought',
    type: 'drought',
    description:
      'Apex of the multi-year 1950s Southwest drought; extreme ring suppression across Arizona, Colorado, and New Mexico.',
    matchesLocation: (lat, lon) => lat < 41.5 && lon > -116.0,
  },
  {
    year: 1934,
    shortLabel: '’34 Dust Bowl',
    fullName: '1934 Dust Bowl Megadrought',
    type: 'drought',
    description:
      'The most widespread North American drought of the 20th century, producing ultra-narrow rings across all western conifer stands.',
    matchesLocation: () => true,
  },
  {
    year: 1996,
    shortLabel: '’96 Drought',
    fullName: '1996 Southwest Spring Drought',
    type: 'drought',
    description:
      'Acute winter/spring precipitation failure across the Southwest causing severe earlywood curtailment.',
    matchesLocation: (lat, lon) => lat < 38.0 && lon > -115.0,
  },
  {
    year: 1983,
    shortLabel: '’83 Pluvial',
    fullName: '1983 Mega-El Niño Pluvial',
    type: 'pluvial',
    description:
      'Historic winter precipitation and snowpack across the Great Basin and Southwest, producing exceptionally wide radial increments.',
    matchesLocation: (lat, _lon) => lat < 43.5,
  },
];

export function getRelevantClimateLandmarks(
  firstYear: number,
  lastYear: number,
  latitude: number,
  longitude: number
): ClimateLandmark[] {
  return CLIMATE_LANDMARKS.filter(
    (lm) =>
      lm.year >= firstYear &&
      lm.year <= lastYear &&
      lm.matchesLocation(latitude, longitude)
  ).sort((a, b) => a.year - b.year);
}

function getGeographicZoneName(lat: number, lon: number): string {
  // Northern Arizona / Coconino Plateau
  if (lat >= 34.2 && lat <= 36.8 && lon >= -113.8 && lon <= -110.0) {
    return 'on the Coconino Plateau';
  }
  // Oregon Cascades
  if (lat >= 43.2 && lat <= 45.8) {
    if (lon < -121.9) return 'in the Western Oregon Cascades';
    if (lon >= -121.9 && lon <= -120.5) return 'in the East Cascades rain shadow';
  }
  // Washington Cascades & Puget
  if (lat > 45.8 && lat <= 49.0 && lon < -120.5) {
    if (lon < -123.0) return 'in the Olympic Peninsula';
    return 'in the Washington Cascades';
  }
  // Colorado Front Range / Rockies
  if (lat >= 37.0 && lat <= 41.2 && lon >= -106.8 && lon <= -104.5) {
    return 'in the Colorado Front Range';
  }
  // Montana / Northern Rockies / Bitterroot
  if (lat >= 44.5 && lat <= 49.0 && lon >= -116.0 && lon <= -111.0) {
    return 'in the Bitterroot Range of Western Montana';
  }
  // California Sierra Nevada
  if (lat >= 36.0 && lat <= 40.5 && lon >= -121.5 && lon <= -118.0) {
    return 'in the California Sierra Nevada';
  }
  // Southwest General
  if (lat < 37.0 && lon > -114.0) {
    return 'in the American Southwest';
  }
  // Intermountain West
  return 'in the Intermountain West';
}

function getSlopeDescription(slopeDeg: number): string {
  if (slopeDeg < 2.0) return 'A flat tableland basin';
  if (slopeDeg < 5.0) return 'A gentle rolling slope';
  if (slopeDeg < 12.0) return 'A moderate hillslope';
  if (slopeDeg < 24.0) return 'A steep slope';
  return 'A precipitous rocky pitch';
}

function getAspectAdjective(aspectDeg: number, slopeDeg: number): string {
  if (slopeDeg < 2.0) return '';
  const normalized = (((aspectDeg % 360) + 360) % 360);
  if (normalized >= 337.5 || normalized < 22.5) return 'northern';
  if (normalized >= 22.5 && normalized < 67.5) return 'northeastern';
  if (normalized >= 67.5 && normalized < 112.5) return 'eastern';
  if (normalized >= 112.5 && normalized < 157.5) return 'southeastern';
  if (normalized >= 157.5 && normalized < 202.5) return 'south-facing';
  if (normalized >= 202.5 && normalized < 247.5) return 'southwestern';
  if (normalized >= 247.5 && normalized < 292.5) return 'western';
  return 'northwestern';
}

export function generateEnvironmentalNarrative(
  sim: TreeSimulationResult,
  unitSystem: UnitSystem
): { headline: string; story: string } {
  const { terrain, meanAnnualPrecipMm, summerPrecipShare } = sim.environment;
  const { latitude, longitude, species } = sim.params;
  const slopeDesc = getSlopeDescription(terrain.slopeDeg);
  const aspectAdj = getAspectAdjective(terrain.aspectDeg, terrain.slopeDeg);
  const elevStr = formatElevation(terrain.elevationM, unitSystem);
  const zoneStr = getGeographicZoneName(latitude, longitude);

  // Topographic setting phrase
  let topoPhrase: string;
  if (aspectAdj) {
    topoPhrase = `${slopeDesc.replace('A ', 'A ' + aspectAdj + ' ')} ${zoneStr} (${elevStr})`;
  } else {
    topoPhrase = `${slopeDesc} ${zoneStr} (${elevStr})`;
  }

  // Ecological growth dynamic phrase based on precipitation & species
  let growthPhrase: string;
  if (species === 'douglas-fir') {
    if (meanAnnualPrecipMm >= 1400) {
      growthPhrase =
        'yielding lush earlywood growth and complacent annual rings under abundant Pacific moisture.';
    } else if (meanAnnualPrecipMm >= 750) {
      growthPhrase =
        'yielding lush earlywood growth broken by sharp summer drought suppressions.';
    } else {
      growthPhrase =
        'yielding dense, climate-sensitive rings with abrupt latewood transitions under persistent moisture stress.';
    }
  } else {
    // Ponderosa pine
    if (summerPrecipShare >= 0.22) {
      growthPhrase =
        'yielding dense, drought-sensitive annual increments punctuated by summer monsoon false rings.';
    } else if (meanAnnualPrecipMm < 550) {
      growthPhrase =
        'yielding tight, climate-sensitive annual rings where narrow marker years record severe regional droughts.';
    } else {
      growthPhrase =
        'yielding balanced radial increments broken by periodic rain-shadow drought suppressions.';
    }
  }

  // Terrain mechanical effect
  let terrainNuance = '';
  if (terrain.slopeDeg >= 14) {
    terrainNuance = ` Steep ${formatSlope(terrain.slopeDeg, unitSystem)} slope induces asymmetric compression wood and subtle hoop-stress curvature.`;
  }

  const story = `${topoPhrase}, ${growthPhrase}${terrainNuance}`;
  return {
    headline: topoPhrase,
    story,
  };
}
