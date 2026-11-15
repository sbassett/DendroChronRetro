import { SpeciesId } from './types';

export type PresetId =
  | 'bristlecone-ancient'
  | 'pluvial-megadrought'
  | 'volcanic-frost-shock'
  | 'wildfire-scar-healing';

export type PaletteId = 'aged-wood' | 'charred-subalpine' | 'skeleton-plot';

export interface DisturbanceConfig {
  droughtThresholdRwi: number;
  frostEventYears: number[];
  fireScarYear?: number;
  fireScarAzimuthRad?: number;
  fireScarArcRad?: number;
}

export interface PresetClimaticParameters {
  meanAnnualTempC: number;
  meanAnnualPrecipMm: number;
  summerPrecipShare?: number;
  climateSensitivityExp?: number;
  temperatureAnomalyC?: number;
  droughtRegimeDescription: string;
}

export interface RetrospectivePreset {
  id: PresetId;
  label: string;
  name: string;
  subtitle: string;
  description: string;
  coordinates: {
    latitude: number;
    longitude: number;
    elevationM: number;
    region: string;
    siteName: string;
  };
  latitude: number;
  longitude: number;
  species: SpeciesId;
  temporal: {
    totalAge: number;
    deathYear: number;
    startYear: number;
    germinationEra: string;
  };
  totalAge: number;
  deathYear: number;
  eraLabel: string;
  climatic: PresetClimaticParameters;
  disturbance: DisturbanceConfig;
  disturbanceConfig: DisturbanceConfig;
  initialMode: 'peel' | 'grow';
  recommendedPalette: PaletteId;
  landmarkYears: number[];
}

export type Preset = RetrospectivePreset;

export const RETROSPECTIVE_PRESETS: RetrospectivePreset[] = [
  {
    id: 'bristlecone-ancient',
    label: 'Old-Growth Bristlecone',
    name: 'Old-Growth Bristlecone',
    subtitle: 'Ancient Subalpine Dendrochronology (White Mountains, CA)',
    description:
      'Reconstruct an ancient Great Basin Bristlecone Pine (Pinus longaeva) rooted in exposed dolomitic scree at 3,120 meters in California’s White Mountains. Characterized by dense, slow-growing annual increments, multi-decadal carbon storage carryover, and acute sensitivity to volcanic summer cooling events.',
    coordinates: {
      latitude: 37.3855,
      longitude: -118.1788,
      elevationM: 3120,
      region: 'White Mountains, Inyo County, CA',
      siteName: 'Methuselah Walk / Schulman Grove',
    },
    latitude: 37.3855,
    longitude: -118.1788,
    species: 'bristlecone-pine',
    temporal: {
      totalAge: 380,
      deathYear: 2024,
      startYear: 1644,
      germinationEra: 'Little Ice Age (Mid-17th Century)',
    },
    totalAge: 380,
    deathYear: 2024,
    eraLabel: '1644–2024 CE',
    climatic: {
      meanAnnualTempC: 1.4,
      meanAnnualPrecipMm: 312,
      summerPrecipShare: 0.12,
      climateSensitivityExp: 1.48,
      droughtRegimeDescription:
        'High-elevation arid subalpine; winter snowpack ablation and acute summer moisture deficit on reflective dolomite.',
    },
    disturbance: {
      droughtThresholdRwi: 0.38,
      frostEventYears: [1783, 1816, 1884, 1912],
    },
    disturbanceConfig: {
      droughtThresholdRwi: 0.38,
      frostEventYears: [1783, 1816, 1884, 1912],
    },
    initialMode: 'peel',
    recommendedPalette: 'skeleton-plot',
    landmarkYears: [1783, 1816, 1884, 1912, 1977, 2002],
  },
  {
    id: 'pluvial-megadrought',
    label: 'Pluvial to Megadrought Transition',
    name: 'Pluvial to Megadrought Transition',
    subtitle: 'Bimodal Climate Oscillations & Aridification (Coconino Plateau, AZ)',
    description:
      'Trace the dramatic 20th-century transition from the historic 1905–1920s Colorado River pluvial (the wettest decadal interval in over 500 years) through the 1934 Dust Bowl, 1950s aridification, and the severe post-2000 millennium megadrought in Northern Arizona Ponderosa pine.',
    coordinates: {
      latitude: 35.2645,
      longitude: -111.7442,
      elevationM: 2150,
      region: 'Coconino Plateau, Northern Arizona',
      siteName: 'Fort Valley Experimental Forest / Flagstaff',
    },
    latitude: 35.2645,
    longitude: -111.7442,
    species: 'ponderosa-pine',
    temporal: {
      totalAge: 260,
      deathYear: 2024,
      startYear: 1764,
      germinationEra: 'Late 18th Century Pre-Industrial',
    },
    totalAge: 260,
    deathYear: 2024,
    eraLabel: '1764–2024 CE',
    climatic: {
      meanAnnualTempC: 8.6,
      meanAnnualPrecipMm: 545,
      summerPrecipShare: 0.38,
      climateSensitivityExp: 1.32,
      droughtRegimeDescription:
        'Bimodal precipitation: winter snowpack followed by severe May–June aridification, punctuated by monsoonal convective storms.',
    },
    disturbance: {
      droughtThresholdRwi: 0.34,
      frostEventYears: [1816],
    },
    disturbanceConfig: {
      droughtThresholdRwi: 0.34,
      frostEventYears: [1816],
    },
    initialMode: 'peel',
    recommendedPalette: 'aged-wood',
    landmarkYears: [1905, 1934, 1956, 1983, 2002, 2021],
  },
  {
    id: 'volcanic-frost-shock',
    label: 'Volcanic Forcing & Frost Trauma',
    name: 'Volcanic Forcing & Frost Trauma',
    subtitle: 'Stratospheric Aerosol Cooling & 1816 Frost Rings (Bitterroot Range, MT)',
    description:
      'Examine the anatomical shock of stratospheric sulfur veil eruptions, centered on the April 1815 Tambora cataclysm and the subsequent 1816 "Year Without a Summer." Severe mid-growing-season freezing produces traumatic frost rings: collapsed thin-walled tracheids, radial crushing, and traumatic resin canal initiation.',
    coordinates: {
      latitude: 46.1294,
      longitude: -114.2531,
      elevationM: 2280,
      region: 'Bitterroot Range, Western Montana',
      siteName: 'Trapper Peak Montane Transect',
    },
    latitude: 46.1294,
    longitude: -114.2531,
    species: 'douglas-fir',
    temporal: {
      totalAge: 240,
      deathYear: 1920,
      startYear: 1680,
      germinationEra: 'Maunder Minimum / Little Ice Age',
    },
    totalAge: 240,
    deathYear: 1920,
    eraLabel: '1680–1920 CE',
    climatic: {
      meanAnnualTempC: 3.8,
      meanAnnualPrecipMm: 860,
      summerPrecipShare: 0.18,
      temperatureAnomalyC: -2.8,
      droughtRegimeDescription:
        'Montane continental interior; short 75-day growing seasons with elevated vulnerability to episodic unseasonal sub-zero cold outbreaks.',
    },
    disturbance: {
      droughtThresholdRwi: 0.42,
      frostEventYears: [1783, 1816, 1884],
    },
    disturbanceConfig: {
      droughtThresholdRwi: 0.42,
      frostEventYears: [1783, 1816, 1884],
    },
    initialMode: 'grow',
    recommendedPalette: 'charred-subalpine',
    landmarkYears: [1783, 1816, 1884],
  },
  {
    id: 'wildfire-scar-healing',
    label: 'Wildfire Scarring & Cambial Healing',
    name: 'Wildfire Scarring & Cambial Healing',
    subtitle: 'Thermal Necrosis Catface & Decadal Woundwood Roll (East Cascades, OR)',
    description:
      'Model the biophysical impact of a catastrophic dry-season crown fire. On the uphill lee side, aerodynamic heat pooling causes localized thermal necrosis of the cambium, exposing heartwood in an 80° catface scar. Over subsequent decades, living cambial margins roll inward to deposit curved woundwood callus curls.',
    coordinates: {
      latitude: 44.4622,
      longitude: -121.6358,
      elevationM: 940,
      region: 'East Cascades Rain Shadow, Oregon',
      siteName: 'Metolius River Basin / Black Butte',
    },
    latitude: 44.4622,
    longitude: -121.6358,
    species: 'ponderosa-pine',
    temporal: {
      totalAge: 220,
      deathYear: 2024,
      startYear: 1804,
      germinationEra: 'Early 19th Century Post-Fire Cohort',
    },
    totalAge: 220,
    deathYear: 2024,
    eraLabel: '1804–2024 CE',
    climatic: {
      meanAnnualTempC: 7.8,
      meanAnnualPrecipMm: 480,
      summerPrecipShare: 0.12,
      droughtRegimeDescription:
        'Rain-shadow xeric pine forest; prolonged late-summer drought creating high fuel flammability and rapid fire spread.',
    },
    disturbance: {
      droughtThresholdRwi: 0.4,
      frostEventYears: [],
      fireScarYear: 1910,
      fireScarAzimuthRad: 2.356, // 135° (SE uphill slope eddy)
      fireScarArcRad: 1.414, // 81° catface arc
    },
    disturbanceConfig: {
      droughtThresholdRwi: 0.4,
      frostEventYears: [],
      fireScarYear: 1910,
      fireScarAzimuthRad: 2.356,
      fireScarArcRad: 1.414,
    },
    initialMode: 'grow',
    recommendedPalette: 'charred-subalpine',
    landmarkYears: [1910, 1934, 1977, 2002, 2021],
  },
];

export function getPresetById(id: string): RetrospectivePreset | undefined {
  return RETROSPECTIVE_PRESETS.find((p) => p.id === id);
}

export function getAllPresets(): RetrospectivePreset[] {
  return RETROSPECTIVE_PRESETS;
}

export function getDefaultPreset(): RetrospectivePreset {
  return RETROSPECTIVE_PRESETS[0];
}

export function isPresetActive(
  preset: RetrospectivePreset,
  current: {
    species: SpeciesId;
    latitude: number;
    longitude: number;
    totalAge: number;
    deathYear: number;
  }
): boolean {
  return (
    preset.species === current.species &&
    Math.abs(preset.coordinates.latitude - current.latitude) < 0.001 &&
    Math.abs(preset.coordinates.longitude - current.longitude) < 0.001 &&
    preset.temporal.totalAge === current.totalAge &&
    preset.temporal.deathYear === current.deathYear
  );
}
