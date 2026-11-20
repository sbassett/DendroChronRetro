import React, { useMemo } from 'react';
import {
  ClimateLandmark,
  getRelevantClimateLandmarks,
} from '../model/narrative';
import { AnnualRingRecord, ClimateProvenance } from '../model/types';
import { formatRingWidth, UnitSystem } from '../model/units';

function formatShortProvenance(prov?: ClimateProvenance, isSynthetic?: boolean): string {
  switch (prov) {
    case 'reanalysis-merra2':
      return 'MERRA-2';
    case 'reanalysis-era5':
      return 'ERA5';
    case 'instrumental-nclimdiv':
      return 'nClimDiv';
    case 'paleo-atlas':
      return 'Paleo Atlas';
    case 'synthetic':
      return 'Synthetic';
    default:
      return isSynthetic ? 'Synthetic' : 'Observed';
  }
}

function barProvenanceClass(rec: AnnualRingRecord): string {
  if (rec.climateProvenance === 'paleo-atlas') return 'paleo';
  if (rec.climateProvenance === 'instrumental-nclimdiv') return 'instrumental';
  if (rec.climateProvenance === 'reanalysis-era5') return 'era5';
  if (rec.climateProvenance === 'synthetic') return 'synthetic';
  return rec.isSyntheticClimate ? 'synthetic' : '';
}

interface RingChronologyChartProps {
  records: AnnualRingRecord[];
  hoveredRing: number | null;
  unitSystem: UnitSystem;
  latitude: number;
  longitude: number;
  onHoverRing: (ringIndex: number | null) => void;
}

export const RingChronologyChart: React.FC<RingChronologyChartProps> = ({
  records,
  hoveredRing,
  unitSystem,
  latitude,
  longitude,
  onHoverRing,
}) => {
  if (records.length === 0) return null;

  const maxWidth = Math.max(...records.map((r) => r.meanWidthMm), 1.0);
  const firstYear = records[0].calendarYear;
  const lastYear = records[records.length - 1].calendarYear;

  const axisTransitionMarkers = useMemo(() => {
    const hasExplicitProvenance = records.some((r) => r.climateProvenance !== undefined);
    if (!hasExplicitProvenance) {
      const legacyStart = records[0].isSyntheticClimate
        ? (records.find((r) => !r.isSyntheticClimate)?.calendarYear ?? null)
        : null;
      return legacyStart !== null
        ? [`${legacyStart} (Observed Weather Start)`]
        : [];
    }

    const candidates: Array<{ year: number; label: string }> = [];
    const seen = new Set<string>();
    const tierStartLabels: Partial<Record<ClimateProvenance, string>> = {
      'instrumental-nclimdiv': 'Instrumental',
      'reanalysis-era5': 'ERA5',
      'reanalysis-merra2': 'MERRA-2',
    };

    for (let i = 1; i < records.length; i++) {
      const prev = records[i - 1].climateProvenance;
      const cur = records[i].climateProvenance;
      if (cur && cur !== prev && tierStartLabels[cur] && !seen.has(cur)) {
        seen.add(cur);
        candidates.push({
          year: records[i].calendarYear,
          label: `${records[i].calendarYear} (${tierStartLabels[cur]})`,
        });
      }
    }

    if (candidates.length <= 2) {
      return candidates.map((c) => c.label);
    }
    // Keep at most 2 well-spaced interior transition markers so the axis never crowds
    return [candidates[0].label, candidates[candidates.length - 1].label];
  }, [records]);

  // Filter regional climate landmarks for this tree's lifespan and geography
  const landmarks = useMemo(
    () => getRelevantClimateLandmarks(firstYear, lastYear, latitude, longitude),
    [firstYear, lastYear, latitude, longitude]
  );

  const landmarksByYear = useMemo(() => {
    const map = new Map<number, ClimateLandmark>();
    for (const lm of landmarks) {
      map.set(lm.year, lm);
    }
    return map;
  }, [landmarks]);

  const recordByYear = useMemo(() => {
    const map = new Map<number, AnnualRingRecord>();
    for (const r of records) {
      map.set(r.calendarYear, r);
    }
    return map;
  }, [records]);

  const fireRecords = useMemo(
    () => records.filter((r) => r.hasFireScar),
    [records]
  );

  const fireByYear = useMemo(() => {
    const map = new Map<number, AnnualRingRecord>();
    for (const r of fireRecords) {
      map.set(r.calendarYear, r);
    }
    return map;
  }, [fireRecords]);

  const visibleFlagYears = useMemo(() => {
    const shown = new Set<number>();
    const minGap = Math.max(12, Math.round((lastYear - firstYear) * 0.14));
    let lastShownYear = -Infinity;
    for (const lm of landmarks) {
      if (!recordByYear.has(lm.year)) continue;
      if (lm.year - lastShownYear >= minGap) {
        shown.add(lm.year);
        lastShownYear = lm.year;
      }
    }
    return shown;
  }, [landmarks, recordByYear, firstYear, lastYear]);

  const visibleFirePinYears = useMemo(() => {
    const shown = new Set<number>();
    const minGap = Math.max(10, Math.round((lastYear - firstYear) * 0.08));
    for (const fr of fireRecords) {
      let overlaps = false;
      for (const fy of visibleFlagYears) {
        if (Math.abs(fr.calendarYear - fy) < minGap) {
          overlaps = true;
          break;
        }
      }
      for (const py of shown) {
        if (Math.abs(fr.calendarYear - py) < minGap) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        shown.add(fr.calendarYear);
      }
    }
    return shown;
  }, [fireRecords, visibleFlagYears, firstYear, lastYear]);

  const activeHoveredRecord = useMemo(
    () => (hoveredRing !== null ? records.find((r) => r.ringIndex === hoveredRing) : null),
    [hoveredRing, records]
  );

  const activeLandmark = activeHoveredRecord
    ? landmarksByYear.get(activeHoveredRecord.calendarYear)
    : null;
  const activeFireRecord =
    activeHoveredRecord && activeHoveredRecord.hasFireScar
      ? activeHoveredRecord
      : null;

  const barsContainerRef = React.useRef<HTMLDivElement | null>(null);
  const isPointerScrubbingRef = React.useRef(false);

  const handlePointerScrub = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = barsContainerRef.current;
      if (!el || records.length === 0) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const clientX = e.clientX;
      const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const targetIndex = Math.min(records.length - 1, Math.floor(fraction * records.length));
      onHoverRing(records[targetIndex].ringIndex);
    },
    [records, onHoverRing]
  );

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      isPointerScrubbingRef.current = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
      handlePointerScrub(e);
    },
    [handlePointerScrub]
  );

  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isPointerScrubbingRef.current) {
        handlePointerScrub(e);
      }
    },
    [handlePointerScrub]
  );

  const handlePointerUp = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      isPointerScrubbingRef.current = false;
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {}
    },
    []
  );

  return (
    <div className="chronology-panel">
      <div className="chronology-header">
        <div className="chronology-title-row">
          <span className="chronology-title">
            Ring-Width Chronology ({firstYear}–{lastYear})
          </span>
          {landmarks.length > 0 && (
            <div className="landmark-chips-strip">
              <span className="landmark-label">Climate Signals:</span>
              {landmarks.map((lm) => {
                const rec = recordByYear.get(lm.year);
                if (!rec) return null;
                const isSelected = hoveredRing === rec.ringIndex;
                return (
                  <button
                    key={lm.year}
                    type="button"
                    className={`landmark-chip ${isSelected ? 'active' : ''} ${lm.type}`}
                    onClick={() => onHoverRing(isSelected ? null : rec.ringIndex)}
                    onMouseEnter={() => onHoverRing(rec.ringIndex)}
                    title={`${lm.fullName}: ${lm.description}`}
                  >
                    <span className="landmark-chip-dot" />
                    {lm.fullName}
                  </button>
                );
              })}
            </div>
          )}
          {fireRecords.length > 0 && (
            <div className="landmark-chips-strip">
              <span className="landmark-label">Fire Scars:</span>
              {fireRecords.map((fr) => {
                const isSelected = hoveredRing === fr.ringIndex;
                return (
                  <button
                    key={`fire-${fr.calendarYear}`}
                    type="button"
                    className={`landmark-chip fire ${isSelected ? 'active' : ''}`}
                    onClick={() => onHoverRing(isSelected ? null : fr.ringIndex)}
                    onMouseEnter={() => onHoverRing(fr.ringIndex)}
                    title={`${fr.calendarYear} CE — ${fr.isFireRescar ? 'Recorder-Tree Open Catface Re-Scar' : 'Wildfire Catface Scar'}${fr.fireIntensity !== undefined ? ` (Intensity ${Math.round(fr.fireIntensity * 100)}%)` : ''}`}
                  >
                    <span className="landmark-chip-dot" />
                    {fr.calendarYear}
                    {fr.isFireRescar ? ' (Re-Scar)' : ''}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <span className="chronology-legend">
          Peak: {formatRingWidth(maxWidth, unitSystem)} · Hover or tap bars to cross-date
        </span>
      </div>

      {activeLandmark && activeHoveredRecord && (
        <div className="chronology-landmark-banner">
          <strong>
            {activeLandmark.fullName} ({activeHoveredRecord.calendarYear})
          </strong>
          <span> — {activeLandmark.description} (Ring: {formatRingWidth(activeHoveredRecord.meanWidthMm, unitSystem)})</span>
        </div>
      )}

      {!activeLandmark && activeFireRecord && (
        <div className="chronology-landmark-banner">
          <strong>
            {activeFireRecord.isFireRescar
              ? `Recorder-Tree Re-Scar (${activeFireRecord.calendarYear} CE)`
              : `Wildfire Catface Scar (${activeFireRecord.calendarYear} CE)`}
          </strong>
          <span>
            {' '}
            —{' '}
            {activeFireRecord.isFireRescar
              ? 'Surface wildfire re-injured an open pitch-exuding catface margin, charring the healing callus edge.'
              : 'Thermal necrosis killed a localized cambial sector, exposing bare heartwood and initiating decadal woundwood healing.'}{' '}
            (Ring: {formatRingWidth(activeFireRecord.meanWidthMm, unitSystem)})
          </span>
        </div>
      )}

      <div
        ref={barsContainerRef}
        className="chronology-bars"
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={handlePointerUp}
        onMouseLeave={() => {
          if (!isPointerScrubbingRef.current) {
            onHoverRing(null);
          }
        }}
      >
        {records.map((rec) => {
          const heightPct = Math.max(4, (rec.meanWidthMm / maxWidth) * 100);
          const isHovered = hoveredRing === rec.ringIndex;
          const isMarkerDrought = rec.climateIndex < 0.58;
          const lm = landmarksByYear.get(rec.calendarYear);
          const fireRec = fireByYear.get(rec.calendarYear);
          const showFlag = lm ? visibleFlagYears.has(rec.calendarYear) : false;
          const showFirePin =
            !showFlag && fireRec ? visibleFirePinYears.has(rec.calendarYear) : false;
          const posFrac =
            (rec.calendarYear - firstYear) / Math.max(1, lastYear - firstYear);
          const edgeClass =
            posFrac > 0.85
              ? 'pin-right-edge'
              : posFrac < 0.12
              ? 'pin-left-edge'
              : '';
          const fireSuffix = fireRec
            ? fireRec.isFireRescar
              ? ' — Fire Re-Scar'
              : ' — Fire Scar'
            : '';

          return (
            <div
              key={rec.ringIndex}
              className={`chrono-bar-col ${isHovered ? 'active' : ''} ${lm ? 'has-landmark' : ''}`}
              onMouseEnter={() => onHoverRing(rec.ringIndex)}
              onClick={() => onHoverRing(isHovered ? null : rec.ringIndex)}
              title={`${rec.calendarYear} (Ring #${rec.ringIndex}, ${formatShortProvenance(rec.climateProvenance, rec.isSyntheticClimate)}): ${formatRingWidth(rec.meanWidthMm, unitSystem)}${lm ? ` — ${lm.fullName}` : ''}${fireSuffix}`}
            >
              {lm && showFlag && (
                <div
                  className={`landmark-pin ${lm.type} ${edgeClass}`.trim()}
                  title={`${lm.fullName}: ${lm.description}`}
                >
                  <span className="pin-flag">{lm.shortLabel}</span>
                  <span className="pin-stem" />
                </div>
              )}
              {showFirePin && fireRec && (
                <div
                  className={`landmark-pin fire ${edgeClass}`.trim()}
                  title={`${fireRec.calendarYear} CE: ${fireRec.isFireRescar ? 'Fire Re-Scar' : 'Wildfire Scar'}`}
                >
                  <span className="pin-flag">
                    ’{String(fireRec.calendarYear).slice(-2)} Fire
                  </span>
                  <span className="pin-stem" />
                </div>
              )}
              <div
                className={`chrono-bar ${isMarkerDrought ? 'drought' : ''} ${barProvenanceClass(rec)} ${lm ? 'landmark-bar' : ''} ${fireRec ? 'fire-scar' : ''}`}
                style={{ height: `${heightPct}%` }}
              />
            </div>
          );
        })}
      </div>

      <div className="chronology-axis">
        <span>{firstYear} (Pith +1)</span>
        {axisTransitionMarkers.map((markerLabel) => (
          <span key={markerLabel}>{markerLabel}</span>
        ))}
        <span>{lastYear} (Cambium)</span>
      </div>
    </div>
  );
};
