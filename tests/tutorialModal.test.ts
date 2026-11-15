import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Dendrochronology & Cross-Section Tutorial Modal', () => {
  const cwd = process.cwd();
  const tutorialSource = fs.readFileSync(
    path.resolve(cwd, 'src/components/DendroTutorialModal.tsx'),
    'utf-8'
  );
  const appSource = fs.readFileSync(path.resolve(cwd, 'src/App.tsx'), 'utf-8');
  const cssSource = fs.readFileSync(path.resolve(cwd, 'src/App.css'), 'utf-8');

  it('defines all five dendrochronology tutorial chapters', () => {
    expect(tutorialSource).toContain('1. Cross-Section');
    expect(tutorialSource).toContain('2. Early vs. Latewood');
    expect(tutorialSource).toContain('3. Climate & RWI');
    expect(tutorialSource).toContain('4. Trauma Markers');
    expect(tutorialSource).toContain('5. Peel & Grow');
  });

  it('covers all five interactive cross-section anatomical zones', () => {
    expect(tutorialSource).toContain('Pith (Germination Core)');
    expect(tutorialSource).toContain('Heartwood (Duramen)');
    expect(tutorialSource).toContain('Sapwood (Alburnum)');
    expect(tutorialSource).toContain('Vascular Cambium (Living Sheath)');
    expect(tutorialSource).toContain('Outer Bark (Rhytidome)');
  });

  it('covers earlywood/latewood Mork criterion and all four disturbance trauma markers', () => {
    expect(tutorialSource).toContain('Mork’s anatomical criterion');
    expect(tutorialSource).toContain('False Ring (IADF)');
    expect(tutorialSource).toContain('Locally Absent Ring');
    expect(tutorialSource).toContain('Catface Fire Scar');
    expect(tutorialSource).toContain('Traumatic Resin Pocket');
  });

  it('provides accessible dialog semantics, keyboard navigation, and live specimen links', () => {
    expect(tutorialSource).toContain('role="dialog"');
    expect(tutorialSource).toContain('aria-modal="true"');
    expect(tutorialSource).toContain("e.key === 'Escape'");
    expect(tutorialSource).toContain("e.key === 'ArrowRight'");
    expect(tutorialSource).toContain("e.key === 'ArrowLeft'");
    expect(tutorialSource).toContain("handleLoadPreset('wildfire-scar-healing')");
    expect(tutorialSource).toContain("handleLoadPreset('pluvial-megadrought')");
    expect(tutorialSource).toContain("onSelectPalette('skeleton-plot')");
  });

  it('wires the Guide trigger and DendroTutorialModal into App.tsx with responsive CSS', () => {
    expect(appSource).toContain('DendroTutorialModal');
    expect(appSource).toContain('setIsTutorialOpen(true)');
    expect(appSource).toContain('<span>Guide</span>');
    expect(cssSource).toContain('.tutorial-modal-card');
    expect(cssSource).toContain('.tutorial-stepper');
  });
});
