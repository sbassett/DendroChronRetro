import { Noise2D, SeededRNG } from './prng';
import { SpeciesProfile } from './species';
import { BarkGeometry, PolarPoint } from './types';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function wrapAngle(theta: number): number {
  const twoPi = 2 * Math.PI;
  return ((theta % twoPi) + twoPi) % twoPi;
}

/**
 * Biophysical transverse bark generator modeling living secondary phloem,
 * circumferential hoop-stress fracturing,
 * and species-specific sequential periderm / rhytidome compartment anatomy.
 */
export function buildAnatomicalBarkGeometry(
  profile: SpeciesProfile,
  cambiumRadii: number[],
  woodAngles: number[],
  meanWoodRadiusMm: number,
  rngBark: SeededRNG
): BarkGeometry {
  const morphology = profile.bark.morphology;
  const diameterIbMm = meanWoodRadiusMm * 2;

  // Allometric bark scaling (USDA FS inside-to-outside bark relationships + 0.30m stump boost)
  const maturityWeight = clamp((diameterIbMm - 75) / 270, 0, 1);
  const dbtRatio =
    profile.bark.juvenileDbtRatio * (1 - maturityWeight) +
    profile.bark.matureDbtRatio * maturityWeight;

  const stumpBarkBoost = 1.15;
  const rawSingleBarkMm =
    (0.5 * dbtRatio * diameterIbMm + profile.bark.juvenileOffsetMm) *
    stumpBarkBoost *
    rngBark.range(0.93, 1.08);
  // Outer scale exfoliation gradually balances inner periderm production on old-growth trunks
  const softMaxMm = morphology === 'plated-scaly' ? 82.0 : 104.0;
  const kneeMm = morphology === 'plated-scaly' ? 44.0 : 62.0;
  const spanMm = softMaxMm - kneeMm;
  const meanSingleBarkMm = clamp(
    rawSingleBarkMm <= kneeMm
      ? rawSingleBarkMm
      : kneeMm + spanMm * (1 - Math.exp(-(rawSingleBarkMm - kneeMm) / spanMm)),
    2.0,
    softMaxMm
  );

  // Hoop-strain maturity [0.12 .. 1.0]: small saplings have shallow fissures; large trunks fracture deeply
  const hoopMaturity = clamp((diameterIbMm - 32) / 210, 0.14, 1.0);

  // Living inner bark (secondary phloem) thickness
  const basePhloemMm = clamp(1.1 + meanWoodRadiusMm * 0.014, 1.05, 4.5);
  const rhytidomeTargetMaxMm = Math.max(
    1.2,
    (meanSingleBarkMm - basePhloemMm) * (morphology === 'furrowed-corky' ? 1.34 : 1.2)
  );

  // High-resolution angular grid (1080 samples = 0.333 deg resolution) for crisp stepped clefts & ridges
  const barkSteps = 1080;
  const barkAnglesRad: number[] = [];
  for (let i = 0; i < barkSteps; i++) {
    barkAnglesRad.push((i / barkSteps) * 2 * Math.PI);
  }

  // Smooth circular interpolation of wood cambium radius at arbitrary theta
  const sampleWoodRadius = (theta: number): number => {
    const n = woodAngles.length;
    const pos = (wrapAngle(theta) / (2 * Math.PI)) * n;
    const i0 = Math.floor(pos) % n;
    const i1 = (i0 + 1) % n;
    const f = pos - Math.floor(pos);
    return cambiumRadii[i0] * (1 - f) + cambiumRadii[i1] * f;
  };

  // Partition circumference into primary bark units (ridges for DF, puzzle plates for PP)
  const sizeScale = clamp(Math.pow(Math.max(diameterIbMm, 45) / 250, 0.44), 0.52, 1.95);
  const numUnits = Math.max(
    7,
    Math.round(profile.bark.basePlateCount * sizeScale + rngBark.range(-2, 2))
  );

  const unitWeights = Array.from({ length: numUnits }, () =>
    morphology === 'plated-scaly'
      ? rngBark.range(0.62, 1.65)
      : rngBark.range(0.55, 1.5)
  );
  const totalWeight = unitWeights.reduce((a, b) => a + b, 0);

  const startOffset = rngBark.range(0, 2 * Math.PI);
  const unitStarts: number[] = [];
  const unitSpans: number[] = [];
  let cursor = startOffset;
  for (let u = 0; u < numUnits; u++) {
    unitStarts.push(cursor);
    const span = (unitWeights[u] / totalWeight) * 2 * Math.PI;
    unitSpans.push(span);
    cursor += span;
  }

  // Per-unit mechanical fracture & exfoliation traits
  interface BarkUnitSpec {
    crestMult: number;
    obliqueLean: number;
    leftWallSteepness: number;
    rightWallSteepness: number;
    fissureFloorFrac: number;
    secondarySplitPos: number | null;
    secondarySplitDepth: number;
    stepCount: number;
  }

  const unitSpecs: BarkUnitSpec[] = [];
  for (let u = 0; u < numUnits; u++) {
    const relWidth = unitWeights[u] / (totalWeight / numUnits);
    const canSplit = hoopMaturity > 0.32 && relWidth > 0.95;

    if (morphology === 'furrowed-corky') {
      // Douglas-fir: rugged corky ridges, asymmetric oblique V/U canyons, secondary crest splits
      const hasSec = canSplit && rngBark.next() < 0.65;
      unitSpecs.push({
        crestMult: rngBark.range(0.8, 1.2),
        obliqueLean: rngBark.range(-0.24, 0.24),
        leftWallSteepness: rngBark.range(1.15, 1.95),
        rightWallSteepness: rngBark.range(1.15, 1.95),
        fissureFloorFrac: clamp(
          1 - profile.bark.fissureDepthFraction * hoopMaturity * rngBark.range(0.88, 1.12),
          0.1,
          0.65
        ),
        secondarySplitPos: hasSec ? rngBark.range(-0.26, 0.26) : null,
        secondarySplitDepth: hasSec ? rngBark.range(0.24, 0.46) * hoopMaturity : 0,
        stepCount: rngBark.int(3, 6),
      });
    } else {
      // Ponderosa pine: quantized tabular exfoliation plates + steep stair-stepped cleft margins
      const discreteScaleSteps = rngBark.int(-2, 2);
      const hasHairline = canSplit && rngBark.next() < 0.38;
      unitSpecs.push({
        crestMult: clamp(0.96 + discreteScaleSteps * 0.065 + rngBark.range(-0.02, 0.02), 0.78, 1.16),
        obliqueLean: rngBark.range(-0.14, 0.14),
        leftWallSteepness: rngBark.range(2.1, 3.4),
        rightWallSteepness: rngBark.range(2.1, 3.4),
        fissureFloorFrac: clamp(
          1 - profile.bark.fissureDepthFraction * hoopMaturity * rngBark.range(0.9, 1.12),
          0.14,
          0.68
        ),
        secondarySplitPos: hasHairline ? rngBark.range(-0.22, 0.22) : null,
        secondarySplitDepth: hasHairline ? rngBark.range(0.32, 0.58) * hoopMaturity : 0,
        stepCount: rngBark.int(2, 4),
      });
    }
  }

  const phloemNoise = new Noise2D(rngBark.fork('phloem-wave'));
  const surfaceNoise = new Noise2D(rngBark.fork('outer-crust'));

  const phloemOuterRadiusMm: number[] = [];
  const outerBarkRadiusMm: number[] = [];

  for (let i = 0; i < barkSteps; i++) {
    const theta = barkAnglesRad[i];
    const rCambium = sampleWoodRadius(theta);

    const localPhloem =
      basePhloemMm *
      (1 + 0.05 * phloemNoise.polarFbm(theta, 8, 1.1, 2));
    const rPhloem = rCambium + localPhloem;
    phloemOuterRadiusMm.push(rPhloem);

    // Locate containing bark unit u
    let rel = wrapAngle(theta - startOffset);
    let uIdx = numUnits - 1;
    let acc = 0;
    for (let u = 0; u < numUnits; u++) {
      if (rel >= acc && rel < acc + unitSpans[u]) {
        uIdx = u;
        break;
      }
      acc += unitSpans[u];
    }

    const localOffset = rel - unitStarts[uIdx] + startOffset;
    // Normalized coordinate s in [-1, 1] across unit u
    const rawS = clamp((localOffset / Math.max(1e-5, unitSpans[uIdx])) * 2 - 1, -1, 1);
    const spec = unitSpecs[uIdx];
    // Apply oblique shear so fracture walls lean realistically
    const s = clamp(rawS + spec.obliqueLean * (1 - rawS * rawS), -1, 1);

    let heightFrac = 1.0;

    if (morphology === 'furrowed-corky') {
      // Douglas-fir: asymmetric ridge profile with rugged corky ledges along canyon walls
      const wallExp = s < 0 ? spec.leftWallSteepness : spec.rightWallSteepness;
      const absS = Math.abs(s);
      // Canyon opens wider with hoopMaturity
      const canyonOpenness = 0.52 + 0.35 * hoopMaturity;
      const smoothRidge = Math.pow(Math.max(0, 1 - Math.pow(absS, wallExp)), canyonOpenness);

      // Subtle stepped ledges where periderm layers sheared off along fissure walls
      const stepQuant =
        Math.floor(smoothRidge * spec.stepCount) / spec.stepCount;
      const blendedWall = 0.78 * smoothRidge + 0.22 * stepQuant;

      heightFrac =
        spec.fissureFloorFrac +
        (spec.crestMult - spec.fissureFloorFrac) * blendedWall;

      // Secondary split on mature ridges
      if (spec.secondarySplitPos !== null) {
        const dSec = Math.abs(s - spec.secondarySplitPos);
        const secHalfW = 0.16 + 0.08 * hoopMaturity;
        if (dSec < secHalfW) {
          const notch = Math.cos((dSec / secHalfW) * (Math.PI / 2));
          heightFrac -= spec.secondarySplitDepth * notch * notch;
        }
      }

      // Rough corky micro-relief
      const crustRough =
        0.09 * surfaceNoise.polarFbm(theta, 22.0, diameterIbMm * 0.03, 3);
      heightFrac = Math.max(spec.fissureFloorFrac * 0.85, heightFrac + crustRough);
    } else {
      // Ponderosa pine: flat/gently arched exfoliated armor plate top + stair-stepped narrow clefts
      const absS = Math.abs(s);
      const plateTopSpan = clamp(0.84 - 0.14 * hoopMaturity, 0.64, 0.84);

      if (absS <= plateTopSpan) {
        // Tabular exfoliated scale surface (very slight arch + fine flake roughness)
        const uNorm = absS / plateTopSpan;
        heightFrac =
          spec.crestMult * (1 - 0.035 * uNorm * uNorm) +
          0.022 * surfaceNoise.polarFbm(theta, 26.0, 2.7, 2);

        // Narrow hairline incipient cleft inside large plates
        if (spec.secondarySplitPos !== null) {
          const dSec = Math.abs(s - spec.secondarySplitPos);
          if (dSec < 0.075) {
            const cleft = 1 - dSec / 0.075;
            heightFrac -= spec.secondarySplitDepth * Math.pow(cleft, 1.7);
          }
        }
      } else {
        // Steep stair-stepped canyon edge where stacked puzzle scales terminate
        const edgeT = (absS - plateTopSpan) / Math.max(1e-4, 1 - plateTopSpan);
        const wallExp = s < 0 ? spec.leftWallSteepness : spec.rightWallSteepness;
        const contDrop = Math.pow(Math.max(0, 1 - edgeT), wallExp * 0.55);
        // Quantize partially into discrete scale steps!
        const steppedDrop =
          Math.ceil(contDrop * spec.stepCount) / spec.stepCount;
        const terraceDrop = 0.58 * contDrop + 0.42 * steppedDrop;

        heightFrac =
          spec.fissureFloorFrac +
          (spec.crestMult * 0.965 - spec.fissureFloorFrac) * terraceDrop;
      }
    }

    const localRhytidomeMm = Math.max(0.35, rhytidomeTargetMaxMm * heightFrac);
    outerBarkRadiusMm.push(rPhloem + localRhytidomeMm);
  }

  // Measure actual peak rhytidome thickness around the circumference so internal
  // cork bands / puzzle-scale tiers always span 100% of the bark out to the exterior surface
  let maxActualRhytidomeMm = 1.2;
  for (let i = 0; i < barkSteps; i++) {
    const rhyt = outerBarkRadiusMm[i] - phloemOuterRadiusMm[i];
    if (rhyt > maxActualRhytidomeMm) {
      maxActualRhytidomeMm = rhyt;
    }
  }

  // Generate internal sequential periderm compartments (clipped to rhytidome in SVG!)
  const rhytidomeCells: BarkGeometry['rhytidomeCells'] = [];
  const peridermSeams: BarkGeometry['peridermSeams'] = [];
  const internalNoise = new Noise2D(rngBark.fork('periderm-arcs'));

  if (morphology === 'furrowed-corky') {
    // DOUGLAS-FIR: Tangential pale cork (phellem) bands/lenses interleaved with dark crushed phloem,
    // laid down along concentric cambial arcs so they get cleanly truncated by deep V-fissures!
    const coverHeightMm = maxActualRhytidomeMm * 1.04 + 0.6;
    const targetBandSpacingMm = clamp(1.35 + coverHeightMm * 0.046, 1.3, 6.2);
    const numRadialBands = clamp(
      Math.round(coverHeightMm / targetBandSpacingMm),
      3,
      24
    );
    const bandSpacingMm = coverHeightMm / numRadialBands;

    for (let b = 0; b < numRadialBands; b++) {
      const zCenter = (b + 0.52) / numRadialBands; // 0 = near inner bark, 1 = outer ridge tips
      const radialOffsetMm = zCenter * coverHeightMm;
      const corkBandHalfThickMm =
        bandSpacingMm * rngBark.range(0.19, 0.34) * (1 - 0.14 * zCenter);

      // Divide circumference into 5..11 elongated tangential cork lenses per radial tier
      const lensesInTier = rngBark.int(5, 10);
      const tierPhase = rngBark.range(0, 2 * Math.PI);

      for (let l = 0; l < lensesInTier; l++) {
        const arcStart =
          tierPhase + (l / lensesInTier) * 2 * Math.PI + rngBark.range(-0.08, 0.08);
        const arcSpan =
          ((2 * Math.PI) / lensesInTier) * rngBark.range(0.68, 0.94);
        const steps = Math.max(8, Math.round(arcSpan * 28));

        const outerArc: PolarPoint[] = [];
        const innerArc: PolarPoint[] = [];

        const corkGray = Math.round(
          clamp(
            profile.palette.barkHighlightGray +
              rngBark.range(-12, 18) -
              zCenter * 10,
            82,
            138
          )
        );

        for (let sIdx = 0; sIdx <= steps; sIdx++) {
          const frac = sIdx / steps;
          const theta = arcStart + frac * arcSpan;
          // Taper lens gently at its tangential ends (anastomosing phellogen)
          const endTaper = Math.sin(frac * Math.PI);
          const pinch = Math.pow(endTaper, 0.45);

          const basePhloemR =
            sampleWoodRadius(theta) + basePhloemMm;
          const waveMm =
            bandSpacingMm *
            0.35 *
            internalNoise.polarFbm(theta, 6.5, b * 1.7, 2);

          const rMid = basePhloemR + radialOffsetMm + waveMm;
          const halfT = corkBandHalfThickMm * pinch;
          outerArc.push({ theta, r: rMid + halfT });
          innerArc.push({ theta, r: Math.max(basePhloemR * 0.995, rMid - halfT) });
        }

        rhytidomeCells.push({
          pointsPolar: [...outerArc, ...innerArc.reverse()],
          fillGray: corkGray,
          strokeGray: 24,
          strokeWidthMm: clamp(bandSpacingMm * 0.085, 0.12, 0.42),
        });
      }

      // Continuous undulating dark phellogen seam between cork tiers
      const seamPts: PolarPoint[] = [];
      const seamSteps = 180;
      const seamOffsetMm = (b + 0.08) * bandSpacingMm;
      for (let sIdx = 0; sIdx <= seamSteps; sIdx++) {
        const theta = (sIdx / seamSteps) * 2 * Math.PI;
        const baseR = sampleWoodRadius(theta) + basePhloemMm;
        const wave =
          bandSpacingMm *
          0.28 *
          internalNoise.polarFbm(theta, 7.5, b * 2.3 + 9.1, 2);
        seamPts.push({ theta, r: baseR + seamOffsetMm + wave });
      }
      peridermSeams.push({
        pointsPolar: seamPts,
        gray: 20,
        widthMm: clamp(bandSpacingMm * 0.075, 0.11, 0.36),
      });
    }
  } else {
    // PONDEROSA PINE: Interlocking brick/shingle tiers of tabular-lenticular puzzle scales
    // enclosed by crisp dark sequential periderm seams spanning 100% of the rhytidome!
    const coverHeightMm =
      maxActualRhytidomeMm * 1.08 + basePhloemMm * 0.1 + 0.8;
    const targetScaleThickMm = clamp(
      1.15 + coverHeightMm * 0.048,
      1.15,
      5.6
    );
    const numTiers = clamp(
      Math.round(coverHeightMm / targetScaleThickMm),
      4,
      20
    );
    // Derive exact radial step from coverHeightMm / numTiers so tiers NEVER stop short of outer bark
    const scaleThickMm = coverHeightMm / numTiers;

    const scalesPerCircle = Math.max(
      16,
      Math.round(numUnits * 1.65)
    );

    for (let t = 0; t < numTiers; t++) {
      const rTierInnerOffset = t * scaleThickMm;
      const rTierOuterOffset = (t + 1) * scaleThickMm;
      const tierFrac = t / Math.max(1, numTiers - 1);

      // Stagger each radial tier by ~half a scale width so periderm seams overlap like shingles!
      const tierAngleOffset =
        startOffset +
        (t % 2 === 1 ? Math.PI / scalesPerCircle : 0) +
        rngBark.range(-0.04, 0.04);

      // Partition full 2*PI circle into seamless jittered scale spans so adjacent scales meet cleanly
      const boundaryOffsets: number[] = [0];
      for (let sc = 1; sc < scalesPerCircle; sc++) {
        const jitter = rngBark.range(-0.18, 0.18) / scalesPerCircle;
        boundaryOffsets.push((sc / scalesPerCircle + jitter) * 2 * Math.PI);
      }
      boundaryOffsets.push(2 * Math.PI);

      for (let sc = 0; sc < scalesPerCircle; sc++) {
        const scStart = tierAngleOffset + boundaryOffsets[sc];
        const scSpan = boundaryOffsets[sc + 1] - boundaryOffsets[sc];
        const steps = 10;

        const outerPts: PolarPoint[] = [];
        const innerPts: PolarPoint[] = [];

        // Ponderosa scales brighten from inner bark toward ochre/buff ("yellowbelly") outer plates,
        // with subtle tier-to-tier & scale-to-scale luminance contrast so stacked layers read clearly
        const tierParityLift = (t % 2 === 1 ? 6 : -4);
        const scaleGray = Math.round(
          clamp(
            profile.palette.barkBaseGray +
              24 +
              tierFrac * 36 +
              tierParityLift +
              rngBark.range(-10, 11),
            84,
            158
          )
        );

        for (let k = 0; k <= steps; k++) {
          const u = k / steps; // 0..1 across single puzzle scale
          const theta = scStart + u * scSpan;
          const baseR = sampleWoodRadius(theta) + basePhloemMm;

          // Subtle convex arch per scale; adjacent radial tiers share boundary wave seed
          // so tiers interlock tightly without leaving dark voids between layers
          const scallop = Math.sin(u * Math.PI);
          const waveIn =
            scaleThickMm *
            0.14 *
            internalNoise.polarFbm(theta, 10.0, t * 1.35, 2);
          const waveOut =
            scaleThickMm *
            0.14 *
            internalNoise.polarFbm(theta, 10.0, (t + 1) * 1.35, 2);

          const rIn =
            t === 0
              ? baseR - basePhloemMm * 0.08
              : baseR + rTierInnerOffset + waveIn - scaleThickMm * 0.09 * scallop;
          const rOut =
            baseR + rTierOuterOffset + waveOut + scaleThickMm * 0.11 * scallop;

          innerPts.push({ theta, r: rIn });
          outerPts.push({ theta, r: rOut });
        }

        // Delicate internal papery laminar exfoliation line inside thicker scales (subtle when zoomed out)
        if (scaleThickMm > 1.45) {
          const lamPts: PolarPoint[] = [];
          for (let m = 0; m <= 6; m++) {
            const um = m / 6;
            const thM = scStart + um * scSpan;
            const bRM = sampleWoodRadius(thM) + basePhloemMm;
            const wInM =
              scaleThickMm *
              0.14 *
              internalNoise.polarFbm(thM, 10.0, t * 1.35, 2);
            const wOutM =
              scaleThickMm *
              0.14 *
              internalNoise.polarFbm(thM, 10.0, (t + 1) * 1.35, 2);
            const wM = 0.5 * (wInM + wOutM);
            lamPts.push({
              theta: thM,
              r: bRM + 0.5 * (rTierInnerOffset + rTierOuterOffset) + wM,
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
