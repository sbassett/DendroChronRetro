import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { simulateTreeCrossSection } from '../src/model/growthEngine';
import {
  extractSpecimenHighlights,
  generateEnvironmentalNarrative,
  generateSpecimenLede,
} from '../src/model/narrative';
import { generateCrossSectionSvgBundle } from '../src/model/svgGenerator';
import { EnvironmentDataset, MonthlyClimateYear } from '../src/model/types';
import { searchPlaces } from '../src/services/geocodingApi';

function buildUniformTestEnv(
  startYear: number,
  endYear: number,
  slopeDeg = 10,
  aspectDeg = 180
): EnvironmentDataset {
  const baseTemp = [-1.0, 0.2, 3.6, 7.4, 12.2, 17.5, 20.0, 19.0, 15.0, 9.2, 3.0, -0.8];
  const basePrecip = [40, 36, 34, 24, 18, 12, 58, 70, 38, 34, 30, 42];
  const years: MonthlyClimateYear[] = [];
  for (let y = startYear - 1; y <= endYear; y++) {
    years.push({
      year: y,
      tempC: [...baseTemp],
      precipMm: [...basePrecip],
      isSynthetic: true,
    });
  }
  return {
    terrain: {
      elevationM: 2150,
      slopeDeg,
      aspectDeg,
      isWaterOrInvalid: false,
    },
    years,
    source: 'offline-climatology',
    meanAnnualTempC: 9.5,
    meanAnnualPrecipMm: 436,
    summerPrecipShare: 0.32,
  };
}

function buildHistoricEventEnv(startYear: number, endYear: number): EnvironmentDataset {
  const baseTemp = [-1.0, 0.2, 3.6, 7.4, 12.2, 17.5, 20.0, 19.0, 15.0, 9.2, 3.0, -0.8];
  const basePrecip = [40, 36, 34, 24, 18, 12, 58, 70, 38, 34, 30, 42];
  const years: MonthlyClimateYear[] = [];
  for (let y = startYear - 1; y <= endYear; y++) {
    const isDustBowl = y === 1934;
    const isSwDrought = y === 1956 || y === 2002;
    const isPluvial = y === 1983 || y === 1982 || y === 1981;
    const pMult = isDustBowl ? 0.35 : isSwDrought ? 0.45 : isPluvial ? 1.65 : 1.0;
    const tShift = isDustBowl ? 2.1 : isSwDrought ? 1.4 : isPluvial ? -0.6 : 0;
    years.push({
      year: y,
      tempC: baseTemp.map((t) => t + tShift),
      precipMm: basePrecip.map((p) => p * pMult),
      isSynthetic: false,
      provenance: 'paleo-atlas',
      pmdi: isDustBowl ? -4.2 : isSwDrought ? -3.2 : isPluvial ? 3.1 : 0.2,
    });
  }
  return {
    terrain: {
      elevationM: 2450,
      slopeDeg: 18,
      aspectDeg: 171,
      isWaterOrInvalid: false,
    },
    years,
    source: 'offline-climatology',
    provenanceTiers: ['paleo-atlas'],
    meanAnnualTempC: 9.5,
    meanAnnualPrecipMm: 436,
    summerPrecipShare: 0.32,
  };
}

describe('Editorial Polish, SVG Callouts, Place Search & Fact-Checks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses vowel-aware indefinite articles in topographic narratives ("An eastern" vs "A south-facing")', () => {
    const eastEnv = buildUniformTestEnv(1980, 2026, 6.5, 90);
    const eastSim = simulateTreeCrossSection(
      {
        species: 'ponderosa-pine',
        latitude: 33.405,
        longitude: -108.582,
        totalAge: 40,
        deathYear: 2026,
      },
      eastEnv
    );
    const eastNarrative = generateEnvironmentalNarrative(eastSim, 'metric');
    expect(eastNarrative.headline).toMatch(/^An eastern /);

    const southEnv = buildUniformTestEnv(1980, 2026, 18.0, 180);
    const southSim = simulateTreeCrossSection(
      {
        species: 'ponderosa-pine',
        latitude: 32.4344,
        longitude: -110.77,
        totalAge: 40,
        deathYear: 2026,
      },
      southEnv
    );
    const southNarrative = generateEnvironmentalNarrative(southSim, 'metric');
    expect(southNarrative.headline).toMatch(/^A south-facing /);
  });

  it('extracts empirical climate & modeled fire highlights while suppressing bogus droughts on flat uniform climate', () => {
    const historicEnv = buildHistoricEventEnv(1820, 2026);
    const historicSim = simulateTreeCrossSection(
      {
        species: 'ponderosa-pine',
        latitude: 32.4344,
        longitude: -110.77,
        totalAge: 200,
        deathYear: 2026,
        disturbance: {
          fireScarYear: 1900,
          enableClimateWildfires: true,
        },
      },
      historicEnv
    );

    const highlights = extractSpecimenHighlights(historicSim, 5);
    expect(highlights.length).toBeGreaterThanOrEqual(3);
    expect(highlights.some((h) => h.type === 'fire')).toBe(true);
    expect(highlights.some((h) => h.year === 1934 && h.eventLabel === 'Dust Bowl')).toBe(true);
    for (let i = 1; i < highlights.length; i++) {
      expect(highlights[i].year).toBeGreaterThanOrEqual(highlights[i - 1].year);
    }

    const lede = generateSpecimenLede(historicSim, 'Santa Catalina Mts (Mt. Lemmon)');
    expect(lede).toContain('simulated 200-year Ponderosa Pine');
    expect(lede).toContain('at Santa Catalina Mts (Mt. Lemmon)');
    expect(lede).toContain('modeled');
    expect(lede).toContain('1934 Dust Bowl');

    // Flat uniform synthetic trees must not report phantom Dust Bowl or Megadrought events
    const uniformEnv = buildUniformTestEnv(1820, 2026);
    const uniformSim = simulateTreeCrossSection(
      {
        species: 'ponderosa-pine',
        latitude: 35.2645,
        longitude: -111.7442,
        totalAge: 200,
        deathYear: 2026,
        disturbance: { enableClimateWildfires: false },
      },
      uniformEnv
    );
    expect(extractSpecimenHighlights(uniformSim, 5)).toEqual([]);
  });

  it('renders subtle in-bounds <g id="ring-callouts"> on annotated SVGs and respects peel slicing and Exhibition mode', () => {
    const env = buildHistoricEventEnv(1820, 2026);
    const sim = simulateTreeCrossSection(
      {
        species: 'ponderosa-pine',
        latitude: 32.4344,
        longitude: -110.77,
        totalAge: 200,
        deathYear: 2026,
        disturbance: {
          fireScarYear: 1900,
          enableClimateWildfires: true,
        },
      },
      env
    );

    const fullBundle = generateCrossSectionSvgBundle(sim, {
      showBark: true,
      showMedullaryRays: true,
      showAnnotations: true,
      showLocatorMap: true,
      showCaptionText: true,
      transparentBackground: false,
      unitSystem: 'us',
      paletteId: 'aged-wood',
    });

    expect(fullBundle.innerMarkup).toContain('<g id="ring-callouts"');

    // Extract callout section and verify all polyline points lie inside viewBox
    const calloutMatch = fullBundle.innerMarkup.match(/<g id="ring-callouts"[\s\S]*?<\/g>/);
    expect(calloutMatch).not.toBeNull();
    const calloutSvg = calloutMatch![0];
    const { x: vbX, y: vbY, width: vbW, height: vbH } = fullBundle.viewBox;

    for (const polyMatch of calloutSvg.matchAll(/points="([^"]+)"/g)) {
      const pairs = polyMatch[1].trim().split(/\s+/);
      for (const pair of pairs) {
        const [px, py] = pair.split(',').map(Number);
        expect(px).toBeGreaterThan(vbX);
        expect(px).toBeLessThan(vbX + vbW);
        expect(py).toBeGreaterThan(vbY);
        expect(py).toBeLessThan(vbY + vbH);
      }
    }

    // Peeling back to an early year hides later 20th-century callouts like 1956 / 2002
    const ring1920 = sim.rings.find((r) => r.record.calendarYear === 1920);
    expect(ring1920).toBeDefined();
    const peeledBundle = generateCrossSectionSvgBundle(sim, {
      showBark: true,
      showMedullaryRays: true,
      showAnnotations: true,
      showLocatorMap: false,
      showCaptionText: false,
      transparentBackground: false,
      unitSystem: 'us',
      paletteId: 'aged-wood',
      maxRenderedRingIndex: ring1920!.record.ringIndex,
    });
    const peeledCallouts = peeledBundle.innerMarkup.match(/<g id="ring-callouts"[\s\S]*?<\/g>/)?.[0] ?? '';
    expect(peeledCallouts).not.toContain('>1934<');
    expect(peeledCallouts).not.toContain('>2002<');

    // Exhibition mode (showAnnotations: false) omits ring-callouts cleanly
    const exhibitionBundle = generateCrossSectionSvgBundle(sim, {
      showBark: true,
      showMedullaryRays: true,
      showAnnotations: false,
      showLocatorMap: false,
      showCaptionText: false,
      transparentBackground: false,
      unitSystem: 'us',
      paletteId: 'aged-wood',
    });
    expect(exhibitionBundle.innerMarkup).not.toContain('id="ring-callouts"');
  });

  it('supports instant local place matching, comma state expansion, and offline resilience in searchPlaces', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: 2,
              name: 'Bendrichua',
              latitude: 21.5,
              longitude: 86.2,
              elevation: 45,
              country_code: 'IN',
              country: 'India',
              admin1: 'Odisha',
            },
            {
              id: 1,
              name: 'Bend',
              latitude: 44.05817,
              longitude: -121.31531,
              elevation: 1106,
              country_code: 'US',
              country: 'United States',
              admin1: 'Oregon',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const bendResults = await searchPlaces('Bend, OR');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bendResults[0].name).toBe('Bend');
    expect(bendResults[0].displayLabel).toBe('Bend, Oregon');
    expect(bendResults[0].latitude).toBeCloseTo(44.0582, 3);

    // Offline / network failure still returns instant curated presets
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const offlineResults = await searchPlaces('Gila');
    expect(offlineResults.length).toBeGreaterThanOrEqual(1);
    expect(offlineResults[0].source).toBe('preset');
    expect(offlineResults[0].name).toContain('Gila Wilderness');
  });

  it('keeps factual copy, unaffiliated credits, and absolute OpenGraph image URLs aligned with editorial fixes', () => {
    const cwd = process.cwd();
    const presetsSrc = fs.readFileSync(path.resolve(cwd, 'src/model/presets.ts'), 'utf-8');
    const colophonSrc = fs.readFileSync(
      path.resolve(cwd, 'src/components/ColophonModal.tsx'),
      'utf-8'
    );
    const indexHtml = fs.readFileSync(path.resolve(cwd, 'index.html'), 'utf-8');

    expect(presetsSrc).not.toMatch(/crown fire/i);
    expect(presetsSrc).toMatch(/surface fire/i);

    expect(colophonSrc).toContain('Laboratory of Tree-Ring Research');
    expect(colophonSrc).toMatch(/unaffiliated/i);
    expect(colophonSrc).toMatch(/Measured Data vs\. Simulated Specimen/);
    expect(colophonSrc).toMatch(/recorder-tree\s+re-scarring/i);

    expect(indexHtml).toContain('<meta property="og:image" content="https://xylem.art/og-preview.png"');
    expect(indexHtml).toContain('<meta name="twitter:image" content="https://xylem.art/og-preview.png"');
  });
});
