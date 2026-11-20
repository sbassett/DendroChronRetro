import React from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  Copy,
  Download,
  Fingerprint,
  Info,
  Share2,
  Sliders,
  Sparkles,
  X,
} from 'lucide-react';
import { PaletteId } from '../model/permalink';
import { RETROSPECTIVE_PRESETS, RetrospectivePreset } from '../model/presets';
import { SvgRenderOptions } from '../model/svgGenerator';
import { TreeSimulationResult } from '../model/types';
import {
  formatAnnualPrecip,
  formatBarkThickness,
  formatDiameter,
  formatElevation,
  formatSlope,
  formatTemperature,
  UnitSystem,
} from '../model/units';

export type DrawerTab = 'ledger' | 'style' | 'export';

function compassLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}

export interface LedgerTelemetryPanelProps {
  simulation: TreeSimulationResult | null;
  story: string | null;
  viabilityDetail: string | null;
  latitude: number;
  longitude: number;
  unitSystem: UnitSystem;
  onOpenColophon: () => void;
  onOpenGuide: () => void;
}

export const LedgerTelemetryPanel: React.FC<LedgerTelemetryPanelProps> = ({
  simulation,
  story,
  viabilityDetail,
  latitude,
  longitude,
  unitSystem,
  onOpenColophon,
  onOpenGuide,
}) => {
  const coordDisplay = `${Math.abs(latitude).toFixed(4)}°${latitude >= 0 ? 'N' : 'S'}, ${Math.abs(longitude).toFixed(4)}°${longitude >= 0 ? 'E' : 'W'}`;

  return (
    <div className="drawer-panel-stack">
      {story && (
        <section className="drawer-section">
          <div className="story-header-row">
            <span className="story-tag">Dendroclimatic Ledger</span>
            <span className="story-coords">{coordDisplay}</span>
          </div>
          <p className="story-prose">{story}</p>
          <p className="ledger-provenance-callout">
            Real climate &amp; terrain (1200–2026); tree geometry and fire years are
            biophysically simulated, not cored from a physical stump.
          </p>
        </section>
      )}

      {simulation &&
        (simulation.viability.stressLevel === 'unsuitable' ||
          simulation.viability.stressLevel === 'marginal') && (
          <div
            className={`viability-banner drawer-viability-banner ${simulation.viability.stressLevel}`}
          >
            <AlertTriangle size={16} />
            <div>
              <strong>{simulation.viability.summary}</strong>
              {viabilityDetail && <span> — {viabilityDetail}</span>}
            </div>
          </div>
        )}

      <section className="drawer-section">
        <span className="section-label">Specimen &amp; Site Telemetry</span>
        {simulation ? (
          <div className="telemetry-grid">
            <div
              className="telemetry-cell"
              title="Total stump diameter outside bark (DOB)"
            >
              <span className="metric-label">Outer Diameter</span>
              <span className="metric-value">
                {formatDiameter(simulation.diameterOutsideBarkMm, unitSystem)}
              </span>
            </div>
            <div
              className="telemetry-cell"
              title="Wood diameter inside bark (DIB)"
            >
              <span className="metric-label">Wood Diameter</span>
              <span className="metric-value">
                {formatDiameter(simulation.diameterInsideBarkMm, unitSystem)}
              </span>
            </div>
            <div className="telemetry-cell" title="Mean radial bark thickness">
              <span className="metric-label">Mean Bark</span>
              <span className="metric-value">
                {formatBarkThickness(simulation.bark.meanThicknessMm, unitSystem)}
              </span>
            </div>
            <div className="telemetry-cell" title="Site elevation above sea level">
              <span className="metric-label">Elevation</span>
              <span className="metric-value">
                {formatElevation(
                  simulation.environment.terrain.elevationM,
                  unitSystem
                )}
              </span>
            </div>
            <div className="telemetry-cell" title="Local terrain slope">
              <span className="metric-label">Slope</span>
              <span className="metric-value">
                {formatSlope(simulation.environment.terrain.slopeDeg, unitSystem)}
              </span>
            </div>
            <div className="telemetry-cell" title="Downhill slope facing azimuth">
              <span className="metric-label">Aspect</span>
              <span className="metric-value">
                {compassLabel(simulation.environment.terrain.aspectDeg)} (
                {Math.round(simulation.environment.terrain.aspectDeg)}°)
              </span>
            </div>
            <div className="telemetry-cell" title="Site mean annual air temperature">
              <span className="metric-label">Mean Temp</span>
              <span className="metric-value">
                {formatTemperature(
                  simulation.environment.meanAnnualTempC,
                  unitSystem
                )}
              </span>
            </div>
            <div className="telemetry-cell" title="Site mean annual precipitation">
              <span className="metric-label">Annual Precip</span>
              <span className="metric-value">
                {formatAnnualPrecip(
                  simulation.environment.meanAnnualPrecipMm,
                  unitSystem
                )}
              </span>
            </div>
            {simulation.fireScars && simulation.fireScars.length > 0 && (() => {
              const scars = simulation.fireScars;
              const uniqueYears = Array.from(new Set(scars.map((s) => s.year)));
              const shownYears =
                uniqueYears.length <= 4
                  ? uniqueYears.join(', ')
                  : `${uniqueYears.slice(0, 3).join(', ')} +${uniqueYears.length - 3}`;
              const allHealed = scars.every((s) => s.healedYear !== undefined);
              const latestHealed = allHealed
                ? Math.max(...scars.map((s) => s.healedYear!))
                : null;
              const statusText =
                allHealed && latestHealed !== null
                  ? `Healed ${latestHealed}`
                  : 'Open';
              const standNote =
                simulation.standFireYears && simulation.standFireYears.length > 0
                  ? ` · Stand fires: ${simulation.standFireYears.join(', ')}`
                  : '';
              return (
                <div
                  className="telemetry-cell telemetry-cell-wide"
                  title={`Scarred years: ${uniqueYears.join(', ')}${standNote}`}
                >
                  <span className="metric-label">Fire History</span>
                  <span className="metric-value">
                    {scars.length} {scars.length === 1 ? 'Scar' : 'Scars'} (
                    {shownYears} · {statusText})
                  </span>
                </div>
              );
            })()}
            <div
              className="telemetry-cell telemetry-cell-wide"
              title={`Deterministic seed key: ${simulation.seedKey}`}
            >
              <span className="metric-label">
                <Fingerprint size={11} /> Deterministic Seed
              </span>
              <span className="metric-value mono">{simulation.seedHex}</span>
            </div>
          </div>
        ) : (
          <span className="loading-text">
            Loading historical weather &amp; terrain…
          </span>
        )}
      </section>

      <section className="drawer-section drawer-reference-links">
        <span className="section-label">Reference &amp; Essay</span>
        <div className="drawer-ref-buttons">
          <button
            type="button"
            className="btn-secondary"
            onClick={onOpenGuide}
          >
            <BookOpen size={14} />
            <span>Dendrochronology Guide</span>
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={onOpenColophon}
          >
            <Info size={14} />
            <span>Colophon &amp; Statement</span>
          </button>
        </div>
      </section>
    </div>
  );
};

export interface RetrospectiveScenariosPanelProps {
  activePresetId: string | null;
  onSelectPreset: (preset: RetrospectivePreset) => void;
}

export const RetrospectiveScenariosPanel: React.FC<
  RetrospectiveScenariosPanelProps
> = ({ activePresetId, onSelectPreset }) => {
  return (
    <section className="drawer-section">
      <div className="section-label-row">
        <span className="section-label">
          <Sparkles size={13} /> Retrospective Scenarios
        </span>
        <span className="preset-count-indicator">4 Curated Presets</span>
      </div>
      <div className="retrospective-presets-grid">
        {RETROSPECTIVE_PRESETS.map((preset) => {
          const isSelected = activePresetId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              className={`scenario-card ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelectPreset(preset)}
              title={`${preset.name}: ${preset.description}`}
            >
              <div className="scenario-card-header">
                <span className="scenario-name">{preset.name}</span>
                <span className="scenario-era-badge">{preset.eraLabel}</span>
              </div>
              <span className="scenario-species-meta">
                {preset.species === 'bristlecone-pine'
                  ? 'Great Basin Bristlecone Pine'
                  : preset.species === 'ponderosa-pine'
                  ? 'Ponderosa Pine'
                  : 'Douglas-Fir'}
              </span>
              <p className="scenario-blurb">{preset.subtitle}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
};

export interface StyleAndLayersPanelProps {
  selectedPalette: PaletteId;
  onSelectPalette: (palette: PaletteId) => void;
  enableWoodGrain: boolean;
  onToggleWoodGrain: (checked: boolean) => void;
  renderOptions: Omit<SvgRenderOptions, 'unitSystem'>;
  onChangeRenderOptions: (
    updater: (
      prev: Omit<SvgRenderOptions, 'unitSystem'>
    ) => Omit<SvgRenderOptions, 'unitSystem'>
  ) => void;
  unitSystem: UnitSystem;
  onChangeUnitSystem: (u: UnitSystem) => void;
}

const PALETTE_OPTIONS: {
  id: PaletteId;
  name: string;
  subtitle: string;
  swatches: string[];
}[] = [
  {
    id: 'aged-wood',
    name: 'Aged Heartwood',
    subtitle: 'Natural Sapwood & Umber Rings',
    swatches: ['#ebdcc7', '#7b4822', '#a65d2a', '#423226'],
  },
  {
    id: 'charred-subalpine',
    name: 'Charred Sub-Alpine',
    subtitle: 'Ash-Gray, Soot & Basalt Char',
    swatches: ['#c4c2be', '#2c2b29', '#575550', '#1a1918'],
  },
  {
    id: 'skeleton-plot',
    name: 'Skeleton Plot',
    subtitle: 'High-Contrast Archival Ledger',
    swatches: ['#fdfcf7', '#111111', '#c82828', '#222222'],
  },
];

export const StyleAndLayersPanel: React.FC<StyleAndLayersPanelProps> = ({
  selectedPalette,
  onSelectPalette,
  enableWoodGrain,
  onToggleWoodGrain,
  renderOptions,
  onChangeRenderOptions,
  unitSystem,
  onChangeUnitSystem,
}) => {
  return (
    <div className="drawer-panel-stack">
      <section className="drawer-section palette-section">
        <div className="section-label-row">
          <span className="section-label">
            <Sparkles size={13} /> Color Profile &amp; Grain
          </span>
          <span className="palette-count-indicator">3 Archival Profiles</span>
        </div>
        <div className="palette-cards-grid">
          {PALETTE_OPTIONS.map((p) => {
            const isSelected = selectedPalette === p.id;
            return (
              <button
                key={p.id}
                type="button"
                className={`palette-card ${isSelected ? 'selected' : ''}`}
                onClick={() => onSelectPalette(p.id)}
                title={`${p.name} — ${p.subtitle}`}
              >
                <div className="palette-swatch-row">
                  {p.swatches.map((color, idx) => (
                    <span
                      key={idx}
                      className="palette-swatch-dot"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="palette-card-body">
                  <span className="palette-card-name">{p.name}</span>
                  <span className="palette-card-desc">{p.subtitle}</span>
                </div>
              </button>
            );
          })}
        </div>

        <label className="checkbox-row grain-toggle">
          <input
            type="checkbox"
            checked={enableWoodGrain}
            onChange={(e) => onToggleWoodGrain(e.target.checked)}
          />
          <span>End-Grain Micro-Texture (Tracheid Pores)</span>
        </label>
      </section>

      <section className="drawer-section">
        <span className="section-label">
          <Sliders size={13} /> Anatomical Layers
        </span>
        <div className="toggles-grid">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={renderOptions.showBark}
              onChange={(e) =>
                onChangeRenderOptions((o) => ({
                  ...o,
                  showBark: e.target.checked,
                }))
              }
            />
            <span>Bark Rhytidome &amp; Periderm</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={renderOptions.showMedullaryRays}
              onChange={(e) =>
                onChangeRenderOptions((o) => ({
                  ...o,
                  showMedullaryRays: e.target.checked,
                }))
              }
            />
            <span>Medullary Rays (Xylem Parenchyma)</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={renderOptions.showAnnotations}
              onChange={(e) =>
                onChangeRenderOptions((o) => ({
                  ...o,
                  showAnnotations: e.target.checked,
                }))
              }
            />
            <span>Scale Bar &amp; Azimuth</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={renderOptions.showLocatorMap ?? true}
              onChange={(e) =>
                onChangeRenderOptions((o) => ({
                  ...o,
                  showLocatorMap: e.target.checked,
                }))
              }
            />
            <span>Range &amp; Provenance Map</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={renderOptions.transparentBackground}
              onChange={(e) =>
                onChangeRenderOptions((o) => ({
                  ...o,
                  transparentBackground: e.target.checked,
                }))
              }
            />
            <span>Transparent Background</span>
          </label>
        </div>
      </section>

      <section className="drawer-section">
        <div className="section-label-row">
          <span className="section-label">Units of Measure</span>
          <div
            className="unit-segmented"
            role="group"
            aria-label="Units of measure"
          >
            <button
              type="button"
              className={unitSystem === 'us' ? 'active' : ''}
              title="US Customary units (in, ft, °F)"
              onClick={() => onChangeUnitSystem('us')}
            >
              US
            </button>
            <button
              type="button"
              className={unitSystem === 'metric' ? 'active' : ''}
              title="Metric units (mm, cm, m, °C)"
              onClick={() => onChangeUnitSystem('metric')}
            >
              Metric
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export interface ExportPanelProps {
  hasSpecimen: boolean;
  includeColophonBorder: boolean;
  onToggleColophonBorder: (checked: boolean) => void;
  copiedShareLink: boolean;
  copiedSvg: boolean;
  isExportingPng: boolean;
  onCopyShareLink: () => void;
  onCopySvg: () => void;
  onExportSvg: () => void;
  onExport4kPng: () => void;
}

export const ExportPanel: React.FC<ExportPanelProps> = ({
  hasSpecimen,
  includeColophonBorder,
  onToggleColophonBorder,
  copiedShareLink,
  copiedSvg,
  isExportingPng,
  onCopyShareLink,
  onCopySvg,
  onExportSvg,
  onExport4kPng,
}) => {
  return (
    <div className="drawer-panel-stack">
      <section className="drawer-section">
        <span className="section-label">Share Specimen</span>
        <button
          type="button"
          className="btn-secondary drawer-full-btn btn-share-link"
          onClick={onCopyShareLink}
          title="Copy shareable permalink URL to clipboard"
        >
          {copiedShareLink ? <Check size={14} /> : <Share2 size={14} />}
          <span>{copiedShareLink ? 'Link Copied!' : 'Copy Share Link'}</span>
        </button>
      </section>

      <section className="drawer-section">
        <span className="section-label">Archival Vector &amp; Print Export</span>
        <label
          className={`colophon-plate-toggle drawer-full-toggle ${includeColophonBorder ? 'active' : ''}`}
          title="Format export inside an archival museum colophon plate border with specimen metadata"
        >
          <input
            type="checkbox"
            checked={includeColophonBorder}
            onChange={(e) => onToggleColophonBorder(e.target.checked)}
          />
          <span>Include Museum Colophon Plate Border</span>
        </label>
        <p className="export-hint">
          Exports include the full North America provenance locator map and specimen caption even when tucked off-canvas.
        </p>

        <div className="drawer-export-stack">
          <button
            type="button"
            className="btn-secondary drawer-full-btn"
            onClick={onCopySvg}
            disabled={!hasSpecimen}
          >
            {copiedSvg ? <Check size={14} /> : <Copy size={14} />}
            <span>{copiedSvg ? 'Copied SVG Markup' : 'Copy SVG'}</span>
          </button>

          <button
            type="button"
            className="btn-secondary drawer-full-btn btn-export-svg"
            onClick={onExportSvg}
            disabled={!hasSpecimen}
          >
            <Download size={14} />
            <span>
              {includeColophonBorder ? 'Export Plate SVG' : 'Export SVG'}
            </span>
          </button>

          <button
            type="button"
            className="btn-primary drawer-full-btn btn-export-png"
            onClick={onExport4kPng}
            disabled={!hasSpecimen || isExportingPng}
          >
            <Download size={14} />
            <span>
              {isExportingPng
                ? 'Rendering 4K…'
                : includeColophonBorder
                ? 'Export 4K Plate (300 DPI)'
                : 'Export 4K PNG (300 DPI)'}
            </span>
          </button>
        </div>
      </section>
    </div>
  );
};

export interface ControlsDrawerProps {
  isOpen: boolean;
  activeTab: DrawerTab;
  onTabChange: (tab: DrawerTab) => void;
  onClose: () => void;
  simulation: TreeSimulationResult | null;
  story: string | null;
  viabilityDetail: string | null;
  latitude: number;
  longitude: number;
  unitSystem: UnitSystem;
  onChangeUnitSystem: (u: UnitSystem) => void;
  activePresetId: string | null;
  onSelectPreset: (preset: RetrospectivePreset) => void;
  selectedPalette: PaletteId;
  onSelectPalette: (palette: PaletteId) => void;
  enableWoodGrain: boolean;
  onToggleWoodGrain: (checked: boolean) => void;
  renderOptions: Omit<SvgRenderOptions, 'unitSystem'>;
  onChangeRenderOptions: (
    updater: (
      prev: Omit<SvgRenderOptions, 'unitSystem'>
    ) => Omit<SvgRenderOptions, 'unitSystem'>
  ) => void;
  hasSpecimen: boolean;
  includeColophonBorder: boolean;
  onToggleColophonBorder: (checked: boolean) => void;
  copiedShareLink: boolean;
  copiedSvg: boolean;
  isExportingPng: boolean;
  onCopyShareLink: () => void;
  onCopySvg: () => void;
  onExportSvg: () => void;
  onExport4kPng: () => void;
  onOpenColophon: () => void;
  onOpenGuide: () => void;
}

export const ControlsDrawer: React.FC<ControlsDrawerProps> = ({
  isOpen,
  activeTab,
  onTabChange,
  onClose,
  simulation,
  story,
  viabilityDetail,
  latitude,
  longitude,
  unitSystem,
  onChangeUnitSystem,
  activePresetId,
  onSelectPreset,
  selectedPalette,
  onSelectPalette,
  enableWoodGrain,
  onToggleWoodGrain,
  renderOptions,
  onChangeRenderOptions,
  hasSpecimen,
  includeColophonBorder,
  onToggleColophonBorder,
  copiedShareLink,
  copiedSvg,
  isExportingPng,
  onCopyShareLink,
  onCopySvg,
  onExportSvg,
  onExport4kPng,
  onOpenColophon,
  onOpenGuide,
}) => {
  if (!isOpen) return null;

  return (
    <aside
      className="controls-drawer"
      role="dialog"
      aria-modal="false"
      aria-label="Specimen Controls and Ecological Ledger"
    >
      <div className="controls-drawer-header">
        <div className="drawer-tabs" role="tablist" aria-label="Control sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'ledger'}
            className={`drawer-tab-btn ${activeTab === 'ledger' ? 'active' : ''}`}
            onClick={() => onTabChange('ledger')}
          >
            Ledger
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'style'}
            className={`drawer-tab-btn ${activeTab === 'style' ? 'active' : ''}`}
            onClick={() => onTabChange('style')}
          >
            Style &amp; Presets
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'export'}
            className={`drawer-tab-btn ${activeTab === 'export' ? 'active' : ''}`}
            onClick={() => onTabChange('export')}
          >
            Export
          </button>
        </div>

        <button
          type="button"
          className="drawer-close-btn"
          onClick={onClose}
          aria-label="Close controls drawer"
          title="Close (Esc)"
        >
          <X size={16} />
        </button>
      </div>

      <div className="controls-drawer-body">
        {activeTab === 'ledger' && (
          <LedgerTelemetryPanel
            simulation={simulation}
            story={story}
            viabilityDetail={viabilityDetail}
            latitude={latitude}
            longitude={longitude}
            unitSystem={unitSystem}
            onOpenColophon={onOpenColophon}
            onOpenGuide={onOpenGuide}
          />
        )}

        {activeTab === 'style' && (
          <div className="drawer-panel-stack">
            <RetrospectiveScenariosPanel
              activePresetId={activePresetId}
              onSelectPreset={onSelectPreset}
            />
            <StyleAndLayersPanel
              selectedPalette={selectedPalette}
              onSelectPalette={onSelectPalette}
              enableWoodGrain={enableWoodGrain}
              onToggleWoodGrain={onToggleWoodGrain}
              renderOptions={renderOptions}
              onChangeRenderOptions={onChangeRenderOptions}
              unitSystem={unitSystem}
              onChangeUnitSystem={onChangeUnitSystem}
            />
          </div>
        )}

        {activeTab === 'export' && (
          <ExportPanel
            hasSpecimen={hasSpecimen}
            includeColophonBorder={includeColophonBorder}
            onToggleColophonBorder={onToggleColophonBorder}
            copiedShareLink={copiedShareLink}
            copiedSvg={copiedSvg}
            isExportingPng={isExportingPng}
            onCopyShareLink={onCopyShareLink}
            onCopySvg={onCopySvg}
            onExportSvg={onExportSvg}
            onExport4kPng={onExport4kPng}
          />
        )}
      </div>
    </aside>
  );
};
