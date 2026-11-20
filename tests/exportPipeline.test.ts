import { describe, expect, it } from 'vitest';
import {
  escapeXml,
  computeColophonLayout,
  generateColophonBorderRules,
  generateColophonHeader,
  generateColophonFooter,
  wrapInColophonPlate,
  createColophonPlateSvg,
} from '../src/model/colophon';
import {
  buildStandaloneSvg,
  calculateExportDimensions,
  export4kPng,
  exportStandaloneSvg,
  generateExportFilename,
  rasterizeSvgToBlob,
  sanitizeFilename,
} from '../src/model/exportPipeline';
import { simulateTreeCrossSection } from '../src/model/growthEngine';
import {
  blendHex,
  getAllPalettes,
  getPalette,
  getPaletteById,
  PALETTES,
  PaletteDefinition,
  resolvePaletteId,
} from '../src/model/palettes';
import {
  buildShareableUrl,
  deserializePermalink,
  serializePermalink,
} from '../src/model/permalink';
import { getPresetById } from '../src/model/presets';
import {
  generateCrossSectionSvg,
  generateCrossSectionSvgBundle,
} from '../src/model/svgGenerator';
import {
  computeEndGrainConfig,
  generateTextureFilterDefs,
  generateWatercolorBleedFilterXml,
  generateWoodGrainFilterXml,
  normalizeFilterSeed,
  WATERCOLOR_BLEED_FILTER_ID,
  WOOD_GRAIN_FILTER_ID,
} from '../src/model/textureFilters';
import { EnvironmentDataset, MonthlyClimateYear } from '../src/model/types';

function makeSyntheticEnvironment(
  baseTempC = 8.5,
  annualPrecipMm = 560,
  elevationM = 2150
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

const testEnv = makeSyntheticEnvironment();

function calculateLuminance(hex: string): number {
  const raw = hex.replace('#', '');
  const r = parseInt(raw.substring(0, 2), 16) / 255;
  const g = parseInt(raw.substring(2, 4), 16) / 255;
  const b = parseInt(raw.substring(4, 6), 16) / 255;
  const sRGB = [r, g, b].map((val) =>
    val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * sRGB[0] + 0.7152 * sRGB[1] + 0.0722 * sRGB[2];
}

function calculateContrastRatio(hexA: string, hexB: string): number {
  const lumA = calculateLuminance(hexA);
  const lumB = calculateLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Milestone 4 (R4): Palettes, Textures & High-Resolution Export', () => {
  // Shared specimen simulations
  const standardSim = simulateTreeCrossSection(
    {
      species: 'ponderosa-pine',
      latitude: 35.2645,
      longitude: -111.7442,
      totalAge: 120,
      deathYear: 2024,
    },
    testEnv
  );

  // ==========================================================================
  // Block 1: Organic Palette Profiles (src/model/palettes.ts - Feature 16)
  // ==========================================================================
  describe('Block 1: Organic Botanical Palette Profiles', () => {
    it('contains complete definitions for aged-wood, charred-subalpine, and skeleton-plot', () => {
      const expectedIds = ['aged-wood', 'charred-subalpine', 'skeleton-plot'];
      for (const id of expectedIds) {
        const pal = PALETTES[id as keyof typeof PALETTES];
        expect(pal).toBeDefined();
        expect(pal.id).toBe(id);
        expect(typeof pal.name).toBe('string');
        expect(pal.name.length).toBeGreaterThan(0);
        expect(typeof pal.description).toBe('string');
        expect(pal.description.length).toBeGreaterThan(0);
        expect(typeof pal.background).toBe('string');
        expect(typeof pal.earlywoodColor).toBe('string');
        expect(typeof pal.latewoodColor).toBe('string');
        expect(Array.isArray(pal.transitionColors)).toBe(true);
        expect(typeof pal.heartwoodTint).toBe('string');
        expect(typeof pal.pithColor).toBe('string');
        expect(typeof pal.fireCharColor).toBe('string');
        expect(typeof pal.resinColor).toBe('string');
        expect(typeof pal.barkPlateColor).toBe('string');
        expect(typeof pal.barkFissureColor).toBe('string');
        expect(typeof pal.annotationColor).toBe('string');
        expect(typeof pal.rwiMarkerColor).toBe('string');
      }
    });

    it('all palette color tokens are valid hexadecimal strings with >= 3 transition steps', () => {
      const hexRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
      for (const pal of getAllPalettes()) {
        expect(pal.background).toMatch(hexRegex);
        expect(pal.earlywoodColor).toMatch(hexRegex);
        expect(pal.latewoodColor).toMatch(hexRegex);
        expect(pal.heartwoodTint).toMatch(hexRegex);
        expect(pal.pithColor).toMatch(hexRegex);
        expect(pal.fireCharColor).toMatch(hexRegex);
        expect(pal.resinColor).toMatch(hexRegex);
        expect(pal.barkPlateColor).toMatch(hexRegex);
        expect(pal.barkFissureColor).toMatch(hexRegex);
        expect(pal.annotationColor).toMatch(hexRegex);
        expect(pal.rwiMarkerColor).toMatch(hexRegex);

        expect(pal.transitionColors.length).toBeGreaterThanOrEqual(3);
        for (const tc of pal.transitionColors) {
          expect(tc).toMatch(hexRegex);
        }
      }
    });

    it('getPaletteById returns matching palette and safely defaults on invalid or missing IDs', () => {
      expect(getPaletteById('aged-wood').id).toBe('aged-wood');
      expect(getPaletteById('charred-subalpine').id).toBe('charred-subalpine');
      expect(getPaletteById('skeleton-plot').id).toBe('skeleton-plot');

      // Safe defaults
      expect(getPaletteById('unknown-palette' as any).id).toBe('aged-wood');
      expect(getPaletteById(null).id).toBe('aged-wood');
      expect(getPaletteById(undefined).id).toBe('aged-wood');
      expect(resolvePaletteId('non-existent')).toBe('aged-wood');
    });

    it('safely handles prototype property keys and non-finite inputs without prototype poisoning or throwing', () => {
      // 1. Prototype property names do not return prototype functions
      const toStringPal = getPalette('toString' as any);
      expect(toStringPal).toEqual(PALETTES['aged-wood']);
      expect(typeof toStringPal).not.toBe('function');

      const constructorPal = getPalette('constructor' as any);
      expect(constructorPal).toEqual(PALETTES['aged-wood']);
      expect(typeof constructorPal).not.toBe('function');

      const valueOfPal = getPalette('valueOf' as any);
      expect(valueOfPal).toEqual(PALETTES['aged-wood']);

      const hasOwnPal = getPalette('hasOwnProperty' as any);
      expect(hasOwnPal).toEqual(PALETTES['aged-wood']);

      // 2. resolvePaletteId falls back to aged-wood for prototype properties
      expect(resolvePaletteId('toString')).toBe('aged-wood');
      expect(resolvePaletteId('constructor')).toBe('aged-wood');
      expect(resolvePaletteId('valueOf')).toBe('aged-wood');
      expect(resolvePaletteId('hasOwnProperty')).toBe('aged-wood');

      // 3. blendHex handles NaN safely
      expect(blendHex('#000000', '#ffffff', NaN)).toBe('#000000');
      expect(blendHex('#ff0000', '#00ff00', NaN)).toBe('#ff0000');

      // 4. deserializePermalink rejects prototype properties on pal query param
      const deserializedProto = deserializePermalink('?pal=toString');
      expect(deserializedProto.pal).toBeUndefined();
      expect(typeof deserializedProto.pal).not.toBe('function');

      const deserializedConstructor = deserializePermalink('?pal=constructor');
      expect(deserializedConstructor.pal).toBeUndefined();

      // 5. generateCrossSectionSvg with paletteId: 'toString' as any executes cleanly without throwing TypeError
      expect(() => {
        const svg = generateCrossSectionSvg(standardSim, {
          paletteId: 'toString' as any,
        });
        expect(svg).toContain('<svg');
      }).not.toThrow();

      expect(() => {
        const svg = generateCrossSectionSvg(standardSim, {
          paletteId: 'constructor' as any,
        });
        expect(svg).toContain('<svg');
      }).not.toThrow();
    });

    it('skeleton-plot palette provides high-contrast monochrome readability with contrast ratio > 7:1', () => {
      const skel = PALETTES['skeleton-plot'];
      expect(skel.background).toBe('#fdfcf7');
      expect(skel.latewoodColor).toBe('#111111');

      const bgLum = calculateLuminance(skel.background);
      const darkLum = calculateLuminance(skel.latewoodColor);
      expect(bgLum).toBeGreaterThan(0.85);
      expect(darkLum).toBeLessThan(0.05);

      const contrastRatio = calculateContrastRatio(skel.background, skel.latewoodColor);
      expect(contrastRatio).toBeGreaterThan(7.0);
    });

    it('presets reference exact matching palette profiles', () => {
      expect(getPresetById('bristlecone-ancient')?.recommendedPalette).toBe('skeleton-plot');
      expect(getPresetById('pluvial-megadrought')?.recommendedPalette).toBe('aged-wood');
      expect(getPresetById('volcanic-frost-shock')?.recommendedPalette).toBe('charred-subalpine');
      expect(getPresetById('wildfire-scar-healing')?.recommendedPalette).toBe('charred-subalpine');
    });
  });

  // ==========================================================================
  // Block 2: Texture Filter Engine (src/model/textureFilters.ts - Feature 17)
  // ==========================================================================
  describe('Block 2: Procedural Texture Filter Engine', () => {
    it('generates valid SVG filter defs markup wrapping wood grain and watercolor bleeding', () => {
      const defs = generateTextureFilterDefs();
      expect(defs).toContain('<defs>');
      expect(defs).toContain('</defs>');
      expect(defs).toContain(`id="${WOOD_GRAIN_FILTER_ID}"`);
      expect(defs).toContain(`<filter id="${WATERCOLOR_BLEED_FILTER_ID}">`);
    });

    it('wood grain filter implements isotropic two-scale end-grain cellular pores and mottling without displacement', () => {
      const xml = generateWoodGrainFilterXml();
      expect(xml).toContain('type="fractalNoise"');
      expect(xml).toContain('primitiveUnits="userSpaceOnUse"');
      expect(xml).toContain('color-interpolation-filters="sRGB"');
      expect(xml).toContain('<feColorMatrix');
      expect(xml).toContain('<feMerge');
      expect(xml).not.toContain('<feDisplacementMap');

      // Every baseFrequency must be strictly isotropic (fx === fy), with poreFrequency > mottleFrequency
      const freqMatches = [...xml.matchAll(/baseFrequency="([\d.]+)\s+([\d.]+)"/g)];
      expect(freqMatches.length).toBe(2);
      const [poreFx, poreFy] = [parseFloat(freqMatches[0][1]), parseFloat(freqMatches[0][2])];
      const [mottleFx, mottleFy] = [parseFloat(freqMatches[1][1]), parseFloat(freqMatches[1][2])];
      expect(poreFx).toBe(poreFy);
      expect(mottleFx).toBe(mottleFy);
      expect(poreFx).toBeGreaterThan(mottleFx);

      // Matrix rows must read only the alpha channel (0 0 0 0 constant RGB columns)
      const matrices = [...xml.matchAll(/values="([^"]+)"/g)].map((m) =>
        m[1].trim().split(/\s+/).map(Number)
      );
      expect(matrices.length).toBe(3);
      for (const vals of matrices) {
        expect(vals.length).toBe(20);
        // R, G, B rows have 0 multipliers on input channels [0..3], [5..8], [10..13]
        expect(vals.slice(0, 4)).toEqual([0, 0, 0, 0]);
        expect(vals.slice(5, 9)).toEqual([0, 0, 0, 0]);
        expect(vals.slice(10, 14)).toEqual([0, 0, 0, 0]);
        // Alpha row ignores input RGB channels [15..17] and operates solely on input A [18] + offset [19]
        expect(vals.slice(15, 18)).toEqual([0, 0, 0]);
        expect(vals[18]).not.toBe(0);
      }

      // Default composite mode merges over SourceGraphic and masks to SourceAlpha
      expect(xml).toContain('<feMergeNode in="SourceGraphic"/>');
      expect(xml).toContain('in2="SourceAlpha" operator="in"');

      // Overlay mode outputs only translucent texture layers
      const overlayXml = generateWoodGrainFilterXml({ compositeMode: 'overlay' });
      expect(overlayXml).not.toContain('SourceGraphic');
      expect(overlayXml).not.toContain('SourceAlpha');
    });

    it('computeEndGrainConfig adapts spatial frequency to specimen diameter and preserves threshold neutrality', () => {
      const smallSapling = computeEndGrainConfig(60);
      const mediumStem = computeEndGrainConfig(400);
      const giantElder = computeEndGrainConfig(1400);

      expect(smallSapling.poreFrequency).toBe(2.5); // clamped upper bound
      expect(mediumStem.poreFrequency).toBeCloseTo(0.6, 4);
      expect(giantElder.poreFrequency).toBe(0.25); // clamped lower bound
      expect(smallSapling.poreFrequency).toBeGreaterThan(mediumStem.poreFrequency);
      expect(mediumStem.poreFrequency).toBeGreaterThan(giantElder.poreFrequency);

      // Non-finite and non-positive diameters fall back safely to 400 mm baseline
      expect(computeEndGrainConfig(NaN)).toEqual(mediumStem);
      expect(computeEndGrainConfig(0)).toEqual(mediumStem);
      expect(computeEndGrainConfig(-50)).toEqual(mediumStem);

      // Intensity scaling scales contrast symmetrically while preserving alpha thresholds
      const scaled = computeEndGrainConfig(400, { intensityScale: 0.72, compositeMode: 'overlay' });
      expect(scaled.compositeMode).toBe('overlay');
      expect(scaled.poreStrength).toBeCloseTo(mediumStem.poreStrength * 0.72, 4);
      expect(scaled.cellWallHighlight).toBeCloseTo(mediumStem.cellWallHighlight * 0.72, 4);
      expect(scaled.mottleStrength).toBeCloseTo(mediumStem.mottleStrength * 0.72, 4);

      const scaledXml = generateWoodGrainFilterXml(scaled, 42);
      const matrices = [...scaledXml.matchAll(/values="([^"]+)"/g)].map((m) =>
        m[1].trim().split(/\s+/).map(Number)
      );
      // At threshold A = 0.48 (pores), A = 0.54 (cell walls), A = 0.52 (mottle), output alpha is ~0
      expect(matrices[0][18] * 0.48 + matrices[0][19]).toBeCloseTo(0, 3);
      expect(matrices[1][18] * 0.54 + matrices[1][19]).toBeCloseTo(0, 3);
      expect(matrices[2][18] * 0.52 + matrices[2][19]).toBeCloseTo(0, 3);
    });

    it('watercolor bleed filter incorporates feGaussianBlur with restrained radius preventing blur blowout', () => {
      const xml = generateWatercolorBleedFilterXml();
      expect(xml).toContain('<feGaussianBlur');
      const blurMatch = xml.match(/stdDeviation="([\d.]+)"/);
      expect(blurMatch).not.toBeNull();
      if (blurMatch) {
        const stdDev = parseFloat(blurMatch[1]);
        expect(stdDev).toBeGreaterThanOrEqual(0.5);
        expect(stdDev).toBeLessThanOrEqual(2.5);
      }
      expect(xml).toContain('<feMerge>');
      expect(xml).toContain('<feMergeNode in="blurred"/>');
      expect(xml).toContain('<feMergeNode in="SourceGraphic"/>');
    });

    it('normalizes integer and arbitrary string seeds deterministically across filter layers', () => {
      expect(normalizeFilterSeed(undefined)).toBeUndefined();
      expect(normalizeFilterSeed(42)).toBe(42);
      expect(normalizeFilterSeed('99')).toBe(99);
      const hexSeed = normalizeFilterSeed(standardSim.seedHex);
      expect(typeof hexSeed).toBe('number');
      expect(Number.isInteger(hexSeed)).toBe(true);
      expect(hexSeed!).toBeGreaterThan(0);
      expect(normalizeFilterSeed(standardSim.seedHex)).toBe(hexSeed);

      const xml42 = generateWoodGrainFilterXml(undefined, 42);
      const xml99 = generateWoodGrainFilterXml(undefined, 99);
      expect(xml42).toContain('seed="42"');
      expect(xml42).toContain('seed="59"'); // uncorrelated mottle seed = 42 + 17
      expect(xml99).toContain('seed="99"');
      expect(xml99).toContain('seed="116"');
      expect(xml42).not.toBe(xml99);
    });

    it('svgGenerator applies clipped end-grain overlay without filtering vector rings and stays locked during peel', () => {
      const svgWithGrain = generateCrossSectionSvg(standardSim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
        paletteId: 'aged-wood',
        enableWoodGrain: true,
      });
      expect(svgWithGrain).toContain(`id="${WOOD_GRAIN_FILTER_ID}"`);
      expect(svgWithGrain).toContain('<g id="annual-rings">');
      expect(svgWithGrain).not.toContain('<g id="annual-rings" filter=');
      expect(svgWithGrain).toContain('<g id="end-grain-texture" pointer-events="none" clip-path="url(#wood-clip)">');
      expect(svgWithGrain).toContain(`filter="url(#${WOOD_GRAIN_FILTER_ID})"`);

      // Peeling rings keeps the exact same filter baseFrequency and seed (zero noise swimming)
      const peeledSvg = generateCrossSectionSvg(standardSim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
        paletteId: 'aged-wood',
        enableWoodGrain: true,
        maxRenderedRingIndex: 40,
      });
      const fullFilterBlock = svgWithGrain.match(/<filter id="wood-grain-filter"[\s\S]*?<\/filter>/)?.[0];
      const peeledFilterBlock = peeledSvg.match(/<filter id="wood-grain-filter"[\s\S]*?<\/filter>/)?.[0];
      expect(fullFilterBlock).toBeDefined();
      expect(peeledFilterBlock).toBe(fullFilterBlock);

      // Skeleton plot reduces end-grain contrast compared to aged-wood
      const skelSvg = generateCrossSectionSvg(standardSim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
        paletteId: 'skeleton-plot',
        enableWoodGrain: true,
      });
      const agedSlope = Number(svgWithGrain.match(/result="poreLumens"/) ? svgWithGrain.match(/0 0 0 (-?[\d.]+) [\d.]+" result="poreLumens"/)?.[1] : NaN);
      const skelSlope = Number(skelSvg.match(/0 0 0 (-?[\d.]+) [\d.]+" result="poreLumens"/)?.[1]);
      expect(Math.abs(skelSlope)).toBeLessThan(Math.abs(agedSlope));

      // Disabled wood grain omits filter and overlay completely
      const svgNoGrain = generateCrossSectionSvg(standardSim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
        enableWoodGrain: false,
      });
      expect(svgNoGrain).not.toContain(`url(#${WOOD_GRAIN_FILTER_ID})`);
      expect(svgNoGrain).not.toContain('id="end-grain-texture"');
      expect(svgNoGrain).not.toContain(`id="${WOOD_GRAIN_FILTER_ID}"`);
    });
  });

  // ==========================================================================
  // Block 3: Typographic Colophon Plate Generation (src/model/colophon.ts)
  // ==========================================================================
  describe('Block 3: Typographic Colophon Plate Generation', () => {
    it('generates archival colophon plate border containing all required biological metadata', () => {
      const bundle = generateCrossSectionSvgBundle(standardSim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
      });

      const plate = wrapInColophonPlate(standardSim, bundle);
      const svg = plate.svgMarkup;

      // Seed Hex
      expect(svg).toContain(standardSim.seedHex);
      // Species scientific and common names
      expect(svg).toContain('Pinus ponderosa');
      expect(svg).toContain('Ponderosa Pine');
      // Calendar year range
      expect(svg).toContain(`${standardSim.firstRingYear}–${standardSim.params.deathYear} CE`);
      // Coordinates
      expect(svg).toContain('35.2645°N');
      expect(svg).toContain('111.7442°W');
      // Curatorial permanent archive permalink
      expect(svg).toContain('Curatorial Permanent Archive Link:');
    });

    it('escapes XML special characters in metadata strings preventing SVG parsing errors', () => {
      const raw = 'XYLEM & "Radial Ledger" <Plate I> \'Special\'';
      const escaped = escapeXml(raw);
      expect(escaped).toBe('XYLEM &amp; &quot;Radial Ledger&quot; &lt;Plate I&gt; &apos;Special&apos;');
      expect(escaped).not.toContain('& ');

      const plate = wrapInColophonPlate(standardSim, '<svg></svg>', {
        plateTitle: 'Tree & Nature <Plate I> "Special Edition"',
      });
      expect(plate.svgMarkup).toContain('Tree &amp; Nature &lt;Plate I&gt; &quot;Special Edition&quot;');
    });

    it('calculates expanded outer viewBox preserving inner cross-section aspect ratio without clipping', () => {
      const innerVb = { x: -250, y: -250, width: 500, height: 500 };
      const layout = computeColophonLayout(innerVb);

      expect(layout.plateViewBox.width).toBeGreaterThan(innerVb.width);
      expect(layout.plateViewBox.height).toBeGreaterThan(innerVb.height);

      const aspect = layout.plateViewBox.width / layout.plateViewBox.height;
      expect(aspect).toBeGreaterThan(0.5);
      expect(aspect).toBeLessThan(2.0);

      // Centered alignment: plateX < innerX and plateY < innerY
      expect(layout.plateViewBox.x).toBeLessThan(innerVb.x);
      expect(layout.plateViewBox.y).toBeLessThan(innerVb.y);
    });

    it('renders typographic hierarchy rules and double border framing', () => {
      const innerVb = { x: -100, y: -100, width: 200, height: 200 };
      const layout = computeColophonLayout(innerVb);
      const borders = generateColophonBorderRules(layout, {
        background: '#f5f0e6',
        borderColor: '#2b2621',
        borderHairline: '#827b73',
        textColor: '#1f1c19',
        textColorMid: '#4a443e',
        textColorDim: '#7a736a',
        accentColor: '#8b4513',
      });

      expect(borders).toContain('id="colophon-borders"');
      expect(borders).toContain('<rect');
      expect(borders).toContain('stroke="#2b2621"');
      expect(borders).toContain('stroke="#827b73"');
      // Corner brackets
      expect(borders).toContain('<path d="M');
    });

    it('produces standalone valid XML when wrapping bundle', () => {
      const plate = wrapInColophonPlate(standardSim, '<circle cx="0" cy="0" r="50"/>');
      expect(plate.svgMarkup.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      expect(plate.svgMarkup).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
      expect(plate.svgMarkup.endsWith('</svg>')).toBe(true);
    });
  });

  // ==========================================================================
  // Block 4: High-Resolution Export Pipeline (src/model/exportPipeline.ts)
  // ==========================================================================
  describe('Block 4: High-Resolution Export Pipeline', () => {
    it('calculateExportDimensions accurately computes 4K dimensions at 300 DPI for given aspect ratios', () => {
      // 1. Square ratio (500x500) -> 3840x3840
      const squareDim = calculateExportDimensions({ x: 0, y: 0, width: 500, height: 500 }, '4k');
      expect(squareDim.width).toBe(3840);
      expect(squareDim.height).toBe(3840);
      expect(squareDim.dpi).toBe(300);
      expect(squareDim.physicalWidthInches).toBeCloseTo(12.8, 1);
      expect(squareDim.physicalHeightInches).toBeCloseTo(12.8, 1);

      // 2. Landscape 16:9 ratio (1600x900) -> 3840x2160
      const landscapeDim = calculateExportDimensions({ x: 0, y: 0, width: 1600, height: 900 }, '4k');
      expect(landscapeDim.width).toBe(3840);
      expect(landscapeDim.height).toBe(2160);
      expect(landscapeDim.physicalWidthInches).toBeCloseTo(12.8, 1);
      expect(landscapeDim.physicalHeightInches).toBeCloseTo(7.2, 1);

      // 3. Portrait 4:5 ratio (800x1000) -> 3072x3840
      const portraitDim = calculateExportDimensions({ x: 0, y: 0, width: 800, height: 1000 }, '4k');
      expect(portraitDim.height).toBe(3840);
      expect(portraitDim.width).toBe(3072);
      expect(portraitDim.physicalHeightInches).toBeCloseTo(12.8, 1);
      expect(portraitDim.physicalWidthInches).toBeCloseTo(10.2, 1);
    });

    it('generateExportFilename formats clean, sanitized filenames incorporating specimen details', () => {
      const filename = generateExportFilename(standardSim, {
        format: 'png',
        includeColophon: true,
      });

      expect(filename).toContain('xylem-ponderosa-pine');
      expect(filename).toContain('35.2645_111.7442');
      expect(filename).toContain(`${standardSim.params.totalAge}yr`);
      expect(filename).toContain(`${standardSim.params.deathYear}ce`);
      expect(filename).toContain('-plate');
      expect(filename.endsWith('.png')).toBe(true);

      // Check sanitizeFilename removes forbidden filesystem characters
      const dirty = 'xylem:douglas-fir/age50*2026?test<tag>|pipe\\slash.png';
      const clean = sanitizeFilename(dirty);
      expect(clean).toBe('xylem-douglas-fir-age50-2026-test-tag--pipe-slash.png');
      expect(clean).not.toMatch(/[:/*?"<>|\\]/);
    });

    it('buildStandaloneSvg creates pure XML string with proper namespaces, defs, and styling', () => {
      const svg = buildStandaloneSvg(standardSim, {
        transparentBackground: false,
        paletteId: 'aged-wood',
      });

      expect(svg.startsWith('<?xml version="1.0"')).toBe(true);
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('<title>');
      expect(svg).toContain(standardSim.seedHex);
      expect(svg.endsWith('</svg>')).toBe(true);

      const transSvg = buildStandaloneSvg(standardSim, {
        transparentBackground: true,
      });
      expect(transSvg).not.toContain('<rect id="svg-background" fill="#');
    });

    it('export4kPng rasterizer handles headless / non-DOM environments gracefully via canvas override', async () => {
      const mockBlob = new Blob(['mock-png-data'], { type: 'image/png' });
      const mockCanvas = {
        getContext: (_type: string) => ({
          fillRect: () => {},
          drawImage: () => {},
          fillStyle: '',
        }),
        convertToBlob: async () => mockBlob,
      };

      const blob = await rasterizeSvgToBlob('<svg></svg>', 3840, 2160, {
        canvasOverride: mockCanvas,
      });
      expect(blob).toBeDefined();
      expect(blob.type).toBe('image/png');
    });

    it('handles canvas context acquisition failure with diagnostic exception', async () => {
      const badCanvas = {
        getContext: (_type: string) => null,
      };

      await expect(
        rasterizeSvgToBlob('<svg></svg>', 3840, 2160, {
          canvasOverride: badCanvas,
        })
      ).rejects.toThrow(/Failed to acquire 2D canvas context/);
    });
  });

  // ==========================================================================
  // Block 5: Cross-Cutting Scenarios & Preset Combinations (Tiers 2-4)
  // ==========================================================================
  describe('Block 5: Cross-Cutting Scenarios & Presets', () => {
    it('Tier 3: Bristlecone ancient preset + skeleton plot + 4K SVG export compiles valid plate', () => {
      const preset = getPresetById('bristlecone-ancient')!;
      expect(preset.recommendedPalette).toBe('skeleton-plot');

      const sim = simulateTreeCrossSection(
        {
          species: preset.species,
          latitude: preset.latitude,
          longitude: preset.longitude,
          totalAge: 200,
          deathYear: preset.temporal.deathYear,
        },
        testEnv
      );

      const plateSvg = buildStandaloneSvg(sim, {
        paletteId: preset.recommendedPalette,
        includeColophon: true,
      });

      expect(plateSvg).toContain('Pinus longaeva');
      expect(plateSvg).toContain('Great Basin Bristlecone Pine');
      expect(plateSvg).toContain('#fdfcf7'); // skeleton-plot background
      expect(plateSvg).toContain('#111111'); // skeleton-plot latewood
    });

    it('Tier 3: Wildfire preset + charred-subalpine palette + fire scar callus roll renders charred tones in SVG', () => {
      const preset = getPresetById('wildfire-scar-healing')!;
      expect(preset.recommendedPalette).toBe('charred-subalpine');

      const sim = simulateTreeCrossSection(
        {
          species: preset.species,
          latitude: preset.latitude,
          longitude: preset.longitude,
          totalAge: preset.totalAge,
          deathYear: preset.temporal.deathYear,
          disturbance: preset.disturbance,
        },
        testEnv
      );

      const bundle = generateCrossSectionSvgBundle(sim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
        paletteId: preset.recommendedPalette,
      });

      expect(bundle.svgMarkup).toContain('id="fire-scars"');
      expect(bundle.svgMarkup).toContain(PALETTES['charred-subalpine'].fireCharColor); // #080a0c
    });

    it('Tier 3: Pluvial-megadrought preset + aged-wood + permalink serialization round-trip maintains palette', () => {
      const preset = getPresetById('pluvial-megadrought')!;
      const state = {
        sp: preset.species,
        lat: preset.latitude,
        lon: preset.longitude,
        age: preset.totalAge,
        death: preset.temporal.deathYear,
        mode: 'peel' as const,
        pal: preset.recommendedPalette,
      };

      const query = serializePermalink(state);
      expect(query).toContain('pal=aged-wood');

      const parsed = deserializePermalink(query);
      expect(parsed.pal).toBe('aged-wood');
      expect(parsed.sp).toBe(preset.species);
      expect(parsed.age).toBe(preset.totalAge);
    });

    it('Tier 4: Curatorial Print Archival Workflow: volcanic frost preset + colophon plate export incorporates Tambora 1816 shock', () => {
      const preset = getPresetById('volcanic-frost-shock')!;
      const sim = simulateTreeCrossSection(
        {
          species: preset.species,
          latitude: preset.latitude,
          longitude: preset.longitude,
          totalAge: 80,
          deathYear: preset.temporal.deathYear,
          disturbance: preset.disturbance,
        },
        testEnv
      );

      const plate = wrapInColophonPlate(sim, generateCrossSectionSvgBundle(sim, {
        showBark: true,
        showMedullaryRays: true,
        showAnnotations: true,
        transparentBackground: false,
        paletteId: preset.recommendedPalette,
      }), {
        paletteId: preset.recommendedPalette,
      });

      expect(plate.svgMarkup).toContain('XYLEM PLATE');
      expect(plate.svgMarkup).toContain(sim.seedHex);
      expect(plate.viewBox.width).toBeGreaterThan(0);
      expect(plate.viewBox.height).toBeGreaterThan(0);
    });

    it('Tier 4: Extreme boundary dimensions (50-year sapling vs 500-year elder) export without numerical overflow or NaN coordinates', () => {
      const youngSim = simulateTreeCrossSection(
        {
          species: 'douglas-fir',
          latitude: 44.2,
          longitude: -121.5,
          totalAge: 50,
          deathYear: 2024,
        },
        testEnv
      );

      const oldSim = simulateTreeCrossSection(
        {
          species: 'bristlecone-pine',
          latitude: 37.38,
          longitude: -118.17,
          totalAge: 350,
          deathYear: 2024,
        },
        testEnv
      );

      const youngSvg = buildStandaloneSvg(youngSim, { includeColophon: true });
      const oldSvg = buildStandaloneSvg(oldSim, { includeColophon: true });

      expect(youngSvg).not.toContain('NaN');
      expect(youngSvg).not.toContain('Infinity');
      expect(oldSvg).not.toContain('NaN');
      expect(oldSvg).not.toContain('Infinity');
    });
  });
});
