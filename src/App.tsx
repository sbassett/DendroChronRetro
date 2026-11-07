import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Copy,
  Check,
  MapPin,
  AlertTriangle,
  Fingerprint,
  Sliders,
} from 'lucide-react';
import { MonochromeMapPicker } from './components/MonochromeMapPicker';
import { SvgViewport } from './components/SvgViewport';
import { RingChronologyChart } from './components/RingChronologyChart';
import { simulateTreeCrossSection } from './model/growthEngine';
import { generateEnvironmentalNarrative } from './model/narrative';
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
import {
  formatAnnualPrecip,
  formatBarkThickness,
  formatDiameter,
  formatElevation,
  formatSlope,
  formatStumpHeightShort,
  formatTemperature,
  formatViabilityReason,
  parseCoordinateInput,
  UnitSystem,
} from './model/units';
import {
  getCachedEnvironmentDataset,
  loadEnvironmentDataset,
} from './services/environmentApi';
import './App.css';

function compassLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}

export const App: React.FC = () => {
  const currentCalendarYear = useMemo(() => new Date().getFullYear(), []);

  const [unitSystem, setUnitSystem] = useState<UnitSystem>('us');
  const [species, setSpecies] = useState<SpeciesId>('ponderosa-pine');
  const [latitude, setLatitude] = useState<number>(35.2645);
  const [longitude, setLongitude] = useState<number>(-111.7442);
  const [latInput, setLatInput] = useState<string>('35.26450');
  const [lonInput, setLonInput] = useState<string>('-111.74420');

  const [totalAge, setTotalAge] = useState<number>(250);
  const [overrideDeathYear, setOverrideDeathYear] = useState<boolean>(false);
  const [customDeathYear, setCustomDeathYear] = useState<number>(currentCalendarYear);

  const effectiveDeathYear = overrideDeathYear
    ? customDeathYear
    : currentCalendarYear;

  const [renderOptions, setRenderOptions] = useState<
    Omit<SvgRenderOptions, 'unitSystem'>
  >({
    showBark: true,
    showMedullaryRays: true,
    showAnnotations: true,
    showLocatorMap: true,
    transparentBackground: false,
  });

  const [fetchedEnv, setFetchedEnv] = useState<{
    key: string;
    dataset: EnvironmentDataset;
  } | null>(null);
  const [loadingEnv, setLoadingEnv] = useState<boolean>(true);
  const [hoveredRing, setHoveredRing] = useState<number | null>(null);
  const [copiedSvg, setCopiedSvg] = useState<boolean>(false);

  const startYear = effectiveDeathYear - Math.max(4, totalAge);
  const currentEnvKey = `${latitude.toFixed(4)}:${longitude.toFixed(4)}:${startYear}:${effectiveDeathYear}`;

  // Synchronous cache lookup prevents any 1-render mismatch when toggling between visited sites
  const syncCachedEnv = useMemo(
    () =>
      getCachedEnvironmentDataset(
        latitude,
        longitude,
        startYear,
        effectiveDeathYear
      ),
    [latitude, longitude, startYear, effectiveDeathYear]
  );

  const matchedEnvDataset =
    syncCachedEnv ??
    (fetchedEnv?.key === currentEnvKey ? fetchedEnv.dataset : null);

  // Sync coordinate text fields when preset or map updates numeric state
  const handleSelectLocation = useCallback((lat: number, lon: number) => {
    setLatitude(lat);
    setLongitude(lon);
    setLatInput(lat.toFixed(5));
    setLonInput(lon.toFixed(5));
    setHoveredRing(null);
  }, []);

  const commitCoordInputs = useCallback(() => {
    const parsedLat = parseCoordinateInput(latInput, 'lat');
    const parsedLon = parseCoordinateInput(lonInput, 'lon');
    if (parsedLat !== null) {
      setLatitude(Number(parsedLat.toFixed(5)));
      setLatInput(parsedLat.toFixed(5));
    } else {
      setLatInput(latitude.toFixed(5));
    }
    if (parsedLon !== null) {
      setLongitude(Number(parsedLon.toFixed(5)));
      setLonInput(parsedLon.toFixed(5));
    } else {
      setLonInput(longitude.toFixed(5));
    }
  }, [latInput, lonInput, latitude, longitude]);

  // Fetch environmental & historical climate data when location or year span is not yet cached
  useEffect(() => {
    if (syncCachedEnv && syncCachedEnv.source === 'nasa-power-merra2') {
      setLoadingEnv(false);
      return;
    }

    let cancelled = false;
    if (!syncCachedEnv) {
      setLoadingEnv(true);
    }

    loadEnvironmentDataset(latitude, longitude, startYear, effectiveDeathYear)
      .then((dataset) => {
        if (!cancelled) {
          setFetchedEnv({ key: currentEnvKey, dataset });
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
  }, [latitude, longitude, startYear, effectiveDeathYear, currentEnvKey, syncCachedEnv]);

  const lastValidSimulationRef = useRef<TreeSimulationResult | null>(null);

  const simulation: TreeSimulationResult | null = useMemo(() => {
    if (!matchedEnvDataset) {
      // Keep displaying the previous coherent specimen while the new site's weather loads
      return lastValidSimulationRef.current;
    }
    const nextSim = simulateTreeCrossSection(
      {
        species,
        latitude,
        longitude,
        totalAge,
        deathYear: effectiveDeathYear,
      },
      matchedEnvDataset
    );
    lastValidSimulationRef.current = nextSim;
    return nextSim;
  }, [species, latitude, longitude, totalAge, effectiveDeathYear, matchedEnvDataset]);

  const svgBundle = useMemo(() => {
    if (!simulation) return null;
    return generateCrossSectionSvgBundle(simulation, {
      ...renderOptions,
      unitSystem,
    });
  }, [simulation, renderOptions, unitSystem]);

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
  const viabilityDetail = useMemo(
    () =>
      simulation
        ? formatViabilityReason(activeProfile, simulation.environment, unitSystem)
        : null,
    [simulation, activeProfile, unitSystem]
  );

  const envNarrative = useMemo(
    () => (simulation ? generateEnvironmentalNarrative(simulation, unitSystem) : null),
    [simulation, unitSystem]
  );

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
        <header className="brand-header desktop-brand-header">
          <div className="brand-top-row">
            <div className="brand-title">
              <img
                src="./favicon.svg"
                alt=""
                width={24}
                height={24}
                className="brand-cookie-icon"
              />
              <h1>DendroSim</h1>
            </div>
            <div
              className="unit-segmented"
              role="group"
              aria-label="Units of measure"
            >
              <button
                type="button"
                className={unitSystem === 'us' ? 'active' : ''}
                title="US Customary units (in, ft, °F)"
                onClick={() => setUnitSystem('us')}
              >
                US
              </button>
              <button
                type="button"
                className={unitSystem === 'metric' ? 'active' : ''}
                title="Metric units (mm, cm, m, °C)"
                onClick={() => setUnitSystem('metric')}
              >
                Metric
              </button>
            </div>
          </div>
          <p className="brand-subtitle">
            Reconstruct a tree’s hidden climate diary from any coordinate in the American West.
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
            unitSystem={unitSystem}
            onSelectLocation={handleSelectLocation}
          />

          <div className="coord-inputs-grid">
            <div className="field-group">
              <label htmlFor="lat-input">Latitude (°N)</label>
              <input
                id="lat-input"
                type="text"
                placeholder="e.g. 44.2124"
                value={latInput}
                onChange={(e) => setLatInput(e.target.value)}
                onBlur={commitCoordInputs}
                onKeyDown={(e) => e.key === 'Enter' && commitCoordInputs()}
              />
            </div>
            <div className="field-group">
              <label htmlFor="lon-input">Longitude (°W negative)</label>
              <input
                id="lon-input"
                type="text"
                placeholder="e.g. -122.2557"
                value={lonInput}
                onChange={(e) => setLonInput(e.target.value)}
                onBlur={commitCoordInputs}
                onKeyDown={(e) => e.key === 'Enter' && commitCoordInputs()}
              />
            </div>
          </div>

          <div className="preset-block">
            <span className="preset-heading">US Reference Forest Sites:</span>
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

        {/* 3. Tree Age & Cambium Year */}
        <section className="control-section age-section">
          <div className="section-label-row">
            <label className="section-label" htmlFor="age-slider">
              3. Tree Age: {totalAge} Years
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
            max={350}
            value={Math.min(350, totalAge)}
            onChange={(e) => setTotalAge(Number(e.target.value))}
          />

          {simulation && (
            <div className="age-narrative-subtext">
              Germinated {simulation.germinationYear} • First ring at{' '}
              {formatStumpHeightShort(simulation.stumpHeightM, unitSystem)} cut plane:{' '}
              {simulation.firstRingYear} ({simulation.visibleRingCount} visible rings) • Outer cambium:{' '}
              {effectiveDeathYear}
            </div>
          )}

          <div className="death-year-row">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={overrideDeathYear}
                onChange={(e) => setOverrideDeathYear(e.target.checked)}
              />
              <span>Harvest / Cambium Year (Default: {currentCalendarYear})</span>
            </label>

            {overrideDeathYear && (
              <div className="death-year-input-wrap">
                <label htmlFor="death-year-input">Cambium Year:</label>
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
                checked={renderOptions.showLocatorMap ?? true}
                onChange={(e) =>
                  setRenderOptions((o) => ({
                    ...o,
                    showLocatorMap: e.target.checked,
                  }))
                }
              />
              <span>Locator map</span>
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
        {/* Mobile-only Top Brand Header */}
        <header className="brand-header mobile-brand-header">
          <div className="brand-top-row">
            <div className="brand-title">
              <img
                src="./favicon.svg"
                alt=""
                width={24}
                height={24}
                className="brand-cookie-icon"
              />
              <h1>DendroSim</h1>
            </div>
            <div
              className="unit-segmented"
              role="group"
              aria-label="Units of measure"
            >
              <button
                type="button"
                className={unitSystem === 'us' ? 'active' : ''}
                title="US Customary units (in, ft, °F)"
                onClick={() => setUnitSystem('us')}
              >
                US
              </button>
              <button
                type="button"
                className={unitSystem === 'metric' ? 'active' : ''}
                title="Metric units (mm, cm, m, °C)"
                onClick={() => setUnitSystem('metric')}
              >
                Metric
              </button>
            </div>
          </div>
          <p className="brand-subtitle">
            Reconstruct a tree’s hidden climate diary from any coordinate in the American West.
          </p>
        </header>

        {/* Top Telemetry & Export Bar */}
        <header className="top-bar">
          <div className="telemetry-strip">
            {simulation ? (
              <>
                <div
                  className="metric-pill"
                  title="Total stump diameter outside bark (DOB)"
                >
                  <span className="metric-label">Outer Diameter</span>
                  <span className="metric-value">
                    {formatDiameter(simulation.diameterOutsideBarkMm, unitSystem)}
                  </span>
                </div>
                <div
                  className="metric-pill"
                  title="Wood diameter inside bark (DIB)"
                >
                  <span className="metric-label">Wood Diameter</span>
                  <span className="metric-value">
                    {formatDiameter(simulation.diameterInsideBarkMm, unitSystem)}
                  </span>
                </div>
                <div
                  className="metric-pill"
                  title="Mean radial bark thickness"
                >
                  <span className="metric-label">Mean Bark</span>
                  <span className="metric-value">
                    {formatBarkThickness(
                      simulation.bark.meanThicknessMm,
                      unitSystem
                    )}
                  </span>
                </div>
                <div
                  className="metric-pill"
                  title="Site elevation above sea level"
                >
                  <span className="metric-label">Elevation</span>
                  <span className="metric-value">
                    {formatElevation(
                      simulation.environment.terrain.elevationM,
                      unitSystem
                    )}
                  </span>
                </div>
                <div className="metric-pill" title="Local terrain slope">
                  <span className="metric-label">Slope</span>
                  <span className="metric-value">
                    {formatSlope(
                      simulation.environment.terrain.slopeDeg,
                      unitSystem
                    )}
                  </span>
                </div>
                <div
                  className="metric-pill"
                  title="Downhill slope facing azimuth"
                >
                  <span className="metric-label">Aspect</span>
                  <span className="metric-value">
                    {compassLabel(simulation.environment.terrain.aspectDeg)} (
                    {Math.round(simulation.environment.terrain.aspectDeg)}°)
                  </span>
                </div>
                <div
                  className="metric-pill"
                  title="Site mean annual air temperature"
                >
                  <span className="metric-label">Mean Temp</span>
                  <span className="metric-value">
                    {formatTemperature(
                      simulation.environment.meanAnnualTempC,
                      unitSystem
                    )}
                  </span>
                </div>
                <div
                  className="metric-pill"
                  title="Site mean annual precipitation"
                >
                  <span className="metric-label">Annual Precip</span>
                  <span className="metric-value">
                    {formatAnnualPrecip(
                      simulation.environment.meanAnnualPrecipMm,
                      unitSystem
                    )}
                  </span>
                </div>
                <div
                  className="metric-pill seed-pill"
                  title={`Deterministic seed key: ${simulation.seedKey}`}
                >
                  <span className="metric-label">
                    <Fingerprint size={11} /> Seed
                  </span>
                  <span className="metric-value mono">{simulation.seedHex}</span>
                </div>
              </>
            ) : (
              <span className="loading-text">
                Loading historical weather &amp; terrain…
              </span>
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

        {/* Environmental Summary Narrative Card */}
        {simulation && envNarrative && (
          <div className="environmental-story-card">
            <div className="story-header-row">
              <span className="story-tag">Site Climate Diary</span>
              <span className="story-coords">
                {latitude.toFixed(4)}°N, {Math.abs(longitude).toFixed(4)}°W
              </span>
            </div>
            <p className="story-prose">{envNarrative.story}</p>
          </div>
        )}

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
                {viabilityDetail && <span> — {viabilityDetail}</span>}
              </div>
            </div>
          )}

        {/* Interactive SVG Canvas */}
        <div className="canvas-area">
          {loadingEnv && (
            <div className="Updating-pill">
              Loading historical weather &amp; terrain…
            </div>
          )}
          {simulation && svgBundle && (
            <SvgViewport
              innerMarkup={svgBundle.innerMarkup}
              baseViewBox={svgBundle.viewBox}
              specimenResetKey={`${simulation.seedKey}:${totalAge}:${effectiveDeathYear}:${(renderOptions.showLocatorMap ?? true) ? 1 : 0}`}
              ringsByIndex={ringsByIndex}
              hoveredRing={hoveredRing}
              unitSystem={unitSystem}
              onHoverRing={setHoveredRing}
            />
          )}
        </div>

        {/* Bottom Chronology Bar Strip */}
        {simulation && (
          <RingChronologyChart
            records={ringRecords}
            hoveredRing={hoveredRing}
            unitSystem={unitSystem}
            latitude={latitude}
            longitude={longitude}
            onHoverRing={setHoveredRing}
          />
        )}
      </main>
    </div>
  );
};

export default App;
