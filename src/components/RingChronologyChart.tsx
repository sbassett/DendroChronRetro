import React, { useMemo } from 'react';
import {
  ClimateLandmark,
  getRelevantClimateLandmarks,
} from '../model/narrative';
import { AnnualRingRecord } from '../model/types';
import { formatRingWidth, UnitSystem } from '../model/units';

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
  const firstObservedTransitionYear = records[0].isSyntheticClimate
    ? (records.find((r) => !r.isSyntheticClimate)?.calendarYear ?? null)
    : null;

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

  const activeHoveredRecord = useMemo(
    () => (hoveredRing !== null ? records.find((r) => r.ringIndex === hoveredRing) : null),
    [hoveredRing, records]
  );

  const activeLandmark = activeHoveredRecord
    ? landmarksByYear.get(activeHoveredRecord.calendarYear)
    : null;

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

      <div
        className="chronology-bars"
        onMouseLeave={() => onHoverRing(null)}
      >
        {records.map((rec) => {
          const heightPct = Math.max(4, (rec.meanWidthMm / maxWidth) * 100);
          const isHovered = hoveredRing === rec.ringIndex;
          const isMarkerDrought = rec.climateIndex < 0.58;
          const lm = landmarksByYear.get(rec.calendarYear);

          return (
            <div
              key={rec.ringIndex}
              className={`chrono-bar-col ${isHovered ? 'active' : ''} ${lm ? 'has-landmark' : ''}`}
              onMouseEnter={() => onHoverRing(rec.ringIndex)}
              onClick={() => onHoverRing(isHovered ? null : rec.ringIndex)}
              title={`${rec.calendarYear} (Ring #${rec.ringIndex}): ${formatRingWidth(rec.meanWidthMm, unitSystem)}${lm ? ` — ${lm.fullName}` : ''}`}
            >
              {lm && (
                <div
                  className={`landmark-pin ${lm.type}`}
                  title={`${lm.fullName}: ${lm.description}`}
                >
                  <span className="pin-flag">{lm.shortLabel}</span>
                  <span className="pin-stem" />
                </div>
              )}
              <div
                className={`chrono-bar ${isMarkerDrought ? 'drought' : ''} ${rec.isSyntheticClimate ? 'synthetic' : ''} ${lm ? 'landmark-bar' : ''}`}
                style={{ height: `${heightPct}%` }}
              />
            </div>
          );
        })}
      </div>

      <div className="chronology-axis">
        <span>{firstYear} (Pith +1)</span>
        {firstObservedTransitionYear !== null && (
          <span>{firstObservedTransitionYear} (Observed Weather Start)</span>
        )}
        <span>{lastYear} (Cambium)</span>
      </div>
    </div>
  );
};
