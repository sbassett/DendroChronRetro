import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { SvgViewBox } from '../model/svgGenerator';
import { AnnualRingRecord } from '../model/types';
import { formatRingWidth, UnitSystem } from '../model/units';

interface SvgViewportProps {
  innerMarkup: string;
  baseViewBox: SvgViewBox;
  specimenResetKey: string;
  ringsByIndex: Map<number, AnnualRingRecord>;
  hoveredRing: number | null;
  unitSystem: UnitSystem;
  onHoverRing: (ringIndex: number | null) => void;
}

export const SvgViewport: React.FC<SvgViewportProps> = ({
  innerMarkup,
  baseViewBox,
  specimenResetKey,
  ringsByIndex,
  hoveredRing,
  unitSystem,
  onHoverRing,
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

  // Synchronously reset zoom & pan on specimen change so viewBox matches baseViewBox on the very first frame
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
      x: baseCenter.x + effectivePan.x,
      y: baseCenter.y + effectivePan.y,
    }),
    [baseCenter.x, baseCenter.y, effectivePan.x, effectivePan.y]
  );

  const dragRef = useRef({
    startClientX: 0,
    startClientY: 0,
    startPanX: 0,
    startPanY: 0,
    mmPerPxX: 1,
    mmPerPxY: 1,
  });

  // Attach non-passive wheel listener so page never scrolls and cursor-anchored vector zoom is exact
  const stateRef = useRef({ zoom: effectiveZoom, center, baseCenter });
  stateRef.current = { zoom: effectiveZoom, center, baseCenter };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
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

  const resetView = useCallback(() => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  const activeVbW = baseViewBox.width / effectiveZoom;
  const activeVbH = baseViewBox.height / effectiveZoom;
  const activeVbX = center.x - activeVbW / 2;
  const activeVbY = center.y - activeVbH / 2;

  const svgInnerHtml = useMemo(() => ({ __html: innerMarkup }), [innerMarkup]);
  const activeRec = hoveredRing ? ringsByIndex.get(hoveredRing) : undefined;

  return (
    <div
      ref={containerRef}
      className={`svg-viewport ${isDragging ? 'dragging' : ''}`}
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

      <div className="viewport-controls" onMouseDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          title="Zoom in"
          onClick={() => setZoom((z) => Math.min(35, z * 1.35))}
        >
          <ZoomIn size={15} />
        </button>
        <button
          type="button"
          title="Zoom out"
          onClick={() => setZoom((z) => Math.max(0.5, z / 1.35))}
        >
          <ZoomOut size={15} />
        </button>
        <button type="button" title="Reset view" onClick={resetView}>
          <RotateCcw size={15} />
        </button>
        <span className="zoom-readout">{Math.round(effectiveZoom * 100)}%</span>
      </div>

      {activeRec && (
        <div className="ring-inspector-badge">
          <div className="ring-badge-header">
            <strong>Year {activeRec.calendarYear}</strong>
            <span>
              Ring #{activeRec.ringIndex} (Tree Age {activeRec.treeAge} yr)
            </span>
          </div>
          <div className="ring-badge-metrics">
            <span>
              Width: {formatRingWidth(activeRec.meanWidthMm, unitSystem)}
            </span>
            <span>Latewood: {Math.round(activeRec.latewoodFraction * 100)}%</span>
            <span>{activeRec.isHeartwood ? 'Heartwood' : 'Sapwood'}</span>
            <span>
              {activeRec.limitingFactor === 'moisture'
                ? 'Moisture-limited'
                : activeRec.limitingFactor === 'temperature'
                  ? 'Temp-limited'
                  : 'Balanced climate'}
              {activeRec.hasFalseRing ? ' · False ring (IADF)' : ''}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
