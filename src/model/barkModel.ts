import { Noise2D, SeededRNG } from './prng';
import { SpeciesProfile } from './species';
import { BarkGeometry, PolarPoint, PolarRingGeometry } from './types';

const TWO_PI = 2 * Math.PI;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function wrapAngle(theta: number): number {
  return ((theta % TWO_PI) + TWO_PI) % TWO_PI;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge0 ? 1 : 0;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function samplePeriodicGrid(
  arr: ArrayLike<number>,
  theta: number,
  fallback = 0
): number {
  const n = arr.length;
  if (n === 0) return fallback;
  const pos = (wrapAngle(theta) / TWO_PI) * n;
  const i0 = Math.floor(pos) % n;
  const i1 = (i0 + 1) % n;
  const f = pos - Math.floor(pos);
  return arr[i0] * (1 - f) + arr[i1] * f;
}

export interface EvolvedBarkFissure {
  /** Fixed compass angle of the fissure root at the phloem (rad in [0, 2*PI)) */
  theta: number;
  /** Direct index on the woodAngles grid */
  gridIdx: number;
  /** Ring state index (1..K) when the fissure nucleated at the outer surface */
  nucRing: number;
  /** Local phloem radius (mm) at nucleation */
  nucRadiusMm: number;
  /** Fracture hierarchy rank (0 = early sapling primary, 1+ = secondary/tertiary) */
  generation: number;
  /** Subtle oblique fracture lean slope (tangential mm per radial mm outward from z=0) */
  leanSlope: number;
  /** Whether the crack tip has reached the basal nascent periderm floor */
  reachedFloor: boolean;
  /** Lagrangian material coordinate b_tip(k) (mm) of the crack tip at every ring state k=0..K */
  tipB: Float64Array;
  /** Exact cumulative kinematic left-face opening integral U_L(k) (mm) at every ring state k=0..K */
  cumOpenL: Float64Array;
  /** Exact cumulative kinematic right-face opening integral U_R(k) (mm) at every ring state k=0..K */
  cumOpenR: Float64Array;
}

interface RhytidomeCohort {
  cohortIdx: number;
  /** Cumulative rhytidome milestone (mm) when this cohort began forming */
  bStartMm: number;
  /** Cumulative rhytidome milestone (mm) when this cohort finished forming */
  bEndMm: number;
  /** Mean phloem radius (mm) at birth */
  meanBirthPhloemRadiusMm: number;
}

interface RingBarkState {
  bRhytMm: number;
  meanRadiusMm: number;
  radii: number[];
}

interface CohortSpec {
  cohortIdx: number;
  bStartMm: number;
  bEndMm: number;
  completedMeanBirthPhloemRadiusMm: number;
}

interface BarkMechanicsParams {
  rPeridermOnsetMm: number;
  epsSat: number;
  epsCrit: number;
  slCoeff: number;
  slExp: number;
  phiDilat: number;
  crackTipRate: number;
  crackKFactor: number;
  crackKLen: number;
  epsElRecoil: number;
  nascentKeepMm: number;
}

export interface BarkDetailConfig {
  barkSteps?: number;
  nascentDensity?: number;
  nascentMinSteps?: number;
  scaleDensity?: number;
  scaleMinSteps?: number;
  dfLensDensity?: number;
  dfLensMinSteps?: number;
  seamSteps?: number;
}

export interface BarkEvolutionContext {
  profile: SpeciesProfile;
  morphology: 'furrowed-corky' | 'plated-scaly';
  woodAngles: number[];
  rngBark: SeededRNG;
  barkVigorMult: number;
  startOffset: number;
  phloemNoise: Noise2D;
  floorNoise: Noise2D;
  archNoise: Noise2D;
  surfaceNoise: Noise2D;
  internalNoise: Noise2D;
  flakeNoise: Noise2D;
  ringStates: RingBarkState[];
  cohortSpecs: CohortSpec[];
  fissures: EvolvedBarkFissure[];
  nascentJitterCache: Map<number, number>;
}

function getBarkMechanicsParams(
  morphology: 'furrowed-corky' | 'plated-scaly'
): BarkMechanicsParams {
  const isPlated = morphology === 'plated-scaly';
  return {
    rPeridermOnsetMm: isPlated ? 9.5 : 10.5,
    epsSat: isPlated ? 0.52 : 0.48,
    epsCrit: isPlated ? 0.31 : 0.27,
    slCoeff: isPlated ? 3.55 : 2.95,
    slExp: isPlated ? 0.48 : 0.5,
    phiDilat: isPlated ? 0.58 : 0.04,
    crackTipRate: isPlated ? 0.62 : 0.72,
    crackKFactor: isPlated ? 0.88 : 0.95,
    crackKLen: isPlated ? 7.5 : 13.0,
    epsElRecoil: isPlated ? 0.032 : 0.028,
    nascentKeepMm: 0,
  };
}

function computeBasePhloemMmForMorphology(
  morphology: 'furrowed-corky' | 'plated-scaly',
  woodRadiusMm: number
): number {
  return morphology === 'plated-scaly'
    ? clamp(0.95 + woodRadiusMm * 0.0065, 0.95, 2.65)
    : clamp(1.1 + woodRadiusMm * 0.0085, 1.1, 3.35);
}

function computeBaseShedMm(
  morphology: 'furrowed-corky' | 'plated-scaly',
  totalProducedRhytidomeMm: number,
  meanWoodRadiusMm: number
): number {
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
  return Math.max(saplingEpidermisShedMm, weatherShedMm);
}

function findRingStateForB(
  ringStates: RingBarkState[],
  maxK: number,
  bTarget: number
): { i0: number; i1: number; t: number } {
  if (maxK <= 0 || bTarget <= ringStates[0].bRhytMm) {
    return { i0: 0, i1: 0, t: 0 };
  }
  if (bTarget >= ringStates[maxK].bRhytMm) {
    return { i0: maxK, i1: maxK, t: 0 };
  }
  let lo = 0;
  let hi = maxK;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (ringStates[mid].bRhytMm <= bTarget) lo = mid;
    else hi = mid;
  }
  const s0 = ringStates[lo];
  const s1 = ringStates[hi];
  const t = clamp(
    (bTarget - s0.bRhytMm) / Math.max(1e-6, s1.bRhytMm - s0.bRhytMm),
    0,
    1
  );
  return { i0: lo, i1: hi, t };
}

function interpolateMeanBirthPhloemRadiusFromStates(
  ringStates: RingBarkState[],
  maxStateIdx: number,
  morphology: 'furrowed-corky' | 'plated-scaly',
  basePhloemMmAtTip: number,
  bRhytTarget: number
): number {
  if (ringStates.length === 0) {
    return 2.0 + basePhloemMmAtTip;
  }
  const { i0, i1, t } = findRingStateForB(ringStates, maxStateIdx, bRhytTarget);
  if (i0 === i1) {
    const st = ringStates[i0];
    const ph =
      i0 === maxStateIdx && bRhytTarget >= st.bRhytMm
        ? basePhloemMmAtTip
        : computeBasePhloemMmForMorphology(morphology, st.meanRadiusMm);
    return st.meanRadiusMm + ph;
  }
  const s0 = ringStates[i0];
  const s1 = ringStates[i1];
  const meanW = s0.meanRadiusMm + (s1.meanRadiusMm - s0.meanRadiusMm) * t;
  return meanW + computeBasePhloemMmForMorphology(morphology, meanW);
}

function getNeighborAngularSpans(
  fissures: EvolvedBarkFissure[],
  idx: number
): [number, number] {
  const m = fissures.length;
  if (m <= 1) return [TWO_PI, TWO_PI];
  const th = fissures[idx].theta;
  const prevTh = idx === 0 ? fissures[m - 1].theta - TWO_PI : fissures[idx - 1].theta;
  const nextTh = idx === m - 1 ? fissures[0].theta + TWO_PI : fissures[idx + 1].theta;
  return [th - prevTh, nextTh - th];
}

function createBarkEvolutionContextFromStates(
  profile: SpeciesProfile,
  woodAngles: number[],
  ringStates: RingBarkState[],
  barkVigorMult: number,
  rngBark: SeededRNG
): BarkEvolutionContext {
  const morphology = profile.bark.morphology;
  const isPlated = morphology === 'plated-scaly';
  const mech = getBarkMechanicsParams(morphology);

  const safeWoodAngles =
    woodAngles.length > 0
      ? woodAngles
      : Array.from({ length: 180 }, (_, i) => (i / 180) * TWO_PI);

  const rngPrimary = rngBark.fork('primary-fissures');
  const rngCohortGrid = rngBark.fork('cohort-grid');
  const flawNoise = new Noise2D(rngBark.fork('bark-flaws'));
  const pathNoise = new Noise2D(rngBark.fork('crack-path'));
  const phloemNoise = new Noise2D(rngBark.fork('phloem-wave'));
  const floorNoise = new Noise2D(rngBark.fork('groove-floor'));
  const archNoise = new Noise2D(rngBark.fork('plate-arch'));
  const surfaceNoise = new Noise2D(rngBark.fork('outer-crust'));
  const internalNoise = new Noise2D(rngBark.fork('periderm-arcs'));
  const flakeNoise = new Noise2D(rngBark.fork('outer-flake'));

  const startOffset = rngPrimary.range(0, TWO_PI);
  const maxStateIdx = Math.max(0, ringStates.length - 1);
  const fullLastState = ringStates[maxStateIdx] ?? {
    bRhytMm: 1.1,
    meanRadiusMm: 2.0,
    radii: [],
  };
  const totalFullRhytidomeMm = Math.max(1.1, fullLastState.bRhytMm);
  const fullBasePhloemMm = computeBasePhloemMmForMorphology(
    morphology,
    fullLastState.meanRadiusMm
  );

  const cohortSpecs: CohortSpec[] = [];
  if (ringStates.length > 0) {
    let bCursor = 0;
    let cIdx = 0;
    while (bCursor < totalFullRhytidomeMm && cIdx < 220) {
      const baseStep = isPlated
        ? clamp(1.3 + 0.02 * bCursor, 1.3, 2.45)
        : clamp(1.3 + 0.038 * bCursor, 1.3, 4.5);
      const dB = baseStep * rngCohortGrid.range(0.92, 1.08);
      const bNext = bCursor + dB;
      const bMid = 0.5 * (bCursor + Math.min(bNext, totalFullRhytidomeMm));
      const meanBirthPhloemR = interpolateMeanBirthPhloemRadiusFromStates(
        ringStates,
        maxStateIdx,
        morphology,
        fullBasePhloemMm,
        bMid
      );
      cohortSpecs.push({
        cohortIdx: cIdx,
        bStartMm: bCursor,
        bEndMm: bNext,
        completedMeanBirthPhloemRadiusMm: meanBirthPhloemR,
      });
      bCursor = bNext;
      cIdx++;
    }
  }

  // Deterministic spatial Weibull fracture-strain heterogeneity field
  const nGrid = safeWoodAngles.length;
  const flawMultGrid = new Float64Array(nGrid);
  let minFlaw = Infinity;
  for (let g = 0; g < nGrid; g++) {
    const th = safeWoodAngles[g];
    const n1 = flawNoise.polarFbm(th, 11.0, 1.3, 3);
    const n2 = flawNoise.polarFbm(th, 29.0, 4.7, 2);
    const fl = clamp(1 + 0.3 * (0.65 * n1 + 0.35 * n2), 0.68, 1.38);
    flawMultGrid[g] = fl;
    if (fl < minFlaw) minFlaw = fl;
  }

  const fissures: EvolvedBarkFissure[] = [];
  const totalStates = ringStates.length;
  if (totalStates > 1) {
    const kMax = totalStates - 1;
    const rNowGrid = new Float64Array(nGrid);
    const epsDriveGrid = new Float64Array(nGrid);
    const rawScoreGrid = new Float64Array(nGrid);

    const getStateRadius = (st: RingBarkState, gridIdx: number): number =>
      gridIdx < st.radii.length ? st.radii[gridIdx] : st.meanRadiusMm;

    for (let k = 1; k <= kMax; k++) {
      const stPrev = ringStates[k - 1];
      const st = ringStates[k];
      const B = st.bRhytMm;
      const shed = computeBaseShedMm(morphology, B, st.meanRadiusMm);
      const H = Math.max(1.0, B - shed);
      const tPhloem = computeBasePhloemMmForMorphology(
        morphology,
        st.meanRadiusMm
      );
      const lSL = mech.slCoeff * Math.pow(H, mech.slExp) * Math.sqrt(tPhloem);
      const bFloor = Math.max(shed, B - mech.nascentKeepMm);

      // 1. Advance existing fissures: exact kinematic opening integrals + LEFM inward crack propagation
      for (let fIdx = 0; fIdx < fissures.length; fIdx++) {
        const f = fissures[fIdx];
        const gF = f.gridIdx;
        const wPrev = getStateRadius(stPrev, gF);
        const wNow = getStateRadius(st, gF);
        const rPrev =
          wPrev + computeBasePhloemMmForMorphology(morphology, wPrev);
        const rNow = wNow + computeBasePhloemMmForMorphology(morphology, wNow);
        const dR = Math.max(0, rNow - rPrev);
        const [dThL, dThR] = getNeighborAngularSpans(fissures, fIdx);

        f.cumOpenL[k] =
          f.cumOpenL[k - 1] + (1 - mech.phiDilat) * 0.5 * dThL * dR;
        f.cumOpenR[k] =
          f.cumOpenR[k - 1] + (1 - mech.phiDilat) * 0.5 * dThR * dR;

        let bTip = Math.max(f.tipB[k - 1], shed);
        const floorSnapDistMm = 0.45;
        if (f.reachedFloor || bTip >= bFloor - floorSnapDistMm) {
          f.reachedFloor = true;
          f.tipB[k] = Math.max(f.tipB[k - 1], bFloor);
          continue;
        }

        const subN = 3;
        const subDR = dR / subN;
        const epsC = mech.epsCrit * flawMultGrid[gF];
        const pairHalfW = 0.5 * rNow * (dThL + dThR);
        const phiLig =
          1 - 1 / Math.cosh(Math.min(12, pairHalfW / Math.max(2.0, lSL)));

        for (let sub = 0; sub < subN; sub++) {
          if (bTip >= bFloor) {
            bTip = bFloor;
            break;
          }
          const rSub = rPrev + ((sub + 0.5) / subN) * dR;
          const c = Math.max(0, bTip - shed);
          const xi = clamp(c / H, 0, 0.992);
          const ligThick = Math.max(0, B - bTip);
          const brTip = findRingStateForB(ringStates, k, bTip);
          const wb0 = getStateRadius(ringStates[brTip.i0], gF);
          const wb1 = getStateRadius(ringStates[brTip.i1], gF);
          const wb = wb0 + (wb1 - wb0) * brTip.t;
          const rBirthTip = Math.max(
            mech.rPeridermOnsetMm,
            wb + computeBasePhloemMmForMorphology(morphology, wb)
          );
          const epsKinTip = Math.log(
            Math.max(1.0, (rSub + ligThick) / rBirthTip)
          );
          const epsEffTip = mech.epsSat * Math.tanh(epsKinTip / mech.epsSat);
          const mK =
            1 +
            (mech.crackKFactor * Math.sqrt((c + 0.5) / mech.crackKLen)) /
              Math.pow(1 - 0.94 * xi, 1.4);
          const gRatio = (epsEffTip * phiLig * mK) / epsC;
          if (gRatio > 1.0) {
            const excess = gRatio - 1.0;
            const dbdR =
              mech.crackTipRate * (excess / (1 + 0.65 * excess));
            bTip = Math.min(bFloor, bTip + dbdR * subDR);
          }
        }
        if (bTip >= bFloor - floorSnapDistMm) {
          f.reachedFloor = true;
          bTip = bFloor;
        }
        f.tipB[k] = Math.max(f.tipB[k - 1], bTip);
      }

      // 2. Precompute outer elastoplastic hoop driving strain once per ring
      const bOutSample = shed + 0.2 * H;
      const brOut = findRingStateForB(ringStates, k, bOutSample);
      const stB0 = ringStates[brOut.i0];
      const stB1 = ringStates[brOut.i1];
      const bt = brOut.t;

      let maxRNow = 0;
      let maxRawScore = 0;
      for (let g = 0; g < nGrid; g++) {
        const wn = getStateRadius(st, g);
        const rn = wn + computeBasePhloemMmForMorphology(morphology, wn);
        rNowGrid[g] = rn;
        if (rn > maxRNow) maxRNow = rn;

        const wb0 = getStateRadius(stB0, g);
        const wb1 = getStateRadius(stB1, g);
        const wb = wb0 + (wb1 - wb0) * bt;
        const rb = Math.max(
          mech.rPeridermOnsetMm,
          wb + computeBasePhloemMmForMorphology(morphology, wb)
        );
        const epsKin = Math.log(Math.max(1.0, (rn + 0.8 * H) / rb));
        const ed = mech.epsSat * Math.tanh(epsKin / mech.epsSat);
        epsDriveGrid[g] = ed;
        const rawSc = ed / (mech.epsCrit * flawMultGrid[g]);
        rawScoreGrid[g] = rawSc;
        if (rawSc > maxRawScore) maxRawScore = rawSc;
      }

      if (maxRNow < mech.rPeridermOnsetMm * 1.15 || maxRawScore <= 1.0) {
        continue;
      }

      const minNeededPhi = 1.0 / maxRawScore;
      const minHalfWidthMm =
        minNeededPhi < 0.999
          ? lSL * Math.acosh(1 / (1 - minNeededPhi))
          : Infinity;

      // 3. Nucleate new surface fissures via Cox shear-lag stress * Weibull flaw strength
      let guard = 0;
      while (guard < 16) {
        guard++;
        let bestScore = 1.0;
        let bestG = -1;
        let bestGen = 0;

        if (fissures.length === 0) {
          for (let g = 0; g < nGrid; g++) {
            if (rNowGrid[g] < mech.rPeridermOnsetMm * 1.15) continue;
            const score = rawScoreGrid[g];
            if (score > bestScore) {
              bestScore = score;
              bestG = g;
              bestGen = 0;
            }
          }
        } else {
          const m = fissures.length;
          for (let p = 0; p < m; p++) {
            const fL = fissures[p];
            const fR = fissures[(p + 1) % m];
            const thL = fL.theta;
            const thR = p === m - 1 ? fR.theta + TWO_PI : fR.theta;
            const dTh = thR - thL;
            const maxHalfW = 0.5 * maxRNow * dTh;
            if (maxHalfW < minHalfWidthMm) continue;
            const phiPlateMax =
              1 - 1 / Math.cosh(Math.min(12, maxHalfW / lSL));
            if (maxRawScore * phiPlateMax <= bestScore) continue;

            const gStart = Math.ceil((thL / TWO_PI) * nGrid);
            const gEnd = Math.floor((thR / TWO_PI) * nGrid);
            for (let gRaw = gStart; gRaw <= gEnd; gRaw++) {
              const thUnwrap = (gRaw / nGrid) * TWO_PI;
              if (thUnwrap <= thL + 0.03 || thUnwrap >= thR - 0.03) continue;
              const g = ((gRaw % nGrid) + nGrid) % nGrid;
              const rawSc = rawScoreGrid[g];
              if (rawSc * phiPlateMax <= bestScore) continue;
              const rNow = rNowGrid[g];
              const a = 0.5 * rNow * dTh;
              if (a < minHalfWidthMm) continue;
              const s = rNow * (thUnwrap - 0.5 * (thL + thR));
              const phiSL =
                1 -
                Math.cosh(Math.min(12, Math.abs(s) / lSL)) /
                  Math.cosh(Math.min(12, a / lSL));
              if (phiSL <= minNeededPhi) continue;
              const score = rawSc * phiSL;
              if (score > bestScore) {
                bestScore = score;
                bestG = g;
                bestGen = Math.max(fL.generation, fR.generation) + 1;
              }
            }
          }
        }

        if (bestG < 0) break;

        const bestTheta = wrapAngle(safeWoodAngles[bestG]);
        const rNuc = rNowGrid[bestG];
        const leanSlope =
          pathNoise.polarFbm(bestTheta, 17.0, 2.1, 2) *
          (isPlated ? 0.03 : 0.075);
        const tipB = new Float64Array(totalStates);
        tipB[k] = shed;
        fissures.push({
          theta: bestTheta,
          gridIdx: bestG,
          nucRing: k,
          nucRadiusMm: rNuc,
          generation: rNuc < 28 ? 0 : Math.max(1, bestGen),
          leanSlope,
          reachedFloor: false,
          tipB,
          cumOpenL: new Float64Array(totalStates),
          cumOpenR: new Float64Array(totalStates),
        });
        fissures.sort((a, b) => a.theta - b.theta);
      }
    }
  }

  return {
    profile,
    morphology,
    woodAngles: safeWoodAngles,
    rngBark,
    barkVigorMult,
    startOffset,
    phloemNoise,
    floorNoise,
    archNoise,
    surfaceNoise,
    internalNoise,
    flakeNoise,
    ringStates,
    cohortSpecs,
    fissures,
    nascentJitterCache: new Map<number, number>(),
  };
}

/**
 * Precomputes ring accretion history, continuum shear-lag / LEFM fissure evolution,
 * cohort births, and cached noise channels once per simulation so historical bark
 * geometry can be evaluated at any ring index cleanly and consistently.
 */
export function createBarkEvolutionContext(
  profile: SpeciesProfile,
  woodAngles: number[],
  rings: PolarRingGeometry[],
  rngBark: SeededRNG
): BarkEvolutionContext {
  const morphology = profile.bark.morphology;
  const rngGlobal = rngBark.fork('global-vigor');
  const barkVigorMult = rngGlobal.range(0.95, 1.06);

  const initialCortexRhytMm = morphology === 'plated-scaly' ? 1.15 : 1.05;
  const bifacialRhytCoeff = morphology === 'plated-scaly' ? 0.118 : 0.178;

  const meanArray = (arr: number[], fallback: number): number => {
    const n = arr.length;
    if (n === 0) return fallback;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += arr[i];
    return sum / n;
  };

  const ringStates: RingBarkState[] = [];
  if (rings.length > 0) {
    const initRadii = rings[0].innerRadiusMm;
    const initMeanR = meanArray(initRadii, 2.0);
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
      const meanR = meanArray(rArr, prevMeanR);
      const dR = Math.max(0.02, meanR - prevMeanR);
      bRhyt += bifacialRhytCoeff * dR * barkVigorMult;
      ringStates.push({
        bRhytMm: bRhyt,
        meanRadiusMm: meanR,
        radii: rArr,
      });
      prevMeanR = meanR;
    }
  }

  return createBarkEvolutionContextFromStates(
    profile,
    woodAngles,
    ringStates,
    barkVigorMult,
    rngBark
  );
}

function findFissureCleaveTime(
  f: EvolvedBarkFissure,
  evalRing: number,
  bTarget: number
): number {
  if (f.tipB[evalRing] <= bTarget) return -1;
  if (f.tipB[f.nucRing] >= bTarget) return f.nucRing;
  let lo = f.nucRing;
  let hi = evalRing;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (f.tipB[mid] <= bTarget) lo = mid;
    else hi = mid;
  }
  const v0 = f.tipB[lo];
  const v1 = f.tipB[hi];
  return lo + clamp((bTarget - v0) / Math.max(1e-6, v1 - v0), 0, 1);
}

function interpFissureCumOpen(
  arr: Float64Array,
  maxRing: number,
  t: number
): number {
  const i0 = Math.floor(t);
  const i1 = Math.min(maxRing, i0 + 1);
  const f = t - i0;
  return arr[i0] * (1 - f) + arr[i1] * f;
}

/**
 * Evaluates anatomical bark geometry from continuum fracture history at a target ring state.
 */
function evaluateBarkFromState(args: {
  profile: SpeciesProfile;
  morphology: 'furrowed-corky' | 'plated-scaly';
  ringIndex: number;
  cambiumRadii: number[];
  meanWoodRadiusMm: number;
  rngBark: SeededRNG;
  startOffset: number;
  fissures: EvolvedBarkFissure[];
  phloemNoise: Noise2D;
  floorNoise: Noise2D;
  archNoise: Noise2D;
  surfaceNoise: Noise2D;
  internalNoise: Noise2D;
  flakeNoise: Noise2D;
  totalProducedRhytidomeMm: number;
  cohorts: RhytidomeCohort[];
  nascentJitterCache: Map<number, number>;
  openCatfaceArcs?: Array<{ centerAngleRad: number; halfArcRad: number }>;
  detail?: BarkDetailConfig;
}): BarkGeometry {
  const {
    profile,
    morphology,
    ringIndex,
    cambiumRadii,
    meanWoodRadiusMm,
    rngBark,
    startOffset,
    fissures,
    phloemNoise,
    floorNoise,
    archNoise,
    surfaceNoise,
    internalNoise,
    flakeNoise,
    totalProducedRhytidomeMm,
    cohorts,
    nascentJitterCache,
    openCatfaceArcs,
    detail,
  } = args;

  const isPlated = morphology === 'plated-scaly';
  const mech = getBarkMechanicsParams(morphology);

  const barkSteps = detail?.barkSteps ?? 1080;
  const nascentDensity = detail?.nascentDensity ?? 900;
  const nascentMinSteps = detail?.nascentMinSteps ?? 16;
  const scaleDensity = detail?.scaleDensity ?? 900;
  const scaleMinSteps = detail?.scaleMinSteps ?? 24;
  const dfLensDensity = detail?.dfLensDensity ?? 36;
  const dfLensMinSteps = detail?.dfLensMinSteps ?? 12;
  const seamSteps = detail?.seamSteps ?? 270;

  const basePhloemMm = computeBasePhloemMmForMorphology(
    morphology,
    meanWoodRadiusMm
  );
  const baseShedMm = computeBaseShedMm(
    morphology,
    totalProducedRhytidomeMm,
    meanWoodRadiusMm
  );
  const meanRetainedGlobalMm = Math.max(
    1.0,
    totalProducedRhytidomeMm - baseShedMm
  );

  const activeFissures = fissures.filter((f) => f.nucRing <= ringIndex);
  const nF = activeFissures.length;

  // Phloem compression & basal groove dip occur only once a crack tip approaches the phloem
  const fissureRootProg = new Float64Array(nF);
  for (let fi = 0; fi < nF; fi++) {
    const xi = clamp(
      (activeFissures[fi].tipB[ringIndex] - baseShedMm) / meanRetainedGlobalMm,
      0,
      1
    );
    fissureRootProg[fi] = smoothstep(0.68, 0.96, xi);
  }

  const activeCohorts = cohorts
    .filter((coh) => totalProducedRhytidomeMm - coh.bStartMm > 0.02)
    .sort((a, b) => b.cohortIdx - a.cohortIdx);
  if (activeCohorts.length === 0 && cohorts.length > 0) {
    activeCohorts.push(cohorts[0]);
  }
  const numActive = activeCohorts.length;

  const dThetaStep = TWO_PI / barkSteps;
  const barkAnglesRad = new Array<number>(barkSteps);
  const phloemOuterRadiusMm = new Array<number>(barkSteps);
  const outerBarkRadiusMm = new Array<number>(barkSteps);

  const dipSumArr = new Float64Array(barkSteps);
  const nearGrooveArr = new Float64Array(barkSteps);
  const localSealArr = new Float64Array(barkSteps);
  const localMaxRhytArr = new Float64Array(barkSteps);
  const profileScaleArr = new Float64Array(barkSteps);
  const catfaceMaskArr =
    openCatfaceArcs && openCatfaceArcs.length > 0
      ? new Float64Array(barkSteps)
      : null;

  // Scatter basal fissure root dip in O(nF * window)
  for (let fi = 0; fi < nF; fi++) {
    const pF = fissureRootProg[fi];
    if (pF <= 1e-6) continue;
    const f = activeFissures[fi];
    const wF =
      f.gridIdx < cambiumRadii.length
        ? cambiumRadii[f.gridIdx]
        : meanWoodRadiusMm;
    const rF = wF + basePhloemMm;
    const dipDecayMm = isPlated
      ? clamp(2.0 + rF * 0.015, 2.0, 5.4)
      : clamp(2.2 + rF * 0.024, 2.2, 9.5);
    const muteDecayMm = dipDecayMm * 1.15;
    const halfSteps = Math.min(
      Math.floor(barkSteps / 2),
      Math.ceil(((muteDecayMm * 6.0) / Math.max(10, rF)) / dThetaStep)
    );
    const centerIdx = Math.round((f.theta / TWO_PI) * barkSteps);
    for (let d = -halfSteps; d <= halfSteps; d++) {
      const idx = ((centerIdx + d) % barkSteps + barkSteps) % barkSteps;
      let dAng = Math.abs(idx * dThetaStep - f.theta);
      if (dAng > Math.PI) dAng = TWO_PI - dAng;
      const distMm = dAng * rF;
      dipSumArr[idx] += pF * Math.exp(-distMm / dipDecayMm);
      const mv = pF * Math.exp(-distMm / muteDecayMm);
      if (mv > nearGrooveArr[idx]) nearGrooveArr[idx] = mv;
    }
  }

  const matureFlakeWeight = smoothstep(18, 36, totalProducedRhytidomeMm);
  for (let i = 0; i < barkSteps; i++) {
    const theta = i * dThetaStep;
    barkAnglesRad[i] = theta;
    const rCambium = samplePeriodicGrid(cambiumRadii, theta, meanWoodRadiusMm);

    let catfaceMask = 1.0;
    if (catfaceMaskArr && openCatfaceArcs) {
      for (const arc of openCatfaceArcs) {
        let dAng = Math.abs(theta - arc.centerAngleRad) % TWO_PI;
        if (dAng > Math.PI) dAng = TWO_PI - dAng;
        if (dAng <= arc.halfArcRad) {
          catfaceMask = 0;
          break;
        }
        const m = smoothstep(arc.halfArcRad, arc.halfArcRad + 0.045, dAng);
        if (m < catfaceMask) catfaceMask = m;
      }
      catfaceMaskArr[i] = catfaceMask;
    }

    const dipSum = dipSumArr[i];
    const nearG = nearGrooveArr[i];

    // Living inner phloem gently compresses beneath deep established fissures (Chang 1954)
    const phloemPinch = 1 - 0.21 * Math.min(1.05, dipSum);
    const phloemWave =
      1 +
      0.035 * phloemNoise.polarFbm(theta, 7, 1.1, 2) +
      0.038 *
        (1 - 0.55 * nearG) *
        phloemNoise.polarFbm(theta, 16, 2.7, 2);
    const localPhloem =
      Math.max(0.68, basePhloemMm * phloemPinch * phloemWave) * catfaceMask;
    phloemOuterRadiusMm[i] = rCambium + localPhloem;

    // Dark suberized wound-periderm floor seal beneath cleaved troughs
    const baseSealMm = isPlated
      ? clamp(0.85 + meanRetainedGlobalMm * 0.04, 0.85, 2.15)
      : clamp(1.35 + meanRetainedGlobalMm * 0.095, 1.35, 5.5);
    localSealArr[i] =
      baseSealMm *
      (1 - 0.26 * Math.min(1.1, dipSum)) *
      (1 + 0.045 * floorNoise.polarFbm(theta, 5.0, 3.1, 2));

    // Continuous spatial exterior flake variation
    const localFlakeOff =
      matureFlakeWeight *
      flakeNoise.polarFbm(theta, 5.5, 1.7, 2) *
      (isPlated ? 1.4 : 1.6);
    localMaxRhytArr[i] = Math.max(1.0, meanRetainedGlobalMm - localFlakeOff);

    const rootDip = isPlated
      ? 1 - 0.03 * Math.min(1.2, dipSum)
      : 1 - 0.09 * Math.min(1.25, dipSum);
    const crustMute = 1 - 0.85 * nearG;
    const archMod =
      1 +
      (isPlated ? 0.011 : 0.025) *
        crustMute *
        archNoise.polarFbm(theta, 6.0, 1.9, 2);
    const surfMod = isPlated
      ? 1 + 0.01 * crustMute * surfaceNoise.polarFbm(theta, 24.0, 2.7, 2)
      : 1 +
        0.06 *
          crustMute *
          surfaceNoise.polarFbm(theta, 20.0, meanWoodRadiusMm * 0.04, 3);
    profileScaleArr[i] = rootDip * archMod * surfMod;
  }

  // Inverted-loop truncated-strata rasterization: cohortZ[s+1] initially holds cohort s thickness
  const cohortZ: Float64Array[] = Array.from(
    { length: numActive + 1 },
    () => new Float64Array(barkSteps)
  );
  const olderThickArr = new Float64Array(barkSteps);
  const presBuf = new Float64Array(barkSteps);

  const tPhloemGlobal = basePhloemMm;
  const lSLNow =
    mech.slCoeff *
    Math.pow(meanRetainedGlobalMm, mech.slExp) *
    Math.sqrt(tPhloemGlobal);

  for (let s = 0; s < numActive; s++) {
    const coh = activeCohorts[s];
    const zIn = Math.max(0, totalProducedRhytidomeMm - coh.bEndMm);
    const rawZOut = totalProducedRhytidomeMm - coh.bStartMm;
    if (rawZOut <= 0 || zIn >= meanRetainedGlobalMm + 2.5) continue;

    presBuf.fill(1.0);
    if (s > 0) {
      const zOutNom = Math.min(rawZOut, meanRetainedGlobalMm);
      const zMid = 0.5 * (zIn + zOutNom);
      const bMid =
        0.5 * (coh.bStartMm + Math.min(coh.bEndMm, totalProducedRhytidomeMm));
      const dB = Math.max(0.2, coh.bEndMm - coh.bStartMm);
      const outerFrac = clamp(zMid / Math.max(1.0, meanRetainedGlobalMm), 0, 1);

      for (let fi = 0; fi < nF; fi++) {
        const f = activeFissures[fi];
        const tipB = f.tipB[ringIndex];
        if (tipB <= coh.bStartMm) continue;

        const tipPen = clamp((tipB - coh.bStartMm) / dB, 0, 1);
        const tCleave = findFissureCleaveTime(
          f,
          ringIndex,
          Math.min(bMid, tipB - 1e-4)
        );
        if (tCleave < 0) continue;

        const uL = Math.max(
          0,
          f.cumOpenL[ringIndex] -
            interpFissureCumOpen(f.cumOpenL, ringIndex, tCleave)
        );
        const uR = Math.max(
          0,
          f.cumOpenR[ringIndex] -
            interpFissureCumOpen(f.cumOpenR, ringIndex, tCleave)
        );
        const wF =
          f.gridIdx < cambiumRadii.length
            ? cambiumRadii[f.gridIdx]
            : meanWoodRadiusMm;
        const rCoh = Math.max(12.0, wF + basePhloemMm + zMid);

        const elRecoil =
          mech.epsElRecoil *
          lSLNow *
          smoothstep(0, 0.85, tipPen) *
          smoothstep(0, 1.2, uL + uR + tipPen * 0.7);
        const corkWeatherL = isPlated ? 0 : 0.24 * outerFrac * uL;
        const corkWeatherR = isPlated ? 0 : 0.24 * outerFrac * uR;

        const gapL = (uL + elRecoil + corkWeatherL) * tipPen;
        const gapR = (uR + elRecoil + corkWeatherR) * tipPen;

        // Anchor oblique lean at the groove root (z = 0) so trough minima remain compass-locked
        const center = wrapAngle(f.theta + (f.leanSlope * zMid) / rCoh);
        const gapLRad = gapL / rCoh;
        const gapRRad = gapR / rCoh;
        const maxBevelMm = isPlated
          ? 0.6 + 0.75 * smoothstep(2.0, 14.0, gapL + gapR)
          : 2.2 + 5.2 * smoothstep(2.0, 26.0, gapL + gapR);
        const maxBevelRad = maxBevelMm / rCoh;
        const bevMult = isPlated ? 0.85 : 1.35;
        const bevelLRad = Math.min(maxBevelRad, gapLRad * bevMult);
        const bevelRRad = Math.min(maxBevelRad, gapRRad * bevMult);

        const reachL = gapLRad + bevelLRad;
        const reachR = gapRRad + bevelRRad;
        const iStart = Math.floor((center - reachL) / dThetaStep);
        const iEnd = Math.ceil((center + reachR) / dThetaStep);
        for (let iRaw = iStart; iRaw <= iEnd; iRaw++) {
          const idx = ((iRaw % barkSteps) + barkSteps) % barkSteps;
          const d = iRaw * dThetaStep - center;
          if (d < 0) {
            const dist = -d;
            if (dist < reachL) {
              const ev =
                bevelLRad <= 1e-7
                  ? dist >= gapLRad
                    ? 1
                    : 0
                  : smoothstep(gapLRad, reachL, dist);
              presBuf[idx] *= 1 - tipPen * (1 - ev);
            }
          } else {
            const dist = d;
            if (dist < reachR) {
              const ev =
                bevelRRad <= 1e-7
                  ? dist >= gapRRad
                    ? 1
                    : 0
                  : smoothstep(gapRRad, reachR, dist);
              presBuf[idx] *= 1 - tipPen * (1 - ev);
            }
          }
        }
      }
    }

    const outSlice = cohortZ[s + 1];
    for (let i = 0; i < barkSteps; i++) {
      const localMax = localMaxRhytArr[i];
      if (zIn >= localMax) continue;
      const dH = Math.min(rawZOut, localMax) - zIn;
      if (dH <= 1e-4) continue;
      const lt = dH * profileScaleArr[i] * presBuf[i];
      outSlice[i] = lt;
      if (s > 0) olderThickArr[i] += lt;
    }
  }

  for (let i = 0; i < barkSteps; i++) {
    if (numActive > 0) {
      cohortZ[1][i] = Math.max(
        cohortZ[1][i],
        Math.max(0, localSealArr[i] - olderThickArr[i])
      );
      if (catfaceMaskArr && catfaceMaskArr[i] < 1.0) {
        const mask = catfaceMaskArr[i];
        for (let s = 1; s <= numActive; s++) {
          cohortZ[s][i] *= mask;
        }
      }
    }

    let cumZ = 0;
    cohortZ[0][i] = 0;
    for (let s = 1; s <= numActive; s++) {
      cumZ += cohortZ[s][i];
      cohortZ[s][i] = cumZ;
    }
    outerBarkRadiusMm[i] = phloemOuterRadiusMm[i] + cumZ;
  }

  // ---------------------------------------------------------------------------
  // 4. Lagrangian Internal Periderm Scales & Cork Lenses (Conforming to Grooves!)
  // ---------------------------------------------------------------------------
  const rhytidomeCells: BarkGeometry['rhytidomeCells'] = [];
  const peridermSeams: BarkGeometry['peridermSeams'] = [];

  // 4a. Active Nascent Innermost Periderm (s = 0)
  // Classify into contiguous groove-floor runs vs plate-base runs with cyclic wraparound
  // so every deep groove floor renders as a single dark suberized seal cell (never split
  // mid-trough by an arbitrary sector grid).
  if (numActive > 0) {
    const coh0 = activeCohorts[0];
    const zInArr0 = cohortZ[0];
    const zOutArr0 = cohortZ[1];
    const zSurfArr = cohortZ[numActive];
    const nominalThick0 = Math.max(0.4, coh0.bEndMm - coh0.bStartMm);
    const outSeed0 = coh0.cohortIdx * 1.73;

    const isGrooveArr = new Uint8Array(barkSteps);
    let hasGroove = false;
    let hasPlate = false;
    for (let i = 0; i < barkSteps; i++) {
      const z1 = zOutArr0[i];
      const zSurf = zSurfArr[i];
      if (z1 >= zSurf - 0.12 && zSurf > 0.05) {
        isGrooveArr[i] = 1;
        hasGroove = true;
      } else {
        hasPlate = true;
      }
    }

    const emitNascentArc = (
      secStart: number,
      secEnd: number,
      isGrooveFloor: boolean
    ) => {
      const secSpan = secEnd - secStart;
      if (secSpan <= 1e-6) return;
      const steps = Math.max(
        nascentMinSteps,
        Math.ceil((secSpan / TWO_PI) * nascentDensity)
      );
      const midTheta = secStart + 0.5 * secSpan;

      let jitter = 0;
      if (!isGrooveFloor) {
        const key = Math.floor((wrapAngle(midTheta) / TWO_PI) * 64);
        let cachedJ = nascentJitterCache.get(key);
        if (cachedJ === undefined) {
          cachedJ = rngBark.fork(`nascent-sec:${key}`).range(-5, 6);
          nascentJitterCache.set(key, cachedJ);
        }
        jitter = cachedJ;
      }

      const sectorGray = isGrooveFloor
        ? Math.round(
            clamp(
              (morphology === 'furrowed-corky' ? 70 : 78) +
                floorNoise.polarFbm(midTheta, 8.0, 1.4, 2) * 8,
              64,
              88
            )
          )
        : Math.round(
            clamp(
              (morphology === 'furrowed-corky' ? 116 : 124) + jitter,
              110,
              134
            )
          );

      const runOuter: PolarPoint[] = [];
      const runInner: PolarPoint[] = [];
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        const theta = secStart + u * secSpan;
        const z0 = samplePeriodicGrid(zInArr0, theta);
        const z1 = samplePeriodicGrid(zOutArr0, theta);
        const zSurf = samplePeriodicGrid(zSurfArr, theta);
        const rPh = samplePeriodicGrid(phloemOuterRadiusMm, theta);

        if (zSurf <= 0.02) {
          if (runOuter.length >= 2) {
            rhytidomeCells.push({
              pointsPolar: [...runOuter, ...runInner.slice().reverse()],
              fillGray: sectorGray,
              strokeGray: 32,
              strokeWidthMm: clamp(nominalThick0 * 0.062, 0.05, 0.14),
            });
          }
          runOuter.length = 0;
          runInner.length = 0;
          continue;
        }

        const locThick = Math.max(0.2, z1 - z0);
        const isExterior = z1 >= zSurf - 0.08;
        const padOut = isExterior ? 0.85 : 0;
        const padIn = -0.06;

        const waveOut = isExterior
          ? 0
          : Math.min(locThick, 1.35) *
            0.095 *
            internalNoise.polarFbm(theta, 11.0, outSeed0, 2);

        runInner.push({ theta, r: rPh + z0 + padIn });
        runOuter.push({ theta, r: rPh + z1 + padOut + waveOut });
      }
      if (runOuter.length >= 2) {
        rhytidomeCells.push({
          pointsPolar: [...runOuter, ...runInner.slice().reverse()],
          fillGray: sectorGray,
          strokeGray: 32,
          strokeWidthMm: clamp(nominalThick0 * 0.062, 0.05, 0.14),
        });
      }
    };

    const emitPlateBaseSubdivided = (
      spanStart: number,
      spanEnd: number,
      isGrooveFlag: boolean
    ) => {
      const span = spanEnd - spanStart;
      const arcLenMm = span * Math.max(25, meanWoodRadiusMm);
      const subCount = clamp(Math.round(arcLenMm / 22), 1, 64);
      const subSpan = span / subCount;
      for (let sub = 0; sub < subCount; sub++) {
        emitNascentArc(
          spanStart + sub * subSpan,
          spanStart + (sub + 1) * subSpan,
          isGrooveFlag
        );
      }
    };

    if (!hasGroove || !hasPlate) {
      const treatAsGroove = hasGroove && !hasPlate && nF > 0;
      const sectorCount = clamp(
        Math.round((TWO_PI * Math.max(25, meanWoodRadiusMm)) / 22),
        24,
        64
      );
      for (let sec = 0; sec < sectorCount; sec++) {
        emitNascentArc(
          startOffset + (sec / sectorCount) * TWO_PI,
          startOffset + ((sec + 1) / sectorCount) * TWO_PI,
          treatAsGroove
        );
      }
    } else {
      let t0 = 0;
      for (let i = 0; i < barkSteps; i++) {
        if (isGrooveArr[i] !== isGrooveArr[(i - 1 + barkSteps) % barkSteps]) {
          t0 = i;
          break;
        }
      }

      let cursor = 0;
      while (cursor < barkSteps) {
        const runVal = isGrooveArr[(t0 + cursor) % barkSteps] === 1;
        const runStartIdx = t0 + cursor;
        while (
          cursor < barkSteps &&
          (isGrooveArr[(t0 + cursor) % barkSteps] === 1) === runVal
        ) {
          cursor++;
        }
        const runEndIdx = t0 + cursor;
        // Shift run boundaries by -0.5 grid step so each bin i sits strictly inside its run
        const runStart = (runStartIdx - 0.5) * dThetaStep;
        const runEnd = (runEndIdx - 0.5) * dThetaStep;
        if (runVal) {
          emitNascentArc(runStart, runEnd, true);
        } else {
          emitPlateBaseSubdivided(runStart, runEnd, false);
        }
      }
    }
  }

  if (morphology === 'furrowed-corky') {
    for (let s = 1; s < numActive; s++) {
      const coh = activeCohorts[s];
      const rngC = rngBark.fork(`df-cohort:${coh.cohortIdx}`);
      const zInArr = cohortZ[s];
      const zOutArr = cohortZ[s + 1];
      const nominalThick = Math.max(0.4, coh.bEndMm - coh.bStartMm);
      const tierFrac = s / Math.max(1, numActive - 1);

      const corkHalfFrac = rngC.range(0.2, 0.35) * (1 - 0.12 * tierFrac);
      const lensesInTier = rngC.int(5, 10);
      const tierPhase = rngC.range(0, TWO_PI);

      for (let l = 0; l < lensesInTier; l++) {
        const arcStart =
          tierPhase + (l / lensesInTier) * TWO_PI + rngC.range(-0.08, 0.08);
        const arcSpan = (TWO_PI / lensesInTier) * rngC.range(0.68, 0.94);
        const steps = Math.max(
          dfLensMinSteps,
          Math.round(arcSpan * dfLensDensity)
        );

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
          const z0 = samplePeriodicGrid(zInArr, theta);
          const z1 = samplePeriodicGrid(zOutArr, theta);
          const locThick = z1 - z0;

          if (locThick < 0.07) {
            flushRun();
            continue;
          }

          const pinch = Math.pow(Math.sin(frac * Math.PI), 0.45);
          const rPh = samplePeriodicGrid(phloemOuterRadiusMm, theta);
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
        const theta = (sIdx / seamSteps) * TWO_PI;
        const z0 = samplePeriodicGrid(zInArr, theta);
        const z1 = samplePeriodicGrid(zOutArr, theta);
        const locThick = z1 - z0;
        if (locThick < 0.05) {
          flushSeam();
          continue;
        }
        const rPh = samplePeriodicGrid(phloemOuterRadiusMm, theta);
        const wave =
          locThick *
          0.18 *
          internalNoise.polarFbm(theta, 7.5, coh.cohortIdx * 2.3 + 9.1, 2);
        seamRun.push({ theta, r: rPh + z0 + 0.1 * locThick + wave });
      }
      flushSeam();
    }
  } else {
    for (let s = 1; s < numActive; s++) {
      const coh = activeCohorts[s];
      const rngC = rngBark.fork(`pp-cohort:${coh.cohortIdx}`);
      const zInArr = cohortZ[s];
      const zOutArr = cohortZ[s + 1];
      const nominalThick = Math.max(0.25, coh.bEndMm - coh.bStartMm);
      const tierFrac = s / Math.max(1, numActive - 1);

      const birthCircMm = TWO_PI * Math.max(22, coh.meanBirthPhloemRadiusMm);
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
        boundaryOffsets.push((sc / scalesPerCircle + jitter) * TWO_PI);
      }
      boundaryOffsets.push(TWO_PI);

      // Shared periderm interface seeds so adjacent tabular cohorts stack flush without void pockets
      const inInterfaceSeed = (coh.cohortIdx + 1) * 1.73;
      const outInterfaceSeed = coh.cohortIdx * 1.73;

      for (let sc = 0; sc < scalesPerCircle; sc++) {
        const scStart = tierAngleOffset + boundaryOffsets[sc];
        const scSpan = boundaryOffsets[sc + 1] - boundaryOffsets[sc];
        const steps = Math.max(
          scaleMinSteps,
          Math.ceil((scSpan / TWO_PI) * scaleDensity)
        );

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
          const z0 = samplePeriodicGrid(zInArr, theta);
          const z1 = samplePeriodicGrid(zOutArr, theta);
          const zSurf = samplePeriodicGrid(cohortZ[numActive], theta);
          const locThick = z1 - z0;

          if (locThick < 0.025) {
            flushScaleRun();
            continue;
          }

          if (locThick > maxRunLocThick) maxRunLocThick = locThick;

          const rPh = samplePeriodicGrid(phloemOuterRadiusMm, theta);
          const scallop = Math.sin(u * Math.PI);
          const sharedAmpIn = Math.min(locThick, 1.35) * 0.095;
          const sharedAmpOut = Math.min(locThick, 1.35) * 0.095;
          const waveIn =
            sharedAmpIn *
            internalNoise.polarFbm(theta, 11.0, inInterfaceSeed, 2);
          const waveOut =
            sharedAmpOut *
            internalNoise.polarFbm(theta, 11.0, outInterfaceSeed, 2);

          const isExteriorLayer = z1 >= zSurf - 0.08;
          const padOut = isExteriorLayer ? 0.85 : 0;
          const padIn = 0;

          const rIn = rPh + z0 + padIn + waveIn - locThick * 0.025 * scallop;
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

  let sumThick = 0;
  let maxThick = -Infinity;
  let minThick = Infinity;
  for (let i = 0; i < barkSteps; i++) {
    const rWood = samplePeriodicGrid(
      cambiumRadii,
      barkAnglesRad[i],
      meanWoodRadiusMm
    );
    const t = outerBarkRadiusMm[i] - rWood;
    sumThick += t;
    if (t > maxThick) maxThick = t;
    if (t < minThick) minThick = t;
  }

  return {
    morphology,
    meanThicknessMm: sumThick / barkSteps,
    maxThicknessMm: maxThick,
    minThicknessMm: minThick,
    phloemThicknessMm: basePhloemMm,
    cambiumRadiusMm: cambiumRadii,
    phloemOuterRadiusMm,
    outerBarkRadiusMm,
    barkAnglesRad,
    rhytidomeCells,
    peridermSeams,
  };
}

/**
 * Evaluates outer bark geometry at an arbitrary historical ring index `1..rings.length`
 * using a precomputed `BarkEvolutionContext`, preserving smooth year-to-year continuity.
 */
export function buildAnatomicalBarkAtRing(
  ctx: BarkEvolutionContext,
  ringIndex: number,
  options?: {
    openCatfaceArcs?: Array<{ centerAngleRad: number; halfArcRad: number }>;
    detail?: BarkDetailConfig;
  }
): BarkGeometry {
  const maxK = Math.max(0, ctx.ringStates.length - 1);
  if (maxK === 0) {
    const safeAngles =
      ctx.woodAngles.length > 0
        ? ctx.woodAngles
        : Array.from({ length: 180 }, (_, i) => (i / 180) * TWO_PI);
    const fallbackRadii = new Array<number>(safeAngles.length).fill(2.0);
    return buildAnatomicalBarkGeometry(
      ctx.profile,
      fallbackRadii,
      safeAngles,
      2.0,
      ctx.rngBark,
      undefined,
      options?.openCatfaceArcs
    );
  }
  const k = clamp(Math.round(ringIndex), 1, maxK);
  const state = ctx.ringStates[k];
  const totalProducedRhytidomeMm = Math.max(1.1, state.bRhytMm);
  const basePhloemMm = computeBasePhloemMmForMorphology(
    ctx.morphology,
    state.meanRadiusMm
  );

  const cohorts: RhytidomeCohort[] = [];
  for (const spec of ctx.cohortSpecs) {
    if (spec.bStartMm >= totalProducedRhytidomeMm) break;
    if (spec.bEndMm <= state.bRhytMm) {
      cohorts.push({
        cohortIdx: spec.cohortIdx,
        bStartMm: spec.bStartMm,
        bEndMm: spec.bEndMm,
        meanBirthPhloemRadiusMm: spec.completedMeanBirthPhloemRadiusMm,
      });
    } else {
      const bMid =
        0.5 * (spec.bStartMm + Math.min(spec.bEndMm, totalProducedRhytidomeMm));
      const meanBirthPhloemRadiusMm = interpolateMeanBirthPhloemRadiusFromStates(
        ctx.ringStates,
        k,
        ctx.morphology,
        basePhloemMm,
        bMid
      );
      cohorts.push({
        cohortIdx: spec.cohortIdx,
        bStartMm: spec.bStartMm,
        bEndMm: spec.bEndMm,
        meanBirthPhloemRadiusMm,
      });
    }
  }

  return evaluateBarkFromState({
    profile: ctx.profile,
    morphology: ctx.morphology,
    ringIndex: k,
    cambiumRadii: state.radii,
    meanWoodRadiusMm: state.meanRadiusMm,
    rngBark: ctx.rngBark,
    startOffset: ctx.startOffset,
    fissures: ctx.fissures,
    phloemNoise: ctx.phloemNoise,
    floorNoise: ctx.floorNoise,
    archNoise: ctx.archNoise,
    surfaceNoise: ctx.surfaceNoise,
    internalNoise: ctx.internalNoise,
    flakeNoise: ctx.flakeNoise,
    totalProducedRhytidomeMm,
    cohorts,
    nascentJitterCache: ctx.nascentJitterCache,
    openCatfaceArcs: options?.openCatfaceArcs,
    detail: options?.detail,
  });
}

/**
 * Biophysical continuum-mechanics bark fracture engine:
 * 1. Bifacial vascular cambial allometry (Larson 1994): rhytidome accretion tracks wood dR.
 * 2. Elastoplastic Cox shear-lag stress + spatial Weibull material flaws: fissures nucleate
 *    where outer hoop tensile strain overcomes critical rhytidome toughness, producing natural
 *    thickness-dependent plate spacing that widens as bark armor thickens.
 * 3. Cohesive LEFM inward crack-tip propagation: secondary fissures initiate with zero depth
 *    at the exterior surface and propagate progressively inward across cohorts rather than
 *    slicing instantaneously to the phloem.
 * 4. Exact cumulative kinematic opening integrals (U_L, U_R) & groove-conforming inner periderms:
 *    plate edges drift outward monotonically with zero backward fissure closure.
 */
export function buildAnatomicalBarkGeometry(
  profile: SpeciesProfile,
  cambiumRadii: number[],
  woodAngles: number[],
  meanWoodRadiusMm: number,
  rngBark: SeededRNG,
  rings?: PolarRingGeometry[],
  openCatfaceArcs?: Array<{ centerAngleRad: number; halfArcRad: number }>
): BarkGeometry {
  if (rings && rings.length > 0) {
    const ctx = createBarkEvolutionContext(profile, woodAngles, rings, rngBark);
    return buildAnatomicalBarkAtRing(ctx, rings.length, { openCatfaceArcs });
  }

  const morphology = profile.bark.morphology;
  const rngGlobal = rngBark.fork('global-vigor');
  const barkVigorMult = rngGlobal.range(0.95, 1.06);

  const initialCortexRhytMm = morphology === 'plated-scaly' ? 1.15 : 1.05;
  const bifacialRhytCoeff = morphology === 'plated-scaly' ? 0.118 : 0.178;

  const safeAngles =
    woodAngles.length > 0
      ? woodAngles
      : Array.from({ length: 180 }, (_, i) => (i / 180) * TWO_PI);
  const safeCambium =
    cambiumRadii.length === safeAngles.length
      ? cambiumRadii
      : safeAngles.map((th) =>
          samplePeriodicGrid(cambiumRadii, th, meanWoodRadiusMm)
        );

  const ringStates: RingBarkState[] = [];
  const steps = 24;
  const initR = Math.min(2.0, meanWoodRadiusMm * 0.2);
  for (let s = 0; s <= steps; s++) {
    const frac = s / steps;
    const rArr = safeCambium.map((r) => initR + (r - initR) * frac);
    const meanR = initR + (meanWoodRadiusMm - initR) * frac;
    const bRhyt =
      (initialCortexRhytMm + bifacialRhytCoeff * meanR) * barkVigorMult;
    ringStates.push({ bRhytMm: bRhyt, meanRadiusMm: meanR, radii: rArr });
  }

  const ctx = createBarkEvolutionContextFromStates(
    profile,
    safeAngles,
    ringStates,
    barkVigorMult,
    rngBark
  );
  return buildAnatomicalBarkAtRing(ctx, ringStates.length - 1, {
    openCatfaceArcs,
  });
}
