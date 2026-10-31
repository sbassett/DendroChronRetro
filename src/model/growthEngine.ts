import { buildAnatomicalBarkGeometry } from './barkModel';
import {
  buildCanonicalSeedKey,
  hashToHex,
  Noise2D,
  SeededRNG,
} from './prng';
import { SPECIES_PROFILES, SpeciesProfile } from './species';
import {
  AnnualRingRecord,
  EnvironmentDataset,
  PolarRingGeometry,
  SimulationParams,
  TreeSimulationResult,
  ViabilityAssessment,
} from './types';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function angularDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Relative astronomical daylength factor g_E(m, lat) in [0, 1] for month m (0..11).
 */
function computeMonthlyPhotoperiod(latDeg: number): number[] {
  const latRad = (clamp(latDeg, -66, 66) * Math.PI) / 180;
  const midMonthDays = [15, 45, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
  const rawHours: number[] = [];

  for (const doy of midMonthDays) {
    const decl =
      0.409 * Math.sin(((2 * Math.PI) / 365) * doy - 1.39);
    const cosH = clamp(-Math.tan(latRad) * Math.tan(decl), -1, 1);
    const halfDayRad = Math.acos(cosH);
    rawHours.push((24 / Math.PI) * halfDayRad);
  }
  const maxH = Math.max(...rawHours, 12.1);
  return rawHours.map((h) => clamp(h / maxH, 0.05, 1.0));
}

/**
 * Trapezoidal temperature growth response g_T(T) in [0, 1].
 */
function tempResponse(tempC: number, cardinals: [number, number, number, number]): number {
  const [t1, t2, t3, t4] = cardinals;
  if (tempC <= t1 || tempC >= t4) return 0;
  if (tempC < t2) return (tempC - t1) / (t2 - t1);
  if (tempC <= t3) return 1.0;
  return 1.0 - (tempC - t3) / (t4 - t3);
}

/**
 * Piecewise linear soil moisture response g_M(w) in [0, 1].
 */
function moistureResponse(bucketFrac: number, cardinals: [number, number]): number {
  const [m1, m2] = cardinals;
  if (bucketFrac <= m1) return 0;
  if (bucketFrac >= m2) return 1.0;
  return (bucketFrac - m1) / (m2 - m1);
}

/**
 * Evaluates ecological viability of the chosen species at the target location.
 */
function assessViability(
  profile: SpeciesProfile,
  env: EnvironmentDataset
): ViabilityAssessment {
  const reasons: string[] = [];
  if (env.terrain.isWaterOrInvalid) {
    return {
      viable: false,
      stressLevel: 'unsuitable',
      summary: 'Open water or submerged coordinates — terrestrial conifers cannot establish here.',
      reasons: ['Elevation stencil indicates open water (0 m across surrounding grid).'],
    };
  }

  const { minAnnualPrecipMm, minMeanTempC, maxMeanTempC } = profile.viabilityBounds;
  let penalty = 0;

  if (env.meanAnnualPrecipMm < minAnnualPrecipMm) {
    const deficit = minAnnualPrecipMm - env.meanAnnualPrecipMm;
    reasons.push(
      `Mean annual precipitation (${Math.round(env.meanAnnualPrecipMm)} mm) is below ${profile.commonName}'s typical xeric threshold (${minAnnualPrecipMm} mm).`
    );
    penalty += deficit > 100 ? 2 : 1;
  }

  if (env.meanAnnualTempC < minMeanTempC) {
    reasons.push(
      `Mean annual temperature (${env.meanAnnualTempC.toFixed(1)} °C) approaches alpine/arctic treeline limits (${minMeanTempC} °C).`
    );
    penalty += env.meanAnnualTempC < minMeanTempC - 2.5 ? 2 : 1;
  }

  if (env.meanAnnualTempC > maxMeanTempC) {
    reasons.push(
      `Mean annual temperature (${env.meanAnnualTempC.toFixed(1)} °C) exceeds ${profile.commonName}'s warm/subtropical thermal limit (${maxMeanTempC} °C) — winter chilling and VPD stress limit survival.`
    );
    penalty += env.meanAnnualTempC > maxMeanTempC + 3 ? 2 : 1;
  }

  if (penalty >= 2) {
    return {
      viable: false,
      stressLevel: 'unsuitable',
      summary: `Outside ${profile.commonName}'s natural climatic envelope; simulation reflects a severely stunted, stress-limited specimen.`,
      reasons,
    };
  }
  if (penalty === 1) {
    return {
      viable: true,
      stressLevel: 'marginal',
      summary: `Marginal / ecotonal site for ${profile.commonName}; expect slow juvenile establishment and high ring sensitivity.`,
      reasons,
    };
  }

  const isOptimal =
    env.meanAnnualPrecipMm > minAnnualPrecipMm * 1.65 &&
    env.meanAnnualTempC >= minMeanTempC + 3 &&
    env.meanAnnualTempC <= maxMeanTempC - 3;

  return {
    viable: true,
    stressLevel: isOptimal ? 'optimal' : 'moderate',
    summary: isOptimal
      ? `Well-suited mesic/montane habitat for ${profile.commonName}.`
      : `Viable montane/woodland habitat with seasonal climate limitation.`,
    reasons,
  };
}

/**
 * Core deterministic dendrochronological simulation engine.
 */
export function simulateTreeCrossSection(
  params: SimulationParams,
  env: EnvironmentDataset
): TreeSimulationResult {
  const profile = SPECIES_PROFILES[params.species];
  const seedKey = buildCanonicalSeedKey(
    params.species,
    params.latitude,
    params.longitude
  );
  const seedHex = hashToHex(seedKey);
  const masterRng = new SeededRNG(seedKey);

  const rngSite = masterRng.fork('microsite');
  const rngAnatomy = masterRng.fork('anatomy');
  const rngMorph = masterRng.fork('morphology');
  const rngBark = masterRng.fork('bark');

  const viability = assessViability(profile, env);

  // Photoperiod vector for site latitude
  const gE = computeMonthlyPhotoperiod(params.latitude);
  const isNorthern = params.latitude >= 0;

  // Aspect insolation modifier: equator-facing steep slopes increase PET & moisture stress
  const slopeFactor = Math.sin((clamp(env.terrain.slopeDeg, 0, 55) * Math.PI) / 180);
  const aspectRad = (env.terrain.aspectDeg * Math.PI) / 180;
  // South-Southwest (200 deg) is warmest/driest in NH; North-Northeast (20 deg) in SH
  const warmestAspectRad = ((isNorthern ? 200 : 20) * Math.PI) / 180;
  const equatorwardExposure = slopeFactor * Math.cos(aspectRad - warmestAspectRad);
  const petAspectMultiplier = 1.0 + 0.24 * equatorwardExposure;

  // Micro-site soil depth & canopy competition parameters (seeded per spot)
  const micrositeSoilMult = rngSite.range(0.84, 1.2);
  const micrositeVigorMult = rngSite.range(0.86, 1.16);
  const bucketCapMm = profile.soilBucketCapacityMm * micrositeSoilMult;

  // Run continuous monthly snow + soil bucket + VS-Lite forward model across all years
  let soilWaterMm = bucketCapMm * 0.55;
  let snowPackMm = 0;

  interface YearlyGrowthMetrics {
    year: number;
    annualG: number;
    springG: number;
    summerG: number;
    summerMoistureG: number;
    juneMoistureG: number;
    summerTempC: number;
    monsoonPulseRatio: number;
    tempStressSum: number;
    moistStressSum: number;
    isSynthetic: boolean;
  }

  const rawYearlyMetrics: YearlyGrowthMetrics[] = [];
  const springMonths = isNorthern ? [3, 4, 5] : [9, 10, 11]; // Apr-Jun (NH)
  const summerMonths = isNorthern ? [6, 7, 8] : [0, 1, 2]; // Jul-Sep (NH)

  for (const cy of env.years) {
    let annualG = 0;
    let springG = 0;
    let summerG = 0;
    let summerMoistureG = 0;
    let juneMoistureG = 1.0;
    let tempStressSum = 0;
    let moistStressSum = 0;

    for (let m = 0; m < 12; m++) {
      const t = cy.tempC[m];
      const p = cy.precipMm[m];

      // Partition precipitation into snow vs liquid rain
      const snowFrac = clamp((1.5 - t) / 4.0, 0, 1);
      snowPackMm += p * snowFrac;
      const rainMm = p * (1 - snowFrac);

      const meltRate = t > 0 ? clamp(t * 18.0, 0, snowPackMm) : 0;
      snowPackMm -= meltRate;

      // Calibrated Hamon/Thornthwaite monthly PET (mm): ~110-150 mm/mo in warm dry summers
      const esat = 6.108 * Math.exp((17.27 * t) / (t + 237.3));
      const basePet = t > -2 ? Math.max(0, 58.0 * gE[m] * (esat / 12.0)) : 2.0;
      const petMm = basePet * petAspectMultiplier;

      // Update soil moisture bucket with runoff/drainage
      const availableIn = soilWaterMm + rainMm + meltRate;
      const actualEt = Math.min(availableIn * 0.88, petMm);
      soilWaterMm = clamp((availableIn - actualEt) * 0.94, 0, bucketCapMm);

      const wFrac = soilWaterMm / bucketCapMm;
      const gT = tempResponse(t, profile.tempCardinalsC);
      const gM = moistureResponse(wFrac, profile.moistureCardinals);
      const gMonth = gE[m] * Math.min(gT, gM);

      annualG += gMonth;
      if (springMonths.includes(m)) {
        springG += gMonth;
      }
      if (summerMonths.includes(m)) {
        summerG += gMonth;
        summerMoistureG += gM;
      }
      if (m === (isNorthern ? 5 : 11)) {
        juneMoistureG = gM;
      }
      if (gE[m] > 0.55) {
        if (gM < gT - 0.05) moistStressSum += gT - gM;
        else if (gT < gM - 0.05) tempStressSum += gM - gT;
      }
    }

    const dryEarlySummerP = cy.precipMm[isNorthern ? 5 : 11] + 5;
    const lateMonsoonP =
      0.5 * (cy.precipMm[isNorthern ? 6 : 0] + cy.precipMm[isNorthern ? 7 : 1]);
    const monsoonPulseRatio = lateMonsoonP / dryEarlySummerP;

    const summerTempC =
      (cy.tempC[summerMonths[0]] +
        cy.tempC[summerMonths[1]] +
        cy.tempC[summerMonths[2]]) /
      3;

    rawYearlyMetrics.push({
      year: cy.year,
      annualG,
      springG,
      summerG,
      summerMoistureG: summerMoistureG / 3,
      juneMoistureG,
      summerTempC,
      monsoonPulseRatio,
      tempStressSum,
      moistStressSum,
      isSynthetic: cy.isSynthetic,
    });
  }

  // Drop warm-up year (index 0 was startYear - 1)
  const treeLifeMetrics = rawYearlyMetrics.slice(1);
  const meanAnnualG =
    treeLifeMetrics.reduce((acc, x) => acc + x.annualG, 0) /
    Math.max(1, treeLifeMetrics.length);

  // Absolute site quality index S in [0.12, 1.25] (~3.1 is a lush mesic benchmark growing season sum)
  const rawSiteQuality = clamp(meanAnnualG / 3.05, 0.08, 1.28);
  const siteQuality = env.terrain.isWaterOrInvalid
    ? 0.12
    : clamp(rawSiteQuality * micrositeVigorMult, 0.12, 1.25);

  // Biologically faithful seedling years to reach 0.30 m stump height (2 yrs lush Site I, 3-5 yrs montane/xeric)
  const totalAge = Math.max(4, Math.round(params.totalAge));
  const germinationYear = params.deathYear - totalAge;
  const rawYearsToStump = Math.round(
    profile.optimalYearsToStump + clamp((1.04 - siteQuality) * 4.2, 0, 5)
  );
  const yearsToStumpHeight = clamp(rawYearsToStump, 2, Math.max(2, totalAge - 2));
  const visibleRingCount = Math.max(1, totalAge - yearsToStumpHeight);
  const firstRingYear = germinationYear + yearsToStumpHeight;

  // Seeded multi-decadal neighbor canopy competition wave (suppression / release)
  const compPhase = rngSite.range(0, Math.PI * 2);
  const compPeriod = rngSite.range(28, 52);
  const compAmp = rngSite.range(0.05, 0.14);

  // Sapwood ring count for heartwood boundary
  const sapwoodRings = Math.round(
    profile.sapwoodRingsMean * rngAnatomy.range(0.85, 1.15)
  );

  // Step 1: Compute 1D radial ring series from pith outward
  const pithRadiusMm = rngAnatomy.range(1.1, 2.0);
  let currentMeanRadiusMm = pithRadiusMm;
  let prevClimateNorm = 1.0;

  const ringRecords: AnnualRingRecord[] = [];
  const metricsByYear = new Map(treeLifeMetrics.map((m) => [m.year, m]));

  for (let k = 1; k <= visibleRingCount; k++) {
    const calendarYear = firstRingYear + k - 1;
    const ym =
      metricsByYear.get(calendarYear) ??
      treeLifeMetrics[treeLifeMetrics.length - 1];

    // Normalized climate index relative to site mean, with species drought sensitivity
    const rawRel = meanAnnualG > 0.05 ? ym.annualG / meanAnnualG : 0.5;
    const sensitized = Math.pow(
      clamp(rawRel, 0.08, 2.1),
      profile.climateSensitivityExp
    );
    const phi = profile.priorYearCarryover;
    const climateIndex = clamp(
      (1 - phi) * sensitized + phi * prevClimateNorm,
      0.12,
      1.95
    );
    prevClimateNorm = sensitized;

    // Stand competition wave
    const standMod =
      1.0 + compAmp * Math.sin((2 * Math.PI * k) / compPeriod + compPhase);

    // Biological age & Basal Area Increment geometry:
    // Smooth biophysical handoff from juvenile cambial capacity w_juv(k) to mature BAI / (2 * PI * r)
    const juvenileRamp = 1 - 0.42 * Math.exp(-(k - 1) / 3.2);
    const wJuvMm =
      profile.maxJuvenileRingMm *
      Math.pow(siteQuality, 0.72) *
      juvenileRamp *
      profile.stumpSwellFactor;

    const targetMatureBaiMm2 =
      profile.optimalMatureBaiMm2 *
      Math.pow(siteQuality, 0.85) *
      profile.stumpSwellFactor *
      profile.stumpSwellFactor;

    const baiRatio =
      (2 * Math.PI * currentMeanRadiusMm * wJuvMm) /
      Math.max(120, targetMatureBaiMm2);
    const senescenceDecay = k > 180 ? Math.exp(-(k - 180) / 420) : 1.0;
    const bioBaseMm =
      (wJuvMm / Math.sqrt(1 + baiRatio * baiRatio)) * senescenceDecay;

    const meanWidthMm = clamp(
      bioBaseMm * climateIndex * standMod * rngAnatomy.range(0.95, 1.05),
      0.12,
      9.2
    );

    // Earlywood vs. Latewood fraction driven by summer moisture & spring-to-summer balance
    const summerShare =
      ym.annualG > 0.05 ? clamp(ym.summerG / ym.annualG, 0.08, 0.65) : 0.25;
    const ageLwAdjust = k < 10 ? -0.035 : k > 150 ? -0.025 : 0.015;
    const lwFrac = clamp(
      profile.baseLatewoodFraction +
        0.24 * (summerShare - 0.3) +
        ageLwAdjust +
        rngAnatomy.gaussian(0, 0.022),
      profile.minLatewoodFraction,
      profile.maxLatewoodFraction
    );

    const latewoodWidthMm = meanWidthMm * lwFrac;
    const earlywoodWidthMm = meanWidthMm - latewoodWidthMm;

    // Check for monsoon Intra-Annual Density Fluctuation (false ring): dry early summer + monsoon surge
    const juneWasDry = ym.juneMoistureG < 0.55 || ym.moistStressSum > 0.35;
    const strongMonsoon = ym.monsoonPulseRatio > 1.75;
    const hasFalseRing =
      meanWidthMm > 0.75 &&
      juneWasDry &&
      strongMonsoon &&
      rngAnatomy.next() < profile.falseRingPropensity;

    const isHeartwood =
      visibleRingCount > 14 && k <= visibleRingCount - sapwoodRings;

    // Grayscale reflectance values [0..255]
    const ewVigorBright = clamp((climateIndex - 1.0) * 11, -12, 10);
    const heartwoodShift = isHeartwood
      ? profile.palette.heartwoodEwDarkening +
        (k === visibleRingCount - sapwoodRings ? -4 : 0)
      : 0;

    const earlywoodGray = Math.round(
      clamp(
        profile.palette.sapwoodEwLight +
          ewVigorBright -
          heartwoodShift +
          rngAnatomy.gaussian(0, 2.5),
        165,
        246
      )
    );

    // Maximum latewood density (MXD) correlates positively with warm late-summer temperatures & moisture
    const mxdDarkening =
      clamp((ym.summerTempC - 15) * 1.4, -10, 12) +
      clamp((ym.summerMoistureG - 0.35) * 14, -8, 10);
    const latewoodGray = Math.round(
      clamp(
        profile.palette.latewoodDark -
          mxdDarkening -
          (isHeartwood ? 4 : 0) +
          rngAnatomy.gaussian(0, 3.0),
        18,
        86
      )
    );

    const transitionGray = Math.round(
      0.52 * earlywoodGray + 0.48 * latewoodGray
    );

    const limitingFactor: AnnualRingRecord['limitingFactor'] =
      ym.moistStressSum > ym.tempStressSum + 0.25
        ? 'moisture'
        : ym.tempStressSum > ym.moistStressSum + 0.25
          ? 'temperature'
          : 'balanced';

    ringRecords.push({
      ringIndex: k,
      calendarYear,
      cambialAge: k,
      treeAge: yearsToStumpHeight + k,
      climateIndex,
      limitingFactor,
      meanWidthMm,
      earlywoodWidthMm,
      latewoodWidthMm,
      latewoodFraction: lwFrac,
      hasFalseRing,
      falseRingPosition: hasFalseRing ? rngAnatomy.range(0.62, 0.78) : 0,
      earlywoodGray,
      transitionGray,
      latewoodGray,
      isHeartwood,
      isSyntheticClimate: ym.isSynthetic,
    });

    currentMeanRadiusMm += meanWidthMm;
  }

  // Step 2: Build 2D Polar Cross-Section Geometry around eccentric pith
  const numAngles = 300;
  const anglesRad: number[] = [];
  for (let j = 0; j < numAngles; j++) {
    anglesRad.push((j / numAngles) * 2 * Math.PI);
  }

  // Biomechanical lean direction: combines downhill slope vector + seeded prevailing wind vector
  // Convert compass azimuth (0=N, 90=E) to SVG/math polar angle where 0=+X(East), PI/2=+Y(South on screen)
  // Using screen compass convention: North = -PI/2 (up), East = 0 (right), South = +PI/2 (down), West = PI (left)
  const compassToScreenRad = (compassDeg: number) =>
    ((compassDeg - 90) * Math.PI) / 180;

  const slopeLeanStrength = clamp(env.terrain.slopeDeg / 38, 0, 0.32);
  const slopeScreenRad = compassToScreenRad(env.terrain.aspectDeg);

  const windCompassDeg = rngMorph.range(0, 360);
  const windScreenRad = compassToScreenRad(windCompassDeg);
  const windLeanStrength = rngMorph.range(0.03, 0.13);

  const leanVecX =
    slopeLeanStrength * Math.cos(slopeScreenRad) +
    windLeanStrength * Math.cos(windScreenRad);
  const leanVecY =
    slopeLeanStrength * Math.sin(slopeScreenRad) +
    windLeanStrength * Math.sin(windScreenRad);

  const compressionStrength = clamp(Math.hypot(leanVecX, leanVecY), 0.03, 0.35);
  const leanScreenRad = Math.atan2(leanVecY, leanVecX);
  const leanAzimuthDeg = (((leanScreenRad * 180) / Math.PI + 90) % 360 + 360) % 360;

  // Root-buttress flare lobes (emerge progressively at 0.30 m stump height)
  const numRootLobes = rngMorph.int(4, 7);
  const rootLobes: Array<{ theta: number; amp: number; sigma: number }> = [];
  const baseRootOffset = rngMorph.range(0, 2 * Math.PI);
  for (let l = 0; l < numRootLobes; l++) {
    const baseAngle =
      baseRootOffset +
      (l / numRootLobes) * 2 * Math.PI +
      rngMorph.range(-0.32, 0.32);
    // Slightly stronger root buttressing on downhill/lean and uphill anchor sides
    const alignBoost =
      1 + 0.25 * Math.abs(Math.cos(baseAngle - leanScreenRad));
    rootLobes.push({
      theta: baseAngle,
      amp: rngMorph.range(0.055, 0.165) * alignBoost,
      sigma: rngMorph.range(0.22, 0.44),
    });
  }

  // Elliptical stem cross-section harmonic
  const ellipseAxisRad = leanScreenRad + rngMorph.range(-0.4, 0.4);
  const ellipseAmp = rngMorph.range(0.015, 0.055);

  const woodNoise = new Noise2D(rngMorph.fork('cambial-grain'));

  // Initialize inner boundary as slightly organic pith
  let prevOuterRadii = anglesRad.map(
    (theta) =>
      pithRadiusMm *
      (1 + 0.08 * woodNoise.polarFbm(theta, 1.8, 0.2, 2))
  );

  const polarRings: PolarRingGeometry[] = [];
  let cumRadiusApprox = pithRadiusMm;

  for (let idx = 0; idx < ringRecords.length; idx++) {
    const rec = ringRecords[idx];
    cumRadiusApprox += rec.meanWidthMm;

    // Root-buttress expression ramps up nonlinearly as tree base matures (> 25 mm radius)
    const rootExpression = clamp(
      Math.pow(clamp((cumRadiusApprox - 18) / 145, 0, 1), 1.25),
      0,
      1
    );

    const innerRadiusMm = prevOuterRadii.slice();
    const ewBoundaryRadiusMm: number[] = [];
    const lwInnerRadiusMm: number[] = [];
    const outerRadiusMm: number[] = [];
    const falseRingRadiusMm: number[] | undefined = rec.hasFalseRing
      ? []
      : undefined;

    // Slight inter-annual wander in lean direction (wind storms / canopy shifts)
    const yearLeanAngle =
      leanScreenRad + 0.14 * Math.sin(idx * 0.19 + ellipseAxisRad);

    for (let j = 0; j < numAngles; j++) {
      const theta = anglesRad[j];

      // 1. Conifer compression wood modulation (wider on lean side)
      const cosLean = Math.cos(theta - yearLeanAngle);
      const compMod = 1 + compressionStrength * cosLean;

      // 2. Progressive basal root-buttress flutes
      let lobeSum = 0;
      for (const lobe of rootLobes) {
        const dTheta = angularDiff(theta, lobe.theta);
        lobeSum +=
          lobe.amp * Math.exp(-(dTheta * dTheta) / (2 * lobe.sigma * lobe.sigma));
      }
      // Zero-mean the lobe modulation partially so mean diameter stays true to allometry
      const fluteMod = 1 + rootExpression * (lobeSum - 0.045);

      // 3. Gentle elliptical stem mode + coherent cambial grain noise
      const ellMod = 1 + ellipseAmp * Math.cos(2 * (theta - ellipseAxisRad));
      const grainMod =
        1 +
        0.065 *
          woodNoise.polarFbm(
            theta,
            3.2,
            cumRadiusApprox * 0.022 + idx * 0.035,
            3
          );

      const localWidth = Math.max(
        0.08,
        rec.meanWidthMm * compMod * fluteMod * ellMod * grainMod
      );

      // Compression wood also increases local latewood proportion on the downhill/lean side
      const compLwBoost =
        cosLean > 0 ? compressionStrength * 0.35 * cosLean : 0;
      const localLwFrac = clamp(
        rec.latewoodFraction + compLwBoost,
        0.09,
        0.62
      );

      const r0 = innerRadiusMm[j];
      const rOuter = r0 + localWidth;
      const lwStartFrac = 1 - localLwFrac;

      // For semi-gradual species (Ponderosa), create a soft transition band before crisp latewood
      const transWidthFrac =
        profile.ewLwTransition === 'semi-gradual'
          ? Math.min(0.22, lwStartFrac * 0.32)
          : Math.min(0.06, lwStartFrac * 0.1);

      ewBoundaryRadiusMm.push(r0 + localWidth * (lwStartFrac - transWidthFrac));
      lwInnerRadiusMm.push(r0 + localWidth * lwStartFrac);
      outerRadiusMm.push(rOuter);

      if (falseRingRadiusMm) {
        falseRingRadiusMm.push(
          r0 + localWidth * lwStartFrac * rec.falseRingPosition
        );
      }
    }

    polarRings.push({
      record: rec,
      innerRadiusMm,
      ewBoundaryRadiusMm,
      lwInnerRadiusMm,
      outerRadiusMm,
      falseRingRadiusMm,
    });

    prevOuterRadii = outerRadiusMm;
  }

  const finalWoodRadii = prevOuterRadii;
  const meanFinalWoodRadiusMm =
    finalWoodRadii.reduce((a, b) => a + b, 0) / finalWoodRadii.length;

  const bark = buildAnatomicalBarkGeometry(
    profile,
    finalWoodRadii,
    anglesRad,
    meanFinalWoodRadiusMm,
    rngBark
  );

  // Compute physical diameters across horizontal + perpendicular axes
  const diameterInsideBarkMm = meanFinalWoodRadiusMm * 2;
  const diameterOutsideBarkMm =
    diameterInsideBarkMm + bark.meanThicknessMm * 2;

  return {
    params,
    seedKey,
    seedHex,
    stumpHeightM: profile.stumpHeightM,
    yearsToStumpHeight,
    germinationYear,
    firstRingYear,
    visibleRingCount,
    anglesRad,
    pithRadiusMm,
    leanAzimuthDeg,
    compressionStrength,
    diameterInsideBarkMm,
    diameterOutsideBarkMm,
    rings: polarRings,
    bark,
    environment: env,
    viability,
  };
}
