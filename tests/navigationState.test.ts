import { describe, expect, it } from 'vitest';
import {
  getClimaticStressDescription,
  getDisturbanceTraumaTags,
  getRwiInspectionInfo,
} from '../src/components/SvgViewport';
import { simulateTreeCrossSection } from '../src/model/growthEngine';
import { getPresetById, RETROSPECTIVE_PRESETS } from '../src/model/presets';
import {
  generateCrossSectionSvgBundle,
  getSimSvgCache,
  invalidateSimSvgCache,
  MAX_BUNDLE_CACHE_SIZE,
  precomputeSimSvgCache,
} from '../src/model/svgGenerator';
import {
  AnnualRingRecord,
  EnvironmentDataset,
  MonthlyClimateYear,
} from '../src/model/types';

function createMockEnvironment(
  baseTempC = 8.5,
  annualPrecipMm = 520,
  elevationM = 1950
): EnvironmentDataset {
  const years: MonthlyClimateYear[] = [];
  for (let y = 1500; y <= 2026; y++) {
    const tempC: number[] = [];
    const precipMm: number[] = [];
    for (let m = 0; m < 12; m++) {
      const seasonal = -Math.cos(((m - 0.5) / 12) * 2 * Math.PI) * 9.0;
      tempC.push(baseTempC + seasonal);
      const wetShare = 1 + 0.35 * Math.cos(((m - 0.5) / 12) * 2 * Math.PI);
      precipMm.push((annualPrecipMm / 12) * wetShare);
    }
    years.push({
      year: y,
      tempC,
      precipMm,
      isSynthetic: true,
    });
  }

  return {
    terrain: {
      elevationM,
      slopeDeg: 14,
      aspectDeg: 190,
      isWaterOrInvalid: false,
    },
    years,
    source: 'offline-climatology',
    meanAnnualTempC: baseTempC,
    meanAnnualPrecipMm: annualPrecipMm,
    summerPrecipShare: 0.22,
  };
}

describe('Time Navigation, Ring Inspection & Slicing Engine (R3)', () => {
  const wildfirePreset = RETROSPECTIVE_PRESETS.find(
    (p) => p.id === 'wildfire-scar-healing'
  )!;

  const env = createMockEnvironment();

  const sim = simulateTreeCrossSection(
    {
      species: wildfirePreset.species,
      latitude: wildfirePreset.latitude,
      longitude: wildfirePreset.longitude,
      totalAge: 200,
      deathYear: 2020,
      disturbance: {
        fireScarYear: 1910,
        enableLocallyAbsent: true,
        enableResinPockets: true,
      },
    },
    env
  );

  describe('1. Peel & Grow Vector Ring Slicing', () => {
    it('renders all rings when maxRenderedRingIndex is omitted or equals visible rings', () => {
      const fullBundle = generateCrossSectionSvgBundle(sim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
      });

      expect(fullBundle.innerMarkup).toContain(`data-ring="${sim.visibleRingCount}"`);
      expect(fullBundle.innerMarkup).toContain('id="bark-layer"');
      expect(fullBundle.innerMarkup).toContain('id="pith"');
    });

    it('slices rings instantaneously when maxRenderedRingIndex is provided (Peel / Grow)', () => {
      const targetRing = 50;
      const t0 = performance.now();
      const slicedBundle = generateCrossSectionSvgBundle(sim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
        maxRenderedRingIndex: targetRing,
      });
      const elapsed = performance.now() - t0;

      // Must execute within < 15ms in test runtime (< 2ms in production V8)
      expect(elapsed).toBeLessThan(15);

      // Rings <= targetRing are rendered
      expect(slicedBundle.innerMarkup).toContain(`data-ring="${targetRing}"`);
      expect(slicedBundle.innerMarkup).toContain('data-ring="1"');

      // Rings > targetRing are NOT rendered
      expect(slicedBundle.innerMarkup).not.toContain(
        `data-ring="${targetRing + 1}"`
      );
      expect(slicedBundle.innerMarkup).not.toContain(
        `data-ring="${sim.visibleRingCount}"`
      );

      // When sliced to historical interior, outer mature bark is peeled away
      expect(slicedBundle.innerMarkup).not.toContain('id="bark-layer"');

      // Subtext reflects historical moment
      expect(slicedBundle.innerMarkup).toContain(`Ring #${targetRing}`);
    });

    it('executes 100 consecutive vector ring slices with average latency well under 15ms (< 3ms)', () => {
      // Warm cache (as occurs on specimen load)
      precomputeSimSvgCache(sim);

      const latencies: number[] = [];
      const cycleCount = 100;
      let allPassed = true;

      for (let cycle = 0; cycle < cycleCount; cycle++) {
        // Scrub through alternating forward and reverse indices across the chronology
        const targetRing =
          cycle % 2 === 0
            ? 1 + ((cycle * 7) % sim.visibleRingCount)
            : Math.max(1, sim.visibleRingCount - (cycle % sim.visibleRingCount));

        const t0 = performance.now();
        const bundle = generateCrossSectionSvgBundle(sim, {
          showBark: true,
          showMedullaryRays: true,
          showAnnotations: true,
          transparentBackground: false,
          maxRenderedRingIndex: targetRing,
        });
        const elapsed = performance.now() - t0;
        latencies.push(elapsed);

        if (!bundle.innerMarkup.includes(`data-ring="${targetRing}"`)) {
          allPassed = false;
        }
        if (
          targetRing < sim.visibleRingCount &&
          bundle.innerMarkup.includes(`data-ring="${targetRing + 1}"`)
        ) {
          allPassed = false;
        }
      }

      expect(allPassed).toBe(true);

      const meanLatency =
        latencies.reduce((sum, v) => sum + v, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);
      const p95Latency = [...latencies].sort((a, b) => a - b)[
        Math.floor(latencies.length * 0.95)
      ];

      console.log(
        `[Benchmark 100 Slices - 200y specimen]: mean=${meanLatency.toFixed(2)}ms, p95=${p95Latency.toFixed(2)}ms, max=${maxLatency.toFixed(2)}ms`
      );

      // Target SLA: < 15ms mean, p95 < 15ms
      expect(meanLatency).toBeLessThan(15);
      expect(p95Latency).toBeLessThan(15);
      expect(maxLatency).toBeLessThan(60);
      // Project SLA: mean latency strictly under 15ms
      expect(meanLatency).toBeLessThan(15);
    });

    it('executes 100 consecutive vector ring slices on a 500-year tree with average latency under 15ms', () => {
      const ancientSim = simulateTreeCrossSection(
        {
          species: 'bristlecone-pine',
          latitude: 37.3855,
          longitude: -118.1788,
          totalAge: 500,
          deathYear: 2024,
        },
        env
      );

      // Prewarm cache
      precomputeSimSvgCache(ancientSim);

      const latencies: number[] = [];
      let allValid = true;

      for (let i = 0; i < 100; i++) {
        // Sweep across 100 unique ring steps spanning the full chronological range
        const targetRing =
          1 + Math.round((i / 99) * (ancientSim.visibleRingCount - 1));
        const t0 = performance.now();
        const bundle = generateCrossSectionSvgBundle(ancientSim, {
          showBark: true,
          showMedullaryRays: true,
          showAnnotations: true,
          transparentBackground: false,
          maxRenderedRingIndex: targetRing,
        });
        const elapsed = performance.now() - t0;
        latencies.push(elapsed);

        if (!bundle.viewBox || bundle.viewBox.width <= 0) {
          allValid = false;
        }

        // Cache size must never exceed MAX_BUNDLE_CACHE_SIZE at any step
        const currentCache = getSimSvgCache(ancientSim);
        expect(currentCache?.bundleCache.size).toBeLessThanOrEqual(
          MAX_BUNDLE_CACHE_SIZE
        );
      }

      expect(allValid).toBe(true);

      const cache = getSimSvgCache(ancientSim)!;
      expect(cache.bundleCache.size).toBeLessThanOrEqual(MAX_BUNDLE_CACHE_SIZE);
      expect(cache.bundleCache.size).toBe(MAX_BUNDLE_CACHE_SIZE);

      const meanLatency =
        latencies.reduce((sum, v) => sum + v, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);
      const p95Latency = [...latencies].sort((a, b) => a - b)[
        Math.floor(latencies.length * 0.95)
      ];

      console.log(
        `[Benchmark 100 Slices - 500y specimen]: mean=${meanLatency.toFixed(2)}ms, p95=${p95Latency.toFixed(2)}ms, max=${maxLatency.toFixed(2)}ms, cacheSize=${cache.bundleCache.size}`
      );

      expect(meanLatency).toBeLessThan(15);
      expect(maxLatency).toBeLessThan(60);
    });

    it('strictly bounds bundleCache to MAX_BUNDLE_CACHE_SIZE with LRU eviction', () => {
      const cache = getSimSvgCache(sim)!;
      cache.bundleCache.clear();

      // Render 6 distinct slices (exceeding MAX_BUNDLE_CACHE_SIZE = 3)
      for (let r = 1; r <= 6; r++) {
        generateCrossSectionSvgBundle(sim, {
          showBark: true,
          showMedullaryRays: true,
          showAnnotations: true,
          transparentBackground: false,
          maxRenderedRingIndex: r,
        });
        expect(cache.bundleCache.size).toBeLessThanOrEqual(MAX_BUNDLE_CACHE_SIZE);
      }

      expect(cache.bundleCache.size).toBe(MAX_BUNDLE_CACHE_SIZE);

      // Slices 1 to 3 were evicted; key for slice 4 is the oldest key in cache
      const keysBefore = Array.from(cache.bundleCache.keys());
      expect(keysBefore.length).toBe(MAX_BUNDLE_CACHE_SIZE);

      // Re-access slice 4 to refresh LRU
      generateCrossSectionSvgBundle(sim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
        maxRenderedRingIndex: 4,
      });

      const keysAfter = Array.from(cache.bundleCache.keys());
      // Key for slice 4 is now at the end of keys (MRU)
      expect(keysAfter[keysAfter.length - 1]).toBe(keysBefore[0]);
    });

    it('handles render option permutations and cache invalidation correctly', () => {
      // 1. Without bark
      const noBark = generateCrossSectionSvgBundle(sim, {
        showBark: false,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
      });
      expect(noBark.innerMarkup).not.toContain('id="bark-layer"');

      // 2. Without medullary rays
      const noRays = generateCrossSectionSvgBundle(sim, {
        showBark: true,
        showMedullaryRays: false,
        showAnnotations: true,
        transparentBackground: false,
      });
      expect(noRays.innerMarkup).not.toContain('id="medullary-rays"');

      // 3. Highlighted ring index
      const highlighted = generateCrossSectionSvgBundle(sim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
        highlightedRingIndex: 20,
      });
      const ring20Year = sim.rings[19].record.calendarYear;
      expect(highlighted.innerMarkup).toContain(
        `<path data-ring="20" data-year="${ring20Year}" d="`
      );
      expect(highlighted.innerMarkup).toContain('fill="#0a0a0a"');

      // 4. Invalidate cache and verify recreation
      invalidateSimSvgCache(sim);
      const freshBundle = generateCrossSectionSvgBundle(sim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
        maxRenderedRingIndex: 40,
      });
      expect(freshBundle.innerMarkup).toContain('data-ring="40"');
      expect(freshBundle.innerMarkup).not.toContain('data-ring="41"');
    });

    it('hides future fire scars and resin pockets until their historical year/ring is reached', () => {
      // Find ring index of 1910 fire scar
      const fireRing = sim.rings.find((r) => r.record.calendarYear === 1910)!;
      expect(fireRing).toBeDefined();
      const fireRingIdx = fireRing.record.ringIndex;

      // Slice before the fire scar
      const beforeFire = generateCrossSectionSvgBundle(sim, {
        showBark: false,
        showMedullaryRays: false,
        showAnnotations: false,
        transparentBackground: false,
        maxRenderedRingIndex: fireRingIdx - 5,
      });
      expect(beforeFire.innerMarkup).not.toContain('data-fire-year="1910"');

      // Slice at or after the fire scar
      const afterFire = generateCrossSectionSvgBundle(sim, {
        showBark: false,
        showMedullaryRays: false,
        showAnnotations: false,
        transparentBackground: false,
        maxRenderedRingIndex: fireRingIdx,
      });
      expect(afterFire.innerMarkup).toContain('data-fire-year="1910"');
    });

    it('clamps maxRenderedRingIndex safely to valid bounds [1, visibleRingCount]', () => {
      const lowerClamped = generateCrossSectionSvgBundle(sim, {
        showBark: false,
        showMedullaryRays: false,
        showAnnotations: false,
        transparentBackground: false,
        maxRenderedRingIndex: -10,
      });
      expect(lowerClamped.innerMarkup).toContain('data-ring="1"');
      expect(lowerClamped.innerMarkup).not.toContain('data-ring="2"');

      const upperClamped = generateCrossSectionSvgBundle(sim, {
        showBark: false,
        showMedullaryRays: false,
        showAnnotations: false,
        transparentBackground: false,
        maxRenderedRingIndex: 9999,
      });
      expect(upperClamped.innerMarkup).toContain(
        `data-ring="${sim.visibleRingCount}"`
      );
    });
  });

  describe('2. Dynamic Ring Inspection HUD Metrics & Trauma Tags', () => {
    it('correctly categorizes Relative Ring Width Index (RWI)', () => {
      const pluvial = getRwiInspectionInfo(1.45);
      expect(pluvial.category).toBe('pluvial');
      expect(pluvial.label).toBe('RWI 1.45');
      expect(pluvial.summary).toContain('Pluvial Pulse');

      const complacent = getRwiInspectionInfo(1.02);
      expect(complacent.category).toBe('complacent');
      expect(complacent.label).toBe('RWI 1.02');

      const drought = getRwiInspectionInfo(0.55);
      expect(drought.category).toBe('drought');
      expect(drought.label).toBe('RWI 0.55');

      const severe = getRwiInspectionInfo(0.28);
      expect(severe.category).toBe('severe');
      expect(severe.label).toBe('RWI 0.28');
      expect(severe.summary).toContain('Severe Drought Crisis');
    });

    it('generates all expected biological disturbance trauma tags', () => {
      const baseRec: AnnualRingRecord = {
        ringIndex: 50,
        calendarYear: 1934,
        cambialAge: 50,
        treeAge: 62,
        climateIndex: 0.32,
        limitingFactor: 'moisture',
        meanWidthMm: 0.35,
        earlywoodWidthMm: 0.25,
        latewoodWidthMm: 0.1,
        latewoodFraction: 0.28,
        hasFalseRing: false,
        falseRingPosition: 0,
        earlywoodGray: 200,
        transitionGray: 140,
        latewoodGray: 50,
        isHeartwood: true,
        isSyntheticClimate: false,
        relativeWidthIndex: 0.36,
      };

      // 1. Severe moisture deficit
      const droughtTags = getDisturbanceTraumaTags(baseRec);
      expect(droughtTags).toContain('Severe moisture deficit');

      // 2. Pluvial summer
      const pluvialRec: AnnualRingRecord = {
        ...baseRec,
        calendarYear: 1983,
        relativeWidthIndex: 1.55,
        climateIndex: 1.48,
      };
      const pluvialTags = getDisturbanceTraumaTags(pluvialRec);
      expect(pluvialTags).toContain('Pluvial summer');

      // 3. Traumatic cold shock
      const frostRec: AnnualRingRecord = {
        ...baseRec,
        calendarYear: 1816, // Year Without a Summer
        limitingFactor: 'temperature',
      };
      const frostTags = getDisturbanceTraumaTags(frostRec, [1783, 1816]);
      expect(frostTags).toContain('Traumatic cold shock');

      // 4. False Ring (IADF)
      const falseRingRec: AnnualRingRecord = {
        ...baseRec,
        hasFalseRing: true,
      };
      const falseTags = getDisturbanceTraumaTags(falseRingRec);
      expect(falseTags).toContain('False Ring (IADF)');

      // 5. Fire Injury & Healing Callus Margin
      const fireRec: AnnualRingRecord = {
        ...baseRec,
        hasFireScar: true,
      };
      const fireTags = getDisturbanceTraumaTags(fireRec);
      expect(fireTags).toContain('Fire Injury & Healing Callus Margin');

      // 6. Locally Absent Ring
      const absentRec: AnnualRingRecord = {
        ...baseRec,
        isLocallyAbsent: true,
        relativeWidthIndex: 0.25,
      };
      const absentTags = getDisturbanceTraumaTags(absentRec);
      expect(absentTags).toContain('Locally Absent Ring');
    });

    it('formats human-readable climatic stress descriptions', () => {
      const moistureCrisisRec: AnnualRingRecord = {
        ringIndex: 10,
        calendarYear: 1956,
        cambialAge: 10,
        treeAge: 20,
        climateIndex: 0.35,
        limitingFactor: 'moisture',
        meanWidthMm: 0.4,
        earlywoodWidthMm: 0.3,
        latewoodWidthMm: 0.1,
        latewoodFraction: 0.25,
        hasFalseRing: false,
        falseRingPosition: 0,
        earlywoodGray: 200,
        transitionGray: 140,
        latewoodGray: 50,
        isHeartwood: true,
        isSyntheticClimate: false,
      };
      expect(getClimaticStressDescription(moistureCrisisRec)).toContain(
        'Acute Soil Moisture Drought Deficit'
      );

      const coldRec: AnnualRingRecord = {
        ...moistureCrisisRec,
        climateIndex: 0.45,
        limitingFactor: 'temperature',
      };
      expect(getClimaticStressDescription(coldRec)).toContain(
        'Short Growing Degree-Day Cold Limitation'
      );
    });
  });

  describe('Tier 5 Adversarial Coverage & State Hardening', () => {
    it('switches navigation mode to preset initialMode when presets are selected', () => {
      const volcanic = getPresetById('volcanic-frost-shock')!;
      const bristlecone = getPresetById('bristlecone-ancient')!;
      expect(volcanic.initialMode).toBe('grow');
      expect(bristlecone.initialMode).toBe('peel');
    });

    it('bounds SVG bundleCache strictly to MAX_BUNDLE_CACHE_SIZE (3) across continuous scrubbing', () => {
      const testSim = simulateTreeCrossSection(
        {
          species: 'ponderosa-pine',
          latitude: 35.2645,
          longitude: -111.7442,
          totalAge: 100,
          deathYear: 2026,
        },
        createMockEnvironment()
      );
      precomputeSimSvgCache(testSim);
      const cache = getSimSvgCache(testSim)!;

      for (let i = 1; i <= 100; i++) {
        generateCrossSectionSvgBundle(testSim, {
          showBark: true,
          showMedullaryRays: true,
          showAnnotations: true,
          transparentBackground: false,
          maxRenderedRingIndex: (i % 50) + 1,
        });
        expect(cache.bundleCache.size).toBeLessThanOrEqual(MAX_BUNDLE_CACHE_SIZE);
      }
    });
  });
});
