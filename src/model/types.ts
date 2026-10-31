export type SpeciesId = 'douglas-fir' | 'ponderosa-pine';

export interface SimulationParams {
  species: SpeciesId;
  latitude: number;
  longitude: number;
  totalAge: number;
  deathYear: number;
}

export interface TerrainInfo {
  elevationM: number;
  slopeDeg: number;
  /** Compass azimuth in degrees (0 = North, 90 = East, 180 = South, 270 = West) that the slope faces */
  aspectDeg: number;
  isWaterOrInvalid: boolean;
}

export interface MonthlyClimateYear {
  year: number;
  /** 12 monthly mean temperatures in Celsius (Jan..Dec) */
  tempC: number[];
  /** 12 monthly precipitation totals in mm (Jan..Dec) */
  precipMm: number[];
  /** True if synthesized via pre-1940 or fallback stochastic generator */
  isSynthetic: boolean;
}

export interface EnvironmentDataset {
  terrain: TerrainInfo;
  years: MonthlyClimateYear[];
  source: 'open-meteo-era5' | 'offline-climatology';
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
}

export interface PolarRingGeometry {
  record: AnnualRingRecord;
  /** Inner boundary radius in mm at each angular sample */
  innerRadiusMm: number[];
  /** Boundary between earlywood and transition/latewood in mm */
  ewBoundaryRadiusMm: number[];
  /** Optional transition-to-latewood inner edge for gradual species */
  lwInnerRadiusMm: number[];
  /** Outer ring boundary (end of latewood) in mm */
  outerRadiusMm: number[];
  /** Optional false ring band center radius in mm */
  falseRingRadiusMm?: number[];
}

export interface PolarPoint {
  theta: number;
  r: number;
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
  /** Direction (radians, math angle or compass) of maximum compression wood */
  leanAzimuthDeg: number;
  compressionStrength: number;
  diameterInsideBarkMm: number;
  diameterOutsideBarkMm: number;
  rings: PolarRingGeometry[];
  bark: BarkGeometry;
  environment: EnvironmentDataset;
  viability: ViabilityAssessment;
}
