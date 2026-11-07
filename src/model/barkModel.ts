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
  /** Subtle oblique fracture lean across radial depth */
  lean: number;
  /** Basal protective periderm floor multiplier specific to this groove */
  floorMult: number;
  /** Fracture hierarchy generation (0 = primary sapling groove, 1+ = secondary split) */
  generation: number;
}

interface EvolvedBarkPlate {
  id: string;
  thetaL: number;
  thetaR: number;
  fissureL: FissureBoundary;
  fissureR: FissureBoundary;
  generation: number;
  /** Per-plate stochastic outer flake offset (mm) on old-growth armor plates */
  exfoliationOffsetMm: number;
  /** Subtle outer plate arch/crest multiplier */
  archMult: number;
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
 * Biophysical Lagrangian bark engine modeling:
 * 1. Bifacial vascular cambium allometry (Larson 1994): phloem production is strictly
 *    proportional to radial wood increment dR (never outpacing stem diameter growth).
 * 2. Persistent primary sapling grooves & shear-lag tensile bifurcation of wide plates.
 * 3. Lagrangian cohort deformation:
 *    - Inner sequential periderms pinch & curve continuously beneath groove troughs
 *      (zero sloughing or disappearing layers in grooves).
 *    - Outer dead rhytidome cohorts conserve physical birth arc length L_c = dTheta * R_eff
 *      and ride intact with their bark plate until old-growth exterior weathering gently
 *      flakes only the outermost exposed plate crests.
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

  // Living inner bark (secondary phloem) thickness
  const basePhloemMm = clamp(1.05 + meanWoodRadiusMm * 0.013, 1.0, 4.2);

  // ---------------------------------------------------------------------------
  // 1. Bifacial Cambial Bark Accretion History (Strictly Coupled to Wood Radius)
  // ---------------------------------------------------------------------------
  // Because fusiform cambial initials divide bifacially (~7-9 xylem cells inward per
  // 1 phloem cell outward), cumulative bark production tracks radial wood expansion dR
  // rather than raw elapsed years, preventing bark from outpacing diameter growth.
  const initialCortexRhytMm = morphology === 'plated-scaly' ? 1.35 : 1.05;
  const bifacialRhytCoeff = morphology === 'plated-scaly' ? 0.172 : 0.196;

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
    let bRhyt = (initialCortexRhytMm + bifacialRhytCoeff * initMeanR) * barkVigorMult;
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
      const ph = clamp(1.0 + ringStates[0].meanRadiusMm * 0.013, 1.0, 4.2);
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
    const ph = clamp(1.0 + meanW * 0.013, 1.0, 4.2);
    return {
      radii: interpRadii,
      meanPhloemR: meanW + ph,
    };
  };

  // Immutable sequential periderm cohort ladder from sapling establishment (c = 0) inward
  const cohorts: RhytidomeCohort[] = [];
  let bCursor = 0;
  let cIdx = 0;
  while (bCursor < totalProducedRhytidomeMm && cIdx < 160) {
    const baseStep =
      morphology === 'plated-scaly'
        ? clamp(1.35 + 0.044 * bCursor, 1.35, 4.8)
        : clamp(1.4 + 0.048 * bCursor, 1.4, 5.6);
    const dB = baseStep * rngCohortGrid.range(0.9, 1.1);
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
  // 2. Hierarchical Hoop-Stress Fracture Tree (Persistent & Bifurcating Grooves)
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
  let angleCursor = startOffset;
  for (let p = 0; p < numPrimary; p++) {
    const nucR =
      morphology === 'plated-scaly'
        ? rngPrimary.range(5.5, 13.5)
        : rngPrimary.range(8.5, 19.5);
    const lean =
      morphology === 'plated-scaly'
        ? rngPrimary.range(-0.07, 0.07)
        : rngPrimary.range(-0.13, 0.13);
    const floorMult = rngPrimary.range(0.9, 1.12);
    primaryFissures.push({
      theta: angleCursor,
      nucRadiusMm: nucR,
      lean,
      floorMult,
      generation: 0,
    });
    angleCursor += (primaryWeights[p] / weightSum) * twoPi;
  }
  primaryFissures.push({
    theta: startOffset + twoPi,
    nucRadiusMm: primaryFissures[0].nucRadiusMm,
    lean: primaryFissures[0].lean,
    floorMult: primaryFissures[0].floorMult,
    generation: 0,
  });

  const plates: EvolvedBarkPlate[] = [];

  const evolvePlate = (
    plateId: string,
    thetaL: number,
    thetaR: number,
    fissureL: FissureBoundary,
    fissureR: FissureBoundary,
    generation: number
  ): void => {
    const rngP = rngBark.fork(`plate:${plateId}`);

    const wCritMm =
      morphology === 'plated-scaly'
        ? generation === 0
          ? rngP.range(54, 86)
          : generation === 1
            ? rngP.range(135, 210)
            : rngP.range(220, 320)
        : generation === 0
          ? rngP.range(38, 64)
          : generation === 1
            ? rngP.range(78, 125)
            : rngP.range(130, 195);

    const splitFrac = rngP.range(0.39, 0.61);
    const splitLean =
      morphology === 'plated-scaly'
        ? rngP.range(-0.07, 0.07)
        : rngP.range(-0.12, 0.12);
    const exfoliationOffsetMm =
      morphology === 'plated-scaly'
        ? rngP.range(-2.2, 2.2)
        : rngP.range(-1.6, 1.6);
    const splitFloorMult = rngP.range(0.9, 1.12);
    const archMult = rngP.range(0.975, 1.025);

    const dTheta = thetaR - thetaL;
    const thetaSplit = thetaL + splitFrac * dTheta;
    const currentPhloemR = sampleWoodRadius(thetaSplit) + basePhloemMm;
    const parentEstablishedR = Math.max(
      fissureL.nucRadiusMm,
      fissureR.nucRadiusMm
    );
    const minSplitR = parentEstablishedR + 9.0;
    const currentPlateWidthMm = currentPhloemR * dTheta;

    if (
      generation < 4 &&
      currentPhloemR > minSplitR &&
      currentPlateWidthMm > wCritMm
    ) {
      const splitNucRadiusMm = Math.max(minSplitR, wCritMm / dTheta);
      const midFissure: FissureBoundary = {
        theta: thetaSplit,
        nucRadiusMm: splitNucRadiusMm,
        lean: splitLean,
        floorMult: splitFloorMult,
        generation: generation + 1,
      };
      evolvePlate(
        `${plateId}L`,
        thetaL,
        thetaSplit,
        fissureL,
        midFissure,
        generation + 1
      );
      evolvePlate(
        `${plateId}R`,
        thetaSplit,
        thetaR,
        midFissure,
        fissureR,
        generation + 1
      );
      return;
    }

    plates.push({
      id: plateId,
      thetaL,
      thetaR,
      fissureL,
      fissureR,
      generation,
      exfoliationOffsetMm,
      archMult,
    });
  };

  for (let p = 0; p < numPrimary; p++) {
    evolvePlate(
      `P${p}`,
      primaryFissures[p].theta,
      primaryFissures[p + 1].theta,
      primaryFissures[p],
      primaryFissures[p + 1],
      0
    );
  }

  // ---------------------------------------------------------------------------
  // 3. Conservative Exterior Exfoliation (Plate Tops Only; Zero Groove Sloughing!)
  // ---------------------------------------------------------------------------
  // Young and mid-aged trees retain nearly all rhytidome cohorts so bark bands stay
  // anchored to their plates rather than conveyor-belting off the tips:
  //   (a) Only fragile primary sapling epidermis/cortex (b < ~2.6 mm, born at R < 12 mm)
  //       flakes off once the pole stem expands past ~45 mm radius.
  //   (b) Mature weathering exfoliation only engages gradually once total rhytidome
  //       exceeds ~40 mm (old-growth plates > ~110-140 yr), softly approaching ~68-92 mm.
  const saplingEpidermisShedMm =
    morphology === 'plated-scaly'
      ? 2.6 * smoothstep(28, 75, meanWoodRadiusMm)
      : 1.4 * smoothstep(35, 90, meanWoodRadiusMm);

  const onsetMm = morphology === 'plated-scaly' ? 40.0 : 58.0;
  const maxRetainedMm = morphology === 'plated-scaly' ? 68.0 : 94.0;
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

  // Active cohorts ordered from innermost (newest, index 0) to outermost (oldest, index M-1)
  const activeCohorts = cohorts
    .filter((coh) => totalProducedRhytidomeMm - coh.bStartMm > 0.02)
    .sort((a, b) => b.cohortIdx - a.cohortIdx);
  const numActive = activeCohorts.length;

  const barkSteps = 1080;
  const barkAnglesRad: number[] = [];
  const phloemOuterRadiusMm: number[] = [];
  const outerBarkRadiusMm: number[] = [];

  // Lagrangian cumulative radial offset Z[s][i] above rPhloem[i] for s = 0 .. numActive:
  //   Z[0][i] = 0 (inner phloem boundary)
  //   Z[numActive][i] = localRhytMm (exact exterior bark contour)
  // Every cohort's polygon follows its true deformed Lagrangian band [Z[s], Z[s+1]],
  // pinching continuously beneath groove troughs and terminating on plate terrace walls!
  const cohortZ: Float64Array[] = Array.from(
    { length: numActive + 1 },
    () => new Float64Array(barkSteps)
  );

  let pCursor = 0;

  for (let i = 0; i < barkSteps; i++) {
    const theta = (i / barkSteps) * twoPi;
    barkAnglesRad.push(theta);

    const rCambium = sampleWoodRadius(theta);
    const localPhloem =
      basePhloemMm * (1 + 0.045 * phloemNoise.polarFbm(theta, 8, 1.1, 2));
    const rPhloem = rCambium + localPhloem;
    phloemOuterRadiusMm.push(rPhloem);

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
    const dTheta = Math.max(1e-5, plate.thetaR - plate.thetaL);
    const u = clamp((unwrapped - plate.thetaL) / dTheta, 0, 1);

    // Per-plate outer flake offset engages only when mature scale shedding is active
    const matureFlakeWeight = smoothstep(36, 56, totalProducedRhytidomeMm);
    const plateShedMm = clamp(
      baseShedMm + matureFlakeWeight * plate.exfoliationOffsetMm,
      0,
      Math.max(0, totalProducedRhytidomeMm - 1.0)
    );
    const plateMaxRhytMm = Math.max(
      1.0,
      totalProducedRhytidomeMm - plateShedMm
    );

    const rNowL = sampleWoodRadius(plate.thetaL) + basePhloemMm;
    const rNowR = sampleWoodRadius(plate.thetaR) + basePhloemMm;
    const inciseScaleMm = morphology === 'plated-scaly' ? 11.5 : 10.5;
    const pL = clamp(
      1 -
        Math.exp(
          -Math.max(0, rNowL - plate.fissureL.nucRadiusMm) / inciseScaleMm
        ),
      0,
      1
    );
    const pR = clamp(
      1 -
        Math.exp(
          -Math.max(0, rNowR - plate.fissureR.nucRadiusMm) / inciseScaleMm
        ),
      0,
      1
    );

    // Continuous basal protective periderm bridge beneath grooves (no sloughing in grooves!)
    const baseFloorFrac =
      morphology === 'plated-scaly'
        ? 1 - profile.bark.fissureDepthFraction * 1.12
        : 1 - profile.bark.fissureDepthFraction * 1.14;
    const localFloorMult =
      plate.fissureL.floorMult * (1 - u) + plate.fissureR.floorMult * u;
    const floorFrac = clamp(baseFloorFrac * localFloorMult, 0.15, 0.36);
    const meanRetainedRhytMm = Math.max(
      1.0,
      totalProducedRhytidomeMm - baseShedMm
    );
    const floorHeightMm = meanRetainedRhytMm * floorFrac;

    // Subtle concave pinching of inner wound/fissure-floor periderms directly beneath groove troughs,
    // plus subtle surface relief on plate tops
    const rootDip =
      1 -
      0.16 * (pL * Math.exp(-u / 0.085) + pR * Math.exp(-(1 - u) / 0.085));
    const edgeMute = smoothstep(0.0, 0.12, Math.min(u, 1 - u));
    const centerDist = Math.abs(u - 0.5) * 2;
    const archFactor =
      morphology === 'plated-scaly'
        ? 1 +
          (plate.archMult - 1) * edgeMute -
          0.02 * centerDist * centerDist * edgeMute
        : 1 + (plate.archMult - 1) * edgeMute;

    const surfNoiseFactor =
      morphology === 'plated-scaly'
        ? 1 + 0.012 * edgeMute * surfaceNoise.polarFbm(theta, 24.0, 2.7, 2)
        : 1 +
          0.065 *
            edgeMute *
            surfaceNoise.polarFbm(theta, 20.0, meanWoodRadiusMm * 0.04, 3);

    const profileScale = rootDip * archFactor * surfNoiseFactor;

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
          const heightNorm = clamp(zMid / Math.max(1.0, plateMaxRhytMm), 0, 1);

          // Cohorts below floorHeightMm pinch smoothly beneath the groove trough without splitting;
          // cohorts above floorHeightMm conserve dead-bark arc length and terminate at plate walls!
          const aboveFloorWeight = smoothstep(
            floorHeightMm * 0.65,
            floorHeightMm * 1.15,
            zOut
          );

          if (aboveFloorWeight <= 0.001) {
            localLayerThick = dH * profileScale;
          } else {
            const rBirthLocal =
              sampleOnWoodGrid(coh.birthWoodRadii, theta) +
              clamp(1.0 + coh.meanBirthPhloemRadiusMm * 0.013, 1.0, 4.2);
            const rCurrentCohort = rPhloem + zMid;

            const rEffL = Math.max(rBirthLocal, plate.fissureL.nucRadiusMm);
            const rEffR = Math.max(rBirthLocal, plate.fissureR.nucRadiusMm);

            const stretchGapL = clamp(
              1 - rEffL / Math.max(1.0, rCurrentCohort),
              0,
              0.76
            );
            const stretchGapR = clamp(
              1 - rEffR / Math.max(1.0, rCurrentCohort),
              0,
              0.76
            );

            const pullCoeff = morphology === 'plated-scaly' ? 0.5 : 0.62;
            const rootNotch =
              (morphology === 'plated-scaly' ? 0.026 : 0.035) *
              Math.pow(heightNorm, 0.55);

            const rawPullL =
              pL * aboveFloorWeight * (rootNotch + pullCoeff * stretchGapL);
            const rawPullR =
              pR * aboveFloorWeight * (rootNotch + pullCoeff * stretchGapR);

            const leanShiftL = plate.fissureL.lean * heightNorm * pL;
            const leanShiftR = plate.fissureR.lean * heightNorm * pR;

            let uLeft = clamp(rawPullL + leanShiftL, 0, 0.46);
            let uRight = clamp(1 - rawPullR + leanShiftR, 0.54, 1);
            if (uRight < uLeft + 0.04) {
              const midU = 0.5 * (uLeft + uRight);
              uLeft = midU - 0.02;
              uRight = midU + 0.02;
            }

            const bevelU =
              morphology === 'plated-scaly'
                ? 0.018 + 0.008 * (1 - pL * pR)
                : 0.075 + 0.045 * heightNorm;

            const inLeft = smoothstep(
              uLeft - bevelU * 0.5,
              uLeft + bevelU * 0.5,
              u
            );
            const inRight =
              1 - smoothstep(uRight - bevelU * 0.5, uRight + bevelU * 0.5, u);
            const presence = inLeft * inRight;

            localLayerThick =
              dH *
              profileScale *
              (1 - aboveFloorWeight + aboveFloorWeight * presence);
          }
        }
      }

      cumZ += localLayerThick;
      cohortZ[s + 1][i] = cumZ;
    }

    outerBarkRadiusMm.push(rPhloem + Math.max(0.45, cumZ));
  }

  // Smooth circular sampler for Lagrangian cohort surface Z[s] & phloem radius at arbitrary theta
  const sampleBarkGrid = (arr: Float64Array | number[], theta: number): number => {
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

        // Emit contiguous visible sub-spans where this cohort has positive thickness (on ridges / pinched base)
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

          if (locThick < 0.08) {
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
          runInner.push({ theta, r: Math.max(rPh * 0.996, rMid - halfT) });
        }
        flushRun();
      }

      // Continuous/conforming dark phellogen seam following cohortZ[s] (pinches smoothly under grooves!)
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
        if (locThick < 0.06) {
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
    // PONDEROSA PINE: Lagrangian puzzle-scale compartments conforming beneath grooves
    // and terminating cleanly on plate canyon walls (never marching into troughs!)
    for (let s = 0; s < numActive; s++) {
      const coh = activeCohorts[s];
      const rngC = rngBark.fork(`pp-cohort:${coh.cohortIdx}`);
      const zInArr = cohortZ[s];
      const zOutArr = cohortZ[s + 1];
      const nominalThick = Math.max(0.35, coh.bEndMm - coh.bStartMm);
      const tierFrac = s / Math.max(1, numActive - 1);

      const birthCircMm = twoPi * Math.max(22, coh.meanBirthPhloemRadiusMm);
      const targetBirthScaleWidthMm = clamp(
        14 + coh.meanBirthPhloemRadiusMm * 0.11,
        14,
        46
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

      const inSeed = coh.bEndMm * 0.42;
      const outSeed = coh.bStartMm * 0.42;

      for (let sc = 0; sc < scalesPerCircle; sc++) {
        const scStart = tierAngleOffset + boundaryOffsets[sc];
        const scSpan = boundaryOffsets[sc + 1] - boundaryOffsets[sc];
        const steps = 18;

        const tierParityLift = coh.cohortIdx % 2 === 1 ? 6 : -4;
        const scaleGray = Math.round(
          clamp(
            profile.palette.barkBaseGray +
              24 +
              tierFrac * 36 +
              tierParityLift +
              rngC.range(-10, 11),
            84,
            158
          )
        );

        let runOuter: PolarPoint[] = [];
        let runInner: PolarPoint[] = [];
        let runLam: PolarPoint[] = [];

        const flushScaleRun = () => {
          if (runOuter.length >= 2) {
            rhytidomeCells.push({
              pointsPolar: [...runOuter, ...runInner.slice().reverse()],
              fillGray: scaleGray,
              strokeGray: profile.palette.barkFissureGray,
              strokeWidthMm: clamp(nominalThick * 0.12, 0.13, 0.48),
            });
            if (nominalThick > 1.45 && runLam.length >= 2) {
              peridermSeams.push({
                pointsPolar: runLam,
                gray: clamp(scaleGray - 18, 54, 122),
                widthMm: clamp(nominalThick * 0.045, 0.07, 0.17),
              });
            }
          }
          runOuter = [];
          runInner = [];
          runLam = [];
        };

        for (let k = 0; k <= steps; k++) {
          const u = k / steps;
          const theta = scStart + u * scSpan;
          const z0 = sampleBarkGrid(zInArr, theta);
          const z1 = sampleBarkGrid(zOutArr, theta);
          const zSurf = sampleBarkGrid(cohortZ[numActive], theta);
          const locThick = z1 - z0;

          // If this cohort has pinched out in an open canyon above the groove floor, break cleanly!
          if (locThick < 0.02) {
            flushScaleRun();
            continue;
          }

          const rPh = sampleBarkGrid(phloemOuterRadiusMm, theta);
          const scallop = Math.sin(u * Math.PI);
          const waveIn =
            locThick * 0.11 * internalNoise.polarFbm(theta, 10.0, inSeed, 2);
          const waveOut =
            locThick * 0.11 * internalNoise.polarFbm(theta, 10.0, outSeed, 2);

          // Extend any exterior-touching cohort slightly past outerBarkD so clip shears flush,
          // and tuck innermost cohort slightly beneath phloemOuterD so no dark gap shows
          const isExteriorLayer = z1 >= zSurf - 0.08;
          const padOut = isExteriorLayer ? 0.85 : 0;
          const padIn = z0 <= 0.05 ? -basePhloemMm * 0.14 : 0;

          const rIn =
            rPh + z0 + padIn + (s === 0 ? 0 : waveIn - locThick * 0.08 * scallop);
          const rOut =
            rPh + z1 + padOut + waveOut + locThick * 0.1 * scallop;

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
