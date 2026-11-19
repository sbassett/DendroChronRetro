import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { SvgViewBox } from '../model/svgGenerator';
import { AnnualRingRecord } from '../model/types';
import { formatRingWidth, UnitSystem } from '../model/units';

export interface SvgViewportProps {
  innerMarkup: string;
  baseViewBox: SvgViewBox;
  specimenResetKey: string;
  ringsByIndex: Map<number, AnnualRingRecord>;
  hoveredRing: number | null;
  unitSystem: UnitSystem;
  onHoverRing: (ringIndex: number | null) => void;
  isExhibitionMode?: boolean;
  ambientDriftEnabled?: boolean;
  transparentBackground?: boolean;
  isDrawerOpen?: boolean;
  frostYears?: number[];
}

/**
 * Returns disturbance trauma tags for a given annual ring record.
 */
export function getDisturbanceTraumaTags(
  rec: AnnualRingRecord,
  frostYears: number[] = [1783, 1809, 1816, 536, 1257]
): string[] {
  const tags: string[] = [];

  // Severe moisture deficit
  if (
    (rec.relativeWidthIndex !== undefined && rec.relativeWidthIndex < 0.45) ||
    (rec.limitingFactor === 'moisture' && rec.climateIndex < 0.42)
  ) {
    tags.push('Severe moisture deficit');
  }

  // Pluvial summer
  if (
    (rec.relativeWidthIndex !== undefined && rec.relativeWidthIndex >= 1.3) ||
    rec.climateIndex >= 1.35
  ) {
    tags.push('Pluvial summer');
  }

  // Traumatic cold shock
  if (
    frostYears.includes(rec.calendarYear) ||
    (rec.limitingFactor === 'temperature' && rec.climateIndex < 0.5)
  ) {
    tags.push('Traumatic cold shock');
  }

  // False Ring (IADF)
  if (rec.hasFalseRing) {
    tags.push('False Ring (IADF)');
  }

  // Fire Injury & Healing Callus Margin
  if (rec.hasFireScar) {
    tags.push('Fire Injury & Healing Callus Margin');
  }

  // Locally Absent Ring
  if (
    rec.isLocallyAbsent ||
    (rec.relativeWidthIndex !== undefined && rec.relativeWidthIndex < 0.35)
  ) {
    tags.push('Locally Absent Ring');
  }

  return tags;
}

/**
 * Categorizes and formats RWI for tooltip display.
 */
export function getRwiInspectionInfo(rwi?: number): {
  label: string;
  category: 'pluvial' | 'complacent' | 'drought' | 'severe';
  summary: string;
} {
  if (rwi === undefined) {
    return {
      label: 'Standardized',
      category: 'complacent',
      summary: 'Baseline index',
    };
  }
  if (rwi >= 1.3) {
    return {
      label: `RWI ${rwi.toFixed(2)}`,
      category: 'pluvial',
      summary: 'Pluvial Pulse (Vigorous earlywood expansion)',
    };
  }
  if (rwi >= 0.7) {
    return {
      label: `RWI ${rwi.toFixed(2)}`,
      category: 'complacent',
      summary: 'Complacent Growth (Mean bioclimatic baseline)',
    };
  }
  if (rwi >= 0.4) {
    return {
      label: `RWI ${rwi.toFixed(2)}`,
      category: 'drought',
      summary: 'Moderate Drought Deficit (Narrow latewood)',
    };
  }
  return {
    label: `RWI ${rwi.toFixed(2)}`,
    category: 'severe',
    summary: 'Severe Drought Crisis (Hairline cambial arrest)',
  };
}

/**
 * Returns human-readable climatic and moisture stress level description.
 */
export function getClimaticStressDescription(rec: AnnualRingRecord): string {
  if (rec.limitingFactor === 'moisture') {
    if (rec.climateIndex < 0.4) return 'Acute Soil Moisture Drought Deficit';
    if (rec.climateIndex < 0.75) return 'Moderate Summer Moisture Limitation';
    return 'Moisture-Governed Growth';
  }
  if (rec.limitingFactor === 'temperature') {
    if (rec.climateIndex < 0.5) return 'Short Growing Degree-Day Cold Limitation';
    return 'Subalpine Thermal Limitation';
  }
  return 'Equable Moisture & Thermal Balance';
}

export const SvgViewport: React.FC<SvgViewportProps> = ({
  innerMarkup,
  baseViewBox,
  specimenResetKey,
  ringsByIndex,
  hoveredRing,
  unitSystem,
  onHoverRing,
  isExhibitionMode = false,
  ambientDriftEnabled = true,
  transparentBackground = false,
  isDrawerOpen = false,
  frostYears = [1783, 1809, 1816, 536, 1257],
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const baseCenter = useMemo(
    () => ({
      x: baseViewBox.x + baseViewBox.width / 2,
      y: baseViewBox.y + baseViewBox.height / 2,
    }),
    [baseViewBox.x, baseViewBox.y, baseViewBox.width, baseViewBox.height]
  );

  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [prevResetKey, setPrevResetKey] = useState(specimenResetKey);
  const [isDragging, setIsDragging] = useState(false);
  const [lastUserInteractionTime, setLastUserInteractionTime] = useState<number>(0);
  const [driftOffset, setDriftOffset] = useState({ x: 0, y: 0, scale: 1 });

  // Synchronously reset zoom & pan on specimen change
  if (prevResetKey !== specimenResetKey) {
    setPrevResetKey(specimenResetKey);
    if (zoom !== 1) setZoom(1);
    if (panOffset.x !== 0 || panOffset.y !== 0) {
      setPanOffset({ x: 0, y: 0 });
    }
  }

  const effectiveZoom = prevResetKey !== specimenResetKey ? 1 : zoom;
  const effectivePan =
    prevResetKey !== specimenResetKey ? { x: 0, y: 0 } : panOffset;

  const center = useMemo(
    () => ({
      x: baseCenter.x + effectivePan.x + driftOffset.x,
      y: baseCenter.y + effectivePan.y + driftOffset.y,
    }),
    [baseCenter.x, baseCenter.y, effectivePan.x, effectivePan.y, driftOffset.x, driftOffset.y]
  );

  const dragRef = useRef({
    startClientX: 0,
    startClientY: 0,
    startPanX: 0,
    startPanY: 0,
    mmPerPxX: 1,
    mmPerPxY: 1,
  });

  const stateRef = useRef({ zoom: effectiveZoom, center, baseCenter });
  stateRef.current = { zoom: effectiveZoom, center, baseCenter };

  // Ambient camera drift & breathing pulse loop in exhibition mode
  useEffect(() => {
    if (!isExhibitionMode || !ambientDriftEnabled) {
      setDriftOffset({ x: 0, y: 0, scale: 1 });
      return;
    }

    let animationFrameId: number;
    let startTime = performance.now();

    const loop = (time: number) => {
      const now = Date.now();
      const isInteracting = isDragging || hoveredRing !== null || now - lastUserInteractionTime < 2500;

      if (!isInteracting) {
        const t = (time - startTime) * 0.001; // elapsed seconds
        // Sinusoidal slow camera drift and subtle breathing pulse
        const dx = 0.006 * Math.sin(0.045 * t) * baseViewBox.width;
        const dy = 0.006 * Math.cos(0.038 * t) * baseViewBox.height;
        const ds = 1.0 + 0.012 * Math.sin(0.025 * t);
        setDriftOffset({ x: dx, y: dy, scale: ds });
      } else {
        // Smoothly decay drift toward identity during user interaction
        setDriftOffset((prev) => ({
          x: prev.x * 0.92,
          y: prev.y * 0.92,
          scale: 1 + (prev.scale - 1) * 0.92,
        }));
      }

      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [
    isExhibitionMode,
    ambientDriftEnabled,
    isDragging,
    hoveredRing,
    lastUserInteractionTime,
    baseViewBox.width,
    baseViewBox.height,
  ]);

  // Attach non-passive wheel listener
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setLastUserInteractionTime(Date.now());
      const svg = svgRef.current;
      const {
        zoom: curZoom,
        center: curCenter,
        baseCenter: curBaseCenter,
      } = stateRef.current;
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const nextZoom = Math.max(0.5, Math.min(35, curZoom * factor));
      if (nextZoom === curZoom) return;

      if (svg) {
        const ctm = svg.getScreenCTM();
        if (ctm) {
          const pt = svg.createSVGPoint();
          pt.x = e.clientX;
          pt.y = e.clientY;
          const svgPt = pt.matrixTransform(ctm.inverse());
          const ratio = curZoom / nextZoom;
          const nextCenterX = svgPt.x - (svgPt.x - curCenter.x) * ratio;
          const nextCenterY = svgPt.y - (svgPt.y - curCenter.y) * ratio;
          setPanOffset({
            x: nextCenterX - curBaseCenter.x,
            y: nextCenterY - curBaseCenter.y,
          });
          setZoom(nextZoom);
          return;
        }
      }
      setZoom(nextZoom);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      setLastUserInteractionTime(Date.now());
      const svg = svgRef.current;
      let mmPerPxX = baseViewBox.width / Math.max(1, effectiveZoom * 800);
      let mmPerPxY = mmPerPxX;
      if (svg) {
        const ctm = svg.getScreenCTM();
        if (ctm && ctm.a !== 0 && ctm.d !== 0) {
          mmPerPxX = 1 / ctm.a;
          mmPerPxY = 1 / ctm.d;
        }
      }
      setIsDragging(true);
      dragRef.current = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: effectivePan.x,
        startPanY: effectivePan.y,
        mmPerPxX,
        mmPerPxY,
      };
    },
    [baseViewBox.width, effectivePan.x, effectivePan.y, effectiveZoom]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      setLastUserInteractionTime(Date.now());
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}

      const svg = svgRef.current;
      let mmPerPxX = baseViewBox.width / Math.max(1, effectiveZoom * 800);
      let mmPerPxY = mmPerPxX;
      if (svg) {
        const ctm = svg.getScreenCTM();
        if (ctm && ctm.a !== 0 && ctm.d !== 0) {
          mmPerPxX = 1 / ctm.a;
          mmPerPxY = 1 / ctm.d;
        }
      }
      setIsDragging(true);
      dragRef.current = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: effectivePan.x,
        startPanY: effectivePan.y,
        mmPerPxX,
        mmPerPxY,
      };
    },
    [baseViewBox.width, effectivePan.x, effectivePan.y, effectiveZoom]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      setLastUserInteractionTime(Date.now());
      if (isDragging) {
        const dx = e.clientX - dragRef.current.startClientX;
        const dy = e.clientY - dragRef.current.startClientY;
        setPanOffset({
          x: dragRef.current.startPanX - dx * dragRef.current.mmPerPxX,
          y: dragRef.current.startPanY - dy * dragRef.current.mmPerPxY,
        });
        return;
      }

      const target = e.target as Element | null;
      const ringEl = target?.closest?.('[data-ring]');
      if (ringEl) {
        const idx = Number(ringEl.getAttribute('data-ring'));
        if (!Number.isNaN(idx)) {
          onHoverRing(idx);
          return;
        }
      }
      onHoverRing(null);
    },
    [isDragging, onHoverRing]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      setLastUserInteractionTime(Date.now());
      if (isDragging) {
        const dx = e.clientX - dragRef.current.startClientX;
        const dy = e.clientY - dragRef.current.startClientY;
        setPanOffset({
          x: dragRef.current.startPanX - dx * dragRef.current.mmPerPxX,
          y: dragRef.current.startPanY - dy * dragRef.current.mmPerPxY,
        });
        return;
      }

      const target = e.target as Element | null;
      const ringEl = target?.closest?.('[data-ring]');
      if (ringEl) {
        const idx = Number(ringEl.getAttribute('data-ring'));
        if (!Number.isNaN(idx)) {
          onHoverRing(idx);
          return;
        }
      }
      onHoverRing(null);
    },
    [isDragging, onHoverRing]
  );

  const stopDrag = useCallback(() => {
    setIsDragging(false);
  }, []);

  const stopPointerDrag = useCallback((e?: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(false);
    if (e) {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {}
    }
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
    setDriftOffset({ x: 0, y: 0, scale: 1 });
  }, []);

  const totalZoom = effectiveZoom * driftOffset.scale;
  const activeVbW = baseViewBox.width / totalZoom;
  const activeVbH = baseViewBox.height / totalZoom;
  const activeVbX = center.x - activeVbW / 2;
  const activeVbY = center.y - activeVbH / 2;

  const svgInnerHtml = useMemo(() => ({ __html: innerMarkup }), [innerMarkup]);
  const activeRec = hoveredRing ? ringsByIndex.get(hoveredRing) : undefined;

  const rwiInfo = useMemo(
    () => (activeRec ? getRwiInspectionInfo(activeRec.relativeWidthIndex) : null),
    [activeRec]
  );

  const stressDescription = useMemo(
    () => (activeRec ? getClimaticStressDescription(activeRec) : ''),
    [activeRec]
  );

  const traumaTags = useMemo(
    () => (activeRec ? getDisturbanceTraumaTags(activeRec, frostYears) : []),
    [activeRec, frostYears]
  );

  return (
    <div
      ref={containerRef}
      className={`svg-viewport ${isDragging ? 'dragging' : ''} ${
        isExhibitionMode ? 'exhibition-viewport' : ''
      } ${transparentBackground ? 'transparent-bg' : ''}`}
      style={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopPointerDrag}
      onPointerCancel={stopPointerDrag}
      onLostPointerCapture={stopPointerDrag}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={() => {
        stopDrag();
        onHoverRing(null);
      }}
    >
      <svg
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        className="vector-stage-svg"
        shapeRendering="geometricPrecision"
        preserveAspectRatio="xMidYMid meet"
        viewBox={`${activeVbX.toFixed(3)} ${activeVbY.toFixed(3)} ${activeVbW.toFixed(3)} ${activeVbH.toFixed(3)}`}
        dangerouslySetInnerHTML={svgInnerHtml}
      />

      {/* Floating Viewport Navigation Toolbar */}
      <div
        className="viewport-controls"
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        role="toolbar"
        aria-label="Viewport zoom controls"
      >
        <button
          type="button"
          title="Zoom in (+)"
          onClick={() => {
            setLastUserInteractionTime(Date.now());
            setZoom((z) => Math.min(35, z * 1.35));
          }}
          aria-label="Zoom in"
        >
          <ZoomIn size={15} />
        </button>
        <button
          type="button"
          title="Zoom out (-)"
          onClick={() => {
            setLastUserInteractionTime(Date.now());
            setZoom((z) => Math.max(0.5, z / 1.35));
          }}
          aria-label="Zoom out"
        >
          <ZoomOut size={15} />
        </button>
        <button
          type="button"
          title="Reset zoom and view center"
          onClick={resetView}
          aria-label="Reset view"
        >
          <RotateCcw size={15} />
        </button>
        <span className="zoom-readout">{Math.round(totalZoom * 100)}%</span>
      </div>

      {/* Dynamic Ring Inspection HUD */}
      {activeRec && rwiInfo && (
        <div
          className={`ring-inspector-badge ${isDrawerOpen ? 'drawer-offset' : ''}`}
          role="status"
          aria-live="polite"
        >
          <div className="ring-badge-header">
            <div className="ring-badge-year-row">
              <strong className="ring-year-text">
                Year {activeRec.calendarYear} CE
              </strong>
              <span className={`ring-rwi-pill ${rwiInfo.category}`}>
                {rwiInfo.label}
              </span>
            </div>
            <span className="ring-index-text">
              Ring #{activeRec.ringIndex} of {ringsByIndex.size} (Tree Age {activeRec.treeAge} yr)
            </span>
          </div>

          <div className="ring-badge-metrics">
            <div className="ring-metric-row">
              <span className="metric-label">Width:</span>
              <span className="metric-val">
                {formatRingWidth(activeRec.meanWidthMm, unitSystem)}
              </span>
              <span className="metric-meta">
                ({Math.round(activeRec.latewoodFraction * 100)}% latewood ·{' '}
                {activeRec.isHeartwood ? 'Heartwood' : 'Sapwood'})
              </span>
            </div>
            <div className="ring-metric-row">
              <span className="metric-label">Climatic Stress:</span>
              <span className="metric-val">{stressDescription}</span>
            </div>
          </div>

          {traumaTags.length > 0 && (
            <div className="ring-trauma-tags-row">
              {traumaTags.map((tag) => (
                <span key={tag} className="trauma-tag">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
