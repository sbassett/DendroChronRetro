import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download,
  Copy,
  Check,
  TreePine,
  MapPin,
  Info,
  AlertTriangle,
  Fingerprint,
  Sliders,
} from 'lucide-react';
import { MonochromeMapPicker } from './components/MonochromeMapPicker';
import { SvgViewport } from './components/SvgViewport';
import { RingChronologyChart } from './components/RingChronologyChart';
import { simulateTreeCrossSection } from './model/growthEngine';
import { LOCATION_PRESETS, SPECIES_PROFILES } from './model/species';
import {
  generateCrossSectionSvgBundle,
  SvgRenderOptions,
} from './model/svgGenerator';
import {
  AnnualRingRecord,
  EnvironmentDataset,
  SpeciesId,
  TreeSimulationResult,
} from './model/types';
import { loadEnvironmentDataset } from './services/environmentApi';
import './App.css';

function compassLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}

export const App: React.FC = () => {
  const currentCalendarYear = useMemo(() => new Date().getFullYear(), []);

  const [species, setSpecies] = useState<SpeciesId>('douglas-fir');
  const [latitude, setLatitude] = useState<number>(44.2124);
  const [longitude, setLongitude] = useState<number>(-122.2557);
  const [latInput, setLatInput] = useState<string>('44.21240');
  const [lonInput, setLonInput] = useState<string>('-122.25570');

  const [totalAge, setTotalAge] = useState<number>(65);
  const [overrideDeathYear, setOverrideDeathYear] = useState<boolean>(false);
  const [customDeathYear, setCustomDeathYear] = useState<number>(currentCalendarYear);

  const effectiveDeathYear = overrideDeathYear
    ? customDeathYear
    : currentCalendarYear;

  const [renderOptions, setRenderOptions] = useState<SvgRenderOptions>({
    showBark: true,
    showMedullaryRays: true,
    showAnnotations: true,
    transparentBackground: false,
  });

  const [envDataset, setEnvDataset] = useState<EnvironmentDataset | null>(null);
  const [loadingEnv, setLoadingEnv] = useState<boolean>(true);
  const [hoveredRing, setHoveredRing] = useState<number | null>(null);
  const [copiedSvg, setCopiedSvg] = useState<boolean>(false);

  // Sync coordinate text fields when preset or map updates numeric state
  const handleSelectLocation = useCallback((lat: number, lon: number) => {
    setLatitude(lat);
    setLongitude(lon);
    setLatInput(lat.toFixed(5));
    setLonInput(lon.toFixed(5));
  }, []);

  const commitCoordInputs = useCallback(() => {
    const parsedLat = Number(latInput);
    const parsedLon = Number(lonInput);
    if (!Number.isNaN(parsedLat) && parsedLat >= -85 && parsedLat <= 85) {
      setLatitude(Number(parsedLat.toFixed(5)));
      setLatInput(parsedLat.toFixed(5));
    } else {
      setLatInput(latitude.toFixed(5));
    }
    if (!Number.isNaN(parsedLon) && parsedLon >= -180 && parsedLon <= 180) {
      setLongitude(Number(parsedLon.toFixed(5)));
      setLonInput(parsedLon.toFixed(5));
    } else {
      setLonInput(longitude.toFixed(5));
    }
  }, [latInput, lonInput, latitude, longitude]);

  // Fetch environmental & historical climate data when location or year span changes
  useEffect(() => {
    let cancelled = false;
    const startYear = effectiveDeathYear - Math.max(4, totalAge);
    setLoadingEnv(true);

    loadEnvironmentDataset(latitude, longitude, startYear, effectiveDeathYear)
      .then((dataset) => {
        if (!cancelled) {
          setEnvDataset(dataset);
          setLoadingEnv(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadingEnv(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [latitude, longitude, totalAge, effectiveDeathYear]);

  const simulation: TreeSimulationResult | null = useMemo(() => {
    if (!envDataset) return null;
    return simulateTreeCrossSection(
      {
        species,
        latitude,
        longitude,
        totalAge,
        deathYear: effectiveDeathYear,
      },
      envDataset
    );
  }, [species, latitude, longitude, totalAge, effectiveDeathYear, envDataset]);

  const svgBundle = useMemo(() => {
    if (!simulation) return null;
    return generateCrossSectionSvgBundle(simulation, renderOptions);
  }, [simulation, renderOptions]);

  const svgMarkup = svgBundle?.svgMarkup ?? '';

  const ringsByIndex = useMemo(() => {
    const m = new Map<number, AnnualRingRecord>();
    if (!simulation) return m;
    for (const r of simulation.rings) {
      m.set(r.record.ringIndex, r.record);
    }
    return m;
  }, [simulation]);

  const ringRecords = useMemo(
    () => (simulation ? simulation.rings.map((r) => r.record) : []),
    [simulation]
  );

  const handleDownloadSvg = useCallback(() => {
    if (!simulation || !svgMarkup) return;
    const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dendrosim-${species}-${latitude.toFixed(4)}_${longitude.toFixed(4)}-age${totalAge}-${effectiveDeathYear}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [simulation, svgMarkup, species, latitude, longitude, totalAge, effectiveDeathYear]);

  const handleCopySvg = useCallback(async () => {
    if (!svgMarkup) return;
    try {
      await navigator.clipboard.writeText(svgMarkup);
      setCopiedSvg(true);
      setTimeout(() => setCopiedSvg(false), 1800);
    } catch {
      // Clipboard API may be blocked in some contexts
    }
  }, [svgMarkup]);

  const activeProfile = SPECIES_PROFILES[species];

  return (
    <div className="app-shell">
      {hoveredRing !== null && (
        <style>{`
          .svg-viewport svg path[data-ring="${hoveredRing}"][data-year] {
            stroke: #000000;
            stroke-width: 1.6px;
            vector-effect: non-scaling-stroke;
          }
        `}</style>
      )}

      {/* Left Control Sidebar */}
      <aside className="sidebar">
        <header className="brand-header">
          <div className="brand-title">
            <TreePine size={20} strokeWidth={2.2} />
            <h1>DendroSim</h1>
          </div>
          <p className="brand-subtitle">
            Deterministic Grayscale Stump Cross-Section &amp; Ring Simulator
          </p>
        </header>

        {/* 1. Species Selection */}
        <section className="control-section">
          <label className="section-label">1. Species</label>
          <div className="species-toggle-grid">
            {(['douglas-fir', 'ponderosa-pine'] as SpeciesId[]).map((spId) => {
              const prof = SPECIES_PROFILES[spId];
              const selected = species === spId;
              return (
                <button
                  key={spId}
                  type="button"
                  className={`species-card ${selected ? 'selected' : ''}`}
                  onClick={() => setSpecies(spId)}
                >
                  <span className="species-common">{prof.commonName}</span>
                  <span className="species-sci">{prof.scientificName}</span>
                </button>
              );
            })}
          </div>
          <p className="species-note">{activeProfile.tagline}</p>
        </section>

        {/* 2. Location Selection */}
        <section className="control-section">
          <div className="section-label-row">
            <label className="section-label">
              <MapPin size={13} /> 2. Location (Lat / Lon)
            </label>
          </div>

          <MonochromeMapPicker
            latitude={latitude}
            longitude={longitude}
            onSelectLocation={handleSelectLocation}
          />

          <div className="coord-inputs-grid">
            <div className="field-group">
              <label htmlFor="lat-input">Latitude (°)</label>
              <input
                id="lat-input"
                type="text"
                value={latInput}
                onChange={(e) => setLatInput(e.target.value)}
                onBlur={commitCoordInputs}
                onKeyDown={(e) => e.key === 'Enter' && commitCoordInputs()}
              />
            </div>
            <div className="field-group">
              <label htmlFor="lon-input">Longitude (°)</label>
              <input
                id="lon-input"
                type="text"
                value={lonInput}
                onChange={(e) => setLonInput(e.target.value)}
                onBlur={commitCoordInputs}
                onKeyDown={(e) => e.key === 'Enter' && commitCoordInputs()}
              />
            </div>
          </div>

          <div className="preset-block">
            <span className="preset-heading">Reference Forest Sites:</span>
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
                    onClick={() => {
                      handleSelectLocation(preset.latitude, preset.longitude);
                      setSpecies(preset.recommendedSpecies);
                    }}
                  >
                    {preset.name}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* 3. Tree Age & Death Year Override */}
        <section className="control-section">
          <div className="section-label-row">
            <label className="section-label" htmlFor="age-slider">
              3. Total Biological Age
            </label>
            <div className="age-number-wrap">
              <input
                type="number"
                min={5}
                max={400}
                value={totalAge}
                onChange={(e) =>
                  setTotalAge(
                    Math.max(5, Math.min(400, Number(e.target.value) || 5))
                  )
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
            max={300}
            value={Math.min(300, totalAge)}
            onChange={(e) => setTotalAge(Number(e.target.value))}
          />

          <div className="death-year-row">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={overrideDeathYear}
                onChange={(e) => setOverrideDeathYear(e.target.checked)}
              />
              <span>Override death / felling year (default {currentCalendarYear})</span>
            </label>

            {overrideDeathYear && (
              <div className="death-year-input-wrap">
                <label htmlFor="death-year-input">Death Year:</label>
                <input
                  id="death-year-input"
                  type="number"
                  min={1600}
                  max={currentCalendarYear}
                  value={customDeathYear}
                  onChange={(e) =>
                    setCustomDeathYear(
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

          {simulation && (
            <div className="stump-age-callout">
              <Info size={14} className="callout-icon" />
              <div>
                <strong>
                  {simulation.visibleRingCount} visible rings at{' '}
                  {simulation.stumpHeightM.toFixed(2)} m stump height
                </strong>
                <p>
                  Germinated in <strong>{simulation.germinationYear}</strong>; took{' '}
                  <strong>{simulation.yearsToStumpHeight} yrs</strong> as a seedling
                  to reach {simulation.stumpHeightM.toFixed(2)} m (1.0 ft) cut plane
                  (first ring: {simulation.firstRingYear}, outer cambium:{' '}
                  {effectiveDeathYear}).
                </p>
              </div>
            </div>
          )}
        </section>

        {/* 4. SVG Display Options */}
        <section className="control-section">
          <label className="section-label">
            <Sliders size={13} /> 4. Rendering &amp; Export Options
          </label>
          <div className="toggles-grid">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={renderOptions.showBark}
                onChange={(e) =>
                  setRenderOptions((o) => ({ ...o, showBark: e.target.checked }))
                }
              />
              <span>Simulate bark</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={renderOptions.showMedullaryRays}
                onChange={(e) =>
                  setRenderOptions((o) => ({
                    ...o,
                    showMedullaryRays: e.target.checked,
                  }))
                }
              />
              <span>Medullary rays</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={renderOptions.showAnnotations}
                onChange={(e) =>
                  setRenderOptions((o) => ({
                    ...o,
                    showAnnotations: e.target.checked,
                  }))
                }
              />
              <span>Scale &amp; compass</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={renderOptions.transparentBackground}
                onChange={(e) =>
                  setRenderOptions((o) => ({
                    ...o,
                    transparentBackground: e.target.checked,
                  }))
                }
              />
              <span>Transparent BG</span>
            </label>
          </div>
        </section>
      </aside>

      {/* Main Specimen Stage */}
      <main className="main-stage">
        {/* Top Telemetry & Export Bar */}
        <header className="top-bar">
          <div className="telemetry-strip">
            {simulation ? (
              <>
                <div className="metric-pill">
                  <span className="metric-label">Diameter (Outside Bark)</span>
                  <span className="metric-value">
                    {(simulation.diameterOutsideBarkMm / 10).toFixed(1)} cm{' '}
                    <small>
                      ({(simulation.diameterOutsideBarkMm / 25.4).toFixed(1)} in)
                    </small>
                  </span>
                </div>
                <div className="metric-pill">
                  <span className="metric-label">Wood DIB / Mean Bark</span>
                  <span className="metric-value">
                    {(simulation.diameterInsideBarkMm / 10).toFixed(1)} cm /{' '}
                    {simulation.bark.meanThicknessMm.toFixed(1)} mm
                  </span>
                </div>
                <div className="metric-pill">
                  <span className="metric-label">Terrain (90m DEM)</span>
                  <span className="metric-value">
                    {Math.round(simulation.environment.terrain.elevationM)} m ·{' '}
                    {simulation.environment.terrain.slopeDeg.toFixed(1)}°{' '}
                    {compassLabel(simulation.environment.terrain.aspectDeg)}
                  </span>
                </div>
                <div className="metric-pill">
                  <span className="metric-label">Site Climate</span>
                  <span className="metric-value">
                    {simulation.environment.meanAnnualTempC.toFixed(1)} °C ·{' '}
                    {Math.round(simulation.environment.meanAnnualPrecipMm)} mm/yr
                  </span>
                </div>
                <div
                  className="metric-pill seed-pill"
                  title={`Deterministic seed key: ${simulation.seedKey}`}
                >
                  <span className="metric-label">
                    <Fingerprint size={11} /> Location+Species Seed
                  </span>
                  <span className="metric-value mono">{simulation.seedHex}</span>
                </div>
              </>
            ) : (
              <span className="loading-text">Loading site climate &amp; terrain...</span>
            )}
          </div>

          <div className="export-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={handleCopySvg}
              disabled={!svgMarkup}
            >
              {copiedSvg ? <Check size={15} /> : <Copy size={15} />}
              <span>{copiedSvg ? 'Copied' : 'Copy SVG'}</span>
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleDownloadSvg}
              disabled={!svgMarkup}
            >
              <Download size={15} />
              <span>Export .SVG</span>
            </button>
          </div>
        </header>

        {/* Ecological Viability Banner if Marginal or Unsuitable */}
        {simulation &&
          (simulation.viability.stressLevel === 'unsuitable' ||
            simulation.viability.stressLevel === 'marginal') && (
            <div
              className={`viability-banner ${simulation.viability.stressLevel}`}
            >
              <AlertTriangle size={16} />
              <div>
                <strong>{simulation.viability.summary}</strong>
                {simulation.viability.reasons.length > 0 && (
                  <span> — {simulation.viability.reasons[0]}</span>
                )}
              </div>
            </div>
          )}

        {/* Interactive SVG Canvas */}
        <div className="canvas-area">
          {loadingEnv && (
            <div className="Updating-pill">Querying Open-Meteo ERA5 &amp; DEM…</div>
          )}
          {simulation && svgBundle && (
            <SvgViewport
              innerMarkup={svgBundle.innerMarkup}
              baseViewBox={svgBundle.viewBox}
              specimenResetKey={`${simulation.seedKey}:${totalAge}:${effectiveDeathYear}`}
              ringsByIndex={ringsByIndex}
              hoveredRing={hoveredRing}
              onHoverRing={setHoveredRing}
            />
          )}
        </div>

        {/* Bottom Chronology Bar Strip */}
        {simulation && (
          <RingChronologyChart
            records={ringRecords}
            hoveredRing={hoveredRing}
            onHoverRing={setHoveredRing}
          />
        )}
      </main>
    </div>
  );
};

export default App;
