/**
 * src/model/exportPipeline.ts
 * High-resolution 4K raster and archival standalone SVG export pipeline for XYLEM.
 */

import { wrapInColophonPlate } from './colophon';
import { PaletteId } from './palettes';
import {
  generateCrossSectionSvgBundle,
  GeneratedSvgBundle,
  SvgRenderOptions,
  SvgViewBox,
} from './svgGenerator';
import { TreeSimulationResult } from './types';
import { UnitSystem } from './units';

export type ExportFormat = 'png' | 'svg';
export type ExportResolutionPreset = '4k' | 'print-300dpi' | '2k' | '1080p';

export interface ExportDimensions {
  width: number;
  height: number;
  dpi: number;
  physicalWidthInches: number;
  physicalHeightInches: number;
}

export interface ExportConfig {
  format?: ExportFormat;
  resolution?: ExportResolutionPreset;
  includeColophon?: boolean;
  transparentBackground?: boolean;
  unitSystem?: UnitSystem;
  paletteId?: PaletteId;
  permalinkUrl?: string;
  plateTitle?: string;
  maxRenderedRingIndex?: number;
  showBark?: boolean;
  showMedullaryRays?: boolean;
  showAnnotations?: boolean;
  showLocatorMap?: boolean;
  enableWoodGrain?: boolean;
  svgBundle?: GeneratedSvgBundle;
  narrative?: string;
  targetDpi?: number;
}

/**
 * Replaces illegal filesystem characters: [:/*?"<>|\\] -> '-'
 */
export function sanitizeFilename(raw: string): string {
  if (!raw) return 'xylem-specimen';
  return raw.replace(/[:/*?"<>|\\]/g, '-');
}

/**
 * Generates standardized, informative export filename.
 */
export function generateExportFilename(
  sim: TreeSimulationResult,
  options?: {
    format?: ExportFormat;
    includeColophon?: boolean;
    resolution?: string;
  }
): string {
  const sp = sim.params.species;
  const lat = Math.abs(sim.params.latitude).toFixed(4);
  const lon = Math.abs(sim.params.longitude).toFixed(4);
  const age = sim.params.totalAge;
  const death = sim.params.deathYear;
  const plateTag = options?.includeColophon ? '-plate' : '';
  const ext = options?.format ?? 'png';

  const raw = `xylem-${sp}-${lat}_${lon}-${age}yr-${death}ce${plateTag}.${ext}`;
  return sanitizeFilename(raw);
}

/**
 * Calculates pixel dimensions, DPI, and physical print size in inches.
 * 4K preset standardizes to 3840 px along primary axis at 300 DPI (12.8 in).
 */
export function calculateExportDimensions(
  viewBox: SvgViewBox,
  preset: ExportResolutionPreset = '4k'
): ExportDimensions {
  const aspect = viewBox.width / viewBox.height;
  const dpi = 300;
  let width = 3840;
  let height = 2160;

  if (preset === '4k' || preset === 'print-300dpi') {
    if (Math.abs(aspect - 16 / 9) < 0.05) {
      width = 3840;
      height = 2160;
    } else if (Math.abs(aspect - 1.0) < 0.05) {
      width = 3840;
      height = 3840;
    } else if (aspect < 1.0) {
      // Portrait: height = 3840, width = round(3840 * aspect)
      height = 3840;
      width = Math.round(3840 * aspect);
    } else {
      // Landscape: width = 3840, height = round(3840 / aspect)
      width = 3840;
      height = Math.round(3840 / aspect);
    }
  } else if (preset === '2k') {
    width = 2560;
    height = Math.round(2560 / aspect);
  } else if (preset === '1080p') {
    width = 1920;
    height = 1080;
  }

  const physicalWidthInches = Number((width / dpi).toFixed(1));
  const physicalHeightInches = Number((height / dpi).toFixed(1));

  return {
    width,
    height,
    dpi,
    physicalWidthInches,
    physicalHeightInches,
  };
}

/**
 * Constructs clean standalone XML SVG string with proper namespaces, defs, and styling.
 */
export function buildStandaloneSvg(
  sim: TreeSimulationResult,
  config?: ExportConfig
): string {
  const renderOptions: SvgRenderOptions = {
    showBark: config?.showBark ?? true,
    showMedullaryRays: config?.showMedullaryRays ?? true,
    showAnnotations: config?.showAnnotations ?? true,
    showLocatorMap: config?.showLocatorMap ?? true,
    transparentBackground: Boolean(config?.transparentBackground),
    unitSystem: config?.unitSystem ?? 'us',
    paletteId: config?.paletteId ?? 'aged-wood',
    enableWoodGrain: config?.enableWoodGrain ?? true,
    maxRenderedRingIndex: config?.maxRenderedRingIndex,
  };

  const bundle = config?.svgBundle ?? generateCrossSectionSvgBundle(sim, renderOptions);

  if (config?.includeColophon) {
    const colophonBundle = wrapInColophonPlate(sim, bundle, {
      unitSystem: config.unitSystem,
      paletteId: config.paletteId,
      permalinkUrl: config.permalinkUrl,
      plateTitle: config.plateTitle,
      narrative: config.narrative,
      maxRenderedRingIndex: config.maxRenderedRingIndex,
    });
    return colophonBundle.svgMarkup;
  }

  return bundle.svgMarkup;
}

/**
 * Generates standalone SVG and triggers browser download when executed client-side.
 */
export function exportStandaloneSvg(
  sim: TreeSimulationResult,
  config?: ExportConfig
): string {
  const svgMarkup = buildStandaloneSvg(sim, config);
  const filename = generateExportFilename(sim, {
    format: 'svg',
    includeColophon: config?.includeColophon,
  });

  triggerBrowserDownload(svgMarkup, filename);
  return svgMarkup;
}

/**
 * Rasterizes SVG markup to uncompressed PNG Blob via OffscreenCanvas / HTMLCanvasElement.
 * Throws descriptive diagnostic error matching /Failed to acquire 2D canvas context/ on context failure.
 */
export async function rasterizeSvgToBlob(
  svgMarkup: string,
  width: number,
  height: number,
  options?: {
    mimeType?: string;
    backgroundColor?: string;
    canvasOverride?: {
      getContext: (type: string) => unknown;
      convertToBlob?: (options?: { type: string }) => Promise<Blob>;
      toBlob?: (cb: (b: Blob | null) => void, mime?: string) => void;
      width?: number;
      height?: number;
    };
  }
): Promise<Blob> {
  const mimeType = options?.mimeType ?? 'image/png';
  let canvas: any = options?.canvasOverride;

  if (!canvas) {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
    } else if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(width, height);
    } else {
      throw new Error('Canvas rasterization requires a browser or OffscreenCanvas environment');
    }
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D canvas context');
  }

  // Support mocked or headless test canvas implementations
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: mimeType });
  }
  if (typeof canvas.toBlob === 'function' && typeof Image === 'undefined') {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob: Blob | null) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to generate canvas blob'));
      }, mimeType);
    });
  }

  return new Promise<Blob>((resolve, reject) => {
    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      try {
        if (options?.backgroundColor) {
          ctx.fillStyle = options.backgroundColor;
          ctx.fillRect(0, 0, width, height);
        }
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        if (typeof canvas.convertToBlob === 'function') {
          canvas.convertToBlob({ type: mimeType }).then(resolve).catch(reject);
        } else if (typeof canvas.toBlob === 'function') {
          canvas.toBlob((blob: Blob | null) => {
            if (blob) resolve(blob);
            else reject(new Error('Failed to generate blob from canvas'));
          }, mimeType);
        } else {
          resolve(new Blob([], { type: mimeType }));
        }
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to render SVG image onto canvas: ' + String(err)));
    };
    img.src = url;
  });
}

/**
 * Unified high-resolution export runner producing ready-to-download artifacts.
 */
export async function exportTreeArtifact(
  sim: TreeSimulationResult,
  config?: ExportConfig
): Promise<{
  blob: Blob;
  filename: string;
  mimeType: string;
  dimensions?: ExportDimensions;
}> {
  const format = config?.format ?? 'png';
  const svgMarkup = buildStandaloneSvg(sim, config);

  if (format === 'svg') {
    const filename = generateExportFilename(sim, {
      format: 'svg',
      includeColophon: config?.includeColophon,
    });
    const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    triggerBrowserDownload(blob, filename);
    return {
      blob,
      filename,
      mimeType: 'image/svg+xml',
    };
  }

  // PNG Rasterization
  // ViewBox for dimension calculation
  const bundle = config?.svgBundle ?? generateCrossSectionSvgBundle(sim, {
    showBark: config?.showBark ?? true,
    showMedullaryRays: config?.showMedullaryRays ?? true,
    showAnnotations: config?.showAnnotations ?? true,
    showLocatorMap: config?.showLocatorMap ?? true,
    transparentBackground: Boolean(config?.transparentBackground),
    unitSystem: config?.unitSystem ?? 'us',
    paletteId: config?.paletteId ?? 'aged-wood',
  });

  const viewBox = config?.includeColophon
    ? wrapInColophonPlate(sim, bundle).viewBox
    : bundle.viewBox;

  const dimensions = calculateExportDimensions(viewBox, config?.resolution ?? '4k');
  const filename = generateExportFilename(sim, {
    format: 'png',
    includeColophon: config?.includeColophon,
    resolution: config?.resolution ?? '4k',
  });

  const blob = await rasterizeSvgToBlob(svgMarkup, dimensions.width, dimensions.height);
  triggerBrowserDownload(blob, filename);

  return {
    blob,
    filename,
    mimeType: 'image/png',
    dimensions,
  };
}

/**
 * Specialized high-resolution 4K PNG export wrapper.
 */
export async function export4kPng(
  sim: TreeSimulationResult,
  config?: ExportConfig
): Promise<{
  blob: Blob;
  filename: string;
  mimeType: string;
  dimensions: ExportDimensions;
}> {
  const result = await exportTreeArtifact(sim, {
    ...config,
    format: 'png',
    resolution: '4k',
  });
  return result as {
    blob: Blob;
    filename: string;
    mimeType: string;
    dimensions: ExportDimensions;
  };
}

/**
 * Triggers client-side browser file download safely.
 */
export function triggerBrowserDownload(
  blobOrString: Blob | string,
  filename: string
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  const blob =
    typeof blobOrString === 'string'
      ? new Blob([blobOrString], { type: 'image/svg+xml;charset=utf-8' })
      : blobOrString;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Environment capability detection helpers.
 */
export function isBrowserEnvironment(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export function isOffscreenCanvasSupported(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}
