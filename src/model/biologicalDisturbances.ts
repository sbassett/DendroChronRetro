import { SeededRNG } from './prng';
import {
  DensityGradientParams,
  DisturbanceConfig,
  FireScarGeometry,
  ResinPocketGeometry,
  SpeciesId,
} from './types';

export {
  type DensityGradientParams,
  type DisturbanceConfig,
  type FireScarGeometry,
  type ResinPocketGeometry,
};

export interface LocallyAbsentArc {
  startAngleRad: number;
  endAngleRad: number;
  centerAngleRad: number;
  deadSectorRad: number;
  taperSectorRad: number;
}

/**
 * Standard cubic smoothstep Hermite interpolation between edge0 and edge1.
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 >= edge1) return x >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Computes shortest angular difference in radians between a and b, normalized to [-PI, PI].
 */
export function angularDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Mork's criterion & asymmetric generalized logistic density function.
 * Evaluates continuous cellular tracheid density rho(u) in [densityEw, densityLw]
 * across normalized intra-ring radial position u in [0, 1].
 */
export function calculateMorkDensity(
  u: number,
  params: DensityGradientParams
): number {
  const { tauCrit, sigmaTrans, gamma, densityEw, densityLw } = params;
  const clampedU = Math.max(0, Math.min(1, u));
  const z = (clampedU - tauCrit) / Math.max(0.001, sigmaTrans);
  // Logistic sigmoidal ramp
  const logistic = 1 / (1 + Math.exp(-z));
  const sigmoidal = Math.pow(logistic, gamma);
  return densityEw + (densityLw - densityEw) * sigmoidal;
}

/**
 * Derives biophysical density gradient parameters for conifer species.
 * Abrupt species (e.g. Douglas-fir) have a steep, sharp transition near the latewood boundary.
 * Semi-gradual species (e.g. Ponderosa pine, Bristlecone pine) have a wider, smoother transition.
 */
export function computeDensityGradientParams(
  species: SpeciesId,
  latewoodFraction: number
): DensityGradientParams {
  const lwFrac = Math.max(0.09, Math.min(0.62, latewoodFraction));

  if (species === 'douglas-fir') {
    // Abrupt transition
    return {
      tauCrit: Math.max(0.40, Math.min(0.91, 1 - lwFrac)),
      sigmaTrans: 0.035,
      gamma: 1.0,
      densityEw: 0.32,
      densityLw: 0.88,
    };
  } else {
    // Semi-gradual transition (Ponderosa, Bristlecone)
    return {
      tauCrit: Math.max(0.30, Math.min(0.85, 1 - 1.35 * lwFrac)),
      sigmaTrans: 0.085,
      gamma: 0.85,
      densityEw: 0.30,
      densityLw: 0.82,
    };
  }
}

/**
 * Computes fractional intra-ring boundary positions [uTrans1, uTrans2, uLwInner]
 * for multi-ribbon spline rendering such that:
 * 0 < uTrans1 < uTrans2 <= uLwInner < 1.0
 */
export function computeDensityRibbonFractions(
  species: SpeciesId,
  latewoodFraction: number
): { uTrans1: number; uTrans2: number; uLwInner: number } {
  const lwFrac = Math.max(0.09, Math.min(0.62, latewoodFraction));
  const lwInner = 1 - lwFrac;

  if (species === 'douglas-fir') {
    // Abrupt: narrow transition zone right before latewood
    const uTrans1 = Math.max(0.25, lwInner - 0.08);
    const uTrans2 = Math.max(uTrans1 + 0.02, lwInner - 0.03);
    const uLwInner = Math.max(uTrans2 + 0.01, lwInner);
    return { uTrans1, uTrans2, uLwInner };
  } else {
    // Semi-gradual: broad transition ribbon zone
    const uTrans1 = Math.max(0.18, lwInner - 0.22);
    const uTrans2 = Math.max(uTrans1 + 0.04, lwInner - 0.10);
    const uLwInner = Math.max(uTrans2 + 0.03, lwInner);
    return { uTrans1, uTrans2, uLwInner };
  }
}

/**
 * Computes smoothstep angular attenuation factor A_camb(theta) in [0, 1]
 * for a locally absent ring.
 * Center angle is opposite the lean/vigor side (uphill/starved cambium).
 * In the core dead sector, A_camb = 0 (ring width pinches to exactly zero).
 * Outside the taper sector, A_camb = 1.
 */
export function computeLocallyAbsentAttenuation(
  theta: number,
  centerAngleRad: number,
  deadSectorRad: number,
  taperSectorRad: number
): number {
  const d = Math.abs(angularDiff(theta, centerAngleRad));
  const halfDead = deadSectorRad / 2;
  if (d <= halfDead) {
    return 0;
  }
  if (d >= halfDead + taperSectorRad) {
    return 1;
  }
  return smoothstep(halfDead, halfDead + taperSectorRad, d);
}

/**
 * Constructs a biological fire scar (catface) on the uphill trunk aspect
 * with bare charred xylem exposure and inward-curling woundwood callus rolls.
 */
export function computeFireScarGeometry(
  year: number,
  currentYear: number,
  preFireRadiusMm: number,
  uphillAzimuthRad: number,
  arcRad: number
): FireScarGeometry {
  // Clamp arc between 0.30 rad (~17 deg) and PI - 0.15 rad (~171 deg) to avoid fatal full girdling
  const clampedArc = Math.max(0.30, Math.min(Math.PI - 0.15, arcRad));
  const catfaceArcStartRad = ((uphillAzimuthRad - clampedArc / 2) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const catfaceArcEndRad = ((uphillAzimuthRad + clampedArc / 2) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);

  const yearsElapsed = Math.max(0, currentYear - year);

  // Biological callus margin convergence:
  // In subsequent post-fire years, hyperplastic woundwood callus lips roll inward
  // across the dead catface facet, narrowing the gap toward closure.
  // Gap(N) = initialGap * (0.30 + 0.70 * exp(-0.045 * N))
  const decayFactor = 0.30 + 0.70 * Math.exp(-0.045 * yearsElapsed);
  const activeArcRad = clampedArc * decayFactor;

  // Curl radius of the involuted callus roll in mm (thickens as callus rolls layer over decades)
  const curlRadiusMm = Math.max(2.0, Math.min(5.2, 2.2 + 0.11 * yearsElapsed));

  // Margin tip coordinates
  const leftAngle = uphillAzimuthRad - activeArcRad / 2;
  const rightAngle = uphillAzimuthRad + activeArcRad / 2;

  // Callus lip rolls slightly outward and over the dead facet
  const callusLipRadius = preFireRadiusMm + curlRadiusMm * 0.35;
  const leftX = callusLipRadius * Math.cos(leftAngle);
  const leftY = callusLipRadius * Math.sin(leftAngle);

  const rightX = callusLipRadius * Math.cos(rightAngle);
  const rightY = callusLipRadius * Math.sin(rightAngle);

  return {
    year,
    catfaceArcStartRad,
    catfaceArcEndRad,
    exposedWoodRadiusMm: preFireRadiusMm,
    callusMarginCoordinates: [
      { x: Number(leftX.toFixed(2)), y: Number(leftY.toFixed(2)), curlRadiusMm },
      { x: Number(rightX.toFixed(2)), y: Number(rightY.toFixed(2)), curlRadiusMm },
    ],
  };
}

/**
 * Generates a traumatic resin pocket (pitch pocket) geometry walled off in secondary xylem.
 * Returns a tangential lenticular closed SVG path matching /^M.*Z$/.
 */
export function generateResinPocketGeometry(
  ringIndex: number,
  centerRadiusMm: number,
  ringWidthMm: number,
  centerAngleRad: number,
  rng: SeededRNG
): ResinPocketGeometry {
  const arcLengthRad = rng.range(0.12, 0.22);
  const radialDepthMm = Math.max(
    0.8,
    Math.min(2.2, ringWidthMm * rng.range(0.48, 0.78))
  );

  const halfArc = arcLengthRad / 2;
  const startTheta = centerAngleRad - halfArc;
  const endTheta = centerAngleRad + halfArc;

  const rCenter = centerRadiusMm;
  const rOuter = rCenter + radialDepthMm / 2;
  const rInner = rCenter - radialDepthMm / 2;

  // 4-point tangential crescent lens:
  // Tip 1: start angle at center radius
  // Outer mid: center angle at outer radius
  // Tip 2: end angle at center radius
  // Inner mid: center angle at inner radius
  const x1 = (rCenter * Math.cos(startTheta)).toFixed(2);
  const y1 = (rCenter * Math.sin(startTheta)).toFixed(2);

  const xOuterMid = (rOuter * Math.cos(centerAngleRad)).toFixed(2);
  const yOuterMid = (rOuter * Math.sin(centerAngleRad)).toFixed(2);

  const x2 = (rCenter * Math.cos(endTheta)).toFixed(2);
  const y2 = (rCenter * Math.sin(endTheta)).toFixed(2);

  const xInnerMid = (rInner * Math.cos(centerAngleRad)).toFixed(2);
  const yInnerMid = (rInner * Math.sin(centerAngleRad)).toFixed(2);

  // Closed path starting with M, quadratic/cubic curves, ending with Z
  const pathD = `M ${x1} ${y1} Q ${xOuterMid} ${yOuterMid} ${x2} ${y2} Q ${xInnerMid} ${yInnerMid} ${x1} ${y1} Z`;

  return {
    ringIndex,
    centerAngleRad,
    arcLengthRad,
    radialDepthMm: Number(radialDepthMm.toFixed(2)),
    pathD,
  };
}
