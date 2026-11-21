export type SpeciesId = 'douglas-fir' | 'ponderosa-pine' | 'bristlecone-pine';

export interface DisturbanceConfig {
  droughtThresholdRwi?: number; // e.g. 0.40
  frostEventYears?: number[];    // e.g. [1783, 1816]
  fireScarYear?: number;        // e.g. 1910
  fireScarAzimuthRad?: number;
  fireScarArcRad?: number;
  enableLocallyAbsent?: boolean;
  enableResinPockets?: boolean;
  enableClimateWildfires?: boolean;
}

export interface PolarPoint {
  theta: number;
  r: number;
}

export interface FireScarGeometry {
  year: number;
  catfaceArcStartRad: number;
  catfaceArcEndRad: number;
  exposedWoodRadiusMm: number;
  callusMarginCoordinates: Array<{ x: number; y: number; curlRadiusMm: number }>;
  scarArcPoints?: PolarPoint[];
  isRescar?: boolean;
  fireIntensity?: number;
  healedYear?: number;
  finalOpenArcRad?: number;
  centerAzimuthRad?: number;
}

export interface ResinPocketGeometry {
  ringIndex: number;
  centerAngleRad: number;
  arcLengthRad: number;
  radialDepthMm: number;
  pathD: string;
}

export interface DensityGradientParams {
  tauCrit: number;
  sigmaTrans: number;
  gamma: number;
  densityEw: number;
  densityLw: number;
}

export interface SimulationParams {
  species: SpeciesId;
  latitude: number;
  longitude: number;
  totalAge: number;
  deathYear: number;
  disturbance?: DisturbanceConfig;
}

export interface TerrainInfo {
  elevationM: number;
  slopeDeg: number;
  /** Compass azimuth in degrees (0 = North, 90 = East, 180 = South, 270 = West) that the slope faces */
  aspectDeg: number;
  isWaterOrInvalid: boolean;
}

export type ClimateProvenance =
  | 'reanalysis-merra2'
  | 'reanalysis-era5'
  | 'instrumental-nclimdiv'
  | 'paleo-atlas'
  | 'synthetic';

export interface MonthlyClimateYear {
  year: number;
  /** 12 monthly mean temperatures in Celsius (Jan..Dec) */
  tempC: number[];
  /** 12 monthly precipitation totals in mm (Jan..Dec) */
  precipMm: number[];
  /** True if synthesized via fallback stochastic generator */
  isSynthetic: boolean;
  /** Tier provenance for this calendar year */
  provenance?: ClimateProvenance;
  /** Growing-season stratospheric volcanic aerosol optical depth (SAOD at 550nm) */
  volcanicAod?: number;
  /** Summer (JJA) Palmer Modified Drought Index when available from paleoclimate atlas */
  pmdi?: number;
}

export interface EnvironmentDataset {
  terrain: TerrainInfo;
  years: MonthlyClimateYear[];
  source: 'nasa-power-merra2' | 'open-meteo-era5' | 'offline-climatology';
  hasHistoricalLayers?: boolean;
  provenanceTiers?: ClimateProvenance[];
  meanAnnualTempC: number;
  meanAnnualPrecipMm: number;
  summerPrecipShare: number;
}

export interface AnnualRingRecord {
  ringIndex: number; // 1..visibleRings (from pith outward)
  calendarYear: number;
  cambialAge: number; // 1..visibleRings
  treeAge: number; // yearsToStump + cambialAge
  climateIndex: number; // normalized ~0.15..1.85
  limitingFactor: 'moisture' | 'temperature' | 'balanced';
  meanWidthMm: number;
  earlywoodWidthMm: number;
  latewoodWidthMm: number;
  latewoodFraction: number;
  hasFalseRing: boolean;
  falseRingPosition: number; // 0..1 within ring if present
  earlywoodGray: number; // 0..255
  transitionGray: number; // 0..255
  latewoodGray: number; // 0..255
  isHeartwood: boolean;
  isSyntheticClimate: boolean;
  climateProvenance?: ClimateProvenance;
  volcanicAod?: number;
  pmdi?: number;
  hasFrostRing?: boolean;
  // Milestone 2 Biological additions:
  relativeWidthIndex?: number;
  isLocallyAbsent?: boolean;
  absentArc?: { startAngleRad: number; endAngleRad: number };
  hasFireScar?: boolean;
  isFireRescar?: boolean;
  fireIntensity?: number;
  transition1Gray?: number;
  transition2Gray?: number;
  densityGradient?: DensityGradientParams;
}

export interface PolarRingGeometry {
  record: AnnualRingRecord;
  /** Inner boundary radius in mm at each angular sample */
  innerRadiusMm: number[];
  /** Intermediate gradient transition 1 radius in mm */
  transition1RadiusMm?: number[];
  /** Intermediate gradient transition 2 radius in mm */
  transition2RadiusMm?: number[];
  /** Boundary between earlywood and transition/latewood in mm */
  ewBoundaryRadiusMm: number[];
  /** Optional transition-to-latewood inner edge for gradual species */
  lwInnerRadiusMm: number[];
  /** Outer ring boundary (end of latewood) in mm */
  outerRadiusMm: number[];
  /** Optional false ring band center radius in mm */
  falseRingRadiusMm?: number[];
  /** Optional locally absent mask across angles (0 = dead/absent, 1 = normal) */
  locallyAbsentMask?: number[];
  /** Optional open fire catface arc active at end of this ring's growing season */
  openCatfaceArc?: { centerAngleRad: number; halfArcRad: number };
}

export interface BarkGeometry {
  morphology: 'furrowed-corky' | 'plated-scaly';
  meanThicknessMm: number;
  maxThicknessMm: number;
  minThicknessMm: number;
  phloemThicknessMm: number;
  /** Cambium / wood outer boundary (matches outermost ring outerRadiusMm) */
  cambiumRadiusMm: number[];
  /** Outer boundary of living secondary phloem / inner bark (high angular res) */
  phloemOuterRadiusMm: number[];
  /** Outer ragged/plated rhytidome surface radius at high angular resolution */
  outerBarkRadiusMm: number[];
  /** High-resolution angular grid (e.g. 1080 steps) used for bark & phloem contours */
  barkAnglesRad: number[];
  /** Filled tangential cork wedges / lenticular scales clipped to the rhytidome */
  rhytidomeCells: Array<{
    pointsPolar: PolarPoint[];
    fillGray: number;
    strokeGray: number;
    strokeWidthMm: number;
  }>;
  /** Anastomosing sequential periderm seam arcs clipped to the rhytidome */
  peridermSeams: Array<{
    pointsPolar: PolarPoint[];
    gray: number;
    widthMm: number;
  }>;
  /** Outer bark scales / weathered cork chips actively peeling and shedding beyond the attached silhouette */
  sheddingFlakes?: Array<{
    pointsPolar: PolarPoint[];
    fillGray: number;
    strokeGray: number;
    strokeWidthMm: number;
    opacity: number;
  }>;
}

export interface ViabilityAssessment {
  viable: boolean;
  stressLevel: 'optimal' | 'moderate' | 'marginal' | 'unsuitable';
  summary: string;
  reasons: string[];
}

export interface TreeSimulationResult {
  params: SimulationParams;
  seedKey: string;
  seedHex: string;
  stumpHeightM: number;
  yearsToStumpHeight: number;
  germinationYear: number;
  firstRingYear: number;
  visibleRingCount: number;
  anglesRad: number[];
  pithRadiusMm: number;
  /** Cumulative offset of pith from outer cambium geometric center */
  pithOffsetMm: { x: number; y: number };
  /** Biological stem cross-section eccentricity in [0..1] */
  eccentricity: number;
  /** Direction (radians, math angle or compass) of maximum compression wood */
  leanAzimuthDeg: number;
  compressionStrength: number;
  diameterInsideBarkMm: number;
  diameterOutsideBarkMm: number;
  rings: PolarRingGeometry[];
  bark: BarkGeometry;
  environment: EnvironmentDataset;
  viability: ViabilityAssessment;
  fireScars?: FireScarGeometry[];
  resinPockets?: ResinPocketGeometry[];
  standFireYears?: number[];
}
