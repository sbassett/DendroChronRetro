import { describe, expect, it } from 'vitest';
import {
  getAllPresets,
  getPresetById,
  isPresetActive,
  PresetId,
  RETROSPECTIVE_PRESETS,
} from '../src/model/presets';
import { simulateTreeCrossSection } from '../src/model/growthEngine';
import { SPECIES_PROFILES } from '../src/model/species';
import { EnvironmentDataset, MonthlyClimateYear } from '../src/model/types';

function makeSyntheticEnvironment(
  baseTempC: number,
  annualPrecipMm: number,
  elevationM: number
): EnvironmentDataset {
  const years: MonthlyClimateYear[] = [];
  for (let y = 1600; y <= 2026; y++) {
    const tempC: number[] = [];
    const precipMm: number[] = [];
    for (let m = 0; m < 12; m++) {
      const seasonal = -Math.cos(((m - 0.5) / 12) * 2 * Math.PI) * 9.5;
      tempC.push(baseTempC + seasonal);
      const wetShare = 1 + 0.4 * Math.cos(((m - 0.5) / 12) * 2 * Math.PI);
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
      slopeDeg: 12,
      aspectDeg: 180,
      isWaterOrInvalid: false,
    },
    years,
    source: 'offline-climatology',
    meanAnnualTempC: baseTempC,
    meanAnnualPrecipMm: annualPrecipMm,
    summerPrecipShare: 0.2,
  };
}

describe('Curated Retrospective Presets Specification', () => {
  it('defines exactly four curated retrospective presets as required by R1', () => {
    const presets = getAllPresets();
    expect(presets).toHaveLength(4);

    const expectedIds: PresetId[] = [
      'bristlecone-ancient',
      'pluvial-megadrought',
      'volcanic-frost-shock',
      'wildfire-scar-healing',
    ];

    const actualIds = presets.map((p) => p.id);
    expect(actualIds).toEqual(expectedIds);
  });

  it('guarantees complete schema compliance and non-empty metadata for all presets', () => {
    for (const preset of RETROSPECTIVE_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.label.trim().length).toBeGreaterThan(5);
      expect(preset.subtitle.trim().length).toBeGreaterThan(10);
      expect(preset.description.trim().length).toBeGreaterThan(30);

      // Coordinates
      expect(preset.coordinates.latitude).toBeGreaterThanOrEqual(15);
      expect(preset.coordinates.latitude).toBeLessThanOrEqual(65);
      expect(preset.coordinates.longitude).toBeGreaterThanOrEqual(-165);
      expect(preset.coordinates.longitude).toBeLessThanOrEqual(-65);
      expect(preset.coordinates.elevationM).toBeGreaterThanOrEqual(500);
      expect(preset.coordinates.elevationM).toBeLessThanOrEqual(4000);
      expect(preset.coordinates.region).toBeTruthy();
      expect(preset.coordinates.siteName).toBeTruthy();

      // Species
      expect(SPECIES_PROFILES[preset.species]).toBeDefined();

      // Temporal
      expect(preset.temporal.totalAge).toBeGreaterThanOrEqual(50);
      expect(preset.temporal.totalAge).toBeLessThanOrEqual(500);
      expect(preset.temporal.deathYear).toBeGreaterThanOrEqual(1800);
      expect(preset.temporal.deathYear).toBeLessThanOrEqual(2026);
      expect(preset.temporal.startYear).toBe(
        preset.temporal.deathYear - preset.temporal.totalAge
      );
      expect(preset.temporal.germinationEra).toBeTruthy();

      // Climatic
      expect(preset.climatic.meanAnnualTempC).toBeGreaterThan(-10);
      expect(preset.climatic.meanAnnualTempC).toBeLessThan(25);
      expect(preset.climatic.meanAnnualPrecipMm).toBeGreaterThan(100);
      expect(preset.climatic.meanAnnualPrecipMm).toBeLessThan(2500);
      expect(preset.climatic.droughtRegimeDescription).toBeTruthy();

      // Disturbance
      expect(preset.disturbance.droughtThresholdRwi).toBeGreaterThan(0.1);
      expect(preset.disturbance.droughtThresholdRwi).toBeLessThan(0.8);
      expect(Array.isArray(preset.disturbance.frostEventYears)).toBe(true);

      if (preset.disturbance.fireScarYear !== undefined) {
        expect(preset.disturbance.fireScarYear).toBeGreaterThanOrEqual(
          preset.temporal.startYear
        );
        expect(preset.disturbance.fireScarYear).toBeLessThanOrEqual(
          preset.temporal.deathYear
        );
        expect(preset.disturbance.fireScarAzimuthRad).toBeGreaterThanOrEqual(0);
        expect(preset.disturbance.fireScarAzimuthRad).toBeLessThanOrEqual(
          2 * Math.PI
        );
        expect(preset.disturbance.fireScarArcRad).toBeGreaterThan(0);
        expect(preset.disturbance.fireScarArcRad).toBeLessThan(Math.PI);
      }

      // Initial mode & palette
      expect(['peel', 'grow']).toContain(preset.initialMode);
      expect([
        'aged-wood',
        'charred-subalpine',
        'skeleton-plot',
      ]).toContain(preset.recommendedPalette);
      expect(preset.landmarkYears.length).toBeGreaterThan(0);
    }
  });

  it('correctly retrieves presets by ID and handles invalid queries', () => {
    expect(getPresetById('bristlecone-ancient')?.label).toBe(
      'Old-Growth Bristlecone'
    );
    expect(getPresetById('pluvial-megadrought')?.label).toBe(
      'Pluvial to Megadrought Transition'
    );
    expect(getPresetById('volcanic-frost-shock')?.label).toBe(
      'Volcanic Forcing & Frost Trauma'
    );
    expect(getPresetById('wildfire-scar-healing')?.label).toBe(
      'Wildfire Scarring & Cambial Healing'
    );
    expect(getPresetById('non-existent-preset')).toBeUndefined();
  });

  it('detects when state matches a preset and flags divergence', () => {
    const preset = getPresetById('bristlecone-ancient')!;

    const matchingState = {
      species: preset.species,
      latitude: preset.coordinates.latitude,
      longitude: preset.coordinates.longitude,
      totalAge: preset.temporal.totalAge,
      deathYear: preset.temporal.deathYear,
    };
    expect(isPresetActive(preset, matchingState)).toBe(true);

    const divergentAgeState = { ...matchingState, totalAge: 120 };
    expect(isPresetActive(preset, divergentAgeState)).toBe(false);

    const divergentSpeciesState = {
      ...matchingState,
      species: 'douglas-fir' as const,
    };
    expect(isPresetActive(preset, divergentSpeciesState)).toBe(false);
  });

  it('runs deterministic tree simulation for all four presets without failure', () => {
    for (const preset of RETROSPECTIVE_PRESETS) {
      const env = makeSyntheticEnvironment(
        preset.climatic.meanAnnualTempC,
        preset.climatic.meanAnnualPrecipMm,
        preset.coordinates.elevationM
      );

      const simA = simulateTreeCrossSection(
        {
          species: preset.species,
          latitude: preset.coordinates.latitude,
          longitude: preset.coordinates.longitude,
          totalAge: preset.temporal.totalAge,
          deathYear: preset.temporal.deathYear,
        },
        env
      );

      const simB = simulateTreeCrossSection(
        {
          species: preset.species,
          latitude: preset.coordinates.latitude,
          longitude: preset.coordinates.longitude,
          totalAge: preset.temporal.totalAge,
          deathYear: preset.temporal.deathYear,
        },
        env
      );

      // Verify determinism
      expect(simA.seedHex).toBe(simB.seedHex);
      expect(simA.visibleRingCount).toBe(simB.visibleRingCount);
      expect(simA.visibleRingCount).toBe(
        preset.temporal.totalAge - simA.yearsToStumpHeight
      );
      expect(simA.rings.length).toBe(simA.visibleRingCount);

      // Check biological plausibility
      expect(simA.diameterInsideBarkMm).toBeGreaterThan(10);
      expect(simA.diameterOutsideBarkMm).toBeGreaterThan(
        simA.diameterInsideBarkMm
      );
    }
  });

  it('validates unique biophysical behavior of the Bristlecone preset', () => {
    const preset = getPresetById('bristlecone-ancient')!;
    const env = makeSyntheticEnvironment(1.4, 312, 3120);

    const sim = simulateTreeCrossSection(
      {
        species: preset.species,
        latitude: preset.coordinates.latitude,
        longitude: preset.coordinates.longitude,
        totalAge: preset.temporal.totalAge,
        deathYear: preset.temporal.deathYear,
      },
      env
    );

    // Bristlecone pine rings should be extremely dense/narrow (mean width < 1.0 mm)
    const meanWidth =
      sim.rings.reduce((sum, r) => sum + r.record.meanWidthMm, 0) /
      sim.rings.length;
    expect(meanWidth).toBeLessThan(1.0);
    expect(meanWidth).toBeGreaterThan(0.15);
  });
});
