import { smoothstep } from './biologicalDisturbances';
import { buildRegionalClimateSeedKey, SeededRNG } from './prng';
import { SpeciesProfile } from './species';
import { SpeciesId } from './types';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function wrapAngle(theta: number): number {
  const twoPi = 2 * Math.PI;
  return ((theta % twoPi) + twoPi) % twoPi;
}

export interface WildfireClimateInputYear {
  year: number;
  annualG: number;
  summerMoistureG: number;
  summerTempC: number;
  pmdi?: number;
}

export interface StandFireEvent {
  year: number;
  intensity: number;
  probability: number;
  aridityIndex: number;
  fuelSwitch: number;
  yearsSincePrevFire: number;
}

export interface OpenCatfaceState {
  centerAngleRad: number;
  openStartRad: number;
  openEndRad: number;
  maxEverHalfArcRad: number;
  isClosed: boolean;
  closedYear?: number;
  scarEvents: Array<{
    year: number;
    isRescar: boolean;
    intensity: number;
    arcStartRad: number;
    arcEndRad: number;
  }>;
}

export interface ActiveCatface {
  centerAngleRad: number;
  openHalfArcRad: number;
  maxEverHalfArcRad: number;
  isClosed: boolean;
  closedYear?: number;
  scarIndices: number[];
}

export interface FireRegimeParams {
  lambda: number;
  baseProb: number;
  aridityWeight: number;
  fuelWeight: number;
}

/**
 * Derives characteristic surface/mixed-severity fire regime parameters
 * from species ecology, mean annual precipitation, and elevation.
 */
export function getFireRegimeParams(
  species: SpeciesId,
  meanAnnualPrecipMm: number,
  elevationM: number
): FireRegimeParams {
  let params: FireRegimeParams;

  if (species === 'ponderosa-pine') {
    params =
      meanAnnualPrecipMm < 680
        ? {
            lambda: 14,
            baseProb: 0.065,
            aridityWeight: 1.15,
            fuelWeight: 0.72,
          }
        : {
            lambda: 24,
            baseProb: 0.04,
            aridityWeight: 1.25,
            fuelWeight: 0.45,
          };
  } else if (species === 'douglas-fir') {
    if (meanAnnualPrecipMm < 750) {
      params = {
        lambda: 28,
        baseProb: 0.035,
        aridityWeight: 1.25,
        fuelWeight: 0.45,
      };
    } else if (meanAnnualPrecipMm < 1300) {
      params = {
        lambda: 65,
        baseProb: 0.014,
        aridityWeight: 1.4,
        fuelWeight: 0.15,
      };
    } else {
      params = {
        lambda: 160,
        baseProb: 0.005,
        aridityWeight: 1.6,
        fuelWeight: 0.0,
      };
    }
  } else {
    params = {
      lambda: 180,
      baseProb: 0.0045,
      aridityWeight: 1.35,
      fuelWeight: 0.1,
    };
  }

  if (elevationM >= 2900) {
    params = {
      ...params,
      baseProb: params.baseProb * 0.7,
    };
  }

  return params;
}

export interface SimulateStandWildfiresArgs {
  yearlyClimate: WildfireClimateInputYear[];
  species: SpeciesId;
  latitude: number;
  longitude: number;
  meanAnnualPrecipMm: number;
  elevationM: number;
  equatorwardExposure: number;
  meanAnnualG: number;
  meanSummerTempC: number;
}

/**
 * Simulates deterministic, regionally synchronized stand-level wildfire events
 * driven by paleoclimate/instrumental aridity, antecedent 2-year fine-fuel build-up,
 * Weibull fuel recovery, topographic exposure, and Western US fire exclusion.
 */
export function simulateStandWildfires(
  args: SimulateStandWildfiresArgs
): Map<number, StandFireEvent> {
  const {
    yearlyClimate,
    species,
    latitude,
    longitude,
    meanAnnualPrecipMm,
    elevationM,
    equatorwardExposure,
    meanAnnualG,
    meanSummerTempC,
  } = args;

  const events = new Map<number, StandFireEvent>();
  if (yearlyClimate.length === 0) return events;

  const { lambda, baseProb, aridityWeight, fuelWeight } = getFireRegimeParams(
    species,
    meanAnnualPrecipMm,
    elevationM
  );
  const regionalKey = buildRegionalClimateSeedKey(latitude, longitude);
  const initRng = new SeededRNG(`${regionalKey}:wildfire:init`);
  let yearsSinceFire = initRng.range(0.35 * lambda, 0.85 * lambda);

  const isWesternNa =
    latitude >= 30 &&
    latitude <= 50 &&
    longitude >= -126 &&
    longitude <= -101;
  const topoMult = Math.exp(0.35 * equatorwardExposure);
  const safeMeanG = Math.max(0.1, meanAnnualG);

  const wetnessSignals: number[] = yearlyClimate.map((ym) =>
    ym.pmdi !== undefined
      ? ym.pmdi / 2.5
      : (ym.annualG / safeMeanG - 1.0) * 1.8
  );

  for (let i = 0; i < yearlyClimate.length; i++) {
    const ym = yearlyClimate[i];

    const pmdiTerm =
      ym.pmdi !== undefined
        ? clamp(-ym.pmdi / 2.2, -1.8, 2.8)
        : clamp((1.0 - ym.annualG / safeMeanG) * 2.0, -1.5, 2.5);
    const summerMoistTerm = clamp((0.45 - ym.summerMoistureG) * 2.4, -1.0, 1.5);
    const summerHeatTerm = clamp(
      (ym.summerTempC - meanSummerTempC) / 1.8,
      -1.2,
      2.0
    );
    const aridityIndex = clamp(
      0.55 * pmdiTerm + 0.25 * summerMoistTerm + 0.2 * summerHeatTerm,
      -2.0,
      3.0
    );

    let fPrev = 0;
    let prevCount = 0;
    for (let lag = 1; lag <= 2; lag++) {
      if (i - lag >= 0) {
        fPrev += wetnessSignals[i - lag];
        prevCount++;
      }
    }
    const avgWetness =
      prevCount > 0 ? clamp(fPrev / prevCount, -0.8, 1.6) : 0;
    const fuelSwitch = aridityIndex > 0.15 ? Math.max(0, avgWetness) : 0;

    const fuelRecovery =
      yearsSinceFire < 2
        ? 0.04
        : 1 - Math.exp(-Math.pow(yearsSinceFire / lambda, 1.7));

    let eraMult = 1.0;
    if (isWesternNa) {
      if (ym.year >= 1905 && ym.year <= 1985) {
        eraMult = 0.28;
      } else if (ym.year >= 1986 && ym.year <= 1999) {
        eraMult = 0.5;
      } else if (ym.year >= 2000) {
        eraMult = 0.85;
      }
    }

    let pFire = clamp(
      baseProb *
        fuelRecovery *
        topoMult *
        eraMult *
        Math.exp(
          aridityWeight * aridityIndex + fuelWeight * fuelSwitch - 0.55
        ),
      0,
      0.45
    );
    if (aridityIndex < -0.35) {
      pFire *= 0.12;
    }

    const standRng = new SeededRNG(`${regionalKey}:wildfire:${ym.year}`);
    if (standRng.next() < pFire) {
      const intensity = clamp(
        0.32 +
          0.24 * Math.max(0, aridityIndex) +
          0.18 * Math.min(1.5, yearsSinceFire / lambda) +
          0.12 * Math.max(0, equatorwardExposure) +
          standRng.range(-0.08, 0.1),
        0.25,
        1.0
      );
      events.set(ym.year, {
        year: ym.year,
        intensity,
        probability: pFire,
        aridityIndex,
        fuelSwitch,
        yearsSincePrevFire: yearsSinceFire,
      });
      yearsSinceFire = 0;
    } else {
      yearsSinceFire += 1;
    }
  }

  return events;
}

/**
 * Computes screen-space scar center azimuth (radians).
 * Steep slopes concentrate scars on the uphill lee eddy where fuel accumulates and upslope
 * convection curls flames; flat ground distributes scars around the downwind leeward side.
 */
export function computeScarAzimuthRad(
  uphillScreenRad: number,
  windScreenRad: number,
  slopeDeg: number,
  rng: SeededRNG
): number {
  const slopeWeight = smoothstep(2.0, 12.0, slopeDeg);
  const vx =
    slopeWeight * Math.cos(uphillScreenRad) +
    (1 - slopeWeight) * Math.cos(windScreenRad);
  const vy =
    slopeWeight * Math.sin(uphillScreenRad) +
    (1 - slopeWeight) * Math.sin(windScreenRad);

  const baseAngle =
    Math.hypot(vx, vy) < 1e-4
      ? slopeWeight >= 0.5
        ? uphillScreenRad
        : windScreenRad
      : Math.atan2(vy, vx);

  const jitterStd = 0.55 * (1 - slopeWeight) + 0.16 * slopeWeight;
  const jitter = clamp(rng.gaussian(0, jitterStd), -0.95, 0.95);
  return wrapAngle(baseAngle + jitter);
}

/**
 * Estimates living single-bark insulation thickness (mm) from species bark allometry
 * and current wood radius inside bark.
 */
export function estimateBarkArmorMm(
  profile: SpeciesProfile,
  meanWoodRadiusMm: number
): number {
  const t = clamp(meanWoodRadiusMm / 180, 0, 1);
  const dbtRatio =
    profile.bark.juvenileDbtRatio +
    (profile.bark.matureDbtRatio - profile.bark.juvenileDbtRatio) * t;
  return profile.bark.juvenileOffsetMm + meanWoodRadiusMm * dbtRatio;
}

export interface EvaluateTreeFireDamageArgs {
  seedKey: string;
  year: number;
  cambialAge: number;
  meanWoodRadiusMm: number;
  profile: SpeciesProfile;
  slopeDeg: number;
  uphillScreenRad: number;
  windScreenRad: number;
  standFire: StandFireEvent;
  openCatface: ActiveCatface | null;
  yearsSinceClosure: number | null;
}

export type TreeFireDamageOutcome =
  | { scarred: false }
  | {
      scarred: true;
      isRescar: boolean;
      centerAngleRad: number;
      halfArcRad: number;
      intensity: number;
    };

/**
 * Evaluates whether an individual specimen scars or re-scars during a stand fire,
 * implementing 3-state recorder-tree mechanics (intact bark-insulated, open unhealed
 * pitch-exuding catface with elevated vulnerability, or recently healed seam).
 */
export function evaluateTreeFireDamage(
  args: EvaluateTreeFireDamageArgs
): TreeFireDamageOutcome {
  const {
    seedKey,
    year,
    cambialAge,
    meanWoodRadiusMm,
    profile,
    slopeDeg,
    uphillScreenRad,
    windScreenRad,
    standFire,
    openCatface,
    yearsSinceClosure,
  } = args;

  if (cambialAge < 8 || meanWoodRadiusMm < 12) {
    return { scarred: false };
  }

  const rng = new SeededRNG(`${seedKey}:scar:${year}`);

  if (openCatface && !openCatface.isClosed && openCatface.openHalfArcRad > 0.03) {
    const openFrac = clamp(openCatface.openHalfArcRad / 0.55, 0.25, 1.0);
    const pRescar = clamp(
      0.38 + 0.42 * standFire.intensity + 0.16 * openFrac,
      0.42,
      0.92
    );
    if (rng.next() < pRescar) {
      const halfArcRad = clamp(
        openCatface.openHalfArcRad + rng.range(0.06, 0.18) * standFire.intensity,
        openCatface.openHalfArcRad + 0.04,
        Math.min(0.88, openCatface.maxEverHalfArcRad + 0.16)
      );
      const centerAngleRad = wrapAngle(
        openCatface.centerAngleRad + rng.range(-0.045, 0.045)
      );
      return {
        scarred: true,
        isRescar: true,
        centerAngleRad,
        halfArcRad,
        intensity: standFire.intensity,
      };
    }
    return { scarred: false };
  }

  const singleBarkMm = estimateBarkArmorMm(profile, meanWoodRadiusMm);
  const seamFactor =
    yearsSinceClosure !== null && yearsSinceClosure < 15
      ? 0.55 + 0.45 * (yearsSinceClosure / 15)
      : 1.0;
  const effBarkMm = singleBarkMm * seamFactor;

  const logit =
    -1.25 +
    2.85 * standFire.intensity -
    0.115 * effBarkMm +
    0.032 * clamp(slopeDeg, 0, 35);
  const pInitial = clamp(1 / (1 + Math.exp(-logit)), 0.03, 0.62);

  if (rng.next() < pInitial) {
    const centerAngleRad = computeScarAzimuthRad(
      uphillScreenRad,
      windScreenRad,
      slopeDeg,
      rng
    );
    const halfArcRad = clamp(
      (0.42 + 0.58 * standFire.intensity + rng.range(-0.1, 0.14)) / 2,
      0.17,
      0.68
    );
    return {
      scarred: true,
      isRescar: false,
      centerAngleRad,
      halfArcRad,
      intensity: standFire.intensity,
    };
  }

  return { scarred: false };
}
