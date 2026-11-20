import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, MapPin, Pencil, Search, X } from 'lucide-react';
import { SpecimenHighlight } from '../model/narrative';
import { PaletteDefinition } from '../model/palettes';
import { RETROSPECTIVE_PRESETS } from '../model/presets';
import { LOCATION_PRESETS, SPECIES_PROFILES } from '../model/species';
import { SpeciesId, TreeSimulationResult } from '../model/types';
import { formatElevation, formatStumpHeightShort, UnitSystem } from '../model/units';
import { PlaceSearchResult, searchPlaces } from '../services/geocodingApi';
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
  onSelectPlace?: (
    lat: number,
    lon: number,
    displayLabel: string,
    recommendedSpecies?: SpeciesId
  ) => void;
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
  onSelectPlace,
}) => {
  const [placeQuery, setPlaceQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearchedEmpty, setHasSearchedEmpty] = useState(false);

  useEffect(() => {
    const trimmed = placeQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      setHasSearchedEmpty(false);
      return;
    }

    const controller = new AbortController();
    setIsSearching(true);
    setHasSearchedEmpty(false);

    const timer = window.setTimeout(() => {
      searchPlaces(trimmed, controller.signal)
        .then((results) => {
          if (controller.signal.aborted) return;
          setSearchResults(results);
          setHasSearchedEmpty(results.length === 0);
          setIsSearching(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setSearchResults([]);
            setIsSearching(false);
          }
        });
    }, 260);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [placeQuery]);

  const handleChooseResult = (res: PlaceSearchResult) => {
    if (onSelectPlace) {
      onSelectPlace(res.latitude, res.longitude, res.displayLabel, res.recommendedSpecies);
    } else if (res.recommendedSpecies) {
      onSelectReferenceSite(res.latitude, res.longitude, res.recommendedSpecies);
    } else {
      onSelectMapLocation(res.latitude, res.longitude);
    }
    setPlaceQuery('');
    setSearchResults([]);
    setHasSearchedEmpty(false);
  };

  const handleSearchKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (searchResults.length > 0) {
      handleChooseResult(searchResults[0]);
      return;
    }
    const trimmed = placeQuery.trim();
    if (trimmed.length < 2) return;
    setIsSearching(true);
    const immediate = await searchPlaces(trimmed);
    setIsSearching(false);
    if (immediate.length > 0) {
      handleChooseResult(immediate[0]);
    } else {
      setSearchResults([]);
      setHasSearchedEmpty(true);
    }
  };

  return (
    <div className="editor-panel-body">
      <div className="place-search-wrap">
        <div className="place-search-input-row">
          <Search size={13} className="place-search-icon" aria-hidden="true" />
          <input
            id="place-search-input"
            type="text"
            className="place-search-input"
            placeholder="Search town, peak, or forest (e.g. Bend, OR)..."
            aria-label="Search place name"
            value={placeQuery}
            onChange={(e) => setPlaceQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          {placeQuery && (
            <button
              type="button"
              className="place-search-clear-btn"
              aria-label="Clear place search"
              onClick={() => {
                setPlaceQuery('');
                setSearchResults([]);
                setHasSearchedEmpty(false);
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>

        {(isSearching || searchResults.length > 0 || hasSearchedEmpty) && (
          <div className="place-search-dropdown" role="listbox" aria-label="Matching places">
            {isSearching && searchResults.length === 0 && (
              <div className="place-search-status">Searching places…</div>
            )}
            {searchResults.map((res) => (
              <button
                key={res.id}
                type="button"
                role="option"
                aria-selected={false}
                className="place-search-item"
                onClick={() => handleChooseResult(res)}
              >
                <span className="place-search-name">{res.name}</span>
                <span className="place-search-meta">
                  {res.subtitle}
                  {res.elevationM !== undefined && ` · ${formatElevation(res.elevationM, unitSystem)}`}
                </span>
              </button>
            ))}
            {!isSearching && hasSearchedEmpty && (
              <div className="place-search-status">
                No matching places found — click the map or enter coordinates.
              </div>
            )}
          </div>
        )}
      </div>

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
  const [ageDraft, setAgeDraft] = useState<string>(String(totalAge));

  useEffect(() => {
    setAgeDraft(String(totalAge));
  }, [totalAge]);

  const commitAgeDraft = () => {
    const parsed = parseInt(ageDraft, 10);
    if (Number.isNaN(parsed)) {
      setAgeDraft(String(totalAge));
      return;
    }
    const clamped = Math.max(5, Math.min(400, parsed));
    setAgeDraft(String(clamped));
    if (clamped !== totalAge) {
      onAgeChange(clamped);
    }
  };

  return (
    <div className="editor-panel-body age-section">
      <div className="section-label-row">
        <label className="section-label" htmlFor="age-slider">
          Chronological Span: {totalAge} Years
        </label>
        <div className="age-number-wrap">
          <input
            id="age-number-input"
            type="number"
            min={5}
            max={400}
            value={ageDraft}
            onChange={(e) => {
              const raw = e.target.value;
              setAgeDraft(raw);
              const parsed = parseInt(raw, 10);
              if (!Number.isNaN(parsed) && parsed >= 5 && parsed <= 400) {
                onAgeChange(parsed);
              }
            }}
            onBlur={commitAgeDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitAgeDraft();
              }
            }}
          />
          <span>yrs</span>
        </div>
      </div>

      <input
        id="age-slider"
        className="mono-slider"
        type="range"
        min={5}
        max={400}
        value={Math.max(5, Math.min(400, totalAge))}
        onChange={(e) => onAgeChange(Number(e.target.value))}
      />

      {simulation && (
        <div className="age-narrative-subtext">
          Germinated {simulation.germinationYear} •{' '}
          {formatStumpHeightShort(simulation.stumpHeightM, unitSystem)} stump plane:{' '}
          {simulation.firstRingYear}–
          {simulation.rings[simulation.rings.length - 1]?.record.calendarYear ?? effectiveDeathYear} ({simulation.visibleRingCount} visible rings, +
          {simulation.yearsToStumpHeight} seedling yrs)
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
  customPlaceLabel?: string | null;
  specimenLede?: string | null;
  highlights?: SpecimenHighlight[];
  activeRingIndex?: number | null;
  pinnedRing?: number | null;
  onJumpToLandmark?: (ringIndex: number | null) => void;
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
  onSelectPlace?: (
    lat: number,
    lon: number,
    displayLabel: string,
    recommendedSpecies?: SpeciesId
  ) => void;
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
  customPlaceLabel,
  specimenLede,
  highlights,
  activeRingIndex,
  pinnedRing,
  onJumpToLandmark,
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
  onSelectPlace,
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
    if (customPlaceLabel) return customPlaceLabel;
    return 'Field Coordinates';
  }, [activePresetId, latitude, longitude, customPlaceLabel]);

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

        {specimenLede && (
          <div className="hud-specimen-summary">
            <p className="hud-specimen-lede">{specimenLede}</p>
            {highlights && highlights.length > 0 && onJumpToLandmark && (
              <div
                className="hud-landmark-chips"
                role="group"
                aria-label="Inspect milestone rings"
              >
                {highlights.slice(0, 4).map((h) => {
                  const isActive = pinnedRing === h.ringIndex;
                  return (
                    <button
                      key={h.id}
                      type="button"
                      className={`landmark-jump-chip type-${h.type} ${isActive ? 'active' : ''}`}
                      title={`${h.description} Click to highlight ${h.year} CE on cross-section.`}
                      aria-pressed={isActive}
                      onClick={() => onJumpToLandmark(h.ringIndex)}
                    >
                      {h.chipLabel}
                    </button>
                  );
                })}
                {activeRingIndex !== null && activeRingIndex !== undefined ? (
                  <button
                    type="button"
                    className="landmark-jump-chip reset"
                    title="Return to full cross-section with outer bark"
                    onClick={() => onJumpToLandmark(null)}
                  >
                    Full Tree
                  </button>
                ) : (
                  pinnedRing !== null &&
                  pinnedRing !== undefined && (
                    <button
                      type="button"
                      className="landmark-jump-chip reset"
                      title="Clear highlighted ring focus"
                      onClick={() => onJumpToLandmark(null)}
                    >
                      Clear
                    </button>
                  )
                )}
              </div>
            )}
            <p className="hud-provenance-note">
              Real 1200–2026 climate &amp; terrain; tree &amp; fire years are simulated.
            </p>
          </div>
        )}

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
                onSelectPlace={onSelectPlace}
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
