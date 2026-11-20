import React, { useCallback, useEffect } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  Layers,
  Clock,
} from 'lucide-react';
import { AnnualRingRecord } from '../model/types';

export type TimeNavMode = 'peel' | 'grow';

export interface TimeNavigationProps {
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
  className?: string;
}

export const TimeNavigation: React.FC<TimeNavigationProps> = ({
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
  className = '',
}) => {
  const clampedRing = Math.max(1, Math.min(totalRings, activeRingIndex));
  const isPeeled = clampedRing < totalRings;
  const lastRingYear =
    totalRings > 0 ? firstYear + totalRings - 1 : deathYear;
  const activeYear =
    activeRecord?.calendarYear ?? firstYear + (clampedRing - 1);
  const activeTreeAge = activeRecord?.treeAge ?? clampedRing;
  const yearsPeeled = Math.max(0, totalRings - clampedRing);

  // Keyboard shortcut listener for Left / Right arrow ring stepping
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid intercepting keystrokes inside text inputs or textareas
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        onTogglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onRingChange(Math.max(1, clampedRing - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onRingChange(Math.min(totalRings, clampedRing + 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clampedRing, totalRings, onRingChange, onTogglePlay]);

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const nextIdx = Number(e.target.value);
      if (!Number.isNaN(nextIdx)) {
        onRingChange(Math.max(1, Math.min(totalRings, nextIdx)));
      }
    },
    [totalRings, onRingChange]
  );

  const handleStepBack = useCallback(() => {
    onRingChange(Math.max(1, clampedRing - 1));
  }, [clampedRing, onRingChange]);

  const handleStepForward = useCallback(() => {
    onRingChange(Math.min(totalRings, clampedRing + 1));
  }, [clampedRing, totalRings, onRingChange]);

  const handleJumpStart = useCallback(() => {
    onRingChange(1);
  }, [onRingChange]);

  const handleJumpEnd = useCallback(() => {
    onRingChange(totalRings);
  }, [totalRings, onRingChange]);

  // Determine RWI tag if available
  const rwiValue = activeRecord?.relativeWidthIndex;
  let rwiBadge: { label: string; tagClass: string } | null = null;
  if (rwiValue !== undefined) {
    if (rwiValue >= 1.3) {
      rwiBadge = { label: `RWI ${rwiValue.toFixed(2)} · Pluvial Pulse`, tagClass: 'badge-pluvial' };
    } else if (rwiValue < 0.4) {
      rwiBadge = { label: `RWI ${rwiValue.toFixed(2)} · Severe Crisis`, tagClass: 'badge-severe' };
    } else if (rwiValue < 0.7) {
      rwiBadge = { label: `RWI ${rwiValue.toFixed(2)} · Drought Stress`, tagClass: 'badge-drought' };
    } else {
      rwiBadge = { label: `RWI ${rwiValue.toFixed(2)} · Baseline`, tagClass: 'badge-baseline' };
    }
  }

  return (
    <nav
      className={`time-navigation-bar ${className}`}
      aria-label="Dendrochronological Time Scrubber"
    >
      {/* Mode Selector Pill */}
      <div className="time-nav-mode-selector" role="radiogroup" aria-label="Time navigation mode">
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'peel'}
          className={`time-nav-mode-btn ${mode === 'peel' ? 'active' : ''}`}
          onClick={() => onModeChange('peel')}
          title="Peel Mode: Peel back outer rings and bark in reverse chronology to view the historical trunk and bark at that moment"
        >
          <Layers size={13} aria-hidden="true" />
          <span>Peel Mode</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'grow'}
          className={`time-nav-mode-btn ${mode === 'grow' ? 'active' : ''}`}
          onClick={() => onModeChange('grow')}
          title="Grow Mode: Forward biological progression of rings and evolving outer bark from pith germination outward"
        >
          <Clock size={13} aria-hidden="true" />
          <span>Grow Mode</span>
        </button>
      </div>

      {/* Playback Controls */}
      <div className="time-nav-playback-controls">
        <button
          type="button"
          className="time-nav-btn"
          onClick={handleJumpStart}
          title="Jump to Germination (Pith / Year 1)"
          aria-label="Jump to start"
        >
          <SkipBack size={14} />
        </button>
        <button
          type="button"
          className="time-nav-btn"
          onClick={handleStepBack}
          disabled={clampedRing <= 1}
          title="Step back 1 year (←)"
          aria-label="Step back 1 year"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          className={`time-nav-btn time-nav-play-btn ${isPlaying ? 'active' : ''}`}
          onClick={onTogglePlay}
          title={isPlaying ? 'Pause growth (Space)' : 'Play continuous growth (Space)'}
          aria-label={isPlaying ? 'Pause growth' : 'Play growth'}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          type="button"
          className="time-nav-btn"
          onClick={handleStepForward}
          disabled={clampedRing >= totalRings}
          title="Step forward 1 year (→)"
          aria-label="Step forward 1 year"
        >
          <ChevronRight size={16} />
        </button>
        <button
          type="button"
          className="time-nav-btn"
          onClick={handleJumpEnd}
          title="Jump to Full Tree (Mature)"
          aria-label="Jump to end"
        >
          <SkipForward size={14} />
        </button>

        {/* Speed Toggles */}
        <div className="time-nav-speed-group" role="group" aria-label="Playback speed">
          {[5, 10, 20].map((spd) => (
            <button
              key={spd}
              type="button"
              className={`time-nav-speed-btn ${playbackSpeed === spd ? 'active' : ''}`}
              onClick={() => onSpeedChange(spd)}
              title={`${spd} rings per second`}
            >
              {spd}×
            </button>
          ))}
        </div>
      </div>

      {/* Main Scrubber Slider */}
      <div className="time-nav-scrubber-track" style={{ touchAction: 'none' }}>
        <div className="time-nav-slider-labels">
          <span className="slider-endpoint">
            {mode === 'peel' ? `${firstYear} CE (Heartwood)` : `${firstYear} CE (Pith)`}
          </span>
          <div className="slider-current-callout">
            <span className="current-year-mono">{activeYear} CE</span>
            <span className="current-ring-tag">
              {!isPeeled
                ? `Full Tree · ${totalRings} rings`
                : mode === 'peel'
                ? `Peeled -${yearsPeeled}y · Ring #${clampedRing}/${totalRings}`
                : `Ring #${clampedRing} of ${totalRings} (${activeTreeAge}y)`}
            </span>
          </div>
          <span className="slider-endpoint">
            {lastRingYear} CE (Mature)
          </span>
        </div>

        <input
          type="range"
          min={1}
          max={totalRings}
          value={clampedRing}
          onChange={handleSliderChange}
          className="time-nav-range-input"
          style={{ touchAction: 'none' }}
          aria-label="Year and ring scrubber"
        />
      </div>

      {/* Ring Ecological Readout Pill */}
      {activeRecord?.hasFireScar && (
        <div
          className="time-nav-fire-pill"
          title={
            activeRecord.isFireRescar
              ? 'Open-catface recorder-tree re-scar'
              : 'Cambial wildfire scar recorded in this ring'
          }
        >
          {activeRecord.isFireRescar ? 'Fire Re-Scar' : 'Fire Scar'}
        </div>
      )}
      {rwiBadge && (
        <div className={`time-nav-rwi-pill ${rwiBadge.tagClass}`}>
          {rwiBadge.label}
        </div>
      )}
    </nav>
  );
};
