import { describe, expect, it } from 'vitest';
import { simulateTreeCrossSection } from '../src/model/growthEngine';
import {
  generateCrossSectionSvg,
  generateCrossSectionSvgBundle,
} from '../src/model/svgGenerator';
import {
  wrapInColophonPlate,
  escapeXml,
} from '../src/model/colophon';
import {
  buildStandaloneSvg,
  calculateExportDimensions,
  sanitizeFilename,
} from '../src/model/exportPipeline';
import {
  blendHex,
  getPalette,
} from '../src/model/palettes';
import {
  generateWoodGrainFilterXml,
  generateWatercolorBleedFilterXml,
} from '../src/model/textureFilters';
import { EnvironmentDataset } from '../src/model/types';

describe('Tier 5 Adversarial Coverage Hardening Suite', () => {
  const minimalEnv: EnvironmentDataset = {
    terrain: { elevationM: 1200, slopeDeg: 10, aspectDeg: 180, isWaterOrInvalid: false },
    years: [
      {
        year: 2026,
        tempC: [0, 2, 5, 10, 15, 20, 22, 21, 16, 10, 4, 1],
        precipMm: [60, 50, 55, 45, 40, 35, 30, 35, 40, 50, 65, 70],
        isSynthetic: false,
      },
    ],
    source: 'test',
    meanAnnualTempC: 10,
    meanAnnualPrecipMm: 600,
    summerPrecipShare: 0.18,
  };

  it('ADV-1: simulates safely without TypeError when climatology contains 0 or 1 year', () => {
    const emptyYearsEnv: EnvironmentDataset = { ...minimalEnv, years: [] };
    expect(() => {
      simulateTreeCrossSection(
        { species: 'douglas-fir', latitude: 44.5, longitude: -121.5, totalAge: 30, deathYear: 2026 },
        emptyYearsEnv
      );
    }).not.toThrow();

    expect(() => {
      simulateTreeCrossSection(
        { species: 'ponderosa-pine', latitude: 35.26, longitude: -111.74, totalAge: 30, deathYear: 2026 },
        minimalEnv
      );
    }).not.toThrow();
  });

  it('ADV-2: sanitizes customColors in colophon plates against XML attribute breakout injection', () => {
    const sim = simulateTreeCrossSection(
      { species: 'douglas-fir', latitude: 44.5, longitude: -121.5, totalAge: 20, deathYear: 2026 },
      { ...minimalEnv, years: [
        { year: 2025, tempC: new Array(12).fill(10), precipMm: new Array(12).fill(50), isSynthetic: false },
        { year: 2026, tempC: new Array(12).fill(10), precipMm: new Array(12).fill(50), isSynthetic: false },
      ] }
    );
    const bundle = generateCrossSectionSvgBundle(sim, {
      showBark: true,
      showMedullaryRays: true,
      showAnnotations: true,
      transparentBackground: false,
    });
    const plate = wrapInColophonPlate(sim, bundle, {
      customColors: {
        borderColor: '#000000" /><g id="injected-payload"><!--',
      } as any,
    });
    expect(plate.svgMarkup).not.toContain('<g id="injected-payload">');
  });

  it('ADV-3: escapes seed attribute in SVG texture filters against XML injection', () => {
    const filterXml = generateWoodGrainFilterXml({}, 'safe-seed" onload="alert(1)');
    expect(filterXml).not.toContain('onload="alert(1)"');
    expect(filterXml).not.toContain('safe-seed');
    expect(filterXml).toMatch(/seed="\d+"/);

    const bleedXml = generateWatercolorBleedFilterXml({}, 'safe-seed" onload="alert(1)');
    expect(bleedXml).not.toContain('onload="alert(1)"');
    expect(bleedXml).toContain('safe-seed&quot;');
  });

  it('ADV-4: escapeXml safely coerces non-string arguments without throwing TypeError', () => {
    expect(escapeXml(12345 as any)).toBe('12345');
    expect(escapeXml(true as any)).toBe('true');
    expect(escapeXml(false as any)).toBe('false');
    expect(escapeXml(null)).toBe('');
    expect(escapeXml(undefined)).toBe('');
  });

  it('ADV-5: blendHex returns valid hex tokens on malformed or empty color inputs', () => {
    const res1 = blendHex('invalid-hex', '#ffffff', 0.5);
    expect(res1).toMatch(/^#([0-9a-fA-F]{6})$/);
    expect(res1).not.toContain('NaN');

    const res2 = blendHex('', '#000000', 0.5);
    expect(res2).toMatch(/^#([0-9a-fA-F]{6})$/);
    expect(res2).not.toContain('NaN');
  });

  it('ADV-6: handles extreme multi-century specimen (1000 years) without numerical instability', () => {
    const years = Array.from({ length: 1002 }, (_, i) => ({
      year: 1025 + i,
      tempC: new Array(12).fill(8.0),
      precipMm: new Array(12).fill(40.0),
      isSynthetic: true,
    }));
    const sim1000 = simulateTreeCrossSection(
      { species: 'bristlecone-pine', latitude: 37.38, longitude: -118.17, totalAge: 1000, deathYear: 2026 },
      { ...minimalEnv, years }
    );
    expect(sim1000.rings.length).toBeGreaterThan(990);
    expect(Number.isFinite(sim1000.diameterInsideBarkMm)).toBe(true);
    expect(Number.isFinite(sim1000.eccentricity)).toBe(true);
    const svg = buildStandaloneSvg(sim1000, { includeColophon: true });
    expect(svg).not.toContain('NaN');
    expect(svg).not.toContain('Infinity');
  });
});
