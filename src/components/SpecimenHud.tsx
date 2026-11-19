import React, { useEffect, useMemo, useRef } from 'react';
import { AlertTriangle, MapPin, Pencil, X } from 'lucide-react';
import { PaletteDefinition } from '../model/palettes';
import { RETROSPECTIVE_PRESETS } from '../model/presets';
import { LOCATION_PRESETS, SPECIES_PROFILES } from '../model/species';
import { SpeciesId, TreeSimulationResult } from '../model/types';
import { formatStumpHeightShort, UnitSystem } from '../model/units';
import { LocatorMapWidget } from './LocatorMapWidget';
import { MonochromeMapPicker } from './MonochromeMapPicker';

export type ActiveEditorKey = 'location' | 'species' | 'age' | null;

export interface SpeciesSelectorPanelProps {
  species: SpeciesId;
  onSelectSpecies: (sp: SpeciesId) => void;
}

export const SpeciesSelectorPanel: React.FC<SpeciesSelectorPanelProps> = ({
  species,
  onSelectSpecies,
}) => {
  const activeProfile = SPECIES_PROFILES[species];
  return (
    <div className="editor-panel-body">
      <div className="species-toggle-grid">
        {(['douglas-fir', 'ponderosa-pine', 'bristlecone-pine'] as SpeciesId[]).map(
          (spId) => {
            const prof = SPECIES_PROFILES[spId];
            const selected = species === spId;
            return (
              <button
                key={spId}
                type="button"
                className={`species-card ${selected ? 'selected' : ''}`}
                onClick={() => onSelectSpecies(spId)}
              >
                <span className="species-common">{prof.commonName}</span>
                <span className="species-sci">{prof.scientificName}</span>
              </button>
            );
          }
        )}
      </div>
      <p className="species-note">{activeProfile.tagline}</p>
    </div>
  );
};

export interface LocationPickerPanelProps {
  latitude: number;
  longitude: number;
  latInput: string;
  lonInput: string;
  unitSystem: UnitSystem;
  mapHeight?: number;
  onLatInputChange: (val: string) => void;
  onLonInputChange: (val: string) => void;
  onCommitCoords: () => void;
  onSelectMapLocation: (lat: number, lon: number) => void;
  onSelectReferenceSite: (lat: number, lon: number, recommendedSpecies: SpeciesId) => void;
}

export const LocationPickerPanel: React.FC<LocationPickerPanelProps> = ({
  latitude,
  longitude,
  latInput,
  lonInput,
  unitSystem,
  mapHeight = 230,
  onLatInputChange,
  onLonInputChange,
  onCommitCoords,
  onSelectMapLocation,
  onSelectReferenceSite,
}) => {
  return (
    <div className="editor-panel-body">
      <MonochromeMapPicker
        latitude={latitude}
        longitude={longitude}
        unitSystem={unitSystem}
        height={mapHeight}
        onSelectLocation={onSelectMapLocation}
      />

      <div className="coord-inputs-grid">
        <div className="field-group">
          <label htmlFor="lat-input">Latitude (°N)</label>
          <input
            id="lat-input"
            type="text"
            placeholder="e.g. 44.2124"
            value={latInput}
            onChange={(e) => onLatInputChange(e.target.value)}
            onBlur={onCommitCoords}
            onKeyDown={(e) => e.key === 'Enter' && onCommitCoords()}
          />
        </div>
        <div className="field-group">
          <label htmlFor="lon-input">Longitude (°W negative)</label>
          <input
            id="lon-input"
            type="text"
            placeholder="e.g. -122.2557"
            value={lonInput}
            onChange={(e) => onLonInputChange(e.target.value)}
            onBlur={onCommitCoords}
            onKeyDown={(e) => e.key === 'Enter' && onCommitCoords()}
          />
        </div>
      </div>

      <div className="preset-block">
        <span className="preset-heading">Geographic Reference Sites:</span>
        <div className="preset-chips">
          {LOCATION_PRESETS.map((preset) => {
            const isMatch =
              Math.abs(preset.latitude - latitude) < 0.002 &&
              Math.abs(preset.longitude - longitude) < 0.002;
            return (
              <button
                key={preset.name}
                type="button"
                className={`preset-chip ${isMatch ? 'active' : ''}`}
                title={`${preset.region} — ${preset.note}`}
                onClick={() =>
                  onSelectReferenceSite(
                    preset.latitude,
                    preset.longitude,
                    preset.recommendedSpecies
                  )
                }
              >
                {preset.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export interface ChronologyEditorPanelProps {
  totalAge: number;
  overrideDeathYear: boolean;
  customDeathYear: number;
  currentCalendarYear: number;
  effectiveDeathYear: number;
  unitSystem: UnitSystem;
  simulation: TreeSimulationResult | null;
  onAgeChange: (age: number) => void;
  onToggleOverrideDeathYear: (checked: boolean) => void;
  onCustomDeathYearChange: (year: number) => void;
}

export const ChronologyEditorPanel: React.FC<ChronologyEditorPanelProps> = ({
  totalAge,
  overrideDeathYear,
  customDeathYear,
  currentCalendarYear,
  effectiveDeathYear,
  unitSystem,
  simulation,
  onAgeChange,
  onToggleOverrideDeathYear,
  onCustomDeathYearChange,
}) => {
  return (
    <div className="editor-panel-body age-section">
      <div className="section-label-row">
        <label className="section-label" htmlFor="age-slider">
          Chronological Span: {totalAge} Years
        </label>
        <div className="age-number-wrap">
          <input
            type="number"
            min={5}
            max={400}
            value={totalAge}
            onChange={(e) =>
              onAgeChange(Math.max(5, Math.min(400, Number(e.target.value) || 5)))
            }
          />
          <span>yrs</span>
        </div>
      </div>

      <input
        id="age-slider"
        className="mono-slider"
        type="range"
        min={5}
        max={350}
        value={Math.min(350, totalAge)}
        onChange={(e) => onAgeChange(Number(e.target.value))}
      />

      {simulation && (
        <div className="age-narrative-subtext">
          Germinated {simulation.germinationYear} • First ring at{' '}
          {formatStumpHeightShort(simulation.stumpHeightM, unitSystem)} sampling plane:{' '}
          {simulation.firstRingYear} ({simulation.visibleRingCount} visible rings) • Outer cambium:{' '}
          {effectiveDeathYear}
        </div>
      )}

      <div className="death-year-row">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={overrideDeathYear}
            onChange={(e) => onToggleOverrideDeathYear(e.target.checked)}
          />
          <span>Terminal Cambium Horizon (Default: {currentCalendarYear} CE)</span>
        </label>

        {overrideDeathYear && (
          <div className="death-year-input-wrap">
            <label htmlFor="death-year-input">Cambium Horizon:</label>
            <input
              id="death-year-input"
              type="number"
              min={1600}
              max={currentCalendarYear}
              value={customDeathYear}
              onChange={(e) =>
                onCustomDeathYearChange(
                  Math.max(
                    1600,
                    Math.min(
                      currentCalendarYear,
                      Number(e.target.value) || currentCalendarYear
                    )
                  )
                )
              }
            />
          </div>
        )}
      </div>
    </div>
  );
};

export interface SpecimenHudProps {
  brandHeader: React.ReactNode;
  species: SpeciesId;
  latitude: number;
  longitude: number;
  latInput: string;
  lonInput: string;
  totalAge: number;
  overrideDeathYear: boolean;
  customDeathYear: number;
  currentCalendarYear: number;
  effectiveDeathYear: number;
  unitSystem: UnitSystem;
  simulation: TreeSimulationResult | null;
  viabilityDetail: string | null;
  activePresetId: string | null;
  activePalette: PaletteDefinition;
  showLocatorMap: boolean;
  transparentBackground: boolean;
  activeEditor: ActiveEditorKey;
  onToggleEditor: (editor: Exclude<ActiveEditorKey, null>) => void;
  onCloseEditor: () => void;
  onSelectSpecies: (sp: SpeciesId) => void;
  onLatInputChange: (val: string) => void;
  onLonInputChange: (val: string) => void;
  onCommitCoords: () => void;
  onSelectMapLocation: (lat: number, lon: number) => void;
  onSelectReferenceSite: (lat: number, lon: number, recommendedSpecies: SpeciesId) => void;
  onAgeChange: (age: number) => void;
  onToggleOverrideDeathYear: (checked: boolean) => void;
  onCustomDeathYearChange: (year: number) => void;
}

export const SpecimenHud: React.FC<SpecimenHudProps> = ({
  brandHeader,
  species,
  latitude,
  longitude,
  latInput,
  lonInput,
  totalAge,
  overrideDeathYear,
  customDeathYear,
  currentCalendarYear,
  effectiveDeathYear,
  unitSystem,
  simulation,
  viabilityDetail,
  activePresetId,
  activePalette,
  showLocatorMap,
  transparentBackground,
  activeEditor,
  onToggleEditor,
  onCloseEditor,
  onSelectSpecies,
  onLatInputChange,
  onLonInputChange,
  onCommitCoords,
  onSelectMapLocation,
  onSelectReferenceSite,
  onAgeChange,
  onToggleOverrideDeathYear,
  onCustomDeathYearChange,
}) => {
  const hudRef = useRef<HTMLElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activeEditor) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (hudRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }
      onCloseEditor();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [activeEditor, onCloseEditor]);

  const activeProfile = SPECIES_PROFILES[species];
  const coordString = `${Math.abs(latitude).toFixed(4)}°${latitude >= 0 ? 'N' : 'S'}, ${Math.abs(longitude).toFixed(4)}°${longitude >= 0 ? 'E' : 'W'}`;

  const siteLabel = useMemo(() => {
    if (activePresetId) {
      const presetMatch = RETROSPECTIVE_PRESETS.find((p) => p.id === activePresetId);
      if (presetMatch) return presetMatch.coordinates.siteName;
    }
    const locMatch = LOCATION_PRESETS.find(
      (p) =>
        Math.abs(p.latitude - latitude) < 0.003 &&
        Math.abs(p.longitude - longitude) < 0.003
    );
    if (locMatch) return locMatch.name;
    const retroMatch = RETROSPECTIVE_PRESETS.find(
      (p) =>
        Math.abs(p.latitude - latitude) < 0.003 &&
        Math.abs(p.longitude - longitude) < 0.003
    );
    if (retroMatch) return retroMatch.coordinates.siteName;
    return 'Field Coordinates';
  }, [activePresetId, latitude, longitude]);

  const firstYearDisplay =
    simulation?.firstRingYear ?? effectiveDeathYear - Math.max(4, totalAge) + 1;

  const isStressed =
    simulation &&
    (simulation.viability.stressLevel === 'marginal' ||
      simulation.viability.stressLevel === 'unsuitable');

  return (
    <>
      <aside
        ref={hudRef}
        className="specimen-hud"
        aria-label="Specimen Identity and Provenance"
      >
        <div className="specimen-hud-brand">{brandHeader}</div>

        {showLocatorMap && (
          <div className="specimen-hud-map">
            <LocatorMapWidget
              species={species}
              latitude={latitude}
              longitude={longitude}
              paletteBackground={activePalette.background}
              annotationColor={activePalette.annotationColor}
              transparentBackground={transparentBackground}
              onEdit={() => onToggleEditor('location')}
              isEditing={activeEditor === 'location'}
            />
          </div>
        )}

        <div className="specimen-hud-listings">
          <button
            type="button"
            className={`hud-editable-row ${activeEditor === 'location' ? 'active' : ''}`}
            onClick={() => onToggleEditor('location')}
            aria-expanded={activeEditor === 'location'}
            title="Edit geographic location on map"
          >
            <div className="hud-editable-content">
              <span className="hud-field-label">
                <MapPin size={10} aria-hidden="true" /> Location
              </span>
              <span className="hud-field-primary">{siteLabel}</span>
              <span className="hud-field-secondary mono">{coordString}</span>
            </div>
            <span className="edit-pencil-icon" aria-hidden="true">
              <Pencil size={12} />
            </span>
          </button>

          <button
            type="button"
            className={`hud-editable-row ${activeEditor === 'species' ? 'active' : ''}`}
            onClick={() => onToggleEditor('species')}
            aria-expanded={activeEditor === 'species'}
            title="Change conifer species"
          >
            <div className="hud-editable-content">
              <span className="hud-field-label">Species</span>
              <span className="hud-field-primary">{activeProfile.commonName}</span>
              <span className="hud-field-secondary italic">
                {activeProfile.scientificName}
              </span>
            </div>
            <span className="edit-pencil-icon" aria-hidden="true">
              <Pencil size={12} />
            </span>
          </button>

          <button
            type="button"
            className={`hud-editable-row ${activeEditor === 'age' ? 'active' : ''}`}
            onClick={() => onToggleEditor('age')}
            aria-expanded={activeEditor === 'age'}
            title="Adjust chronological span and cambium year"
          >
            <div className="hud-editable-content">
              <span className="hud-field-label">Chronology</span>
              <span className="hud-field-primary">{totalAge} Years</span>
              <span className="hud-field-secondary mono">
                {firstYearDisplay}–{effectiveDeathYear} CE
              </span>
            </div>
            <span className="edit-pencil-icon" aria-hidden="true">
              <Pencil size={12} />
            </span>
          </button>
        </div>

        {isStressed && simulation && (
          <div
            className={`hud-viability-pill ${simulation.viability.stressLevel}`}
            title={viabilityDetail ?? simulation.viability.summary}
          >
            <AlertTriangle size={12} aria-hidden="true" />
            <span>{simulation.viability.summary}</span>
          </div>
        )}
      </aside>

      {activeEditor && (
        <div
          ref={popoverRef}
          className={`anchored-editor-popover editor-${activeEditor}`}
          role="dialog"
          aria-modal="false"
          aria-label={
            activeEditor === 'location'
              ? 'Edit Geographic Provenance'
              : activeEditor === 'species'
              ? 'Select Conifer Species'
              : 'Adjust Chronological Span'
          }
        >
          <div className="popover-header">
            <span className="popover-title">
              {activeEditor === 'location'
                ? 'Geographic Provenance'
                : activeEditor === 'species'
                ? 'Specimen Species'
                : 'Chronological Span'}
            </span>
            <button
              type="button"
              className="popover-close-btn"
              onClick={onCloseEditor}
              aria-label="Close editor"
              title="Close (Esc)"
            >
              <X size={15} />
            </button>
          </div>

          <div className="popover-body">
            {activeEditor === 'location' && (
              <LocationPickerPanel
                latitude={latitude}
                longitude={longitude}
                latInput={latInput}
                lonInput={lonInput}
                unitSystem={unitSystem}
                mapHeight={225}
                onLatInputChange={onLatInputChange}
                onLonInputChange={onLonInputChange}
                onCommitCoords={onCommitCoords}
                onSelectMapLocation={onSelectMapLocation}
                onSelectReferenceSite={onSelectReferenceSite}
              />
            )}

            {activeEditor === 'species' && (
              <SpeciesSelectorPanel
                species={species}
                onSelectSpecies={onSelectSpecies}
              />
            )}

            {activeEditor === 'age' && (
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
            )}
          </div>
        </div>
      )}
    </>
  );
};
