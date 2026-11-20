import { SPECIES_PROFILES } from './species';
import { FireScarGeometry, TreeSimulationResult } from './types';
import {
  formatElevation,
  formatSlope,
  UnitSystem,
} from './units';

export interface ClimateLandmark {
  year: number;
  shortLabel: string;
  fullName: string;
  type: 'drought' | 'heat' | 'pluvial' | 'volcanic';
  description: string;
  matchesLocation: (lat: number, lon: number) => boolean;
}

export const CLIMATE_LANDMARKS: ClimateLandmark[] = [
  {
    year: 1580,
    shortLabel: '’80s Megadrought',
    fullName: '1580s Western North American Megadrought',
    type: 'drought',
    description:
      'Severe multi-decade late-16th-century drought spanning the Southwest, Great Basin, and Northern Rockies in LBDA tree-ring records.',
    matchesLocation: () => true,
  },
  {
    year: 1783,
    shortLabel: '’83 Laki',
    fullName: '1783 Laki Volcanic Cooling',
    type: 'volcanic',
    description:
      'Icelandic Laki fissure eruption injecting stratospheric sulfate aerosols across high northern latitudes, triggering severe summer cooling.',
    matchesLocation: (lat) => lat > 35.0,
  },
  {
    year: 1816,
    shortLabel: '’16 Tambora',
    fullName: '1816 Tambora "Year Without a Summer"',
    type: 'volcanic',
    description:
      'Cataclysmic 1815 Mount Tambora eruption producing peak stratospheric aerosol cooling and traumatic subalpine frost-ring collapse in 1816.',
    matchesLocation: () => true,
  },
  {
    year: 1905,
    shortLabel: '’05–20s Pluvial',
    fullName: '1905–1920s Colorado River Pluvial',
    type: 'pluvial',
    description:
      'Wettest multi-decadal interval in centuries across the Southwest and Colorado Plateau, forming the baseline for the 1922 Colorado River Compact.',
    matchesLocation: (lat, lon) => lat < 43.0 && lon > -118.5,
  },
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
  // Santa Catalina Mountains (Southern Arizona Sky Islands)
  if (lat >= 32.2 && lat <= 32.7 && lon >= -111.1 && lon <= -110.4) {
    return 'in the Santa Catalina Mountains of Southern Arizona';
  }
  // Gila Wilderness / Mogollon Mountains (Southwestern New Mexico)
  if (lat >= 33.0 && lat <= 33.7 && lon >= -109.0 && lon <= -108.0) {
    return 'in the Gila Wilderness of New Mexico';
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
    const article = /^[aeiou]/i.test(aspectAdj) ? 'An' : 'A';
    topoPhrase = `${slopeDesc.replace(/^A /, `${article} ${aspectAdj} `)} ${zoneStr} (${elevStr})`;
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

export interface SpecimenHighlight {
  id: string;
  year: number;
  ringIndex: number;
  /** Primary top line for compact SVG callout, e.g. "1934" or "1863–2009" */
  yearLabel: string;
  /** Secondary descriptive line for SVG callout, e.g. "Dust Bowl", "5× Fire Scars", "Tambora Frost" */
  eventLabel: string;
  /** Concise label for interactive UI chips, e.g. "1934 Dust Bowl" or "2024 Fire (9×)" */
  chipLabel: string;
  type: 'fire' | 'drought' | 'volcanic' | 'pluvial';
  /** Preferred polar angle (rad) for SVG callout anchor (e.g. catface azimuth for fire scars) */
  preferredAngleRad?: number;
  /** Number of grouped scars when representing a multi-scar catface */
  scarCount?: number;
  description: string;
}

const LANDMARK_PRIORITY_YEARS = [
  1934,
  1956,
  2002,
  1977,
  1580,
  1905,
  1983,
  2021,
  1988,
  2015,
  1996,
  1816,
  1783,
];

const LANDMARK_LABELS: Record<
  number,
  { eventLabel: string; chipLabel: string }
> = {
  1934: { eventLabel: 'Dust Bowl', chipLabel: '1934 Dust Bowl' },
  1956: { eventLabel: 'SW Drought', chipLabel: '1956 Drought' },
  2002: { eventLabel: 'Megadrought', chipLabel: '2002 Drought' },
  1977: { eventLabel: 'Coast Drought', chipLabel: '1977 Drought' },
  1996: { eventLabel: 'Spring Drought', chipLabel: '1996 Drought' },
  1988: { eventLabel: 'Rockies Drought', chipLabel: '1988 Drought' },
  1580: { eventLabel: 'Megadrought', chipLabel: '1580 Megadrought' },
  1905: { eventLabel: 'Big Pluvial', chipLabel: '1905 Pluvial' },
  1983: { eventLabel: 'El Niño Pluvial', chipLabel: '1983 Pluvial' },
  2015: { eventLabel: 'Snow Drought', chipLabel: '2015 Snow Drought' },
  2021: { eventLabel: 'Heat Dome', chipLabel: '2021 Heat Dome' },
  1816: { eventLabel: 'Tambora Chill', chipLabel: '1816 Tambora' },
  1783: { eventLabel: 'Laki Chill', chipLabel: '1783 Laki' },
};

function shortestAngleDiffRad(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

interface FireCluster {
  scars: FireScarGeometry[];
  isOpen: boolean;
}

function clusterFireScars(scars: FireScarGeometry[]): FireCluster[] {
  if (scars.length === 0) return [];
  const sorted = [...scars].sort((a, b) => a.year - b.year);
  const clusters: FireCluster[] = [];

  for (const scar of sorted) {
    const prevCluster = clusters[clusters.length - 1];
    const az =
      scar.centerAzimuthRad ??
      (scar.catfaceArcStartRad + scar.catfaceArcEndRad) / 2;
    if (prevCluster) {
      const prevLast = prevCluster.scars[prevCluster.scars.length - 1];
      const prevAz =
        prevLast.centerAzimuthRad ??
        (prevLast.catfaceArcStartRad + prevLast.catfaceArcEndRad) / 2;
      const sameSector = Math.abs(shortestAngleDiffRad(az, prevAz)) <= 0.6;
      const joinsOpenCatface = Boolean(scar.isRescar) && sameSector;
      if (joinsOpenCatface || (sameSector && scar.year - prevLast.year <= 40)) {
        prevCluster.scars.push(scar);
        prevCluster.isOpen = scar.healedYear === undefined;
        continue;
      }
    }
    clusters.push({
      scars: [scar],
      isOpen: scar.healedYear === undefined,
    });
  }

  return clusters;
}

/**
 * Extracts the 1 to `maxItems` most telling ecological highlights from a simulated
 * cross-section for direct SVG callouts, plain-English ledes, and tappable chips.
 */
export function extractSpecimenHighlights(
  sim: TreeSimulationResult,
  maxItems = 5
): SpecimenHighlight[] {
  if (sim.rings.length === 0 || maxItems <= 0) return [];

  const ringByYear = new Map(sim.rings.map((r) => [r.record.calendarYear, r.record]));
  const picked: SpecimenHighlight[] = [];
  const usedYears = new Set<number>();

  // 1. Fire scar clusters (prioritize open or largest episode; emit up to 2)
  const clusters = clusterFireScars(sim.fireScars ?? []);
  const rankedClusters = [...clusters].sort((a, b) => {
    const scoreA = (a.isOpen ? 10 : 0) + a.scars.length * 2 + a.scars[a.scars.length - 1].year * 0.001;
    const scoreB = (b.isOpen ? 10 : 0) + b.scars.length * 2 + b.scars[b.scars.length - 1].year * 0.001;
    return scoreB - scoreA;
  });

  for (const cluster of rankedClusters.slice(0, 2)) {
    const first = cluster.scars[0];
    const last = cluster.scars[cluster.scars.length - 1];
    const rec = ringByYear.get(last.year);
    if (!rec) continue;
    const count = cluster.scars.length;
    const az =
      last.centerAzimuthRad ??
      (last.catfaceArcStartRad + last.catfaceArcEndRad) / 2;
    const spanText = count >= 2 ? `${first.year}–${last.year}` : String(last.year);
    const scarYearsList = cluster.scars.map((s) => s.year).join(', ');
    picked.push({
      id: `fire-${last.year}`,
      year: last.year,
      ringIndex: rec.ringIndex,
      yearLabel: spanText,
      eventLabel: count >= 2 ? `${count}× Fire Scars` : 'Fire Scar',
      chipLabel: count >= 2 ? `${last.year} Fire (${count}×)` : `${last.year} Fire`,
      type: 'fire',
      preferredAngleRad: az,
      scarCount: count,
      description:
        count >= 2
          ? `Stacked catface fire scars (${scarYearsList}).`
          : `Modeled surface-fire catface scar in ${last.year} CE.`,
    });
    for (const s of cluster.scars) {
      usedYears.add(s.year);
    }
  }

  // 2. Volcanic frost trauma (or severe volcanic cooling event)
  const frostRings = sim.rings
    .map((r) => r.record)
    .filter((rec) => rec.hasFrostRing && !usedYears.has(rec.calendarYear))
    .sort((a, b) => {
      const bonusA = a.calendarYear === 1816 ? 2 : a.calendarYear === 1783 ? 1 : 0;
      const bonusB = b.calendarYear === 1816 ? 2 : b.calendarYear === 1783 ? 1 : 0;
      if (bonusB !== bonusA) return bonusB - bonusA;
      return (b.volcanicAod ?? 0) - (a.volcanicAod ?? 0);
    });

  const bestFrost = frostRings[0];
  if (bestFrost && picked.length < maxItems) {
    const y = bestFrost.calendarYear;
    const eventLabel =
      y === 1816 ? 'Tambora Frost' : y === 1783 ? 'Laki Frost' : 'Volcanic Frost';
    const chipLabel =
      y === 1816 ? '1816 Tambora' : y === 1783 ? '1783 Laki' : `${y} Frost`;
    picked.push({
      id: `volcanic-${y}`,
      year: y,
      ringIndex: bestFrost.ringIndex,
      yearLabel: String(y),
      eventLabel,
      chipLabel,
      type: 'volcanic',
      description: `Sub-freezing growing-season shock in ${y} CE collapsing earlywood tracheids.`,
    });
    usedYears.add(y);
  }

  // 3. Empirically expressed climate landmarks (skip flat uniform synthetic rings)
  const landmarks = getRelevantClimateLandmarks(
    sim.firstRingYear,
    sim.params.deathYear,
    sim.params.latitude,
    sim.params.longitude
  );
  const landmarkByYear = new Map(landmarks.map((lm) => [lm.year, lm]));
  const orderedLandmarks: ClimateLandmark[] = [];
  for (const py of LANDMARK_PRIORITY_YEARS) {
    const found = landmarkByYear.get(py);
    if (found) orderedLandmarks.push(found);
  }
  for (const lm of landmarks) {
    if (!orderedLandmarks.includes(lm)) orderedLandmarks.push(lm);
  }

  for (const lm of orderedLandmarks) {
    if (picked.length >= maxItems) break;
    if (usedYears.has(lm.year)) continue;
    const rec = ringByYear.get(lm.year);
    if (!rec || rec.isSyntheticClimate) continue;

    let expressed = false;
    if (lm.type === 'drought' || lm.type === 'heat') {
      expressed =
        rec.pmdi !== undefined
          ? rec.pmdi <= -1.2 || rec.climateIndex < 0.85
          : rec.climateIndex < 0.85;
    } else if (lm.type === 'pluvial') {
      expressed =
        rec.pmdi !== undefined
          ? rec.pmdi >= 1.2 || rec.climateIndex > 1.12
          : rec.climateIndex > 1.12;
    } else if (lm.type === 'volcanic') {
      expressed = Boolean(rec.hasFrostRing || (rec.volcanicAod ?? 0) >= 0.14);
    }
    if (!expressed) continue;

    const customLabel = LANDMARK_LABELS[lm.year];
    picked.push({
      id: `landmark-${lm.year}`,
      year: lm.year,
      ringIndex: rec.ringIndex,
      yearLabel: String(lm.year),
      eventLabel: customLabel?.eventLabel ?? lm.shortLabel,
      chipLabel: customLabel?.chipLabel ?? `${lm.year} ${lm.shortLabel}`,
      type: lm.type === 'heat' ? 'drought' : lm.type,
      description: lm.description,
    });
    usedYears.add(lm.year);
  }

  // 4. Fallback: narrowest mature drought marker if fewer than 2 highlights found
  if (picked.length < 2 && sim.rings.length >= 20) {
    let narrowest: (typeof sim.rings)[0]['record'] | null = null;
    for (const r of sim.rings) {
      const rec = r.record;
      if (rec.isSyntheticClimate || rec.ringIndex < 6 || usedYears.has(rec.calendarYear)) {
        continue;
      }
      if (rec.climateIndex >= 0.72) continue;
      if (!narrowest || rec.climateIndex < narrowest.climateIndex) {
        narrowest = rec;
      }
    }
    if (narrowest) {
      picked.push({
        id: `drought-${narrowest.calendarYear}`,
        year: narrowest.calendarYear,
        ringIndex: narrowest.ringIndex,
        yearLabel: String(narrowest.calendarYear),
        eventLabel: 'Severe Drought',
        chipLabel: `${narrowest.calendarYear} Drought`,
        type: 'drought',
        description: `Severe growth suppression (${Math.round(narrowest.climateIndex * 100)}% of baseline climate growth) in ${narrowest.calendarYear} CE.`,
      });
    }
  }

  return picked.slice(0, maxItems).sort((a, b) => a.year - b.year);
}

function formatLedeHighlightPhrase(h: SpecimenHighlight): string {
  if (h.year === 1934) return 'the 1934 Dust Bowl';
  if (h.year === 1816) {
    return h.eventLabel === 'Tambora Frost'
      ? 'the 1816 Tambora frost shock'
      : 'the 1816 Tambora chill';
  }
  if (h.year === 1783) return 'the 1783 Laki volcanic chill';
  if (h.year === 2002) return 'the 2002 megadrought';
  if (h.year === 1580) return 'the 1580s megadrought';
  if (h.year === 2021) return 'the 2021 heat dome';
  if (h.year === 2015) return 'the 2015 snow drought';
  if (h.type === 'pluvial') return `the ${h.year} pluvial`;
  if (h.type === 'volcanic') return `a ${h.year} frost shock`;
  return `the ${h.year} drought`;
}

/**
 * Generates a plain-English one-sentence summary ("nut graf") describing
 * the simulated specimen's lifespan, location, and defining events.
 */
export function generateSpecimenLede(
  sim: TreeSimulationResult,
  siteName?: string
): string {
  const profile = SPECIES_PROFILES[sim.params.species];
  const age = Math.round(sim.params.totalAge);
  const placePhrase = siteName
    ? `at ${siteName}`
    : getGeographicZoneName(sim.params.latitude, sim.params.longitude);

  const scars = sim.fireScars ?? [];
  const highlights = extractSpecimenHighlights(sim, 5);
  const climateHighlights = highlights.filter((h) => h.type !== 'fire');

  // Prefer iconic climatic stories for the lede copy
  const ledeClimate = [...climateHighlights]
    .sort((a, b) => {
      const idxA = LANDMARK_PRIORITY_YEARS.indexOf(a.year);
      const idxB = LANDMARK_PRIORITY_YEARS.indexOf(b.year);
      const rankA = idxA >= 0 ? idxA : 99;
      const rankB = idxB >= 0 ? idxB : 99;
      return rankA - rankB;
    })
    .slice(0, 2);

  if (scars.length > 0) {
    const firePhrase =
      scars.length === 1
        ? `a modeled ${scars[0].year} fire scar`
        : `${scars.length} modeled fire scars (${scars[0].year}–${scars[scars.length - 1].year})`;
    if (ledeClimate.length >= 2) {
      return `A simulated ${age}-year ${profile.commonName} ${placePhrase} carrying ${firePhrase} alongside ${formatLedeHighlightPhrase(ledeClimate[0])} and ${formatLedeHighlightPhrase(ledeClimate[1])}.`;
    }
    if (ledeClimate.length === 1) {
      return `A simulated ${age}-year ${profile.commonName} ${placePhrase} recording ${firePhrase} and ${formatLedeHighlightPhrase(ledeClimate[0])}.`;
    }
    return `A simulated ${age}-year ${profile.commonName} ${placePhrase} recording ${firePhrase}.`;
  }

  if (ledeClimate.length >= 2) {
    return `A simulated ${age}-year ${profile.commonName} ${placePhrase} recording ${formatLedeHighlightPhrase(ledeClimate[0])} and ${formatLedeHighlightPhrase(ledeClimate[1])}.`;
  }
  if (ledeClimate.length === 1) {
    return `A simulated ${age}-year ${profile.commonName} ${placePhrase} marked by ${formatLedeHighlightPhrase(ledeClimate[0])}.`;
  }

  const regimeDesc =
    sim.environment.meanAnnualPrecipMm >= 1200
      ? 'abundant Pacific moisture'
      : 'local mountain climate';
  return `A simulated ${age}-year ${profile.commonName} ${placePhrase} shaped by ${regimeDesc} across ${sim.firstRingYear}–${sim.params.deathYear}.`;
}
