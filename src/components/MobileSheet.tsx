import React from 'react';
import { ChevronUp, MapPin, Pencil, X } from 'lucide-react';
import { PaletteDefinition } from '../model/palettes';
import { PaletteId } from '../model/permalink';
import { RetrospectivePreset } from '../model/presets';
import { SPECIES_PROFILES } from '../model/species';
import { SvgRenderOptions } from '../model/svgGenerator';
import { AnnualRingRecord, SpeciesId, TreeSimulationResult } from '../model/types';
import { UnitSystem } from '../model/units';
import {
  ExportPanel,
  LedgerTelemetryPanel,
  RetrospectiveScenariosPanel,
  StyleAndLayersPanel,
} from './ControlsDrawer';
import { LocatorMapWidget } from './LocatorMapWidget';
import { RingChronologyChart } from './RingChronologyChart';
import {
  ChronologyEditorPanel,
  LocationPickerPanel,
  SpeciesSelectorPanel,
} from './SpecimenHud';
import { TimeNavigation, TimeNavMode } from './TimeNavigation';

export type MobileSheetTab = 'specimen' | 'info' | 'timeline' | 'style';

export interface MobileSheetProps {
  isOpen: boolean;
  activeTab: MobileSheetTab;
  onOpen: () => void;
  onClose: () => void;
  onTabChange: (tab: MobileSheetTab) => void;
  species: SpeciesId;
  onSelectSpecies: (sp: SpeciesId) => void;
  latitude: number;
  longitude: number;
  latInput: string;
  lonInput: string;
  onLatInputChange: (val: string) => void;
  onLonInputChange: (val: string) => void;
  onCommitCoords: () => void;
  onSelectMapLocation: (lat: number, lon: number) => void;
  onSelectReferenceSite: (
    lat: number,
    lon: number,
    recommendedSpecies: SpeciesId
  ) => void;
  totalAge: number;
  overrideDeathYear: boolean;
  customDeathYear: number;
  currentCalendarYear: number;
  effectiveDeathYear: number;
  onAgeChange: (age: number) => void;
  onToggleOverrideDeathYear: (checked: boolean) => void;
  onCustomDeathYearChange: (year: number) => void;
  activePresetId: string | null;
  onSelectPreset: (preset: RetrospectivePreset) => void;
  simulation: TreeSimulationResult | null;
  story: string | null;
  viabilityDetail: string | null;
  unitSystem: UnitSystem;
  onChangeUnitSystem: (u: UnitSystem) => void;
  activePalette: PaletteDefinition;
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
  navMode: TimeNavMode;
  onModeChange: (mode: TimeNavMode) => void;
  activeRingIndex: number;
  onRingChange: (idx: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  playbackSpeed: number;
  onSpeedChange: (spd: number) => void;
  ringRecords: AnnualRingRecord[];
  ringsByIndex: Map<number, AnnualRingRecord>;
  hoveredRing: number | null;
  onHoverRing: (idx: number | null) => void;
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

export const MobileSheet: React.FC<MobileSheetProps> = ({
  isOpen,
  activeTab,
  onOpen,
  onClose,
  onTabChange,
  species,
  onSelectSpecies,
  latitude,
  longitude,
  latInput,
  lonInput,
  onLatInputChange,
  onLonInputChange,
  onCommitCoords,
  onSelectMapLocation,
  onSelectReferenceSite,
  totalAge,
  overrideDeathYear,
  customDeathYear,
  currentCalendarYear,
  effectiveDeathYear,
  onAgeChange,
  onToggleOverrideDeathYear,
  onCustomDeathYearChange,
  activePresetId,
  onSelectPreset,
  simulation,
  story,
  viabilityDetail,
  unitSystem,
  onChangeUnitSystem,
  activePalette,
  selectedPalette,
  onSelectPalette,
  enableWoodGrain,
  onToggleWoodGrain,
  renderOptions,
  onChangeRenderOptions,
  navMode,
  onModeChange,
  activeRingIndex,
  onRingChange,
  isPlaying,
  onTogglePlay,
  playbackSpeed,
  onSpeedChange,
  ringRecords,
  ringsByIndex,
  hoveredRing,
  onHoverRing,
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
  const activeProfile = SPECIES_PROFILES[species];
  const coordDisplay = `${Math.abs(latitude).toFixed(2)}°${latitude >= 0 ? 'N' : 'S'}, ${Math.abs(longitude).toFixed(2)}°${longitude >= 0 ? 'E' : 'W'}`;

  return (
    <div className="mobile-sheet-root">
      {!isOpen && (
        <button
          type="button"
          className="mobile-bottom-tab"
          onClick={onOpen}
          aria-expanded={false}
          aria-label="Open specimen info and controls"
        >
          <ChevronUp size={15} aria-hidden="true" />
          <span className="mobile-tab-title">Info &amp; Controls</span>
          <span className="mobile-tab-meta">
            {activeProfile.commonName} · {totalAge}y
          </span>
        </button>
      )}

      {isOpen && (
        <div className="mobile-sheet-overlay">
          <div
            className="mobile-sheet-backdrop"
            onClick={onClose}
            aria-hidden="true"
          />
          <section
            className="mobile-sheet-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Specimen info and controls"
          >
            <div className="mobile-sheet-handle-bar">
              <div className="mobile-sheet-grabber" aria-hidden="true" />
              <div className="mobile-sheet-title-row">
                <span className="mobile-sheet-title">
                  {activeProfile.commonName} · {totalAge} yrs
                </span>
                <button
                  type="button"
                  className="mobile-sheet-close-btn"
                  onClick={onClose}
                  aria-label="Close controls sheet"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div
              className="mobile-sheet-tabs"
              role="tablist"
              aria-label="Mobile specimen sections"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'specimen'}
                className={`mobile-sheet-tab-btn ${activeTab === 'specimen' ? 'active' : ''}`}
                onClick={() => onTabChange('specimen')}
              >
                Specimen
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'info'}
                className={`mobile-sheet-tab-btn ${activeTab === 'info' ? 'active' : ''}`}
                onClick={() => onTabChange('info')}
              >
                Info
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'timeline'}
                className={`mobile-sheet-tab-btn ${activeTab === 'timeline' ? 'active' : ''}`}
                onClick={() => onTabChange('timeline')}
              >
                Timeline
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'style'}
                className={`mobile-sheet-tab-btn ${activeTab === 'style' ? 'active' : ''}`}
                onClick={() => onTabChange('style')}
              >
                Style &amp; Export
              </button>
            </div>

            <div className="mobile-sheet-body">
              {activeTab === 'specimen' && (
                <div className="drawer-panel-stack">
                  <section className="drawer-section">
                    <span className="section-label">1. Species</span>
                    <SpeciesSelectorPanel
                      species={species}
                      onSelectSpecies={onSelectSpecies}
                    />
                  </section>

                  <section className="drawer-section">
                    <span className="section-label">
                      <MapPin size={13} /> 2. Geographic Provenance
                    </span>
                    <LocationPickerPanel
                      latitude={latitude}
                      longitude={longitude}
                      latInput={latInput}
                      lonInput={lonInput}
                      unitSystem={unitSystem}
                      mapHeight={200}
                      onLatInputChange={onLatInputChange}
                      onLonInputChange={onLonInputChange}
                      onCommitCoords={onCommitCoords}
                      onSelectMapLocation={onSelectMapLocation}
                      onSelectReferenceSite={onSelectReferenceSite}
                    />
                  </section>

                  <section className="drawer-section">
                    <span className="section-label">3. Chronological Span</span>
                    <ChronologyEditorPanel
                      totalAge={totalAge}
                      overrideDeathYear={overrideDeathYear}
                      customDeathYear={customDeathYear}
                      currentCalendarYear={currentCalendarYear}
                      effectiveDeathYear={effectiveDeathYear}
                      unitSystem={unitSystem}
                      simulation={simulation}
                      onAgeChange={onAgeChange}
                      onToggleOverrideDeathYear={onToggleOverrideDeathYear}
                      onCustomDeathYearChange={onCustomDeathYearChange}
                    />
                  </section>

                  <RetrospectiveScenariosPanel
                    activePresetId={activePresetId}
                    onSelectPreset={onSelectPreset}
                  />
                </div>
              )}

              {activeTab === 'info' && (
                <div className="drawer-panel-stack">
                  <section className="drawer-section mobile-info-map-row">
                    <LocatorMapWidget
                      species={species}
                      latitude={latitude}
                      longitude={longitude}
                      paletteBackground={activePalette.background}
                      annotationColor={activePalette.annotationColor}
                      transparentBackground={renderOptions.transparentBackground}
                      compact
                    />
                    <div className="mobile-info-map-meta">
                      <span className="hud-field-label">Provenance &amp; Range</span>
                      <span className="hud-field-primary">
                        {activeProfile.commonName}
                      </span>
                      <span className="hud-field-secondary mono">
                        {coordDisplay}
                      </span>
                      <button
                        type="button"
                        className="btn-secondary mobile-edit-loc-btn"
                        onClick={() => onTabChange('specimen')}
                      >
                        <Pencil size={12} />
                        <span>Edit Specimen</span>
                      </button>
                    </div>
                  </section>

                  <LedgerTelemetryPanel
                    simulation={simulation}
                    story={story}
                    viabilityDetail={viabilityDetail}
                    latitude={latitude}
                    longitude={longitude}
                    unitSystem={unitSystem}
                    onOpenColophon={() => {
                      onClose();
                      onOpenColophon();
                    }}
                    onOpenGuide={() => {
                      onClose();
                      onOpenGuide();
                    }}
                  />
                </div>
              )}

              {activeTab === 'timeline' && simulation && (
                <div className="drawer-panel-stack">
                  <TimeNavigation
                    mode={navMode}
                    onModeChange={onModeChange}
                    totalRings={simulation.visibleRingCount}
                    activeRingIndex={activeRingIndex}
                    onRingChange={onRingChange}
                    firstYear={simulation.firstRingYear}
                    deathYear={effectiveDeathYear}
                    isPlaying={isPlaying}
                    onTogglePlay={onTogglePlay}
                    playbackSpeed={playbackSpeed}
                    onSpeedChange={onSpeedChange}
                    activeRecord={ringsByIndex.get(activeRingIndex)}
                  />
                  <RingChronologyChart
                    records={ringRecords}
                    hoveredRing={hoveredRing}
                    unitSystem={unitSystem}
                    latitude={latitude}
                    longitude={longitude}
                    onHoverRing={onHoverRing}
                  />
                </div>
              )}

              {activeTab === 'style' && (
                <div className="drawer-panel-stack">
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
                  <ExportPanel
                    hasSpecimen={Boolean(simulation)}
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
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
