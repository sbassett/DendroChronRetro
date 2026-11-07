import { Noise2D, SeededRNG } from './prng';
import { SpeciesProfile } from './species';
import { BarkGeometry, PolarPoint, PolarRingGeometry } from './types';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function wrapAngle(theta: number): number {
  const twoPi = 2 * Math.PI;
  return ((theta % twoPi) + twoPi) % twoPi;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge0 ? 1 : 0;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

interface FissureBoundary {
  /** Unwrapped angle in [startOffset, startOffset + 2*PI] */
  theta: number;
  /** Local stem phloem radius (mm) at the moment this fissure nucleated */
  nucRadiusMm: number;
  /** Subtle oblique fracture lean slope (tangential mm per radial mm of growth) */
  leanSlope: number;
  /** Fracture hierarchy generation (0 = primary sapling groove, 1+ = secondary split) */
  generation: number;
}

interface PlateHistoryStage {
  thetaL: number;
  thetaR: number;
  leanSlopeL: number;
  leanSlopeR: number;
  /** Stem phloem radius (mm) when this plate stage began */
  rStartPhloemMm: number;
  /** Stem phloem radius (mm) at split site when this plate stage cleaved (Infinity for leaf) */
  rEndPhloemMm: number;
  /** Current stem phloem radius (mm) at the split site that ended this stage (0 for leaf) */
  currentSplitPhloemMm: number;
}

interface EvolvedBarkPlate {
  id: string;
  thetaL: number;
  thetaR: number;
  fissureL: FissureBoundary;
  fissureR: FissureBoundary;
  generation: number;
  /** Complete ancestor interval history from primary sapling plate down to current leaf plate */
  ancestry: PlateHistoryStage[];
  /** Smoothly blended per-plate outer flake offset (mm) on old-growth armor plates */
  exfoliationOffsetMm: number;
}

interface RhytidomeCohort {
  cohortIdx: number;
  /** Cumulative rhytidome milestone (mm) when this cohort began forming */
  bStartMm: number;
  /** Cumulative rhytidome milestone (mm) when this cohort finished forming */
  bEndMm: number;
  /** Wood cambium radii (on woodAngles grid) when this cohort was sequestered */
  birthWoodRadii: number[];
  /** Mean phloem radius (mm) at birth */
  meanBirthPhloemRadiusMm: number;
}

/**
 * Biophysical Lagrangian bark engine with exact multi-generational arc-length conservation:
 * 1. Bifacial vascular cambium allometry (Larson 1994): phloem production is proportional
 *    to radial wood increment dR so bark never outpaces stem diameter growth.
 * 2. Exact Kinematic History Across Secondary Cleavages:
 *    Each cohort's angular span [alpha, beta] is contracted through every ancestor plate
 *    stage [rStart, rEnd] prior to cleavage and intersected with daughter plates at R_split,
 *    guaranteeing C0 continuity (zero sudden ridge thickening or jump in arc-seconds when
 *    a secondary fissure initiates!).
 * 3. Groove-Conforming Inner Periderms:
 *    Inner periderms pinch continuously beneath groove troughs (zero groove sloughing) while
 *    outer split cohorts ride stably with their plates.
 */
export function buildAnatomicalBarkGeometry(
  profile: SpeciesProfile,
  cambiumRadii: number[],
  woodAngles: number[],
  meanWoodRadiusMm: number,
  rngBark: SeededRNG,
  rings?: PolarRingGeometry[]
): BarkGeometry {
  const morphology = profile.bark.morphology;
  const twoPi = 2 * Math.PI;

  const rngGlobal = rngBark.fork('global-vigor');
  const rngPrimary = rngBark.fork('primary-fissures');
  const rngCohortGrid = rngBark.fork('cohort-grid');
  const phloemNoise = new Noise2D(rngBark.fork('phloem-wave'));
  const floorNoise = new Noise2D(rngBark.fork('groove-floor'));
  const archNoise = new Noise2D(rngBark.fork('plate-arch'));
  const surfaceNoise = new Noise2D(rngBark.fork('outer-crust'));
  const internalNoise = new Noise2D(rngBark.fork('periderm-arcs'));

  const barkVigorMult = rngGlobal.range(0.95, 1.06);

  const sampleOnWoodGrid = (radiiArr: number[], theta: number): number => {
    const n = woodAngles.length;
    const pos = (wrapAngle(theta) / twoPi) * n;
    const i0 = Math.floor(pos) % n;
    const i1 = (i0 + 1) % n;
    const f = pos - Math.floor(pos);
    return radiiArr[i0] * (1 - f) + radiiArr[i1] * f;
  };

  const sampleWoodRadius = (theta: number): number =>
    sampleOnWoodGrid(cambiumRadii, theta);

  // Living inner bark (conducting + non-conducting secondary phloem) thickness (Chang 1954)
  const computeBasePhloemMm = (woodRadiusMm: number): number =>
    morphology === 'plated-scaly'
      ? clamp(0.95 + woodRadiusMm * 0.0065, 0.95, 2.65)
      : clamp(1.1 + woodRadiusMm * 0.0085, 1.1, 3.35);

  const basePhloemMm = computeBasePhloemMm(meanWoodRadiusMm);

  // ---------------------------------------------------------------------------
  // 1. Bifacial Cambial Bark Accretion History (Strictly Coupled to Wood Radius)
  // ---------------------------------------------------------------------------
  const initialCortexRhytMm = morphology === 'plated-scaly' ? 1.15 : 1.05;
  const bifacialRhytCoeff = morphology === 'plated-scaly' ? 0.118 : 0.178;

  interface RingBarkState {
    bRhytMm: number;
    meanRadiusMm: number;
    radii: number[];
  }

  const ringStates: RingBarkState[] = [];
  if (rings && rings.length > 0) {
    const initRadii = rings[0].innerRadiusMm;
    const initMeanR =
      initRadii.reduce((a, b) => a + b, 0) / initRadii.length;
    let bRhyt =
      (initialCortexRhytMm + bifacialRhytCoeff * initMeanR) * barkVigorMult;
    ringStates.push({
      bRhytMm: bRhyt,
      meanRadiusMm: initMeanR,
      radii: initRadii,
    });

    let prevMeanR = initMeanR;
    for (let k = 0; k < rings.length; k++) {
      const rArr = rings[k].outerRadiusMm;
      const meanR = rArr.reduce((a, b) => a + b, 0) / rArr.length;
      const dR = Math.max(0.02, meanR - prevMeanR);
      bRhyt += bifacialRhytCoeff * dR * barkVigorMult;
      ringStates.push({
        bRhytMm: bRhyt,
        meanRadiusMm: meanR,
        radii: rArr,
      });
      prevMeanR = meanR;
    }
  } else {
    const steps = 24;
    const initR = Math.min(2.0, meanWoodRadiusMm * 0.2);
    for (let s = 0; s <= steps; s++) {
      const frac = s / steps;
      const rArr = cambiumRadii.map((r) => initR + (r - initR) * frac);
      const meanR = initR + (meanWoodRadiusMm - initR) * frac;
      const bRhyt =
        (initialCortexRhytMm + bifacialRhytCoeff * meanR) * barkVigorMult;
      ringStates.push({ bRhytMm: bRhyt, meanRadiusMm: meanR, radii: rArr });
    }
  }

  const totalProducedRhytidomeMm = Math.max(
    1.1,
    ringStates[ringStates.length - 1].bRhytMm
  );

  const interpolateBirthWoodRadii = (
    bRhytTarget: number
  ): {
    radii: number[];
    meanPhloemR: number;
  } => {
    if (bRhytTarget <= ringStates[0].bRhytMm) {
      const ph = computeBasePhloemMm(ringStates[0].meanRadiusMm);
      return {
        radii: ringStates[0].radii,
        meanPhloemR: ringStates[0].meanRadiusMm + ph,
      };
    }
    const last = ringStates[ringStates.length - 1];
    if (bRhytTarget >= last.bRhytMm) {
      return {
        radii: last.radii,
        meanPhloemR: last.meanRadiusMm + basePhloemMm,
      };
    }
    let lo = 0;
    let hi = ringStates.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (ringStates[mid].bRhytMm <= bRhytTarget) lo = mid;
      else hi = mid;
    }
    const s0 = ringStates[lo];
    const s1 = ringStates[hi];
    const t = clamp(
      (bRhytTarget - s0.bRhytMm) / Math.max(1e-6, s1.bRhytMm - s0.bRhytMm),
      0,
      1
    );
    const interpRadii = s0.radii.map((r0, idx) => r0 + (s1.radii[idx] - r0) * t);
    const meanW = s0.meanRadiusMm + (s1.meanRadiusMm - s0.meanRadiusMm) * t;
    const ph = computeBasePhloemMm(meanW);
    return {
      radii: interpRadii,
      meanPhloemR: meanW + ph,
    };
  };

  const cohorts: RhytidomeCohort[] = [];
  let bCursor = 0;
  let cIdx = 0;
  while (bCursor < totalProducedRhytidomeMm && cIdx < 220) {
    const baseStep =
      morphology === 'plated-scaly'
        ? clamp(1.3 + 0.02 * bCursor, 1.3, 2.45)
        : clamp(1.3 + 0.038 * bCursor, 1.3, 4.5);
    const dB = baseStep * rngCohortGrid.range(0.92, 1.08);
    const bNext = bCursor + dB;
    const bMid = 0.5 * (bCursor + Math.min(bNext, totalProducedRhytidomeMm));
    const birth = interpolateBirthWoodRadii(bMid);
    cohorts.push({
      cohortIdx: cIdx,
      bStartMm: bCursor,
      bEndMm: bNext,
      birthWoodRadii: birth.radii,
      meanBirthPhloemRadiusMm: birth.meanPhloemR,
    });
    bCursor = bNext;
    cIdx++;
  }

  // ---------------------------------------------------------------------------
  // 2. Hierarchical Hoop-Stress Fracture Tree With Ancestor Stage History
  // ---------------------------------------------------------------------------
  const numPrimary =
    morphology === 'plated-scaly'
      ? rngPrimary.int(9, 11)
      : rngPrimary.int(11, 14);
  const startOffset = rngPrimary.range(0, twoPi);
  const primaryWeights = Array.from({ length: numPrimary }, () =>
    morphology === 'plated-scaly'
      ? rngPrimary.range(0.72, 1.42)
      : rngPrimary.range(0.68, 1.45)
  );
  const weightSum = primaryWeights.reduce((a, b) => a + b, 0);

  const primaryFissures: FissureBoundary[] = [];
  const activeFissures: FissureBoundary[] = [];
  let angleCursor = startOffset;
  for (let p = 0; p < numPrimary; p++) {
    const nucR =
      morphology === 'plated-scaly'
        ? rngPrimary.range(7.5, 14.5)
        : rngPrimary.range(8.5, 18.5);
    const leanSlope =
      morphology === 'plated-scaly'
        ? rngPrimary.range(-0.018, 0.018)
        : rngPrimary.range(-0.075, 0.075);
    const f: FissureBoundary = {
      theta: angleCursor,
      nucRadiusMm: nucR,
      leanSlope,
      generation: 0,
    };
    primaryFissures.push(f);
    activeFissures.push(f);
    angleCursor += (primaryWeights[p] / weightSum) * twoPi;
  }
  primaryFissures.push({
    theta: startOffset + twoPi,
    nucRadiusMm: primaryFissures[0].nucRadiusMm,
    leanSlope: primaryFissures[0].leanSlope,
    generation: 0,
  });

  const plates: EvolvedBarkPlate[] = [];

  const evolvePlate = (
    plateId: string,
    thetaL: number,
    thetaR: number,
    fissureL: FissureBoundary,
    fissureR: FissureBoundary,
    generation: number,
    priorAncestry: PlateHistoryStage[],
    inheritedExfoliationMm: number,
    dRSinceParentSplitMm: number
  ): void => {
    const rngP = rngBark.fork(`plate:${plateId}`);

    const wCritMm =
      morphology === 'plated-scaly'
        ? generation === 0
          ? rngP.range(50, 78)
          : generation === 1
            ? rngP.range(76, 112)
            : rngP.range(98, 142)
        : generation === 0
          ? rngP.range(38, 64)
          : generation === 1
            ? rngP.range(78, 125)
            : rngP.range(130, 195);

    const splitFrac = rngP.range(0.39, 0.61);
    const splitLeanSlope =
      morphology === 'plated-scaly'
        ? rngP.range(-0.016, 0.016)
        : rngP.range(-0.07, 0.07);
    const ownExfoliationMm =
      morphology === 'plated-scaly'
        ? rngP.range(-1.9, 1.9)
        : rngP.range(-1.6, 1.6);

    const rStageStart = Math.max(fissureL.nucRadiusMm, fissureR.nucRadiusMm);

    // Blend exfoliation offset strictly after the new cleavage has opened (> 5 mm radial growth
    // past split), so at cleavage initiation (dRSinceParentSplitMm = 0) both daughters are 100%
    // continuous with their parent plate.
    const stageBlend =
      generation === 0
        ? 1.0
        : smoothstep(5.0, 32.0, Math.max(0, dRSinceParentSplitMm));
    const effectiveExfoliationMm =
      inheritedExfoliationMm * (1 - stageBlend) + ownExfoliationMm * stageBlend;

    const dTheta = thetaR - thetaL;
    const thetaSplit = thetaL + splitFrac * dTheta;
    const currentPhloemR = sampleWoodRadius(thetaSplit) + basePhloemMm;
    const minSplitR = rStageStart + 9.0;
    const currentPlateWidthMm = currentPhloemR * dTheta;
    const minSplitArcRad = morphology === 'plated-scaly' ? 0.22 : 0.16;

    if (
      generation < 4 &&
      dTheta > minSplitArcRad &&
      currentPhloemR > minSplitR &&
      currentPlateWidthMm > wCritMm
    ) {
      const splitNucRadiusMm = Math.max(minSplitR, wCritMm / dTheta);
      const dRSinceThisSplit = Math.max(0, currentPhloemR - splitNucRadiusMm);
      const completedStage: PlateHistoryStage = {
        thetaL,
        thetaR,
        leanSlopeL: fissureL.leanSlope,
        leanSlopeR: fissureR.leanSlope,
        rStartPhloemMm: rStageStart,
        rEndPhloemMm: splitNucRadiusMm,
        currentSplitPhloemMm: currentPhloemR,
      };
      const nextAncestry = [...priorAncestry, completedStage];
      const midFissure: FissureBoundary = {
        theta: thetaSplit,
        nucRadiusMm: splitNucRadiusMm,
        leanSlope: splitLeanSlope,
        generation: generation + 1,
      };
      activeFissures.push(midFissure);
      evolvePlate(
        `${plateId}L`,
        thetaL,
        thetaSplit,
        fissureL,
        midFissure,
        generation + 1,
        nextAncestry,
        effectiveExfoliationMm,
        dRSinceThisSplit
      );
      evolvePlate(
        `${plateId}R`,
        thetaSplit,
        thetaR,
        midFissure,
        fissureR,
        generation + 1,
        nextAncestry,
        effectiveExfoliationMm,
        dRSinceThisSplit
      );
      return;
    }

    const leafStage: PlateHistoryStage = {
      thetaL,
      thetaR,
      leanSlopeL: fissureL.leanSlope,
      leanSlopeR: fissureR.leanSlope,
      rStartPhloemMm: rStageStart,
      rEndPhloemMm: Infinity,
      currentSplitPhloemMm: 0,
    };

    plates.push({
      id: plateId,
      thetaL,
      thetaR,
      fissureL,
      fissureR,
      generation,
      ancestry: [...priorAncestry, leafStage],
      exfoliationOffsetMm: effectiveExfoliationMm,
    });
  };

  for (let p = 0; p < numPrimary; p++) {
    evolvePlate(
      `P${p}`,
      primaryFissures[p].theta,
      primaryFissures[p + 1].theta,
      primaryFissures[p],
      primaryFissures[p + 1],
      0,
      [],
      0,
      Infinity
    );
  }

  // ---------------------------------------------------------------------------
  // 3. Conservative Exterior Exfoliation & Exact Multi-Stage Arc-Length Kinematics
  // ---------------------------------------------------------------------------
  const saplingEpidermisShedMm =
    morphology === 'plated-scaly'
      ? 2.5 * smoothstep(22, 56, meanWoodRadiusMm)
      : 1.4 * smoothstep(35, 90, meanWoodRadiusMm);

  const onsetMm = morphology === 'plated-scaly' ? 12.0 : 44.0;
  const maxRetainedMm = morphology === 'plated-scaly' ? 34.0 : 80.0;
  const spanMm = maxRetainedMm - onsetMm;
  const retainedAfterWeatherMm =
    totalProducedRhytidomeMm <= onsetMm
      ? totalProducedRhytidomeMm
      : onsetMm +
        spanMm * (1 - Math.exp(-(totalProducedRhytidomeMm - onsetMm) / spanMm));
  const weatherShedMm = Math.max(
    0,
    totalProducedRhytidomeMm - retainedAfterWeatherMm
  );
  const baseShedMm = Math.max(saplingEpidermisShedMm, weatherShedMm);
  const meanRetainedGlobalMm = Math.max(
    1.0,
    totalProducedRhytidomeMm - baseShedMm
  );

  // Precompute continuous basal-root incision progress p in [0, 1] for every active fissure
  // (secondary fissures only indent the basal groove floor after propagating down through the plate)
  const crackPropRate = morphology === 'plated-scaly' ? 2.4 : 2.2;
  const inciseScaleMm = morphology === 'plated-scaly' ? 11.5 : 10.5;
  const fissureThetas = new Float64Array(activeFissures.length);
  const fissureProgress = new Float64Array(activeFissures.length);
  for (let fIdx = 0; fIdx < activeFissures.length; fIdx++) {
    const f = activeFissures[fIdx];
    const rFissureNow = sampleWoodRadius(f.theta) + basePhloemMm;
    const rootArrivalDelayMm =
      f.generation === 0 ? 0 : (meanRetainedGlobalMm * 0.55) / crackPropRate;
    fissureThetas[fIdx] = f.theta;
    fissureProgress[fIdx] = clamp(
      1 -
        Math.exp(
          -Math.max(0, rFissureNow - f.nucRadiusMm - rootArrivalDelayMm) /
            inciseScaleMm
        ),
      0,
      1
    );
  }

  const activeCohorts = cohorts
    .filter((coh) => totalProducedRhytidomeMm - coh.bStartMm > 0.02)
    .sort((a, b) => b.cohortIdx - a.cohortIdx);
  const numActive = activeCohorts.length;

  const barkSteps = 1080;
  const barkAnglesRad: number[] = [];
  const phloemOuterRadiusMm: number[] = [];
  const outerBarkRadiusMm: number[] = [];

  const cohortZ: Float64Array[] = Array.from(
    { length: numActive + 1 },
    () => new Float64Array(barkSteps)
  );

  // Reusable zero-allocation scratch buffers for multi-stage cohort kinematics (<= 6 stages)
  const stageStartCohortR = new Float64Array(8);
  const stageEndCohortR = new Float64Array(8);
  const stageCleavedGrowthR = new Float64Array(8);
  const edgePosL = new Float64Array(8);
  const edgeGapL = new Float64Array(8);
  const edgePosR = new Float64Array(8);
  const edgeGapR = new Float64Array(8);
  const pullScale = morphology === 'plated-scaly' ? 0.5 : 1.14;
  // Resinous dark wound-periderm apex half-width at established fissures (0 mm at initiation -> C0 exact!)
  const woundApexHalfWidthMm =
    morphology === 'plated-scaly'
      ? clamp(0.95 + meanWoodRadiusMm * 0.0065, 0.95, 2.8)
      : 0.95;
  // Shear-lag canyon rim saturation for tabular plate-tectonic Ponderosa armor:
  // Measured relative to cohort anchor radius r0 so angular setback is strictly monotonic (d(alpha)/dt >= 0,
  // zero backward cliff drift!) while canyon openings widen naturally as plates drift apart radially.
  const canyonShearLagMm = 4.6;

  // Exact C0-continuous kinematic evolution of a cohort's lateral presence on a plate:
  // Every cohort splits directly at active fissure roots (zero conveyor-belt floor in grooves!)
  // and rides outward stably on its plate. Newly cleaved faces initiate with zero gap and zero
  // bevel at each cohort depth so secondary cleavage causes ZERO jump in ridge width or depth.
  const computeCohortPresence = (
    ancestry: PlateHistoryStage[],
    rBirthLocal: number,
    rCurrentCohort: number,
    zMid: number,
    zOut: number,
    plateMaxRhytMm: number,
    unwrapped: number
  ): number => {
    const m = ancestry.length - 1;
    const depthFromOuterMm = Math.max(0, plateMaxRhytMm - zOut);
    const dRNeededToReachCohort = depthFromOuterMm / crackPropRate;
    stageEndCohortR[m] = rCurrentCohort;
    for (let k = m - 1; k >= 0; k--) {
      const st = ancestry[k];
      const rCohortExposure = Math.max(rBirthLocal, st.rEndPhloemMm);
      const dRSinceSplit = Math.max(
        0,
        st.currentSplitPhloemMm - rCohortExposure
      );
      const dRSinceCohortCleaved = Math.max(
        0,
        dRSinceSplit - dRNeededToReachCohort
      );
      stageCleavedGrowthR[k + 1] = dRSinceCohortCleaved;
      const splitGrowthFrac =
        st.currentSplitPhloemMm > 1e-6
          ? clamp(dRSinceCohortCleaved / st.currentSplitPhloemMm, 0, 0.88)
          : 0;
      stageEndCohortR[k] = Math.min(
        stageEndCohortR[k + 1],
        rCurrentCohort * (1 - splitGrowthFrac)
      );
    }
    stageStartCohortR[0] = ancestry[0].rStartPhloemMm;
    const dRSincePrimaryExposure = Math.max(
      0,
      rCurrentCohort - Math.max(rBirthLocal, ancestry[0].rStartPhloemMm)
    );
    stageCleavedGrowthR[0] = Math.max(
      0,
      dRSincePrimaryExposure - dRNeededToReachCohort
    );
    for (let k = 1; k <= m; k++) {
      stageStartCohortR[k] = stageEndCohortR[k - 1];
    }

    let nEdgesL = 0;
    let nEdgesR = 0;
    let initialized = false;
    let curPL = 0;
    let curPR = 0;
    const rSafe = Math.max(12.0, rCurrentCohort);

    for (let stIdx = 0; stIdx <= m; stIdx++) {
      const st = ancestry[stIdx];
      const stEndR = stageEndCohortR[stIdx];
      const pStage = clamp(
        1 - Math.exp(-stageCleavedGrowthR[stIdx] / inciseScaleMm),
        0,
        1
      );
      const apexRad = (pStage * woundApexHalfWidthMm) / rSafe;

      if (stIdx === 0) {
        curPL = pStage;
        curPR = pStage;
      } else {
        const prevSt = ancestry[stIdx - 1];
        if (st.thetaL > prevSt.thetaL + 1e-9) {
          curPL = pStage;
          if (initialized) {
            edgePosL[nEdgesL] = st.thetaL + apexRad;
            edgeGapL[nEdgesL] = apexRad;
            nEdgesL++;
          }
        }
        if (st.thetaR < prevSt.thetaR - 1e-9) {
          curPR = pStage;
          if (initialized) {
            edgePosR[nEdgesR] = st.thetaR - apexRad;
            edgeGapR[nEdgesR] = apexRad;
            nEdgesR++;
          }
        }
      }

      if (rBirthLocal >= stEndR && stIdx < m) {
        continue;
      }

      if (!initialized) {
        const initApexL = (curPL * woundApexHalfWidthMm) / rSafe;
        const initApexR = (curPR * woundApexHalfWidthMm) / rSafe;
        edgePosL[0] = st.thetaL + initApexL;
        edgeGapL[0] = initApexL;
        nEdgesL = 1;
        edgePosR[0] = st.thetaR - initApexR;
        edgeGapR[0] = initApexR;
        nEdgesR = 1;
        initialized = true;
      }

      const r0 = Math.max(rBirthLocal, stageStartCohortR[stIdx]);
      if (stEndR > r0) {
        const rawRatio = r0 / stEndR;
        const mid = 0.5 * (st.thetaL + st.thetaR);
        const dR = stEndR - r0;
        const dLeanL = (st.leanSlopeL * dR) / stEndR;
        const dLeanR = (st.leanSlopeR * dR) / stEndR;

        if (morphology === 'plated-scaly') {
          const rawStretch = 1 - rawRatio;
          const rAnchor = Math.max(30.0, r0);
          const maxWallRad = canyonShearLagMm / rAnchor;
          for (let e = 0; e < nEdgesL; e++) {
            const prev = edgePosL[e];
            const halfSpanRad = Math.max(0, mid - prev);
            const rawDeltaRad = halfSpanRad * rawStretch * pullScale;
            const remWallRad = Math.max(0.003, maxWallRad - edgeGapL[e]);
            const setbackRad =
              remWallRad * (1 - Math.exp(-rawDeltaRad / remWallRad));
            const next = clamp(
              prev + setbackRad + dLeanL,
              prev,
              Math.max(mid, prev)
            );
            edgePosL[e] = next;
            edgeGapL[e] += Math.max(0, next - prev);
          }
          for (let e = 0; e < nEdgesR; e++) {
            const prev = edgePosR[e];
            const halfSpanRad = Math.max(0, prev - mid);
            const rawDeltaRad = halfSpanRad * rawStretch * pullScale;
            const remWallRad = Math.max(0.003, maxWallRad - edgeGapR[e]);
            const setbackRad =
              remWallRad * (1 - Math.exp(-rawDeltaRad / remWallRad));
            const next = clamp(
              prev - setbackRad + dLeanR,
              Math.min(mid, prev),
              prev
            );
            edgePosR[e] = next;
            edgeGapR[e] += Math.max(0, prev - next);
          }
        } else {
          const lambda = clamp(1 - pullScale * (1 - rawRatio), 0.14, 1.0);
          for (let e = 0; e < nEdgesL; e++) {
            const prev = edgePosL[e];
            const next = mid + (prev - mid) * lambda + dLeanL;
            edgePosL[e] = next;
            edgeGapL[e] += Math.max(0, next - prev);
          }
          for (let e = 0; e < nEdgesR; e++) {
            const prev = edgePosR[e];
            const next = mid + (prev - mid) * lambda + dLeanR;
            edgePosR[e] = next;
            edgeGapR[e] += Math.max(0, prev - next);
          }
        }
      }
    }

    const targetBevelMm =
      morphology === 'plated-scaly'
        ? 0.65 + 0.018 * zMid
        : 2.1 + 0.2 * zMid;
    const maxBevelRad = targetBevelMm / rSafe;

    let presence = 1.0;
    for (let e = 0; e < nEdgesL; e++) {
      const alpha = edgePosL[e];
      const bevel = Math.min(maxBevelRad, edgeGapL[e] * 1.35);
      const fL =
        bevel <= 1e-7
          ? unwrapped >= alpha
            ? 1.0
            : 0.0
          : smoothstep(alpha, alpha + bevel, unwrapped);
      presence *= fL;
    }
    for (let e = 0; e < nEdgesR; e++) {
      const beta = edgePosR[e];
      const bevel = Math.min(maxBevelRad, edgeGapR[e] * 1.35);
      const fR =
        bevel <= 1e-7
          ? unwrapped <= beta
            ? 1.0
            : 0.0
          : 1.0 - smoothstep(beta - bevel, beta, unwrapped);
      presence *= fR;
    }

    return presence;
  };

  let pCursor = 0;

  for (let i = 0; i < barkSteps; i++) {
    const theta = (i / barkSteps) * twoPi;
    barkAnglesRad.push(theta);

    const rCambium = sampleWoodRadius(theta);
    const rApproxPhloem = rCambium + basePhloemMm;

    const unwrapped = startOffset + wrapAngle(theta - startOffset);
    while (
      pCursor < plates.length - 1 &&
      unwrapped >= plates[pCursor].thetaR
    ) {
      pCursor++;
    }
    if (unwrapped < plates[pCursor].thetaL) {
      pCursor = 0;
      while (
        pCursor < plates.length - 1 &&
        unwrapped >= plates[pCursor].thetaR
      ) {
        pCursor++;
      }
    }

    const plate = plates[pCursor];

    const matureFlakeWeight = smoothstep(18, 36, totalProducedRhytidomeMm);
    const plateShedMm = clamp(
      baseShedMm + matureFlakeWeight * plate.exfoliationOffsetMm * 0.75,
      0,
      Math.max(0, totalProducedRhytidomeMm - 1.0)
    );
    const plateMaxRhytMm = Math.max(
      1.0,
      totalProducedRhytidomeMm - plateShedMm
    );

    // Global physical-mm fracture-root dip & groove muting summed across all active fissures
    const dipDecayMm =
      morphology === 'plated-scaly'
        ? clamp(2.0 + rApproxPhloem * 0.015, 2.0, 5.4)
        : clamp(2.2 + rApproxPhloem * 0.024, 2.2, 9.5);
    const muteDecayMm = dipDecayMm * 1.15;
    let dipSum = 0;
    let nearActiveGroove = 0;
    for (let fIdx = 0; fIdx < fissureThetas.length; fIdx++) {
      const pF = fissureProgress[fIdx];
      if (pF <= 1e-6) continue;
      let dAng = Math.abs(unwrapped - fissureThetas[fIdx]);
      if (dAng > Math.PI) dAng = twoPi - dAng;
      const distMm = dAng * rApproxPhloem;
      if (distMm < muteDecayMm * 7.0) {
        const genWeight = activeFissures[fIdx].generation === 0 ? 1.0 : 0.88;
        dipSum += pF * genWeight * Math.exp(-distMm / dipDecayMm);
        const mVal = pF * Math.exp(-distMm / muteDecayMm);
        if (mVal > nearActiveGroove) nearActiveGroove = mVal;
      }
    }

    // Living inner phloem gently compresses beneath deep established fissures (Chang 1954)
    // and displays subtle lunate phellogen scalloping along plate undersides
    const phloemGroovePinch = 1 - 0.21 * Math.min(1.05, dipSum);
    const phloemWave =
      1 +
      0.035 * phloemNoise.polarFbm(theta, 7, 1.1, 2) +
      0.038 *
        (1 - 0.55 * nearActiveGroove) *
        phloemNoise.polarFbm(theta, 16, 2.7, 2);
    const localPhloem = Math.max(
      0.68,
      basePhloemMm * phloemGroovePinch * phloemWave
    );
    const rPhloem = rCambium + localPhloem;
    phloemOuterRadiusMm.push(rPhloem);

    // Thin non-banded dark resinous wound-periderm seal covering living phloem in groove troughs,
    // gently indented right at the fissure apex so trough minima remain locked at fissure centers
    const baseSealMm =
      morphology === 'plated-scaly'
        ? clamp(0.85 + meanRetainedGlobalMm * 0.04, 0.85, 2.15)
        : clamp(1.35 + meanRetainedGlobalMm * 0.095, 1.35, 5.5);
    const localSealMm =
      baseSealMm *
      (1 - 0.26 * Math.min(1.1, dipSum)) *
      (1 + 0.045 * floorNoise.polarFbm(theta, 5.0, 3.1, 2));

    const rootDip =
      morphology === 'plated-scaly'
        ? 1 - 0.032 * Math.min(1.2, dipSum)
        : 1 - 0.12 * Math.min(1.25, dipSum);
    const crustMute = 1 - 0.85 * nearActiveGroove;
    const archAmp = morphology === 'plated-scaly' ? 0.011 : 0.025;
    const archMod =
      1 + archAmp * crustMute * archNoise.polarFbm(theta, 6.0, 1.9, 2);
    const surfNoiseFactor =
      morphology === 'plated-scaly'
        ? 1 + 0.01 * crustMute * surfaceNoise.polarFbm(theta, 24.0, 2.7, 2)
        : 1 +
          0.065 *
            crustMute *
            surfaceNoise.polarFbm(theta, 20.0, meanWoodRadiusMm * 0.04, 3);

    const profileScale = rootDip * archMod * surfNoiseFactor;

    let cumZ = 0;
    cohortZ[0][i] = 0;

    for (let s = 0; s < numActive; s++) {
      const coh = activeCohorts[s];
      const zInUnclipped = Math.max(0, totalProducedRhytidomeMm - coh.bEndMm);
      const rawZOut = totalProducedRhytidomeMm - coh.bStartMm;

      let localLayerThick = 0;
      if (rawZOut > 0 && zInUnclipped < plateMaxRhytMm) {
        const zOut = Math.min(rawZOut, plateMaxRhytMm);
        const dH = Math.max(0, zOut - zInUnclipped);
        if (dH > 1e-4) {
          const zMid = 0.5 * (zInUnclipped + zOut);
          const zMidMaterial = 0.5 * (zInUnclipped + rawZOut);
          const birthWoodR = sampleOnWoodGrid(coh.birthWoodRadii, theta);
          const rBirthLocal = birthWoodR + computeBasePhloemMm(birthWoodR);
          const rCurrentCohort = rPhloem + zMidMaterial;

          const presence = computeCohortPresence(
            plate.ancestry,
            rBirthLocal,
            rCurrentCohort,
            zMid,
            zOut,
            plateMaxRhytMm,
            unwrapped
          );

          localLayerThick = dH * profileScale * presence;
        }
      }

      cumZ += localLayerThick;
      cohortZ[s + 1][i] = cumZ;
    }

    outerBarkRadiusMm.push(rPhloem + Math.max(localSealMm, cumZ));
  }

  const sampleBarkGrid = (
    arr: Float64Array | number[],
    theta: number
  ): number => {
    const pos = (wrapAngle(theta) / twoPi) * barkSteps;
    const i0 = Math.floor(pos) % barkSteps;
    const i1 = (i0 + 1) % barkSteps;
    const f = pos - Math.floor(pos);
    return arr[i0] * (1 - f) + arr[i1] * f;
  };

  // ---------------------------------------------------------------------------
  // 4. Lagrangian Internal Periderm Scales & Cork Lenses (Conforming to Grooves!)
  // ---------------------------------------------------------------------------
  const rhytidomeCells: BarkGeometry['rhytidomeCells'] = [];
  const peridermSeams: BarkGeometry['peridermSeams'] = [];

  if (morphology === 'furrowed-corky') {
    for (let s = 0; s < numActive; s++) {
      const coh = activeCohorts[s];
      const rngC = rngBark.fork(`df-cohort:${coh.cohortIdx}`);
      const zInArr = cohortZ[s];
      const zOutArr = cohortZ[s + 1];
      const nominalThick = Math.max(0.4, coh.bEndMm - coh.bStartMm);
      const tierFrac = s / Math.max(1, numActive - 1);

      const corkHalfFrac = rngC.range(0.2, 0.35) * (1 - 0.12 * tierFrac);
      const lensesInTier = rngC.int(5, 10);
      const tierPhase = rngC.range(0, twoPi);

      for (let l = 0; l < lensesInTier; l++) {
        const arcStart =
          tierPhase + (l / lensesInTier) * twoPi + rngC.range(-0.08, 0.08);
        const arcSpan = (twoPi / lensesInTier) * rngC.range(0.68, 0.94);
        const steps = Math.max(12, Math.round(arcSpan * 36));

        const corkGray = Math.round(
          clamp(
            profile.palette.barkHighlightGray +
              rngC.range(-12, 18) -
              tierFrac * 10,
            82,
            138
          )
        );

        let runOuter: PolarPoint[] = [];
        let runInner: PolarPoint[] = [];
        const flushRun = () => {
          if (runOuter.length >= 3) {
            rhytidomeCells.push({
              pointsPolar: [...runOuter, ...runInner.slice().reverse()],
              fillGray: corkGray,
              strokeGray: 24,
              strokeWidthMm: clamp(nominalThick * 0.085, 0.12, 0.4),
            });
          }
          runOuter = [];
          runInner = [];
        };

        for (let sIdx = 0; sIdx <= steps; sIdx++) {
          const frac = sIdx / steps;
          const theta = arcStart + frac * arcSpan;
          const z0 = sampleBarkGrid(zInArr, theta);
          const z1 = sampleBarkGrid(zOutArr, theta);
          const locThick = z1 - z0;

          if (locThick < 0.07) {
            flushRun();
            continue;
          }

          const pinch = Math.pow(Math.sin(frac * Math.PI), 0.45);
          const rPh = sampleBarkGrid(phloemOuterRadiusMm, theta);
          const wave =
            locThick *
            0.22 *
            internalNoise.polarFbm(theta, 6.5, coh.cohortIdx * 1.7, 2);
          const rMid = rPh + 0.5 * (z0 + z1) + wave;
          const halfT = locThick * corkHalfFrac * pinch;

          runOuter.push({ theta, r: rMid + halfT });
          runInner.push({ theta, r: Math.max(rPh * 0.998, rMid - halfT) });
        }
        flushRun();
      }

      const seamSteps = 270;
      let seamRun: PolarPoint[] = [];
      const flushSeam = () => {
        if (seamRun.length >= 2) {
          peridermSeams.push({
            pointsPolar: seamRun,
            gray: 20,
            widthMm: clamp(nominalThick * 0.075, 0.11, 0.34),
          });
        }
        seamRun = [];
      };

      for (let sIdx = 0; sIdx <= seamSteps; sIdx++) {
        const theta = (sIdx / seamSteps) * twoPi;
        const z0 = sampleBarkGrid(zInArr, theta);
        const z1 = sampleBarkGrid(zOutArr, theta);
        const locThick = z1 - z0;
        if (locThick < 0.05) {
          flushSeam();
          continue;
        }
        const rPh = sampleBarkGrid(phloemOuterRadiusMm, theta);
        const wave =
          locThick *
          0.18 *
          internalNoise.polarFbm(theta, 7.5, coh.cohortIdx * 2.3 + 9.1, 2);
        seamRun.push({ theta, r: rPh + z0 + 0.1 * locThick + wave });
      }
      flushSeam();
    }
  } else {
    for (let s = 0; s < numActive; s++) {
      const coh = activeCohorts[s];
      const rngC = rngBark.fork(`pp-cohort:${coh.cohortIdx}`);
      const zInArr = cohortZ[s];
      const zOutArr = cohortZ[s + 1];
      const nominalThick = Math.max(0.25, coh.bEndMm - coh.bStartMm);
      const tierFrac = s / Math.max(1, numActive - 1);

      const birthCircMm = twoPi * Math.max(22, coh.meanBirthPhloemRadiusMm);
      const targetBirthScaleWidthMm = clamp(
        15 + coh.meanBirthPhloemRadiusMm * 0.12,
        15,
        52
      );
      const scalesPerCircle = clamp(
        Math.round(birthCircMm / targetBirthScaleWidthMm),
        14,
        48
      );

      const tierAngleOffset =
        startOffset +
        (coh.cohortIdx % 2 === 1 ? Math.PI / scalesPerCircle : 0) +
        rngC.range(-0.04, 0.04);

      const boundaryOffsets: number[] = [0];
      for (let sc = 1; sc < scalesPerCircle; sc++) {
        const jitter = rngC.range(-0.18, 0.18) / scalesPerCircle;
        boundaryOffsets.push((sc / scalesPerCircle + jitter) * twoPi);
      }
      boundaryOffsets.push(twoPi);

      // Shared periderm interface seeds so adjacent tabular cohorts stack flush without void pockets
      const inInterfaceSeed = (coh.cohortIdx + 1) * 1.73;
      const outInterfaceSeed = coh.cohortIdx * 1.73;

      for (let sc = 0; sc < scalesPerCircle; sc++) {
        const scStart = tierAngleOffset + boundaryOffsets[sc];
        const scSpan = boundaryOffsets[sc + 1] - boundaryOffsets[sc];
        const steps = Math.max(24, Math.ceil((scSpan / twoPi) * 900));

        const tierParityLift = coh.cohortIdx % 2 === 1 ? 4.5 : -4.5;
        const scaleGray = Math.round(
          clamp(
            118 +
              tierFrac * 52 +
              tierParityLift +
              rngC.range(-6, 7),
            110,
            180
          )
        );

        let runOuter: PolarPoint[] = [];
        let runInner: PolarPoint[] = [];
        let runLam: PolarPoint[] = [];
        let maxRunLocThick = 0;

        const flushScaleRun = () => {
          if (runOuter.length >= 2) {
            const effThick = Math.min(nominalThick, maxRunLocThick);
            rhytidomeCells.push({
              pointsPolar: [...runOuter, ...runInner.slice().reverse()],
              fillGray: scaleGray,
              strokeGray: 32,
              strokeWidthMm: clamp(effThick * 0.062, 0.05, 0.14),
            });
            if (effThick > 2.35 && runLam.length >= 2) {
              peridermSeams.push({
                pointsPolar: runLam,
                gray: clamp(scaleGray - 22, 74, 142),
                widthMm: clamp(effThick * 0.032, 0.04, 0.09),
              });
            }
          }
          runOuter = [];
          runInner = [];
          runLam = [];
          maxRunLocThick = 0;
        };

        for (let k = 0; k <= steps; k++) {
          const u = k / steps;
          const theta = scStart + u * scSpan;
          const z0 = sampleBarkGrid(zInArr, theta);
          const z1 = sampleBarkGrid(zOutArr, theta);
          const zSurf = sampleBarkGrid(cohortZ[numActive], theta);
          const locThick = z1 - z0;

          if (locThick < 0.025) {
            flushScaleRun();
            continue;
          }

          if (locThick > maxRunLocThick) maxRunLocThick = locThick;

          const rPh = sampleBarkGrid(phloemOuterRadiusMm, theta);
          const scallop = Math.sin(u * Math.PI);
          const sharedAmpIn = Math.min(locThick, 1.35) * 0.095;
          const sharedAmpOut = Math.min(locThick, 1.35) * 0.095;
          const waveIn =
            s === 0
              ? 0
              : sharedAmpIn *
                internalNoise.polarFbm(theta, 11.0, inInterfaceSeed, 2);
          const waveOut =
            sharedAmpOut *
            internalNoise.polarFbm(theta, 11.0, outInterfaceSeed, 2);

          const isExteriorLayer = z1 >= zSurf - 0.08;
          const padOut = isExteriorLayer ? 0.85 : 0;
          const padIn = s === 0 ? -0.06 : 0;

          const rIn =
            rPh + z0 + padIn + waveIn - (s === 0 ? 0 : locThick * 0.025 * scallop);
          const rOut =
            rPh + z1 + padOut + waveOut + locThick * 0.035 * scallop;

          runInner.push({ theta, r: rIn });
          runOuter.push({ theta, r: rOut });
          runLam.push({
            theta,
            r: rPh + 0.5 * (z0 + z1) + 0.5 * (waveIn + waveOut),
          });
        }
        flushScaleRun();
      }
    }
  }

  const totalThicknesses = outerBarkRadiusMm.map(
    (rOut, idx) => rOut - sampleWoodRadius(barkAnglesRad[idx])
  );

  return {
    morphology,
    meanThicknessMm:
      totalThicknesses.reduce((a, b) => a + b, 0) / totalThicknesses.length,
    maxThicknessMm: Math.max(...totalThicknesses),
    minThicknessMm: Math.min(...totalThicknesses),
    phloemThicknessMm: basePhloemMm,
    cambiumRadiusMm: cambiumRadii,
    phloemOuterRadiusMm,
    outerBarkRadiusMm,
    barkAnglesRad,
    rhytidomeCells,
    peridermSeams,
  };
}
