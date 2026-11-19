import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { simulateTreeCrossSection } from '../src/model/growthEngine';
import {
  generateCrossSectionSvgBundle,
  getSimSvgCache,
} from '../src/model/svgGenerator';
import { EnvironmentDataset } from '../src/model/types';

function createMinimalEnv(startYear = 1990, endYear = 2025): EnvironmentDataset {
  const years = [];
  for (let y = startYear; y <= endYear; y++) {
    years.push({
      year: y,
      tempC: new Array(12).fill(9.5),
      precipMm: new Array(12).fill(45),
      isSynthetic: false,
    });
  }
  return {
    terrain: {
      elevationM: 2100,
      slopeDeg: 10,
      aspectDeg: 180,
      isWaterOrInvalid: false,
    },
    years,
    source: 'offline-climatology',
    meanAnnualTempC: 9.5,
    meanAnnualPrecipMm: 540,
    summerPrecipShare: 0.25,
  };
}

describe('Minimalist Full-Window Interface Contracts', () => {
  const cwd = process.cwd();

  it('preserves scale bar & north arrow while omitting caption text and locator map in live viewport SVG', () => {
    const sim = simulateTreeCrossSection(
      {
        species: 'ponderosa-pine',
        latitude: 35.2645,
        longitude: -111.7442,
        totalAge: 25,
        deathYear: 2025,
      },
      createMinimalEnv()
    );

    const liveBundle = generateCrossSectionSvgBundle(sim, {
      showBark: true,
      showMedullaryRays: true,
      showAnnotations: true,
      showLocatorMap: false,
      showCaptionText: false,
      transparentBackground: false,
      unitSystem: 'us',
      paletteId: 'aged-wood',
    });

    // Keeps Scale Bar and North Arrow inside #annotations
    expect(liveBundle.innerMarkup).toContain('id="annotations"');
    expect(liveBundle.innerMarkup).toContain('>N</text>');
    // Omits duplicate embedded locator map and species/coordinate text caption
    expect(liveBundle.innerMarkup).not.toContain('id="locator-map"');
    expect(liveBundle.innerMarkup).not.toContain('Pinus ponderosa');
    expect(liveBundle.innerMarkup).not.toContain('Chronology Extent:');

    // Subsequent export call with caption & locator map enabled must NOT collide in bundleCache
    const exportBundle = generateCrossSectionSvgBundle(sim, {
      showBark: true,
      showMedullaryRays: true,
      showAnnotations: true,
      showLocatorMap: true,
      showCaptionText: true,
      transparentBackground: false,
      unitSystem: 'us',
      paletteId: 'aged-wood',
    });

    expect(exportBundle.innerMarkup).toContain('id="locator-map"');
    expect(exportBundle.innerMarkup).toContain('Pinus ponderosa');
    expect(exportBundle.innerMarkup).toContain('Chronology Extent:');

    const cache = getSimSvgCache(sim)!;
    expect(cache.bundleCache.size).toBe(2);
  });

  it('provides Pencil edit affordances and accessible roles across new minimalist components', () => {
    const locatorSrc = fs.readFileSync(
      path.resolve(cwd, 'src/components/LocatorMapWidget.tsx'),
      'utf-8'
    );
    const hudSrc = fs.readFileSync(
      path.resolve(cwd, 'src/components/SpecimenHud.tsx'),
      'utf-8'
    );
    const drawerSrc = fs.readFileSync(
      path.resolve(cwd, 'src/components/ControlsDrawer.tsx'),
      'utf-8'
    );
    const dockSrc = fs.readFileSync(
      path.resolve(cwd, 'src/components/TimelineDock.tsx'),
      'utf-8'
    );
    const mobileSrc = fs.readFileSync(
      path.resolve(cwd, 'src/components/MobileSheet.tsx'),
      'utf-8'
    );

    expect(locatorSrc).toContain('Pencil');
    expect(locatorSrc).toContain('Edit specimen location on map');

    expect(hudSrc).toContain('Pencil');
    expect(hudSrc).toContain('role="dialog"');
    expect(hudSrc).toContain('MonochromeMapPicker');

    expect(drawerSrc).toContain('role="tablist"');
    expect(drawerSrc).toContain('role="tab"');
    expect(drawerSrc).toContain('Ledger');
    expect(drawerSrc).toContain('Export');

    expect(dockSrc).toContain('TimeNavigation');
    expect(dockSrc).toContain('RingChronologyChart');
    expect(dockSrc).toContain('Timeline');

    expect(mobileSrc).toContain('Info &amp; Controls');
    expect(mobileSrc).toContain('role="dialog"');
    expect(mobileSrc).toContain('role="tablist"');
  });

  it('preserves active archival palette background in Zen Exhibition Mode CSS without dark #121212 override', () => {
    const appCss = fs.readFileSync(path.resolve(cwd, 'src/App.css'), 'utf-8');
    expect(appCss).toContain('.app-shell.exhibition-mode');
    expect(appCss).toContain('var(--canvas-bg');
    expect(appCss).not.toContain('#121212');
    expect(appCss).not.toContain('device-experience-banner');
  });

  it('shrinks and regrows chronological span cleanly without clamping activeRingIndex down', () => {
    const appTsx = fs.readFileSync(path.resolve(cwd, 'src/App.tsx'), 'utf-8');
    expect(appTsx).not.toContain('setActiveRingIndex(simulation.visibleRingCount)');
    expect(appTsx).toMatch(/handleAgeChange[\s\S]*setActiveRingIndex\(null\)/);
    expect(appTsx).toContain('maxRenderedRingIndex: isPeeled ? effectiveMaxRenderedRing : undefined');

    const env = createMinimalEnv(1760, 2026);
    const sim250 = simulateTreeCrossSection(
      {
        species: 'ponderosa-pine',
        latitude: 35.2645,
        longitude: -111.7442,
        totalAge: 250,
        deathYear: 2026,
      },
      env
    );
    const sim40 = simulateTreeCrossSection(
      {
        species: 'ponderosa-pine',
        latitude: 35.2645,
        longitude: -111.7442,
        totalAge: 40,
        deathYear: 2026,
      },
      env
    );
    const simRegrown250 = simulateTreeCrossSection(
      {
        species: 'ponderosa-pine',
        latitude: 35.2645,
        longitude: -111.7442,
        totalAge: 250,
        deathYear: 2026,
      },
      env
    );

    expect(sim40.visibleRingCount).toBeLessThan(sim250.visibleRingCount);
    expect(simRegrown250.visibleRingCount).toBe(sim250.visibleRingCount);

    const bundle40 = generateCrossSectionSvgBundle(sim40, {
      showBark: true,
      showMedullaryRays: true,
      showAnnotations: true,
      showLocatorMap: false,
      showCaptionText: false,
      transparentBackground: false,
      maxRenderedRingIndex: undefined,
    });
    const bundleRegrown = generateCrossSectionSvgBundle(simRegrown250, {
      showBark: true,
      showMedullaryRays: true,
      showAnnotations: true,
      showLocatorMap: false,
      showCaptionText: false,
      transparentBackground: false,
      maxRenderedRingIndex: undefined,
    });

    expect(bundle40.innerMarkup).toContain('id="bark-layer"');
    expect(bundle40.innerMarkup).not.toContain(`data-ring="${sim250.visibleRingCount}"`);
    expect(bundleRegrown.innerMarkup).toContain('id="bark-layer"');
    expect(bundleRegrown.innerMarkup).toContain(`data-ring="${simRegrown250.visibleRingCount}"`);
  });
});
