import React, { useState } from 'react';
import { BarChart3, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { AnnualRingRecord } from '../model/types';
import { UnitSystem } from '../model/units';
import { RingChronologyChart } from './RingChronologyChart';
import { TimeNavigation, TimeNavMode } from './TimeNavigation';

export interface TimelineDockProps {
  isOpen: boolean;
  onToggleOpen: () => void;
  mode: TimeNavMode;
  onModeChange: (mode: TimeNavMode) => void;
  totalRings: number;
  activeRingIndex: number;
  onRingChange: (ringIndex: number) => void;
  firstYear: number;
  deathYear: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  playbackSpeed: number;
  onSpeedChange: (speed: number) => void;
  activeRecord?: AnnualRingRecord;
  records: AnnualRingRecord[];
  hoveredRing: number | null;
  unitSystem: UnitSystem;
  latitude: number;
  longitude: number;
  onHoverRing: (ringIndex: number | null) => void;
}

/**
 * Floating bottom-center collapsible dock housing TimeNavigation and RingChronologyChart.
 */
export const TimelineDock: React.FC<TimelineDockProps> = ({
  isOpen,
  onToggleOpen,
  mode,
  onModeChange,
  totalRings,
  activeRingIndex,
  onRingChange,
  firstYear,
  deathYear,
  isPlaying,
  onTogglePlay,
  playbackSpeed,
  onSpeedChange,
  activeRecord,
  records,
  hoveredRing,
  unitSystem,
  latitude,
  longitude,
  onHoverRing,
}) => {
  const [showChronoChart, setShowChronoChart] = useState<boolean>(true);
  const clampedRing = Math.max(1, Math.min(totalRings, activeRingIndex));
  const activeYear = activeRecord?.calendarYear ?? firstYear + (clampedRing - 1);
  const isPeeled = clampedRing < totalRings;

  return (
    <div className="timeline-dock-anchor">
      {!isOpen ? (
        <button
          type="button"
          className={`timeline-collapsed-pill ${isPlaying ? 'playing' : ''}`}
          onClick={onToggleOpen}
          aria-expanded={false}
          title="Expand Peel/Grow Timeline & Ring Chronology"
        >
          <Clock size={13} aria-hidden="true" />
          <span className="timeline-pill-label">Timeline</span>
          <span className="timeline-pill-meta mono">
            {isPlaying || isPeeled
              ? `${activeYear} CE · #${clampedRing}/${totalRings}`
              : `${firstYear}–${deathYear} CE`}
          </span>
          {isPlaying && <span className="timeline-live-dot" aria-hidden="true" />}
          <ChevronUp size={13} aria-hidden="true" />
        </button>
      ) : (
        <section
          className="timeline-expanded-dock"
          aria-label="Timeline and Ring Chronology Dock"
        >
          <div className="timeline-dock-header">
            <span className="timeline-dock-title">
              <Clock size={12} aria-hidden="true" />
              Dendrochronological Timeline
            </span>
            <div className="timeline-dock-header-actions">
              <button
                type="button"
                className={`timeline-chart-toggle ${showChronoChart ? 'active' : ''}`}
                onClick={() => setShowChronoChart((v) => !v)}
                aria-pressed={showChronoChart}
                title="Toggle Ring-Width Chronology Bar Chart"
              >
                <BarChart3 size={12} aria-hidden="true" />
                <span>Chronology Chart</span>
              </button>
              <button
                type="button"
                className="timeline-collapse-btn"
                onClick={onToggleOpen}
                aria-label="Collapse Timeline"
                title="Collapse Timeline (Esc)"
              >
                <ChevronDown size={15} />
              </button>
            </div>
          </div>

          <TimeNavigation
            mode={mode}
            onModeChange={onModeChange}
            totalRings={totalRings}
            activeRingIndex={clampedRing}
            onRingChange={onRingChange}
            firstYear={firstYear}
            deathYear={deathYear}
            isPlaying={isPlaying}
            onTogglePlay={onTogglePlay}
            playbackSpeed={playbackSpeed}
            onSpeedChange={onSpeedChange}
            activeRecord={activeRecord}
          />

          {showChronoChart && (
            <RingChronologyChart
              records={records}
              hoveredRing={hoveredRing}
              unitSystem={unitSystem}
              latitude={latitude}
              longitude={longitude}
              onHoverRing={onHoverRing}
            />
          )}
        </section>
      )}
    </div>
  );
};
