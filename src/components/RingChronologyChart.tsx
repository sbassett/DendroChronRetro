import React from 'react';
import { AnnualRingRecord } from '../model/types';
import { formatRingWidth, UnitSystem } from '../model/units';

interface RingChronologyChartProps {
  records: AnnualRingRecord[];
  hoveredRing: number | null;
  unitSystem: UnitSystem;
  onHoverRing: (ringIndex: number | null) => void;
}

export const RingChronologyChart: React.FC<RingChronologyChartProps> = ({
  records,
  hoveredRing,
  unitSystem,
  onHoverRing,
}) => {
  if (records.length === 0) return null;

  const maxWidth = Math.max(...records.map((r) => r.meanWidthMm), 1.0);
  const firstYear = records[0].calendarYear;
  const lastYear = records[records.length - 1].calendarYear;
  const firstObservedTransitionYear = records[0].isSyntheticClimate
    ? (records.find((r) => !r.isSyntheticClimate)?.calendarYear ?? null)
    : null;

  return (
    <div className="chronology-panel">
      <div className="chronology-header">
        <span>
          Ring-Width Chronology ({firstYear}–{lastYear})
        </span>
        <span className="chronology-legend">
          Peak: {formatRingWidth(maxWidth, unitSystem)} · Hover bars or cross-section to cross-date
        </span>
      </div>
      <div
        className="chronology-bars"
        onMouseLeave={() => onHoverRing(null)}
      >
        {records.map((rec) => {
          const heightPct = Math.max(4, (rec.meanWidthMm / maxWidth) * 100);
          const isHovered = hoveredRing === rec.ringIndex;
          const isMarkerDrought = rec.climateIndex < 0.58;
          return (
            <div
              key={rec.ringIndex}
              className={`chrono-bar-col ${isHovered ? 'active' : ''}`}
              onMouseEnter={() => onHoverRing(rec.ringIndex)}
              title={`${rec.calendarYear} (Ring #${rec.ringIndex}): ${formatRingWidth(rec.meanWidthMm, unitSystem)}`}
            >
              <div
                className={`chrono-bar ${isMarkerDrought ? 'drought' : ''} ${rec.isSyntheticClimate ? 'synthetic' : ''}`}
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
