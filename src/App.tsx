import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Copy,
  Check,
  MapPin,
  AlertTriangle,
  Fingerprint,
  Sliders,
  Monitor,
  X,
  Info,
  Sparkles,
  Share2,
  Maximize2,
  Minimize2,
  Activity,
  BookOpen,
} from 'lucide-react';
import { ColophonModal } from './components/ColophonModal';
import { DendroTutorialModal } from './components/DendroTutorialModal';
import { MonochromeMapPicker } from './components/MonochromeMapPicker';
import { SvgViewport } from './components/SvgViewport';
import { RingChronologyChart } from './components/RingChronologyChart';
import { TimeNavigation, TimeNavMode } from './components/TimeNavigation';
import {
  buildShareableUrl,
  deserializePermalink,
  PaletteId,
  serializePermalink,
} from './model/permalink';
import { export4kPng, exportStandaloneSvg } from './model/exportPipeline';
import { simulateTreeCrossSection } from './model/growthEngine';
import { generateEnvironmentalNarrative } from './model/narrative';
import {
  getPresetById,
  PresetId,
  RETROSPECTIVE_PRESETS,
  RetrospectivePreset,
} from './model/presets';
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
  const [copiedShareLink, setCopiedShareLink] = useState<boolean>(false);
  const [isColophonOpen, setIsColophonOpen] = useState<boolean>(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState<boolean>(false);
  const [activePresetId, setActivePresetId] = useState<PresetId | string | null>('bristlecone-ancient');

  // Milestone 3 Time Navigation, Playback & Exhibition State
  const [navMode, setNavMode] = useState<TimeNavMode>('peel');
  const [activeRingIndex, setActiveRingIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(10);
  const [isExhibitionMode, setIsExhibitionMode] = useState<boolean>(false);
  const [ambientDriftEnabled, setAmbientDriftEnabled] = useState<boolean>(true);
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);
  const hideControlsTimerRef = useRef<number | null>(null);
  const targetPermalinkYearRef = useRef<number | null>(null);

  // Milestone 4 Palettes, Grain Texture, Colophon & Archival Export State
  const [selectedPalette, setSelectedPalette] = useState<PaletteId>('aged-wood');
  const [enableWoodGrain, setEnableWoodGrain] = useState<boolean>(true);
  const [includeColophonBorder, setIncludeColophonBorder] = useState<boolean>(false);
  const [isExportingPng, setIsExportingPng] = useState<boolean>(false);
  const [exportToastNotice, setExportToastNotice] = useState<string | null>(null);

  const handleSelectPreset = useCallback((preset: RetrospectivePreset) => {
    setActivePresetId(preset.id);
    setSpecies(preset.species);
    setLatitude(preset.latitude);
    setLongitude(preset.longitude);
    setLatInput(preset.latitude.toFixed(5));
    setLonInput(preset.longitude.toFixed(5));
    setTotalAge(preset.totalAge);
    if (preset.deathYear) {
      setOverrideDeathYear(true);
      setCustomDeathYear(preset.deathYear);
    } else {
      setOverrideDeathYear(false);
    }
    if (preset.recommendedPalette) {
      setSelectedPalette(preset.recommendedPalette);
    }
    if (preset.initialMode) {
      setNavMode(preset.initialMode);
    }
    setHoveredRing(null);
    setActiveRingIndex(null);
    setIsPlaying(false);
  }, []);

  // Read initial permalink parameters from URL on startup
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const initialQuery = window.location.search || window.location.hash;
    if (!initialQuery) return;

    const parsed = deserializePermalink(initialQuery);
    if (parsed.preset) {
      const p = getPresetById(parsed.preset);
      if (p) {
        handleSelectPreset(p);
      }
    }
    if (parsed.pal) {
      setSelectedPalette(parsed.pal);
    }
    if (
      parsed.sp &&
      (parsed.sp === 'douglas-fir' ||
        parsed.sp === 'ponderosa-pine' ||
        parsed.sp === 'bristlecone-pine')
    ) {
      setSpecies(parsed.sp);
      if (!parsed.preset) setActivePresetId(null);
    }
    if (parsed.lat !== undefined) {
      setLatitude(parsed.lat);
      setLatInput(parsed.lat.toFixed(5));
      if (!parsed.preset) setActivePresetId(null);
    }
    if (parsed.lon !== undefined) {
      setLongitude(parsed.lon);
      setLonInput(parsed.lon.toFixed(5));
      if (!parsed.preset) setActivePresetId(null);
    }
    if (parsed.age !== undefined) {
      setTotalAge(parsed.age);
      if (!parsed.preset) setActivePresetId(null);
    }
    if (parsed.death !== undefined) {
      setOverrideDeathYear(true);
      setCustomDeathYear(parsed.death);
      if (!parsed.preset) setActivePresetId(null);
    }
    if (parsed.mode) {
      setNavMode(parsed.mode);
    }
    if (parsed.year !== undefined) {
      targetPermalinkYearRef.current = parsed.year;
    }
  }, [handleSelectPreset]);
  const [showDeviceNotice, setShowDeviceNotice] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('dendro_dismiss_device_notice') !== '1';
    } catch {
      return true;
    }
  });

  const handleDismissDeviceNotice = useCallback(() => {
    setShowDeviceNotice(false);
    try {
      sessionStorage.setItem('dendro_dismiss_device_notice', '1');
    } catch {
      // Ignore storage errors in restricted contexts
    }
  }, []);

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

  // Synchronize activeRingIndex when simulation completes
  useEffect(() => {
    if (!simulation) return;
    if (targetPermalinkYearRef.current !== null) {
      const targetYear = targetPermalinkYearRef.current;
      const target = simulation.rings.find(
        (r) => r.record.calendarYear === targetYear
      );
      if (target) {
        setActiveRingIndex(target.record.ringIndex);
      }
      targetPermalinkYearRef.current = null;
      if (target) {
        return;
      }
    }
    if (
      activeRingIndex === null ||
      activeRingIndex > simulation.visibleRingCount
    ) {
      setActiveRingIndex(simulation.visibleRingCount);
    }
  }, [simulation, activeRingIndex]);

  const effectiveMaxRenderedRing =
    activeRingIndex !== null
      ? Math.max(
          1,
          Math.min(simulation?.visibleRingCount ?? 1, activeRingIndex)
        )
      : simulation?.visibleRingCount;

  const svgBundle = useMemo(() => {
    if (!simulation) return null;
    return generateCrossSectionSvgBundle(simulation, {
      ...renderOptions,
      unitSystem,
      highlightedRingIndex: hoveredRing ?? (isPlaying ? null : effectiveMaxRenderedRing),
      maxRenderedRingIndex: effectiveMaxRenderedRing,
      paletteId: selectedPalette,
      enableWoodGrain: enableWoodGrain,
    });
  }, [
    simulation,
    renderOptions,
    unitSystem,
    hoveredRing,
    isPlaying,
    effectiveMaxRenderedRing,
    selectedPalette,
    enableWoodGrain,
  ]);

  // Continuous growth playback animation loop
  useEffect(() => {
    if (!isPlaying || !simulation) return;

    let animId: number;
    let lastTick = performance.now();
    const intervalMs = 1000 / playbackSpeed;

    const tick = (now: number) => {
      const elapsed = now - lastTick;
      if (elapsed >= intervalMs) {
        lastTick = now;
        setActiveRingIndex((cur) => {
          const current = cur ?? simulation.visibleRingCount;
          if (navMode === 'grow') {
            if (current >= simulation.visibleRingCount) {
              return 1;
            }
            return current + 1;
          } else {
            // Peel mode: peeling backward toward heartwood
            if (current <= 1) {
              return simulation.visibleRingCount;
            }
            return current - 1;
          }
        });
      }
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, playbackSpeed, navMode, simulation]);

  // Live URL permalink synchronization
  useEffect(() => {
    if (!simulation || typeof window === 'undefined') return;

    const timeout = setTimeout(() => {
      const activeRec =
        effectiveMaxRenderedRing !== undefined
          ? ringsByIndex.get(effectiveMaxRenderedRing)
          : undefined;

      const permalinkQuery = serializePermalink({
        sp: species,
        lat: latitude,
        lon: longitude,
        age: totalAge,
        death: effectiveDeathYear,
        mode: navMode,
        year: activeRec?.calendarYear,
        preset: activePresetId ?? undefined,
        pal: selectedPalette,
      });

      if (window.history && window.history.replaceState) {
        const newUrl = `${window.location.pathname}${permalinkQuery}`;
        window.history.replaceState(null, '', newUrl);
      }
    }, 280);

    return () => clearTimeout(timeout);
  }, [
    species,
    latitude,
    longitude,
    totalAge,
    effectiveDeathYear,
    navMode,
    effectiveMaxRenderedRing,
    activePresetId,
    ringsByIndex,
    simulation,
    selectedPalette,
  ]);

  // Copy share link with clipboard visual confirmation
  const handleCopyShareLink = useCallback(async () => {
    try {
      const activeRec =
        effectiveMaxRenderedRing !== undefined
          ? ringsByIndex.get(effectiveMaxRenderedRing)
          : undefined;

      const fullUrl = buildShareableUrl({
        sp: species,
        lat: latitude,
        lon: longitude,
        age: totalAge,
        death: effectiveDeathYear,
        mode: navMode,
        year: activeRec?.calendarYear,
        preset: activePresetId ?? undefined,
        pal: selectedPalette,
      });

      await navigator.clipboard.writeText(fullUrl);
      setCopiedShareLink(true);
      setTimeout(() => setCopiedShareLink(false), 2000);
    } catch {
      // Ignore clipboard restrictions
    }
  }, [
    species,
    latitude,
    longitude,
    totalAge,
    effectiveDeathYear,
    navMode,
    effectiveMaxRenderedRing,
    activePresetId,
    ringsByIndex,
    selectedPalette,
  ]);

  // Exhibition mode toggle
  const toggleExhibitionMode = useCallback(() => {
    setIsExhibitionMode((prev) => {
      const next = !prev;
      if (next) {
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      } else {
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
      }
      return next;
    });
  }, []);

  // Sync fullscreen change event
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isExhibitionMode) {
        setIsExhibitionMode(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () =>
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isExhibitionMode]);

  // Keydown for 'F' / 'f' and 'Escape'
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleExhibitionMode();
      } else if (e.key === 'Escape') {
        if (isExhibitionMode) {
          setIsExhibitionMode(false);
          if (document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleExhibitionMode, isExhibitionMode]);

  // Floating controls auto-hide in Exhibition mode
  const resetControlsTimer = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimerRef.current) {
      window.clearTimeout(hideControlsTimerRef.current);
    }
    if (isExhibitionMode) {
      hideControlsTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false);
      }, 3500);
    }
  }, [isExhibitionMode]);

  useEffect(() => {
    if (!isExhibitionMode) {
      setControlsVisible(true);
      return;
    }
    resetControlsTimer();
    const handlePointer = () => resetControlsTimer();
    window.addEventListener('pointermove', handlePointer);
    return () => {
      window.removeEventListener('pointermove', handlePointer);
      if (hideControlsTimerRef.current) {
        window.clearTimeout(hideControlsTimerRef.current);
      }
    };
  }, [isExhibitionMode, resetControlsTimer]);

  const envNarrative = useMemo(
    () => (simulation ? generateEnvironmentalNarrative(simulation, unitSystem) : null),
    [simulation, unitSystem]
  );

  const handleCopySvg = useCallback(async () => {
    const markup = svgBundle?.svgMarkup;
    if (!markup) return;
    try {
      await navigator.clipboard.writeText(markup);
      setCopiedSvg(true);
      setTimeout(() => setCopiedSvg(false), 1800);
    } catch {
      // Clipboard API may be blocked in some contexts
    }
  }, [svgBundle]);

  const activeProfile = SPECIES_PROFILES[species];
  const viabilityDetail = useMemo(
    () =>
      simulation
        ? formatViabilityReason(activeProfile, simulation.environment, unitSystem)
        : null,
    [simulation, activeProfile, unitSystem]
  );

  const handleExportSvg = useCallback(() => {
    if (!simulation || !svgBundle) return;
    exportStandaloneSvg(simulation, {
      svgBundle,
      unitSystem,
      paletteId: selectedPalette,
      includeColophon: includeColophonBorder,
      narrative: envNarrative?.story,
      transparentBackground: renderOptions.transparentBackground,
      permalinkUrl: buildShareableUrl({
        sp: species,
        lat: latitude,
        lon: longitude,
        age: totalAge,
        death: effectiveDeathYear,
        mode: navMode,
        year: ringsByIndex.get(effectiveMaxRenderedRing ?? simulation.visibleRingCount)?.calendarYear,
        preset: activePresetId ?? undefined,
        pal: selectedPalette,
      }),
    });
    setExportToastNotice(includeColophonBorder ? 'Archival Plate SVG Exported' : 'Archival SVG Downloaded');
    setTimeout(() => setExportToastNotice(null), 2500);
  }, [
    simulation,
    svgBundle,
    unitSystem,
    selectedPalette,
    includeColophonBorder,
    envNarrative,
    renderOptions.transparentBackground,
    species,
    latitude,
    longitude,
    totalAge,
    effectiveDeathYear,
    navMode,
    effectiveMaxRenderedRing,
    ringsByIndex,
    activePresetId,
  ]);

  const handleExport4kPng = useCallback(async () => {
    if (!simulation || !svgBundle || isExportingPng) return;
    setIsExportingPng(true);
    try {
      await export4kPng(simulation, {
        svgBundle,
        unitSystem,
        paletteId: selectedPalette,
        includeColophon: includeColophonBorder,
        targetDpi: 300,
        narrative: envNarrative?.story,
        transparentBackground: renderOptions.transparentBackground,
        permalinkUrl: buildShareableUrl({
          sp: species,
          lat: latitude,
          lon: longitude,
          age: totalAge,
          death: effectiveDeathYear,
          mode: navMode,
          year: ringsByIndex.get(effectiveMaxRenderedRing ?? simulation.visibleRingCount)?.calendarYear,
          preset: activePresetId ?? undefined,
          pal: selectedPalette,
        }),
      });
      setExportToastNotice(
        includeColophonBorder ? '4K Archival Plate PNG Exported' : '4K PNG Exported'
      );
      setTimeout(() => setExportToastNotice(null), 3000);
    } catch (err) {
      console.error('Failed to export 4K PNG:', err);
      setExportToastNotice('Export failed');
      setTimeout(() => setExportToastNotice(null), 3000);
    } finally {
      setIsExportingPng(false);
    }
  }, [
    simulation,
    svgBundle,
    isExportingPng,
    unitSystem,
    selectedPalette,
    includeColophonBorder,
    envNarrative,
    renderOptions.transparentBackground,
    species,
    latitude,
    longitude,
    totalAge,
    effectiveDeathYear,
    navMode,
    effectiveMaxRenderedRing,
    ringsByIndex,
    activePresetId,
  ]);

  return (
    <div className={`app-shell ${isExhibitionMode ? 'exhibition-mode' : ''}`}>
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
                alt="XYLEM Specimen Mark"
                width={24}
                height={24}
                className="brand-specimen-icon"
              />
              <div className="brand-title-group">
                <h1>XYLEM</h1>
                <span className="brand-tagline">An Ecological Ledger of Deep Time</span>
              </div>
            </div>
            <div className="brand-header-actions">
              <button
                type="button"
                className="btn-colophon-trigger"
                onClick={() => setIsColophonOpen(true)}
                aria-label="Open Colophon and Artist Statement"
                title="Colophon & Ecological Ledger Statement"
              >
                <Info size={13} aria-hidden="true" />
                <span>Colophon</span>
              </button>
              <button
                type="button"
                className="btn-colophon-trigger"
                onClick={() => setIsTutorialOpen(true)}
                aria-label="Open Dendrochronology & Wood Anatomy Guide"
                title="Interactive Dendrochronology & Cross-Section Guide"
              >
                <BookOpen size={13} aria-hidden="true" />
                <span>Guide</span>
              </button>
              <button
                type="button"
                className="btn-exhibition-trigger"
                onClick={toggleExhibitionMode}
                aria-label="Enter Fullscreen Exhibition Mode (F)"
                title="Fullscreen Exhibition Mode (Press F)"
              >
                <Maximize2 size={13} aria-hidden="true" />
                <span>Exhibit</span>
              </button>
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
          </div>
          <p className="brand-subtitle">
            Retrospective Dendrochronology &amp; Biological Climate Memory Across Deep Environmental Time
          </p>
        </header>

        {/* Retrospective Environmental Scenarios */}
        <section className="control-section retrospective-presets-section">
          <div className="section-label-row">
            <label className="section-label">
              <Sparkles size={13} /> Retrospective Scenarios
            </label>
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
                  onClick={() => handleSelectPreset(preset)}
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

        {/* 1. Species Selection */}
        <section className="control-section">
          <label className="section-label">1. Species</label>
          <div className="species-toggle-grid">
            {(['douglas-fir', 'ponderosa-pine', 'bristlecone-pine'] as SpeciesId[]).map((spId) => {
              const prof = SPECIES_PROFILES[spId];
              const selected = species === spId;
              return (
                <button
                  key={spId}
                  type="button"
                  className={`species-card ${selected ? 'selected' : ''}`}
                  onClick={() => {
                    setSpecies(spId);
                    setActivePresetId(null);
                  }}
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
              <MapPin size={13} /> 2. Geographic Provenance (Lat / Lon)
            </label>
          </div>

          <MonochromeMapPicker
            latitude={latitude}
            longitude={longitude}
            unitSystem={unitSystem}
            onSelectLocation={(lat, lon) => {
              handleSelectLocation(lat, lon);
              setActivePresetId(null);
            }}
          />

          <div className="coord-inputs-grid">
            <div className="field-group">
              <label htmlFor="lat-input">Latitude (°N)</label>
              <input
                id="lat-input"
                type="text"
                placeholder="e.g. 44.2124"
                value={latInput}
                onChange={(e) => {
                  setLatInput(e.target.value);
                  setActivePresetId(null);
                }}
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
                onChange={(e) => {
                  setLonInput(e.target.value);
                  setActivePresetId(null);
                }}
                onBlur={commitCoordInputs}
                onKeyDown={(e) => e.key === 'Enter' && commitCoordInputs()}
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
                    onClick={() => {
                      handleSelectLocation(preset.latitude, preset.longitude);
                      setSpecies(preset.recommendedSpecies);
                      setActivePresetId(null);
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
              3. Chronological Span: {totalAge} Years
            </label>
            <div className="age-number-wrap">
              <input
                type="number"
                min={5}
                max={400}
                value={totalAge}
                onChange={(e) => {
                  setTotalAge(
                    Math.max(5, Math.min(400, Number(e.target.value) || 5))
                  );
                  setActivePresetId(null);
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
            max={350}
            value={Math.min(350, totalAge)}
            onChange={(e) => {
              setTotalAge(Number(e.target.value));
              setActivePresetId(null);
            }}
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
                onChange={(e) => {
                  setOverrideDeathYear(e.target.checked);
                  setActivePresetId(null);
                }}
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
                  onChange={(e) => {
                    setCustomDeathYear(
                      Math.max(
                        1600,
                        Math.min(
                          currentCalendarYear,
                          Number(e.target.value) || currentCalendarYear
                        )
                      )
                    );
                    setActivePresetId(null);
                  }}
                />
              </div>
            )}
          </div>
        </section>

        {/* 4. Organic Color Profile & Grain */}
        <section className="control-section palette-section">
          <div className="section-label-row">
            <label className="section-label">
              <Sparkles size={13} /> 4. Color Profile &amp; Grain
            </label>
            <span className="palette-count-indicator">3 Archival Profiles</span>
          </div>
          <div className="palette-cards-grid">
            {([
              {
                id: 'aged-wood' as const,
                name: 'Aged Heartwood',
                subtitle: 'Natural Sapwood & Umber Rings',
                swatches: ['#ebdcc7', '#7b4822', '#a65d2a', '#423226'],
              },
              {
                id: 'charred-subalpine' as const,
                name: 'Charred Sub-Alpine',
                subtitle: 'Ash-Gray, Soot & Basalt Char',
                swatches: ['#c4c2be', '#2c2b29', '#575550', '#1a1918'],
              },
              {
                id: 'skeleton-plot' as const,
                name: 'Skeleton Plot',
                subtitle: 'High-Contrast Archival Ledger',
                swatches: ['#fdfcf7', '#111111', '#c82828', '#222222'],
              },
            ]).map((p) => {
              const isSelected = selectedPalette === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`palette-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedPalette(p.id)}
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
              onChange={(e) => setEnableWoodGrain(e.target.checked)}
            />
            <span>Wood Grain Micro-Texture (Anisotropic Fiber)</span>
          </label>
        </section>

        {/* 5. Anatomical Layers */}
        <section className="control-section">
          <label className="section-label">
            <Sliders size={13} /> 5. Anatomical Layers
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
              <span>Bark Rhytidome &amp; Periderm</span>
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
              <span>Medullary Rays (Xylem Parenchyma)</span>
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
              <span>Scale Bar &amp; Azimuth</span>
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
              <span>Range &amp; Provenance Map</span>
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
              <span>Transparent Background</span>
            </label>
          </div>
        </section>
      </aside>

      {/* Main Specimen Stage */}
      <main className="main-stage">
        {/* Mobile / Narrow Viewport Device Recommendation Notice */}
        {showDeviceNotice && (
          <aside
            className="device-experience-banner"
            role="status"
            aria-label="Device recommendation notice"
          >
            <div className="device-experience-content">
              <Monitor
                className="device-experience-icon"
                size={15}
                aria-hidden="true"
              />
              <span className="device-experience-text">
                For archival 4K vector fidelity and multi-ribbon cellular inspection, a desktop or large-format display is recommended.
              </span>
            </div>
            <button
              type="button"
              className="device-experience-close"
              onClick={handleDismissDeviceNotice}
              aria-label="Dismiss recommendation notice"
              title="Dismiss notice"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </aside>
        )}

        {/* Mobile-only Top Brand Header */}
        <header className="brand-header mobile-brand-header">
          <div className="brand-top-row">
            <div className="brand-title">
              <img
                src="./favicon.svg"
                alt="XYLEM Specimen Mark"
                width={24}
                height={24}
                className="brand-specimen-icon"
              />
              <div className="brand-title-group">
                <h1>XYLEM</h1>
                <span className="brand-tagline">An Ecological Ledger of Deep Time</span>
              </div>
            </div>
            <div className="brand-header-actions">
              <button
                type="button"
                className="btn-colophon-trigger"
                onClick={() => setIsColophonOpen(true)}
                aria-label="Open Colophon and Artist Statement"
                title="Colophon & Ecological Ledger Statement"
              >
                <Info size={13} aria-hidden="true" />
                <span>Colophon</span>
              </button>
              <button
                type="button"
                className="btn-colophon-trigger"
                onClick={() => setIsTutorialOpen(true)}
                aria-label="Open Dendrochronology & Wood Anatomy Guide"
                title="Interactive Dendrochronology & Cross-Section Guide"
              >
                <BookOpen size={13} aria-hidden="true" />
                <span>Guide</span>
              </button>
              <button
                type="button"
                className="btn-exhibition-trigger"
                onClick={toggleExhibitionMode}
                aria-label="Enter Fullscreen Exhibition Mode (F)"
                title="Fullscreen Exhibition Mode (Press F)"
              >
                <Maximize2 size={13} aria-hidden="true" />
                <span>Exhibit</span>
              </button>
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
          </div>
          <p className="brand-subtitle">
            Retrospective Dendrochronology &amp; Biological Climate Memory Across Deep Environmental Time
          </p>
        </header>

        {/* Top Telemetry & Export Bar */}
        <header className="top-bar">
          <div className="top-bar-scenario-quick">
            <label htmlFor="quick-scenario-select" className="quick-scenario-label">
              Scenario:
            </label>
            <select
              id="quick-scenario-select"
              className="quick-scenario-select"
              value={activePresetId ?? ''}
              onChange={(e) => {
                const p = getPresetById(e.target.value);
                if (p) handleSelectPreset(p);
              }}
            >
              {!activePresetId && (
                <option value="" disabled hidden>
                  Custom Specimen
                </option>
              )}
              {RETROSPECTIVE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.eraLabel})
                </option>
              ))}
            </select>
          </div>

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

          <div className="top-bar-palette-quick">
            <label htmlFor="quick-palette-select" className="quick-palette-label">
              Palette:
            </label>
            <select
              id="quick-palette-select"
              className="quick-palette-select"
              value={selectedPalette}
              onChange={(e) => setSelectedPalette(e.target.value as PaletteId)}
            >
              <option value="aged-wood">Aged Heartwood</option>
              <option value="charred-subalpine">Charred Sub-Alpine</option>
              <option value="skeleton-plot">Skeleton Plot</option>
            </select>
          </div>

          <div className="export-actions">
            {/* Colophon Border Toggle */}
            <label
              className={`colophon-plate-toggle ${includeColophonBorder ? 'active' : ''}`}
              title="Format export inside an archival museum colophon plate border with specimen metadata"
            >
              <input
                type="checkbox"
                checked={includeColophonBorder}
                onChange={(e) => setIncludeColophonBorder(e.target.checked)}
              />
              <span>Colophon Plate</span>
            </label>

            <button
              type="button"
              className="btn-secondary btn-share-link"
              onClick={handleCopyShareLink}
              title="Copy shareable permalink URL to clipboard"
            >
              {copiedShareLink ? <Check size={14} /> : <Share2 size={14} />}
              <span>{copiedShareLink ? 'Link Copied!' : 'Copy Share Link'}</span>
            </button>

            <button
              type="button"
              className="btn-secondary btn-exhibition-button"
              onClick={toggleExhibitionMode}
              title="Enter Fullscreen Exhibition Mode (F)"
            >
              <Maximize2 size={14} />
              <span>Exhibit (F)</span>
            </button>

            <button
              type="button"
              className="btn-secondary"
              onClick={handleCopySvg}
              disabled={!svgBundle}
            >
              {copiedSvg ? <Check size={14} /> : <Copy size={14} />}
              <span>{copiedSvg ? 'Copied' : 'Copy SVG'}</span>
            </button>

            <button
              type="button"
              className="btn-secondary btn-export-svg"
              onClick={handleExportSvg}
              disabled={!svgBundle}
              title={includeColophonBorder ? 'Export standalone SVG framed with museum colophon plate' : 'Export standalone vector SVG'}
            >
              <Download size={14} />
              <span>{includeColophonBorder ? 'Export Plate SVG' : 'Export SVG'}</span>
            </button>

            <button
              type="button"
              className="btn-primary btn-export-png"
              onClick={handleExport4kPng}
              disabled={!svgBundle || isExportingPng}
              title="Render high-resolution uncompressed 4K (300 DPI) print raster"
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
        </header>

        {/* Environmental Summary Narrative Card */}
        {simulation && envNarrative && !isExhibitionMode && (
          <div className="environmental-story-card">
            <div className="story-header-row">
              <span className="story-tag">Dendroclimatic Ledger</span>
              <span className="story-coords">
                {latitude.toFixed(4)}°N, {Math.abs(longitude).toFixed(4)}°W
              </span>
            </div>
            <p className="story-prose">{envNarrative.story}</p>
          </div>
        )}

        {/* Ecological Viability Banner if Marginal or Unsuitable */}
        {simulation &&
          !isExhibitionMode &&
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
        <div className="canvas-area" style={{ touchAction: 'none' }}>
          {loadingEnv && (
            <div className="updating-pill">
              Reconstructing paleoclimatic record…
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
              isExhibitionMode={isExhibitionMode}
              ambientDriftEnabled={ambientDriftEnabled}
            />
          )}
        </div>

        {/* Dual-Mode Time Navigation & Playback Scrubber */}
        {simulation && !isExhibitionMode && (
          <TimeNavigation
            mode={navMode}
            onModeChange={setNavMode}
            totalRings={simulation.visibleRingCount}
            activeRingIndex={effectiveMaxRenderedRing ?? simulation.visibleRingCount}
            onRingChange={(idx) => {
              setIsPlaying(false);
              setActiveRingIndex(idx);
            }}
            firstYear={simulation.firstRingYear}
            deathYear={effectiveDeathYear}
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying((p) => !p)}
            playbackSpeed={playbackSpeed}
            onSpeedChange={setPlaybackSpeed}
            activeRecord={ringsByIndex.get(effectiveMaxRenderedRing ?? simulation.visibleRingCount)}
          />
        )}

        {/* Bottom Chronology Bar Strip */}
        {simulation && !isExhibitionMode && (
          <RingChronologyChart
            records={ringRecords}
            hoveredRing={hoveredRing}
            unitSystem={unitSystem}
            latitude={latitude}
            longitude={longitude}
            onHoverRing={setHoveredRing}
          />
        )}

        {/* Fullscreen Exhibition Floating Minimal Controls Pill */}
        {isExhibitionMode && simulation && (
          <div
            className={`floating-exhibition-bar ${controlsVisible ? 'visible' : 'hidden'}`}
            onMouseEnter={() => setControlsVisible(true)}
          >
            <TimeNavigation
              mode={navMode}
              onModeChange={setNavMode}
              totalRings={simulation.visibleRingCount}
              activeRingIndex={effectiveMaxRenderedRing ?? simulation.visibleRingCount}
              onRingChange={(idx) => {
                setIsPlaying(false);
                setActiveRingIndex(idx);
              }}
              firstYear={simulation.firstRingYear}
              deathYear={effectiveDeathYear}
              isPlaying={isPlaying}
              onTogglePlay={() => setIsPlaying((p) => !p)}
              playbackSpeed={playbackSpeed}
              onSpeedChange={setPlaybackSpeed}
              activeRecord={ringsByIndex.get(effectiveMaxRenderedRing ?? simulation.visibleRingCount)}
              className="exhibition-compact-nav"
            />
            <div className="exhibition-bar-actions">
              <button
                type="button"
                className={`btn-exhibition-pill ${ambientDriftEnabled ? 'active' : ''}`}
                onClick={() => setAmbientDriftEnabled((a) => !a)}
                title={ambientDriftEnabled ? 'Pause ambient camera drift' : 'Resume ambient camera drift'}
              >
                <Activity size={13} />
                <span>{ambientDriftEnabled ? 'Drift: On' : 'Drift: Off'}</span>
              </button>
              <button
                type="button"
                className="btn-exhibition-pill"
                onClick={() => {
                  const list: PaletteId[] = ['aged-wood', 'charred-subalpine', 'skeleton-plot'];
                  const nextIdx = (list.indexOf(selectedPalette) + 1) % list.length;
                  setSelectedPalette(list[nextIdx]);
                }}
                title="Cycle color profile"
              >
                <Sparkles size={13} />
                <span>
                  {selectedPalette === 'aged-wood'
                    ? 'Aged Wood'
                    : selectedPalette === 'charred-subalpine'
                    ? 'Charred'
                    : 'Skeleton'}
                </span>
              </button>
              <button
                type="button"
                className="btn-exhibition-pill btn-exit-exhibition"
                onClick={toggleExhibitionMode}
                title="Exit Fullscreen Exhibition (Esc / F)"
              >
                <Minimize2 size={13} />
                <span>Exit (Esc)</span>
              </button>
            </div>
          </div>
        )}
      </main>

      <ColophonModal
        isOpen={isColophonOpen}
        onClose={() => setIsColophonOpen(false)}
      />

      <DendroTutorialModal
        isOpen={isTutorialOpen}
        onClose={() => setIsTutorialOpen(false)}
        onSelectPreset={(id) => {
          const preset = getPresetById(id);
          if (preset) handleSelectPreset(preset);
        }}
        onSelectPalette={setSelectedPalette}
        onSetTimeNavMode={setNavMode}
      />

      {exportToastNotice && (
        <div className="export-toast-notice" role="status" aria-live="polite">
          <Check size={14} />
          <span>{exportToastNotice}</span>
        </div>
      )}
    </div>
  );
};

export default App;
