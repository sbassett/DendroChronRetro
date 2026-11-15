import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Helper to inspect binary PNG dimensions from header (IHDR chunk)
function getPngDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  const isPng =
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a;
  if (!isPng) {
    throw new Error(`File at ${filePath} is not a valid PNG image`);
  }
  // IHDR chunk begins at offset 12; width is at 16..20 (big-endian 32-bit uint), height at 20..24
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

describe('Milestone 5 (R5): Metadata, Cross-Device Polish & Release Staging', () => {
  const cwd = process.cwd();
  const indexPath = path.resolve(cwd, 'index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf-8');

  // ==========================================================================
  // 1. Social Metadata in index.html (OpenGraph & Twitter Cards)
  // ==========================================================================
  describe('1. OpenGraph & Twitter Social Metadata in index.html', () => {
    it('declares valid og:title with complete retrospective subtitle', () => {
      const match = indexHtml.match(/<meta property="og:title" content="([^"]+)"/i);
      expect(match).not.toBeNull();
      const title = match![1];
      expect(title).toBe('XYLEM: An Ecological Ledger of Deep Time — Retrospective Dendrochronology');
    });

    it('declares museum-grade og:description with length under 200 characters', () => {
      const match = indexHtml.match(/<meta property="og:description" content="([^"]+)"/i);
      expect(match).not.toBeNull();
      const desc = match![1];
      expect(desc).toBe(
        'A museum-grade generative dendrochronology installation reading ecological history in reverse through cellular wood anatomy, climate stress, and environmental trauma.'
      );
      expect(desc.length).toBeLessThanOrEqual(200);
      expect(desc.length).toBeGreaterThanOrEqual(40);
    });

    it('configures og:image with 1200x630 dimension specifications and png type', () => {
      expect(indexHtml).toContain('<meta property="og:image" content="./og-preview.png"');
      expect(indexHtml).toContain('<meta property="og:image:width" content="1200"');
      expect(indexHtml).toContain('<meta property="og:image:height" content="630"');
      expect(indexHtml).toContain('<meta property="og:image:type" content="image/png"');
      expect(indexHtml).toContain('<meta property="og:image:alt"');
    });

    it('declares og:url, og:type="website", and og:site_name', () => {
      expect(indexHtml).toContain('<meta property="og:type" content="website"');
      expect(indexHtml).toContain('<meta property="og:url" content="https://xylem.art"');
      expect(indexHtml).toContain('<meta property="og:site_name" content="XYLEM: An Ecological Ledger of Deep Time"');
    });

    it('declares complete Twitter Card metadata with summary_large_image', () => {
      expect(indexHtml).toContain('<meta name="twitter:card" content="summary_large_image"');
      const titleMatch = indexHtml.match(/<meta name="twitter:title" content="([^"]+)"/i);
      expect(titleMatch).not.toBeNull();
      expect(titleMatch![1]).toBe('XYLEM: An Ecological Ledger of Deep Time — Retrospective Dendrochronology');

      const descMatch = indexHtml.match(/<meta name="twitter:description" content="([^"]+)"/i);
      expect(descMatch).not.toBeNull();
      expect(descMatch![1]).toContain('cellular wood anatomy');

      expect(indexHtml).toContain('<meta name="twitter:image" content="./og-preview.png"');
      expect(indexHtml).toContain('<meta name="twitter:image:alt"');
    });

    it('declares canonical link, theme-color, and museum favicon assets', () => {
      expect(indexHtml).toContain('<link rel="canonical" href="https://xylem.art"');
      expect(indexHtml).toContain('<meta name="theme-color" content="#12100e"');
      expect(indexHtml).toContain('rel="icon" type="image/svg+xml" href="./favicon.svg"');
      expect(indexHtml).toContain('rel="icon" type="image/png" sizes="32x32" href="./favicon-32x32.png"');
      expect(indexHtml).toContain('rel="apple-touch-icon" sizes="180x180" href="./apple-touch-icon.png"');
    });
  });

  // ==========================================================================
  // 2. High-Resolution Social Preview Graphic Assets
  // ==========================================================================
  describe('2. Social Preview Graphic Assets (public/og-preview.png & .svg)', () => {
    const pngPath = path.resolve(cwd, 'public/og-preview.png');
    const svgPath = path.resolve(cwd, 'public/og-preview.svg');

    it('generates public/og-preview.png file on disk with non-trivial byte size', () => {
      expect(fs.existsSync(pngPath)).toBe(true);
      const stats = fs.statSync(pngPath);
      expect(stats.size).toBeGreaterThan(15000); // Substantial visual detail
    });

    it('verifies public/og-preview.png has exact binary dimensions of 1200 x 630 pixels', () => {
      const dimensions = getPngDimensions(pngPath);
      expect(dimensions.width).toBe(1200);
      expect(dimensions.height).toBe(630);
    });

    it('generates public/og-preview.svg vector graphic with 1200x630 viewBox', () => {
      expect(fs.existsSync(svgPath)).toBe(true);
      const svgContent = fs.readFileSync(svgPath, 'utf-8');
      expect(svgContent).toContain('viewBox="0 0 1200 630"');
      expect(svgContent).toContain('width="1200"');
      expect(svgContent).toContain('height="630"');
    });

    it('embeds brand typography, biophysical ledger, and trauma features in SVG asset', () => {
      const svgContent = fs.readFileSync(svgPath, 'utf-8');
      expect(svgContent).toContain('XYLEM');
      expect(svgContent).toContain('AN ECOLOGICAL LEDGER OF DEEP TIME');
      expect(svgContent).toContain('RETROSPECTIVE DENDROCHRONOLOGY');
      expect(svgContent).toContain('Pinus longaeva');
      expect(svgContent).toContain('Vaganov-Shashkin');
      expect(svgContent).toContain('Catface Fire Scar');
    });
  });

  // ==========================================================================
  // 3. Touch Scrolling Containment & Pointer Events
  // ==========================================================================
  describe('3. Touch Scrolling Containment & Pointer Events', () => {
    const appCssPath = path.resolve(cwd, 'src/App.css');
    const appCss = fs.readFileSync(appCssPath, 'utf-8');

    it('enforces touch-action: none on interactive scrubber slider and tracks', () => {
      expect(appCss).toMatch(/\.time-nav-range-input\s*\{[^}]*touch-action:\s*none/);
      expect(appCss).toMatch(/\.time-nav-scrubber-track\s*\{[^}]*touch-action:\s*none/);
      expect(appCss).toMatch(/\.time-navigation-bar\s*\{[^}]*touch-action:\s*pan-y/);
    });

    it('enforces touch-action: none on interactive ring chronology chart bars', () => {
      expect(appCss).toMatch(/\.chronology-bars\s*\{[^}]*touch-action:\s*none/);
      expect(appCss).toMatch(/\.chrono-bar-col\s*\{[^}]*touch-action:\s*none/);
    });

    it('enforces touch-action: none on main canvas area and SVG viewport', () => {
      expect(appCss).toMatch(/\.svg-viewport\s*\{[^}]*touch-action:\s*none/);
      expect(appCss).toMatch(/\.canvas-area\s*\{[^}]*touch-action:\s*none/);
      expect(appCss).toMatch(/\.floating-exhibition-bar\s*\{[^}]*touch-action:\s*none/);
    });

    it('provides ergonomic touch thumb styling on time navigation slider', () => {
      expect(appCss).toContain('.time-nav-range-input::-webkit-slider-thumb');
      expect(appCss).toContain('.time-nav-range-input::-moz-range-thumb');
    });

    it('verifies TimeNavigation component sets touch-action: none inline on range input and track', () => {
      const timeNavTsx = fs.readFileSync(path.resolve(cwd, 'src/components/TimeNavigation.tsx'), 'utf-8');
      expect(timeNavTsx).toContain('style={{ touchAction: \'none\' }}');
    });

    it('verifies RingChronologyChart implements pointer scrubbing with setPointerCapture and capture revocation handling', () => {
      const chartTsx = fs.readFileSync(path.resolve(cwd, 'src/components/RingChronologyChart.tsx'), 'utf-8');
      expect(chartTsx).toContain('onPointerDown={handlePointerDown}');
      expect(chartTsx).toContain('onPointerMove={handlePointerMove}');
      expect(chartTsx).toContain('onPointerUp={handlePointerUp}');
      expect(chartTsx).toContain('onPointerCancel={handlePointerUp}');
      expect(chartTsx).toContain('onLostPointerCapture={handlePointerUp}');
      expect(chartTsx).toContain('setPointerCapture');
      expect(chartTsx).toContain('releasePointerCapture');
      expect(chartTsx).toContain('style={{ touchAction: \'none\' }}');
    });

    it('verifies SvgViewport implements unified pointer drag gestures with setPointerCapture and capture revocation handling', () => {
      const viewportTsx = fs.readFileSync(path.resolve(cwd, 'src/components/SvgViewport.tsx'), 'utf-8');
      expect(viewportTsx).toContain('onPointerDown={handlePointerDown}');
      expect(viewportTsx).toContain('onPointerMove={handlePointerMove}');
      expect(viewportTsx).toContain('onPointerUp={stopPointerDrag}');
      expect(viewportTsx).toContain('onPointerCancel={stopPointerDrag}');
      expect(viewportTsx).toContain('onLostPointerCapture={stopPointerDrag}');
      expect(viewportTsx).toContain('setPointerCapture');
      expect(viewportTsx).toContain('releasePointerCapture');
      expect(viewportTsx).toContain('style={{ touchAction: \'none\' }}');
    });

    it('verifies App.tsx sets touch-action: none inline on .canvas-area container', () => {
      const appTsx = fs.readFileSync(path.resolve(cwd, 'src/App.tsx'), 'utf-8');
      expect(appTsx).toMatch(/<div\s+className="canvas-area"\s+style=\{\{\s*touchAction:\s*['"]none['"]\s*\}\}/);
    });

    it('verifies all 5 interactive touch targets have inline style touchAction: "none"', () => {
      const timeNavTsx = fs.readFileSync(path.resolve(cwd, 'src/components/TimeNavigation.tsx'), 'utf-8');
      const viewportTsx = fs.readFileSync(path.resolve(cwd, 'src/components/SvgViewport.tsx'), 'utf-8');
      const chartTsx = fs.readFileSync(path.resolve(cwd, 'src/components/RingChronologyChart.tsx'), 'utf-8');
      const appTsx = fs.readFileSync(path.resolve(cwd, 'src/App.tsx'), 'utf-8');

      // 1. .time-nav-scrubber-track (TimeNavigation.tsx)
      expect(timeNavTsx).toMatch(/className="time-nav-scrubber-track"[^>]*style=\{\{\s*touchAction:\s*['"]none['"]\s*\}\}/);

      // 2. .time-nav-range-input (TimeNavigation.tsx)
      expect(timeNavTsx).toMatch(/className="time-nav-range-input"[^>]*style=\{\{\s*touchAction:\s*['"]none['"]\s*\}\}/);

      // 3. .svg-viewport (SvgViewport.tsx)
      expect(viewportTsx).toMatch(/className=\{`svg-viewport\s[^`]*`\}[^>]*style=\{\{\s*touchAction:\s*['"]none['"]\s*\}\}/);

      // 4. .canvas-area (App.tsx)
      expect(appTsx).toMatch(/className="canvas-area"[^>]*style=\{\{\s*touchAction:\s*['"]none['"]\s*\}\}/);

      // 5. .chronology-bars (RingChronologyChart.tsx)
      expect(chartTsx).toMatch(/className="chronology-bars"[^>]*style=\{\{\s*touchAction:\s*['"]none['"]\s*\}\}/);
    });
  });

  // ==========================================================================
  // 4. Cross-Device Responsiveness & High-DPI Retina Scaling
  // ==========================================================================
  describe('4. Cross-Device Responsiveness & High-DPI Scaling', () => {
    const appCss = fs.readFileSync(path.resolve(cwd, 'src/App.css'), 'utf-8');

    it('defines mobile breakpoints for inverted hierarchy and compact viewport scaling', () => {
      expect(appCss).toContain('@media (max-width: 920px)');
      expect(appCss).toContain('@media (max-width: 480px)');
      expect(appCss).toContain('order: 2'); // canvas-area hero priority on mobile
    });

    it('defines tablet and large desktop viewport breakpoints', () => {
      expect(appCss).toContain('@media (min-width: 481px) and (max-width: 1024px)');
      expect(appCss).toContain('@media (min-width: 1440px)');
    });

    it('defines ultra-wide and 4K gallery screen breakpoint (>= 2101px)', () => {
      expect(appCss).toContain('@media (min-width: 2101px)');
      expect(appCss).toContain('grid-template-columns: 460px 1fr');
    });

    it('enforces High-DPI Retina scaling rules preventing pixelation and blur', () => {
      expect(appCss).toContain('@media (-webkit-min-device-pixel-ratio: 2), (min-resolution: 192dpi)');
      expect(appCss).toContain('shape-rendering: geometricPrecision');
      expect(appCss).toContain('text-rendering: geometricPrecision');
    });

    it('maintains strict horizontal overflow containment on shell and root', () => {
      expect(appCss).toContain('overflow-x: hidden');
    });
  });

  // ==========================================================================
  // 5. Release Announcement & Staging Documentation
  // ==========================================================================
  describe('5. Release Announcement & Staging (RELEASE_ANNOUNCEMENT.md)', () => {
    const releaseDocPath = path.resolve(cwd, 'RELEASE_ANNOUNCEMENT.md');

    it('confirms RELEASE_ANNOUNCEMENT.md exists at project root', () => {
      expect(fs.existsSync(releaseDocPath)).toBe(true);
    });

    it('contains curatorial release announcement with exhibition identity', () => {
      const doc = fs.readFileSync(releaseDocPath, 'utf-8');
      expect(doc).toContain('XYLEM: An Ecological Ledger of Deep Time');
      expect(doc).toContain('Curatorial Release Announcement');
      expect(doc).toContain('https://xylem.art');
      expect(doc).toContain('Vaganov-Shashkin (VS-Lite)');
    });

    it('contains poetic artist statement emphasizing retrospection and unbribable biological ledgers', () => {
      const doc = fs.readFileSync(releaseDocPath, 'utf-8');
      expect(doc).toContain('Artist Statement: The Unbribable Ledger of Deep Time');
      expect(doc).toContain('unbribable ledger');
      expect(doc).toContain('retrospection');
      expect(doc).toContain('deep planetary time');
      expect(doc).toContain('woundwood');
    });

    it('enumerates all target launch communities across science, art, and creative coding', () => {
      const doc = fs.readFileSync(releaseDocPath, 'utf-8');
      // Generative Art
      expect(doc).toContain('Generative Art & Creative Coding');
      expect(doc).toContain('fxhash');
      expect(doc).toContain('Art Blocks');
      expect(doc).toContain('r/generative');

      // Creative Technology
      expect(doc).toContain('Creative Technology & Web Standards');
      expect(doc).toContain('Hacker News');
      expect(doc).toContain('Creative Applications Network');

      // Climate Visualization
      expect(doc).toContain('Climate Visualization & Data Journalism');
      expect(doc).toContain('r/dataisbeautiful');

      // Dendrochronology & Earth Systems
      expect(doc).toContain('Dendrochronology, Forestry & Earth Systems Science');
      expect(doc).toContain('Tree-Ring Society');
      expect(doc).toContain('ITRDB');
      expect(doc).toContain('NOAA Paleoclimatology');

      // Digital Museums
      expect(doc).toContain('Digital Museums, Galleries & Media Art');
      expect(doc).toContain('Rhizome');
      expect(doc).toContain('Ars Electronica');

      // Fediverse / Bluesky
      expect(doc).toContain('Decentralized Social & Creative Fediverse');
      expect(doc).toContain('Mastodon');
      expect(doc).toContain('Bluesky');
    });

    it('summarizes technical specifications matching architectural contracts', () => {
      const doc = fs.readFileSync(releaseDocPath, 'utf-8');
      expect(doc).toContain('Technical & Curatorial Specifications Summary');
      expect(doc).toContain('1200 × 630 px OpenGraph & Twitter Cards');
      expect(doc).toContain('Non-blocking Pointer Events, `touch-action: none`');
      expect(doc).toContain('4K (300 DPI)');
    });
  });
});
