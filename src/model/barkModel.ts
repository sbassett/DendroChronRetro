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
  /** Per-plate stochastic flaking offset (mm) for discrete puzzle-plate height relief */
  exfoliationOffsetMm: number;
  /** Basal fissure-floor protection multiplier */
  floorMult: number;
  /** Subtle outer plate arch/crest multiplier */
  archMult: number;
}

interface RhytidomeCohort {
  cohortIdx: number;
  /** Cumulative rhytidome production milestone (mm) when this cohort began forming */
  bStartMm: number;
  /** Cumulative rhytidome production milestone (mm) when this cohort finished forming */
  bEndMm: number;
  /** Wood cambium radii (on woodAngles grid) when this cohort was sequestered */
  birthWoodRadii: number[];
  /** Mean phloem radius (mm) at birth */
  meanBirthPhloemRadiusMm: number;
}

/**
 * Biophysical transverse bark engine modeling forward-in-time cambial phloem accretion,
 * hierarchical shear-lag hoop-stress fracture nucleation, dead-rhytidome arc-length
 * conservation (which naturally opens terraced V/U grooves as the stem expands),
 * and progressive exterior weathering & scale exfoliation.
 *
 * Because primary fracture sites, binary-tree plate fracture thresholds, and sequential
 * periderm cohort milestones are anchored deterministically to specimen seed streams,
 * deep grooves persist at fixed compass angles and evolve continuously as a tree ages
 * rather than jumping or re-randomizing.
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

  // Deterministic sub-streams isolated by physical subsystem so aging never shifts downstream draws
  const rngGlobal = rngBark.fork('global-vigor');
  const rngPrimary = rngBark.fork('primary-fissures');
  const rngCohortGrid = rngBark.fork('cohort-grid');
  const phloemNoise = new Noise2D(rngBark.fork('phloem-wave'));
  const surfaceNoise = new Noise2D(rngBark.fork('outer-crust'));
  const internalNoise = new Noise2D(rngBark.fork('periderm-arcs'));

  const barkVigorMult = rngGlobal.range(0.94, 1.07);

  // Smooth circular interpolation on the wood angular grid
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
  const basePhloemMm = clamp(1.1 + meanWoodRadiusMm * 0.014, 1.05, 4.5);

  // ---------------------------------------------------------------------------
  // 1. Forward Cumulative Phloem / Rhytidome Accretion History Across Rings
  // ---------------------------------------------------------------------------
  // Juvenile cortex + initial sapling periderm present as stem reaches stump height
  const initialBarkMm = profile.bark.juvenileOffsetMm * 1.1;
  const cambialBarkCoeff =
    morphology === 'plated-scaly' ? 0.168 : 0.188;
  const annualMaintenanceMm =
    morphology === 'plated-scaly' ? 0.078 : 0.068;

  interface RingBarkState {
    bCumMm: number;
    meanRadiusMm: number;
    radii: number[];
  }

  const ringStates: RingBarkState[] = [];
  if (rings && rings.length > 0) {
    const initRadii = rings[0].innerRadiusMm;
    const initMeanR =
      initRadii.reduce((a, b) => a + b, 0) / initRadii.length;
    let bCum = initialBarkMm * barkVigorMult;
    ringStates.push({
      bCumMm: bCum,
      meanRadiusMm: initMeanR,
      radii: initRadii,
    });

    let prevMeanR = initMeanR;
    for (let k = 0; k < rings.length; k++) {
      const rArr = rings[k].outerRadiusMm;
      const meanR = rArr.reduce((a, b) => a + b, 0) / rArr.length;
      const dR = Math.max(0.05, meanR - prevMeanR);
      bCum += (cambialBarkCoeff * dR + annualMaintenanceMm) * barkVigorMult;
      ringStates.push({
        bCumMm: bCum,
        meanRadiusMm: meanR,
        radii: rArr,
      });
      prevMeanR = meanR;
    }
  } else {
    // Fallback synthetic linear radial history if rings array was omitted
    const steps = 24;
    const initR = Math.min(2.0, meanWoodRadiusMm * 0.2);
    for (let s = 0; s <= steps; s++) {
      const frac = s / steps;
      const rArr = cambiumRadii.map((r) => initR + (r - initR) * frac);
      const meanR = initR + (meanWoodRadiusMm - initR) * frac;
      const bCum =
        (initialBarkMm + cambialBarkCoeff * meanR + frac * 3.0) * barkVigorMult;
      ringStates.push({ bCumMm: bCum, meanRadiusMm: meanR, radii: rArr });
    }
  }

  const totalProducedBarkMm = ringStates[ringStates.length - 1].bCumMm;
  const totalProducedRhytidomeMm = Math.max(
    1.1,
    totalProducedBarkMm - basePhloemMm * 0.75
  );

  // Helper to interpolate historical 2D wood radii at any cumulative rhytidome milestone bTarget
  const interpolateBirthWoodRadii = (bRhytTarget: number): {
    radii: number[];
    meanPhloemR: number;
  } => {
    const bTotalTarget = bRhytTarget + basePhloemMm * 0.75;
    if (bTotalTarget <= ringStates[0].bCumMm) {
      const ph = clamp(1.0 + ringStates[0].meanRadiusMm * 0.014, 1.0, 4.5);
      return {
        radii: ringStates[0].radii,
        meanPhloemR: ringStates[0].meanRadiusMm + ph,
      };
    }
    const last = ringStates[ringStates.length - 1];
    if (bTotalTarget >= last.bCumMm) {
      return {
        radii: last.radii,
        meanPhloemR: last.meanRadiusMm + basePhloemMm,
      };
    }
    // Binary search ringStates by bCumMm
    let lo = 0;
    let hi = ringStates.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (ringStates[mid].bCumMm <= bTotalTarget) lo = mid;
      else hi = mid;
    }
    const s0 = ringStates[lo];
    const s1 = ringStates[hi];
    const t = clamp(
      (bTotalTarget - s0.bCumMm) / Math.max(1e-6, s1.bCumMm - s0.bCumMm),
      0,
      1
    );
    const interpRadii = s0.radii.map((r0, idx) => r0 + (s1.radii[idx] - r0) * t);
    const meanW = s0.meanRadiusMm + (s1.meanRadiusMm - s0.meanRadiusMm) * t;
    const ph = clamp(1.05 + meanW * 0.014, 1.05, 4.5);
    return {
      radii: interpRadii,
      meanPhloemR: meanW + ph,
    };
  };

  // Build immutable sequential periderm cohort ladder from establishment (b = 0) up to current B_rhyt
  const cohorts: RhytidomeCohort[] = [];
  let bCursor = 0;
  let cIdx = 0;
  // Generate slightly past totalProducedRhytidomeMm so outer/inner clips always have complete cohorts
  while (bCursor < totalProducedRhytidomeMm + 0.5 && cIdx < 160) {
    const baseStep =
      morphology === 'plated-scaly'
        ? clamp(1.3 + 0.036 * bCursor, 1.3, 4.6)
        : clamp(1.35 + 0.042 * bCursor, 1.35, 5.5);
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
        ? rngPrimary.range(-0.08, 0.08)
        : rngPrimary.range(-0.14, 0.14);
    const floorMult = rngPrimary.range(0.88, 1.14);
    primaryFissures.push({
      theta: angleCursor,
      nucRadiusMm: nucR,
      lean,
      floorMult,
      generation: 0,
    });
    angleCursor += (primaryWeights[p] / weightSum) * twoPi;
  }
  // Periodic closing image of fissure 0 at startOffset + 2*PI
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

    // Shear-lag tensile fracture critical width (mm): thicker mature armor plates carry higher
    // tensile load and relieve surface strain via horizontal scale flaking before splitting radially
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

    // Peak tensile stress occurs near middle of intact plate
    const splitFrac = rngP.range(0.39, 0.61);
    const splitLean =
      morphology === 'plated-scaly'
        ? rngP.range(-0.075, 0.075)
        : rngP.range(-0.13, 0.13);
    const exfoliationOffsetMm =
      morphology === 'plated-scaly'
        ? rngP.range(-2.3, 2.3)
        : rngP.range(-1.8, 1.8);
    const floorMult = rngP.range(0.88, 1.14);
    const archMult = rngP.range(0.97, 1.03);

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
        floorMult,
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
      floorMult,
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
  // 3. Evaluate Exterior Exfoliation & Terraced Groove Canyon Geometry (1080 steps)
  // ---------------------------------------------------------------------------
  // Determine cumulative exfoliated thickness B_shed for each plate from:
  //   (a) Over-stretch detachment of early sapling cohorts (R_birth < strainShedRatio * R_now)
  //   (b) Weathering & flaking steady-state equilibrium thickness H_eq
  const strainShedRatio = morphology === 'plated-scaly' ? 0.43 : 0.18;
  const equilibriumRhytidomeMm = morphology === 'plated-scaly' ? 74.0 : 98.0;

  // Find cumulative rhytidome milestone where mean phloem radius reached strainShedRatio * currentMeanPhloemR
  const currentMeanPhloemR = meanWoodRadiusMm + basePhloemMm;
  const minRetainedBirthR = strainShedRatio * currentMeanPhloemR;
  let strainShedMilestoneMm = 0;
  for (const coh of cohorts) {
    if (coh.meanBirthPhloemRadiusMm < minRetainedBirthR) {
      const nextR = coh.meanBirthPhloemRadiusMm;
      const frac = clamp(
        (minRetainedBirthR - nextR) / Math.max(4.0, minRetainedBirthR * 0.2),
        0,
        1
      );
      strainShedMilestoneMm =
        coh.bStartMm + (coh.bEndMm - coh.bStartMm) * frac;
    } else {
      break;
    }
  }

  const equilibriumRetainedMm =
    equilibriumRhytidomeMm *
    (1 - Math.exp(-totalProducedRhytidomeMm / equilibriumRhytidomeMm));
  const weatherShedMilestoneMm = Math.max(
    0,
    totalProducedRhytidomeMm - equilibriumRetainedMm
  );
  const baseShedMm = Math.max(strainShedMilestoneMm, weatherShedMilestoneMm);

  const barkSteps = 1080;
  const barkAnglesRad: number[] = [];
  const phloemOuterRadiusMm: number[] = [];
  const outerBarkRadiusMm: number[] = [];

  let pCursor = 0;

  for (let i = 0; i < barkSteps; i++) {
    const theta = (i / barkSteps) * twoPi;
    barkAnglesRad.push(theta);

    const rCambium = sampleWoodRadius(theta);
    const localPhloem =
      basePhloemMm * (1 + 0.045 * phloemNoise.polarFbm(theta, 8, 1.1, 2));
    const rPhloem = rCambium + localPhloem;
    phloemOuterRadiusMm.push(rPhloem);

    // Map theta into [startOffset, startOffset + 2*PI) to locate active leaf plate
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

    // Per-plate exfoliation milestone (activates gradually once bark > 14 mm)
    const flakeWeight = smoothstep(10, 26, totalProducedRhytidomeMm);
    const plateShedMm = clamp(
      baseShedMm + flakeWeight * plate.exfoliationOffsetMm,
      0,
      Math.max(0, totalProducedRhytidomeMm - 1.1)
    );
    const plateMaxRhytMm = Math.max(
      1.0,
      totalProducedRhytidomeMm - plateShedMm
    );

    // Fissure incision progress pL, pR in [0, 1] at left and right plate boundaries:
    // Newly nucleated fissures start at 0 incision & 0 width, deepening smoothly over ~12 mm of radial growth
    const rNowL = sampleWoodRadius(plate.thetaL) + basePhloemMm;
    const rNowR = sampleWoodRadius(plate.thetaR) + basePhloemMm;
    const inciseScaleMm = morphology === 'plated-scaly' ? 11.5 : 10.5;
    const pL = clamp(
      1 - Math.exp(-Math.max(0, rNowL - plate.fissureL.nucRadiusMm) / inciseScaleMm),
      0,
      1
    );
    const pR = clamp(
      1 - Math.exp(-Math.max(0, rNowR - plate.fissureR.nucRadiusMm) / inciseScaleMm),
      0,
      1
    );

    // Protective innermost rhytidome bridge over living phloem at fissure roots
    // Interpolated across fissureL -> fissureR so groove floors meet continuously across thetaL/thetaR
    const baseFloorFrac =
      morphology === 'plated-scaly'
        ? 1 - profile.bark.fissureDepthFraction * 1.12
        : 1 - profile.bark.fissureDepthFraction * 1.14;
    const localFloorMult =
      plate.fissureL.floorMult * (1 - u) + plate.fissureR.floorMult * u;
    const floorFrac = clamp(baseFloorFrac * localFloorMult, 0.14, 0.36);
    const meanRetainedRhytMm = Math.max(
      1.0,
      totalProducedRhytidomeMm - baseShedMm
    );
    const floorHeightMm = meanRetainedRhytMm * floorFrac;

    // Accumulate radial thickness cohort-by-cohort from inner phloem (z = 0) outward
    // using conservation of dead-bark arc length L_c = dTheta * max(R_birth, R_nuc)
    let localRhytMm = 0;

    for (let idx = cohorts.length - 1; idx >= 0; idx--) {
      const coh = cohorts[idx];
      // Cohort's current radial interval above rPhloem:
      // Newer bark formed after coh.bEndMm has pushed this cohort outward!
      const zIn = Math.max(0, totalProducedRhytidomeMm - coh.bEndMm);
      const rawZOut = totalProducedRhytidomeMm - coh.bStartMm;
      if (rawZOut <= 0) continue;
      if (zIn >= plateMaxRhytMm) break; // Older cohorts above plateMaxRhytMm have exfoliated!

      const zOut = Math.min(rawZOut, plateMaxRhytMm);
      const dH = zOut - zIn;
      if (dH <= 1e-4) continue;

      const zMid = 0.5 * (zIn + zOut);
      const heightNorm = clamp(zMid / Math.max(1.0, plateMaxRhytMm), 0, 1);

      // Cohorts below the basal protective fissure floor remain continuous across the plate
      const aboveFloorWeight = smoothstep(
        floorHeightMm * 0.72,
        floorHeightMm * 1.12,
        zOut
      );

      if (aboveFloorWeight <= 0.001) {
        localRhytMm += dH;
        continue;
      }

      // Local birth radius of this cohort at theta vs current radius R_c = rPhloem + zMid
      const rBirthLocal =
        sampleOnWoodGrid(coh.birthWoodRadii, theta) +
        clamp(1.05 + coh.meanBirthPhloemRadiusMm * 0.014, 1.05, 4.5);
      const rCurrentCohort = rPhloem + zMid;

      // Effective un-fractured anchor radii at left and right fissures
      const rEffL = Math.max(rBirthLocal, plate.fissureL.nucRadiusMm);
      const rEffR = Math.max(rBirthLocal, plate.fissureR.nucRadiusMm);

      const stretchGapL = clamp(1 - rEffL / Math.max(1.0, rCurrentCohort), 0, 0.78);
      const stretchGapR = clamp(1 - rEffR / Math.max(1.0, rCurrentCohort), 0, 0.78);

      // Pullback fraction on each side of the plate (0.5 * stretchGap from arc-length conservation,
      // plus small basal fracture root release notch)
      const pullCoeff = morphology === 'plated-scaly' ? 0.5 : 0.62;
      const rootNotch =
        (morphology === 'plated-scaly' ? 0.028 : 0.036) *
        Math.pow(heightNorm, 0.55);

      const rawPullL = pL * aboveFloorWeight * (rootNotch + pullCoeff * stretchGapL);
      const rawPullR = pR * aboveFloorWeight * (rootNotch + pullCoeff * stretchGapR);

      // Subtle oblique radial lean of canyon walls
      const leanShiftL = plate.fissureL.lean * heightNorm * pL;
      const leanShiftR = plate.fissureR.lean * heightNorm * pR;

      let uLeft = clamp(rawPullL + leanShiftL, 0, 0.47);
      let uRight = clamp(1 - rawPullR + leanShiftR, 0.53, 1);
      if (uRight < uLeft + 0.04) {
        const midU = 0.5 * (uLeft + uRight);
        uLeft = midU - 0.02;
        uRight = midU + 0.02;
      }

      // Edge bevel: crisp fractured scale terrace edges on Ponderosa; broader weathered cork slopes on Douglas-fir
      const bevelU =
        morphology === 'plated-scaly'
          ? 0.018 + 0.008 * (1 - pL * pR)
          : 0.075 + 0.045 * heightNorm;

      const inLeft = smoothstep(uLeft - bevelU * 0.5, uLeft + bevelU * 0.5, u);
      const inRight =
        1 - smoothstep(uRight - bevelU * 0.5, uRight + bevelU * 0.5, u);
      const presence = inLeft * inRight;

      localRhytMm += dH * (1 - aboveFloorWeight + aboveFloorWeight * presence);
    }

    // Active fracture-root V-notch dip right at u = 0 / u = 1 where hoop strain concentrates,
    // plus subtle surface micro-relief (tabular scale arch vs rough corky crust)
    const rootDip =
      1 -
      0.16 *
        (pL * Math.exp(-u / 0.085) + pR * Math.exp(-(1 - u) / 0.085));
    const edgeMute = smoothstep(0.0, 0.12, Math.min(u, 1 - u));

    if (morphology === 'plated-scaly') {
      const centerDist = Math.abs(u - 0.5) * 2;
      const subtleArch =
        1 + (plate.archMult - 1) * edgeMute - 0.022 * centerDist * centerDist * edgeMute;
      const flakeTex =
        0.2 * edgeMute * surfaceNoise.polarFbm(theta, 24.0, 2.7, 2);
      localRhytMm = Math.max(0.45, localRhytMm * rootDip * subtleArch + flakeTex);
    } else {
      const corkTex =
        (0.35 + 0.055 * localRhytMm) *
        edgeMute *
        surfaceNoise.polarFbm(theta, 20.0, meanWoodRadiusMm * 0.04, 3);
      const ridgeArch = 1 + (plate.archMult - 1) * edgeMute;
      localRhytMm = Math.max(0.45, localRhytMm * rootDip * ridgeArch + corkTex);
    }

    outerBarkRadiusMm.push(rPhloem + localRhytMm);
  }

  // Peak actual exterior rhytidome height for clipping cohort visual polygons cleanly
  let maxActualRhytidomeMm = 1.2;
  for (let i = 0; i < barkSteps; i++) {
    const rhyt = outerBarkRadiusMm[i] - phloemOuterRadiusMm[i];
    if (rhyt > maxActualRhytidomeMm) {
      maxActualRhytidomeMm = rhyt;
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Internal Sequential Periderm Compartments Aligned to Actual Cohorts!
  // ---------------------------------------------------------------------------
  // Each cohort c has its own immutable PRNG stream `cohort:${c}`, so individual bark
  // scales & cork lenses maintain identity as newer bark pushes them outward over time!
  const rhytidomeCells: BarkGeometry['rhytidomeCells'] = [];
  const peridermSeams: BarkGeometry['peridermSeams'] = [];

  const survivingCohorts = cohorts.filter((coh) => {
    const zIn = Math.max(0, totalProducedRhytidomeMm - coh.bEndMm);
    const zOut = totalProducedRhytidomeMm - coh.bStartMm;
    return zOut > 0.05 && zIn < maxActualRhytidomeMm + 2.5;
  });

  // Sort from innermost (youngest, near phloem) to outermost (oldest, near exterior)
  survivingCohorts.sort((a, b) => b.cohortIdx - a.cohortIdx);

  // Outermost cohort extends slightly past maxActualRhytidomeMm so <clipPath id="rhytidome-clip">
  // shears the exterior scale cleanly along outerBarkD without leaving any dark rim
  const numSurviving = survivingCohorts.length;

  if (morphology === 'furrowed-corky') {
    for (let s = 0; s < numSurviving; s++) {
      const coh = survivingCohorts[s];
      const rngC = rngBark.fork(`df-cohort:${coh.cohortIdx}`);
      const zIn = Math.max(0, totalProducedRhytidomeMm - coh.bEndMm);
      const zOut =
        s === numSurviving - 1
          ? Math.max(
              totalProducedRhytidomeMm - coh.bStartMm,
              maxActualRhytidomeMm + 2.2
            )
          : totalProducedRhytidomeMm - coh.bStartMm;
      const bandThick = Math.max(0.4, zOut - zIn);
      const zMid = 0.5 * (zIn + zOut);
      const tierFrac = s / Math.max(1, numSurviving - 1);

      const corkHalfThick =
        bandThick * rngC.range(0.2, 0.35) * (1 - 0.12 * tierFrac);
      const lensesInTier = rngC.int(5, 10);
      const tierPhase = rngC.range(0, twoPi);

      for (let l = 0; l < lensesInTier; l++) {
        const arcStart =
          tierPhase + (l / lensesInTier) * twoPi + rngC.range(-0.08, 0.08);
        const arcSpan = (twoPi / lensesInTier) * rngC.range(0.68, 0.94);
        const steps = Math.max(8, Math.round(arcSpan * 28));

        const outerArc: PolarPoint[] = [];
        const innerArc: PolarPoint[] = [];

        const corkGray = Math.round(
          clamp(
            profile.palette.barkHighlightGray +
              rngC.range(-12, 18) -
              tierFrac * 10,
            82,
            138
          )
        );

        for (let sIdx = 0; sIdx <= steps; sIdx++) {
          const frac = sIdx / steps;
          const theta = arcStart + frac * arcSpan;
          const pinch = Math.pow(Math.sin(frac * Math.PI), 0.45);
          const basePhloemR = sampleWoodRadius(theta) + basePhloemMm;
          const waveMm =
            bandThick *
            0.32 *
            internalNoise.polarFbm(theta, 6.5, coh.cohortIdx * 1.7, 2);

          const rMid = basePhloemR + zMid + waveMm;
          const halfT = corkHalfThick * pinch;
          outerArc.push({ theta, r: rMid + halfT });
          innerArc.push({
            theta,
            r: Math.max(basePhloemR * 0.992, rMid - halfT),
          });
        }

        rhytidomeCells.push({
          pointsPolar: [...outerArc, ...innerArc.reverse()],
          fillGray: corkGray,
          strokeGray: 24,
          strokeWidthMm: clamp(bandThick * 0.085, 0.12, 0.42),
        });
      }

      // Undulating dark phellogen seam along cohort boundary
      const seamPts: PolarPoint[] = [];
      const seamSteps = 180;
      for (let sIdx = 0; sIdx <= seamSteps; sIdx++) {
        const theta = (sIdx / seamSteps) * twoPi;
        const baseR = sampleWoodRadius(theta) + basePhloemMm;
        const wave =
          bandThick *
          0.26 *
          internalNoise.polarFbm(theta, 7.5, coh.cohortIdx * 2.3 + 9.1, 2);
        seamPts.push({ theta, r: baseR + zIn + 0.08 * bandThick + wave });
      }
      peridermSeams.push({
        pointsPolar: seamPts,
        gray: 20,
        widthMm: clamp(bandThick * 0.075, 0.11, 0.36),
      });
    }
  } else {
    // PONDEROSA PINE: Persistent per-cohort interlocking puzzle-scale tiers!
    for (let s = 0; s < numSurviving; s++) {
      const coh = survivingCohorts[s];
      const rngC = rngBark.fork(`pp-cohort:${coh.cohortIdx}`);

      const zIn = s === 0 ? 0 : Math.max(0, totalProducedRhytidomeMm - coh.bEndMm);
      const zOut =
        s === numSurviving - 1
          ? Math.max(
              totalProducedRhytidomeMm - coh.bStartMm,
              maxActualRhytidomeMm + basePhloemMm * 0.12 + 1.8
            )
          : totalProducedRhytidomeMm - coh.bStartMm;

      const scaleThickMm = Math.max(0.35, zOut - zIn);
      const tierFrac = s / Math.max(1, numSurviving - 1);

      // Scale count determined by immutable birth circumference so cohort keeps fixed scale divisions
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

      // Stagger alternate cohort indices like overlapping brick/shingle periderms
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
        const steps = 10;

        const outerPts: PolarPoint[] = [];
        const innerPts: PolarPoint[] = [];

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

        for (let k = 0; k <= steps; k++) {
          const u = k / steps;
          const theta = scStart + u * scSpan;
          const baseR = sampleWoodRadius(theta) + basePhloemMm;

          const scallop = Math.sin(u * Math.PI);
          const waveIn =
            scaleThickMm *
            0.13 *
            internalNoise.polarFbm(theta, 10.0, inSeed, 2);
          const waveOut =
            scaleThickMm *
            0.13 *
            internalNoise.polarFbm(theta, 10.0, outSeed, 2);

          const rIn =
            s === 0
              ? baseR - basePhloemMm * 0.12
              : baseR + zIn + waveIn - scaleThickMm * 0.09 * scallop;
          const rOut =
            baseR + zOut + waveOut + scaleThickMm * 0.11 * scallop;

          innerPts.push({ theta, r: rIn });
          outerPts.push({ theta, r: rOut });
        }

        if (scaleThickMm > 1.45) {
          const lamPts: PolarPoint[] = [];
          for (let m = 0; m <= 6; m++) {
            const um = m / 6;
            const thM = scStart + um * scSpan;
            const bRM = sampleWoodRadius(thM) + basePhloemMm;
            const wInM =
              scaleThickMm *
              0.13 *
              internalNoise.polarFbm(thM, 10.0, inSeed, 2);
            const wOutM =
              scaleThickMm *
              0.13 *
              internalNoise.polarFbm(thM, 10.0, outSeed, 2);
            lamPts.push({
              theta: thM,
              r: bRM + 0.5 * (zIn + zOut) + 0.5 * (wInM + wOutM),
            });
          }
          peridermSeams.push({
            pointsPolar: lamPts,
            gray: clamp(scaleGray - 18, 54, 122),
            widthMm: clamp(scaleThickMm * 0.045, 0.07, 0.18),
          });
        }

        rhytidomeCells.push({
          pointsPolar: [...outerPts, ...innerPts.reverse()],
          fillGray: scaleGray,
          strokeGray: profile.palette.barkFissureGray,
          strokeWidthMm: clamp(scaleThickMm * 0.125, 0.14, 0.52),
        });
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
