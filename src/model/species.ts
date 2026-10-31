import { SpeciesId } from './types';

export interface SpeciesProfile {
  id: SpeciesId;
  commonName: string;
  scientificName: string;
  tagline: string;
  stumpHeightM: number;
  /** VS-Lite cardinal temperatures (Celsius): T1 min onset, T2 lower opt, T3 upper opt, T4 heat shutoff */
  tempCardinalsC: [number, number, number, number];
  /** Soil moisture bucket fraction [0..1] cardinals: M1 wilting shutoff, M2 unstressed saturation */
  moistureCardinals: [number, number];
  /** Soil bucket water holding capacity baseline in mm */
  soilBucketCapacityMm: number;
  /** Lag-1 carbohydrate carryover weight (0..0.5) */
  priorYearCarryover: number;
  /** Climatic variance sensitivity exponent (>1 accentuates drought marker rings) */
  climateSensitivityExp: number;
  /** Optimal juvenile radial ring width in mm/yr at stump height (includes butt swell) */
  maxJuvenileRingMm: number;
  /** Mature steady basal-area-increment target (mm^2 / yr) on an optimal site */
  optimalMatureBaiMm2: number;
  /** Butt-swell factor at 0.30 m relative to upper stem */
  stumpSwellFactor: number;
  /** Minimum years to reach 0.30 m stump height under ideal conditions */
  optimalYearsToStump: number;
  /** Typical sapwood ring count in mature trees */
  sapwoodRingsMean: number;
  /** Earlywood -> Latewood transition character */
  ewLwTransition: 'abrupt' | 'semi-gradual';
  /** Baseline latewood fraction of total ring width */
  baseLatewoodFraction: number;
  minLatewoodFraction: number;
  maxLatewoodFraction: number;
  /** Propensity [0..1] to form intra-annual density fluctuations (false rings) in monsoon summers */
  falseRingPropensity: number;
  /** Grayscale palette [0..255] */
  palette: {
    sapwoodEwLight: number;
    heartwoodEwDarkening: number;
    transitionMidGray: number;
    latewoodDark: number;
    barkBaseGray: number;
    barkFissureGray: number;
    barkHighlightGray: number;
  };
  /** Bark allometric & morphological traits */
  bark: {
    morphology: 'furrowed-corky' | 'plated-scaly';
    /** Double bark thickness fraction of inside-bark diameter for small stems */
    juvenileDbtRatio: number;
    /** Double bark thickness fraction of inside-bark diameter for mature stems */
    matureDbtRatio: number;
    /** Early fire-shield additive bark offset (mm single thickness) */
    juvenileOffsetMm: number;
    /** Number of primary bark ridge/plate divisions on a medium stem */
    basePlateCount: number;
    /** Fissure depth as fraction of total bark thickness */
    fissureDepthFraction: number;
  };
  /** Viability bounds for ecological feedback */
  viabilityBounds: {
    minAnnualPrecipMm: number;
    minMeanTempC: number;
    maxMeanTempC: number;
  };
}

export const SPECIES_PROFILES: Record<SpeciesId, SpeciesProfile> = {
  'douglas-fir': {
    id: 'douglas-fir',
    commonName: 'Douglas-Fir',
    scientificName: 'Pseudotsuga menziesii',
    tagline:
      'Abrupt earlywood-to-latewood transition, bold dark summer latewood bands, distinct darker heartwood, and deeply furrowed cork-streaked bark.',
    stumpHeightM: 0.3,
    tempCardinalsC: [3.2, 16.5, 25.5, 35.5],
    moistureCardinals: [0.065, 0.42],
    soilBucketCapacityMm: 185,
    priorYearCarryover: 0.24,
    climateSensitivityExp: 1.05,
    maxJuvenileRingMm: 5.4,
    optimalMatureBaiMm2: 3600,
    stumpSwellFactor: 1.21,
    optimalYearsToStump: 2,
    sapwoodRingsMean: 24,
    ewLwTransition: 'abrupt',
    baseLatewoodFraction: 0.3,
    minLatewoodFraction: 0.17,
    maxLatewoodFraction: 0.46,
    falseRingPropensity: 0.08,
    palette: {
      sapwoodEwLight: 229,
      heartwoodEwDarkening: 22,
      transitionMidGray: 132,
      latewoodDark: 38,
      barkBaseGray: 58,
      barkFissureGray: 22,
      barkHighlightGray: 108,
    },
    bark: {
      morphology: 'furrowed-corky',
      juvenileDbtRatio: 0.095,
      matureDbtRatio: 0.182,
      juvenileOffsetMm: 1.1,
      basePlateCount: 22,
      fissureDepthFraction: 0.72,
    },
    viabilityBounds: {
      minAnnualPrecipMm: 340,
      minMeanTempC: -1.5,
      maxMeanTempC: 18.5,
    },
  },
  'ponderosa-pine': {
    id: 'ponderosa-pine',
    commonName: 'Ponderosa Pine',
    scientificName: 'Pinus ponderosa',
    tagline:
      'Drought-sensitive xeric chronology, bright wide sapwood, crisp narrow latewood lines with occasional monsoon false rings, and broad puzzle-piece scaly bark plates.',
    stumpHeightM: 0.3,
    tempCardinalsC: [4.2, 19.5, 29.0, 38.5],
    moistureCardinals: [0.032, 0.34],
    soilBucketCapacityMm: 150,
    priorYearCarryover: 0.2,
    climateSensitivityExp: 1.32,
    maxJuvenileRingMm: 4.5,
    optimalMatureBaiMm2: 2850,
    stumpSwellFactor: 1.16,
    optimalYearsToStump: 2,
    sapwoodRingsMean: 52,
    ewLwTransition: 'semi-gradual',
    baseLatewoodFraction: 0.21,
    minLatewoodFraction: 0.11,
    maxLatewoodFraction: 0.34,
    falseRingPropensity: 0.42,
    palette: {
      sapwoodEwLight: 238,
      heartwoodEwDarkening: 13,
      transitionMidGray: 162,
      latewoodDark: 46,
      barkBaseGray: 76,
      barkFissureGray: 24,
      barkHighlightGray: 126,
    },
    bark: {
      morphology: 'plated-scaly',
      juvenileDbtRatio: 0.165,
      matureDbtRatio: 0.148,
      juvenileOffsetMm: 2.4,
      basePlateCount: 15,
      fissureDepthFraction: 0.64,
    },
    viabilityBounds: {
      minAnnualPrecipMm: 240,
      minMeanTempC: -1.0,
      maxMeanTempC: 20.5,
    },
  },
};

export interface LocationPreset {
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  recommendedSpecies: SpeciesId;
  note: string;
}

export const LOCATION_PRESETS: LocationPreset[] = [
  {
    name: 'H.J. Andrews Forest',
    region: 'Western Cascades, OR',
    latitude: 44.2124,
    longitude: -122.2557,
    recommendedSpecies: 'douglas-fir',
    note: 'Classic mesic old-growth Douglas-fir benchmark site; fast early growth & bold latewood.',
  },
  {
    name: 'Hoh Temperate Rainforest',
    region: 'Olympic Peninsula, WA',
    latitude: 47.8609,
    longitude: -123.9348,
    recommendedSpecies: 'douglas-fir',
    note: 'Abundant maritime precipitation yields wide, relatively complacent growth rings.',
  },
  {
    name: 'Coconino Plateau (Flagstaff)',
    region: 'Northern Arizona',
    latitude: 35.2645,
    longitude: -111.7442,
    recommendedSpecies: 'ponderosa-pine',
    note: 'Birthplace of dendrochronology (A.E. Douglass); crisp drought marker rings & monsoon false rings.',
  },
  {
    name: 'Metolius River Basin',
    region: 'East Cascades, OR',
    latitude: 44.4622,
    longitude: -121.6358,
    recommendedSpecies: 'ponderosa-pine',
    note: 'Rain-shadow volcanic soils supporting classic park-like Ponderosa pine stands.',
  },
  {
    name: 'Boulder Foothills (Front Range)',
    region: 'Colorado',
    latitude: 39.9885,
    longitude: -105.3112,
    recommendedSpecies: 'ponderosa-pine',
    note: 'Steep rocky slopes producing asymmetric compression wood and sensitive drought chronologies.',
  },
  {
    name: 'Bitterroot Range',
    region: 'Western Montana',
    latitude: 46.1294,
    longitude: -114.2531,
    recommendedSpecies: 'douglas-fir',
    note: 'Cold interior montane climate; shorter growing seasons and tighter radial increments.',
  },
];
