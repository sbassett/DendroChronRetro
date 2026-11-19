import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  Check,
  Info,
  Maximize2,
  Minimize2,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { ColophonModal } from './components/ColophonModal';
import { ControlsDrawer, DrawerTab } from './components/ControlsDrawer';
import { DendroTutorialModal } from './components/DendroTutorialModal';
import { MobileSheet, MobileSheetTab } from './components/MobileSheet';
import { ActiveEditorKey, SpecimenHud } from './components/SpecimenHud';
import { SvgViewport } from './components/SvgViewport';
import { TimeNavigation, TimeNavMode } from './components/TimeNavigation';
import { TimelineDock } from './components/TimelineDock';
import { export4kPng, exportStandaloneSvg } from './model/exportPipeline';
import { simulateTreeCrossSection } from './model/growthEngine';
import { generateEnvironmentalNarrative } from './model/narrative';
import { getPalette } from './model/palettes';
import {
  buildShareableUrl,
  deserializePermalink,
  PaletteId,
  serializePermalink,
} from './model/permalink';
import {
  getPresetById,
  PresetId,
  RetrospectivePreset,
} from './model/presets';
import { generateCrossSectionSvgBundle, SvgRenderOptions } from './model/svgGenerator';
import {
  AnnualRingRecord,
  EnvironmentDataset,
  SpeciesId,
  TreeSimulationResult,
} from './model/types';
import {
  formatViabilityReason,
  parseCoordinateInput,
  UnitSystem,
} from './model/units';
import { SPECIES_PROFILES } from './model/species';
import {
  getCachedEnvironmentDataset,
  loadEnvironmentDataset,
} from './services/environmentApi';
import './App.css';

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
  const [activePresetId, setActivePresetId] = useState<PresetId | string | null>(null);

  // Minimalist disclosure state
  const [activeEditor, setActiveEditor] = useState<ActiveEditorKey>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('ledger');
  const [isTimelineOpen, setIsTimelineOpen] = useState<boolean>(false);
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState<boolean>(false);
  const [mobileSheetTab, setMobileSheetTab] = useState<MobileSheetTab>('specimen');
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(max-width: 920px)').matches;
  });

  // Time Navigation, Playback & Zen Exhibition State
  const [navMode, setNavMode] = useState<TimeNavMode>('peel');
  const [activeRingIndex, setActiveRingIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(10);
  const [isExhibitionMode, setIsExhibitionMode] = useState<boolean>(false);
  const [ambientDriftEnabled, setAmbientDriftEnabled] = useState<boolean>(true);
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);
  const hideControlsTimerRef = useRef<number | null>(null);
  const targetPermalinkYearRef = useRef<number | null>(null);

  // Palettes, Grain Texture, Colophon & Archival Export State
  const [selectedPalette, setSelectedPalette] = useState<PaletteId>('aged-wood');
  const [enableWoodGrain, setEnableWoodGrain] = useState<boolean>(true);
  const [includeColophonBorder, setIncludeColophonBorder] = useState<boolean>(false);
  const [isExportingPng, setIsExportingPng] = useState<boolean>(false);
  const [exportToastNotice, setExportToastNotice] = useState<string | null>(null);

  const activePalette = useMemo(
    () => getPalette(selectedPalette),
    [selectedPalette]
  );

  // Track responsive breakpoint cleanly to avoid duplicate global keydown listeners
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia('(max-width: 920px)');
    const handleChange = (e: MediaQueryListEvent) => {
      setIsMobileViewport(e.matches);
      if (e.matches) {
        setActiveEditor(null);
        setIsDrawerOpen(false);
        setIsTimelineOpen(false);
      } else {
        setIsMobileSheetOpen(false);
      }
    };
    setIsMobileViewport(mq.matches);
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

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
    setActiveEditor(null);
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

  // Live viewport SVG omits duplicate embedded locator map & text caption so the cross section centers cleanly
  const svgBundle = useMemo(() => {
    if (!simulation) return null;
    return generateCrossSectionSvgBundle(simulation, {
      ...renderOptions,
      showLocatorMap: false,
      showCaptionText: false,
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

  // Full archival SVG bundle used for Copy SVG, Export SVG, and Export 4K PNG
  const buildExportSvgBundle = useCallback(() => {
    if (!simulation) return null;
    return generateCrossSectionSvgBundle(simulation, {
      ...renderOptions,
      showLocatorMap: renderOptions.showLocatorMap ?? true,
      showCaptionText: true,
      unitSystem,
      highlightedRingIndex: null,
      maxRenderedRingIndex: effectiveMaxRenderedRing,
      paletteId: selectedPalette,
      enableWoodGrain: enableWoodGrain,
    });
  }, [
    simulation,
    renderOptions,
    unitSystem,
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
          }
          if (current <= 1) {
            return simulation.visibleRingCount;
          }
          return current - 1;
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

  // Zen Exhibition mode toggle
  const toggleExhibitionMode = useCallback(() => {
    setIsExhibitionMode((prev) => {
      const next = !prev;
      if (next) {
        setActiveEditor(null);
        setIsDrawerOpen(false);
        setIsTimelineOpen(false);
        setIsMobileSheetOpen(false);
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

  // Keydown for 'F' / 'f' and layered 'Escape' dismissal
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
        if (isColophonOpen || isTutorialOpen) {
          return;
        }
        if (activeEditor !== null) {
          setActiveEditor(null);
        } else if (isDrawerOpen) {
          setIsDrawerOpen(false);
        } else if (isTimelineOpen) {
          setIsTimelineOpen(false);
        } else if (isMobileSheetOpen) {
          setIsMobileSheetOpen(false);
        } else if (isExhibitionMode) {
          setIsExhibitionMode(false);
          if (document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    toggleExhibitionMode,
    isExhibitionMode,
    isColophonOpen,
    isTutorialOpen,
    activeEditor,
    isDrawerOpen,
    isTimelineOpen,
    isMobileSheetOpen,
  ]);

  // Floating controls auto-hide in Zen Exhibition mode
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
    const exportBundle = buildExportSvgBundle();
    if (!exportBundle?.svgMarkup) return;
    try {
      await navigator.clipboard.writeText(exportBundle.svgMarkup);
      setCopiedSvg(true);
      setTimeout(() => setCopiedSvg(false), 1800);
    } catch {
      // Clipboard API may be blocked in some contexts
    }
  }, [buildExportSvgBundle]);

  const activeProfile = SPECIES_PROFILES[species];
  const viabilityDetail = useMemo(
    () =>
      simulation
        ? formatViabilityReason(activeProfile, simulation.environment, unitSystem)
        : null,
    [simulation, activeProfile, unitSystem]
  );

  const buildPermalinkUrl = useCallback(() => {
    if (!simulation) return '';
    return buildShareableUrl({
      sp: species,
      lat: latitude,
      lon: longitude,
      age: totalAge,
      death: effectiveDeathYear,
      mode: navMode,
      year: ringsByIndex.get(effectiveMaxRenderedRing ?? simulation.visibleRingCount)
        ?.calendarYear,
      preset: activePresetId ?? undefined,
      pal: selectedPalette,
    });
  }, [
    simulation,
    species,
    latitude,
    longitude,
    totalAge,
    effectiveDeathYear,
    navMode,
    ringsByIndex,
    effectiveMaxRenderedRing,
    activePresetId,
    selectedPalette,
  ]);

  const handleExportSvg = useCallback(() => {
    const exportBundle = buildExportSvgBundle();
    if (!simulation || !exportBundle) return;
    exportStandaloneSvg(simulation, {
      svgBundle: exportBundle,
      unitSystem,
      paletteId: selectedPalette,
      includeColophon: includeColophonBorder,
      narrative: envNarrative?.story,
      transparentBackground: renderOptions.transparentBackground,
      permalinkUrl: buildPermalinkUrl(),
    });
    setExportToastNotice(
      includeColophonBorder ? 'Archival Plate SVG Exported' : 'Archival SVG Downloaded'
    );
    setTimeout(() => setExportToastNotice(null), 2500);
  }, [
    simulation,
    buildExportSvgBundle,
    unitSystem,
    selectedPalette,
    includeColophonBorder,
    envNarrative,
    renderOptions.transparentBackground,
    buildPermalinkUrl,
  ]);

  const handleExport4kPng = useCallback(async () => {
    const exportBundle = buildExportSvgBundle();
    if (!simulation || !exportBundle || isExportingPng) return;
    setIsExportingPng(true);
    try {
      await export4kPng(simulation, {
        svgBundle: exportBundle,
        unitSystem,
        paletteId: selectedPalette,
        includeColophon: includeColophonBorder,
        targetDpi: 300,
        narrative: envNarrative?.story,
        transparentBackground: renderOptions.transparentBackground,
        permalinkUrl: buildPermalinkUrl(),
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
    buildExportSvgBundle,
    isExportingPng,
    unitSystem,
    selectedPalette,
    includeColophonBorder,
    envNarrative,
    renderOptions.transparentBackground,
    buildPermalinkUrl,
  ]);

  const handleToggleEditor = useCallback(
    (editor: Exclude<ActiveEditorKey, null>) => {
      setActiveEditor((cur) => (cur === editor ? null : editor));
    },
    []
  );

  const handleSelectSpecies = useCallback((sp: SpeciesId) => {
    setSpecies(sp);
    setActivePresetId(null);
  }, []);

  const handleLatInputChange = useCallback((val: string) => {
    setLatInput(val);
    setActivePresetId(null);
  }, []);

  const handleLonInputChange = useCallback((val: string) => {
    setLonInput(val);
    setActivePresetId(null);
  }, []);

  const handleMapSelect = useCallback(
    (lat: number, lon: number) => {
      handleSelectLocation(lat, lon);
      setActivePresetId(null);
    },
    [handleSelectLocation]
  );

  const handleReferenceSiteSelect = useCallback(
    (lat: number, lon: number, recommendedSpecies: SpeciesId) => {
      handleSelectLocation(lat, lon);
      setSpecies(recommendedSpecies);
      setActivePresetId(null);
    },
    [handleSelectLocation]
  );

  const handleAgeChange = useCallback((age: number) => {
    setTotalAge(age);
    setActivePresetId(null);
  }, []);

  const handleToggleOverrideDeath = useCallback((checked: boolean) => {
    setOverrideDeathYear(checked);
    setActivePresetId(null);
  }, []);

  const handleCustomDeathYearChange = useCallback((year: number) => {
    setCustomDeathYear(year);
    setActivePresetId(null);
  }, []);

  const desktopBrandHeader = (
    <header className="brand-header desktop-brand-header">
      <div className="brand-title">
        <img
          src="./favicon.svg"
          alt="XYLEM Specimen Mark"
          width={22}
          height={22}
          className="brand-specimen-icon"
        />
        <div className="brand-title-group">
          <h1>XYLEM</h1>
          <span className="brand-tagline">An Ecological Ledger of Deep Time</span>
        </div>
      </div>
      <p className="brand-subtitle">
        Retrospective Dendrochronology &amp; Biological Climate Memory Across Deep Environmental Time
      </p>
    </header>
  );

  return (
    <div
      className={`app-shell ${isExhibitionMode ? 'exhibition-mode' : ''}`}
      style={{ '--canvas-bg': activePalette.background } as React.CSSProperties}
    >
      {hoveredRing !== null && (
        <style>{`
          .svg-viewport svg path[data-ring="${hoveredRing}"][data-year] {
            stroke: #000000;
            stroke-width: 1.6px;
            vector-effect: non-scaling-stroke;
          }
        `}</style>
      )}

      <main className="main-stage">
        {/* Full-Bleed Interactive Specimen Canvas */}
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
              specimenResetKey={`${simulation.seedKey}:${totalAge}:${effectiveDeathYear}`}
              ringsByIndex={ringsByIndex}
              hoveredRing={hoveredRing}
              unitSystem={unitSystem}
              onHoverRing={setHoveredRing}
              isExhibitionMode={isExhibitionMode}
              ambientDriftEnabled={ambientDriftEnabled}
              transparentBackground={renderOptions.transparentBackground}
              isDrawerOpen={isDrawerOpen && !isMobileViewport}
            />
          )}
        </div>

        {/* Desktop Minimalist Floating HUD & Tucked Controls */}
        {!isExhibitionMode && !isMobileViewport && (
          <>
            <SpecimenHud
              brandHeader={desktopBrandHeader}
              species={species}
              latitude={latitude}
              longitude={longitude}
              latInput={latInput}
              lonInput={lonInput}
              totalAge={totalAge}
              overrideDeathYear={overrideDeathYear}
              customDeathYear={customDeathYear}
              currentCalendarYear={currentCalendarYear}
              effectiveDeathYear={effectiveDeathYear}
              unitSystem={unitSystem}
              simulation={simulation}
              viabilityDetail={viabilityDetail}
              activePresetId={activePresetId}
              activePalette={activePalette}
              showLocatorMap={renderOptions.showLocatorMap ?? true}
              transparentBackground={renderOptions.transparentBackground}
              activeEditor={activeEditor}
              onToggleEditor={handleToggleEditor}
              onCloseEditor={() => setActiveEditor(null)}
              onSelectSpecies={handleSelectSpecies}
              onLatInputChange={handleLatInputChange}
              onLonInputChange={handleLonInputChange}
              onCommitCoords={commitCoordInputs}
              onSelectMapLocation={handleMapSelect}
              onSelectReferenceSite={handleReferenceSiteSelect}
              onAgeChange={handleAgeChange}
              onToggleOverrideDeathYear={handleToggleOverrideDeath}
              onCustomDeathYearChange={handleCustomDeathYearChange}
            />

            {/* Top-Right Compact Utility Trigger Pill */}
            <nav
              className="top-right-utility-pill"
              aria-label="Workspace tools and guides"
            >
              <button
                type="button"
                className={`utility-pill-btn primary ${isDrawerOpen ? 'active' : ''}`}
                onClick={() => setIsDrawerOpen((o) => !o)}
                aria-expanded={isDrawerOpen}
                title="Open Ledger, Presets, Style & Export Drawer"
              >
                <Sliders size={13} aria-hidden="true" />
                <span>Controls</span>
              </button>
              <button
                type="button"
                className="utility-pill-btn"
                onClick={() => setIsTutorialOpen(true)}
                aria-label="Open Dendrochronology & Wood Anatomy Guide"
                title="Interactive Dendrochronology & Cross-Section Guide"
              >
                <BookOpen size={13} aria-hidden="true" />
                <span>Guide</span>
              </button>
              <button
                type="button"
                className="utility-pill-btn btn-colophon-trigger"
                onClick={() => setIsColophonOpen(true)}
                aria-label="Open Colophon and Artist Statement"
                title="Colophon & Ecological Ledger Statement"
              >
                <Info size={13} aria-hidden="true" />
                <span>Colophon</span>
              </button>
              <button
                type="button"
                className="utility-pill-btn"
                onClick={toggleExhibitionMode}
                aria-label="Enter Fullscreen Zen Mode (F)"
                title="Fullscreen Zen Mode (Press F)"
              >
                <Maximize2 size={13} aria-hidden="true" />
                <span>Exhibit</span>
              </button>
            </nav>

            <ControlsDrawer
              isOpen={isDrawerOpen}
              activeTab={drawerTab}
              onTabChange={setDrawerTab}
              onClose={() => setIsDrawerOpen(false)}
              simulation={simulation}
              story={envNarrative?.story ?? null}
              viabilityDetail={viabilityDetail}
              latitude={latitude}
              longitude={longitude}
              unitSystem={unitSystem}
              onChangeUnitSystem={setUnitSystem}
              activePresetId={activePresetId}
              onSelectPreset={handleSelectPreset}
              selectedPalette={selectedPalette}
              onSelectPalette={setSelectedPalette}
              enableWoodGrain={enableWoodGrain}
              onToggleWoodGrain={setEnableWoodGrain}
              renderOptions={renderOptions}
              onChangeRenderOptions={setRenderOptions}
              hasSpecimen={Boolean(simulation)}
              includeColophonBorder={includeColophonBorder}
              onToggleColophonBorder={setIncludeColophonBorder}
              copiedShareLink={copiedShareLink}
              copiedSvg={copiedSvg}
              isExportingPng={isExportingPng}
              onCopyShareLink={handleCopyShareLink}
              onCopySvg={handleCopySvg}
              onExportSvg={handleExportSvg}
              onExport4kPng={handleExport4kPng}
              onOpenColophon={() => setIsColophonOpen(true)}
              onOpenGuide={() => setIsTutorialOpen(true)}
            />

            {simulation && (
              <TimelineDock
                isOpen={isTimelineOpen}
                onToggleOpen={() => setIsTimelineOpen((o) => !o)}
                mode={navMode}
                onModeChange={setNavMode}
                totalRings={simulation.visibleRingCount}
                activeRingIndex={
                  effectiveMaxRenderedRing ?? simulation.visibleRingCount
                }
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
                activeRecord={ringsByIndex.get(
                  effectiveMaxRenderedRing ?? simulation.visibleRingCount
                )}
                records={ringRecords}
                hoveredRing={hoveredRing}
                unitSystem={unitSystem}
                latitude={latitude}
                longitude={longitude}
                onHoverRing={setHoveredRing}
              />
            )}
          </>
        )}

        {/* Mobile Full-Screen Header & Bottom Toggle Tab Sheet */}
        {!isExhibitionMode && isMobileViewport && (
          <>
            <header className="brand-header mobile-brand-header">
              <div className="brand-top-row">
                <div className="brand-title">
                  <img
                    src="./favicon.svg"
                    alt="XYLEM Specimen Mark"
                    width={20}
                    height={20}
                    className="brand-specimen-icon"
                  />
                  <div className="brand-title-group">
                    <h1>XYLEM</h1>
                    <span className="brand-tagline">
                      An Ecological Ledger of Deep Time
                    </span>
                  </div>
                </div>
                <div className="mobile-header-actions">
                  <button
                    type="button"
                    className="utility-pill-btn"
                    onClick={() => setIsTutorialOpen(true)}
                    aria-label="Open Dendrochronology & Wood Anatomy Guide"
                    title="Guide"
                  >
                    <BookOpen size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="utility-pill-btn btn-colophon-trigger"
                    onClick={() => setIsColophonOpen(true)}
                    aria-label="Open Colophon and Artist Statement"
                    title="Colophon"
                  >
                    <Info size={13} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </header>

            <MobileSheet
              isOpen={isMobileSheetOpen}
              activeTab={mobileSheetTab}
              onOpen={() => setIsMobileSheetOpen(true)}
              onClose={() => setIsMobileSheetOpen(false)}
              onTabChange={setMobileSheetTab}
              species={species}
              onSelectSpecies={handleSelectSpecies}
              latitude={latitude}
              longitude={longitude}
              latInput={latInput}
              lonInput={lonInput}
              onLatInputChange={handleLatInputChange}
              onLonInputChange={handleLonInputChange}
              onCommitCoords={commitCoordInputs}
              onSelectMapLocation={handleMapSelect}
              onSelectReferenceSite={handleReferenceSiteSelect}
              totalAge={totalAge}
              overrideDeathYear={overrideDeathYear}
              customDeathYear={customDeathYear}
              currentCalendarYear={currentCalendarYear}
              effectiveDeathYear={effectiveDeathYear}
              onAgeChange={handleAgeChange}
              onToggleOverrideDeathYear={handleToggleOverrideDeath}
              onCustomDeathYearChange={handleCustomDeathYearChange}
              activePresetId={activePresetId}
              onSelectPreset={handleSelectPreset}
              simulation={simulation}
              story={envNarrative?.story ?? null}
              viabilityDetail={viabilityDetail}
              unitSystem={unitSystem}
              onChangeUnitSystem={setUnitSystem}
              activePalette={activePalette}
              selectedPalette={selectedPalette}
              onSelectPalette={setSelectedPalette}
              enableWoodGrain={enableWoodGrain}
              onToggleWoodGrain={setEnableWoodGrain}
              renderOptions={renderOptions}
              onChangeRenderOptions={setRenderOptions}
              navMode={navMode}
              onModeChange={setNavMode}
              activeRingIndex={
                effectiveMaxRenderedRing ?? simulation?.visibleRingCount ?? 1
              }
              onRingChange={(idx) => {
                setIsPlaying(false);
                setActiveRingIndex(idx);
              }}
              isPlaying={isPlaying}
              onTogglePlay={() => setIsPlaying((p) => !p)}
              playbackSpeed={playbackSpeed}
              onSpeedChange={setPlaybackSpeed}
              ringRecords={ringRecords}
              ringsByIndex={ringsByIndex}
              hoveredRing={hoveredRing}
              onHoverRing={setHoveredRing}
              includeColophonBorder={includeColophonBorder}
              onToggleColophonBorder={setIncludeColophonBorder}
              copiedShareLink={copiedShareLink}
              copiedSvg={copiedSvg}
              isExportingPng={isExportingPng}
              onCopyShareLink={handleCopyShareLink}
              onCopySvg={handleCopySvg}
              onExportSvg={handleExportSvg}
              onExport4kPng={handleExport4kPng}
              onOpenColophon={() => setIsColophonOpen(true)}
              onOpenGuide={() => setIsTutorialOpen(true)}
            />
          </>
        )}

        {/* Fullscreen Zen Exhibition Floating Minimal Controls Pill */}
        {isExhibitionMode && simulation && (
          <div
            className={`floating-exhibition-bar ${controlsVisible ? 'visible' : 'hidden'}`}
            onMouseEnter={() => setControlsVisible(true)}
          >
            <TimeNavigation
              mode={navMode}
              onModeChange={setNavMode}
              totalRings={simulation.visibleRingCount}
              activeRingIndex={
                effectiveMaxRenderedRing ?? simulation.visibleRingCount
              }
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
              activeRecord={ringsByIndex.get(
                effectiveMaxRenderedRing ?? simulation.visibleRingCount
              )}
              className="exhibition-compact-nav"
            />
            <div className="exhibition-bar-actions">
              <button
                type="button"
                className={`btn-exhibition-pill ${ambientDriftEnabled ? 'active' : ''}`}
                onClick={() => setAmbientDriftEnabled((a) => !a)}
                title={
                  ambientDriftEnabled
                    ? 'Pause ambient camera drift'
                    : 'Resume ambient camera drift'
                }
              >
                <Activity size={13} />
                <span>{ambientDriftEnabled ? 'Drift: On' : 'Drift: Off'}</span>
              </button>
              <button
                type="button"
                className="btn-exhibition-pill"
                onClick={() => {
                  const list: PaletteId[] = [
                    'aged-wood',
                    'charred-subalpine',
                    'skeleton-plot',
                  ];
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
                title="Exit Zen Exhibition Mode (Esc / F)"
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
