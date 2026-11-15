import React, { useEffect, useState } from 'react';
import {
  X,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Layers,
  Sun,
  TrendingUp,
  Flame,
  History,
  Play,
} from 'lucide-react';
import { PresetId } from '../model/presets';
import { PaletteId } from '../model/permalink';
import { TimeNavMode } from './TimeNavigation';

export interface DendroTutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPreset?: (presetId: PresetId) => void;
  onSelectPalette?: (palette: PaletteId) => void;
  onSetTimeNavMode?: (mode: TimeNavMode) => void;
}

type AnatomyZoneId = 'pith' | 'heartwood' | 'sapwood' | 'cambium' | 'bark';
type TraumaId = 'false-ring' | 'absent-ring' | 'fire-scar' | 'resin-pocket';

interface AnatomyZoneInfo {
  id: AnatomyZoneId;
  label: string;
  title: string;
  summary: string;
  archivalRole: string;
}

const ANATOMY_ZONES: AnatomyZoneInfo[] = [
  {
    id: 'pith',
    label: 'Pith',
    title: 'Pith (Germination Core)',
    summary:
      'The soft parenchymatous core formed during the tree’s first year as a seedling. Often slightly off-center due to early wind, snowpack, or slope lean.',
    archivalRole: 'Anchors Year 0 of the specimen’s chronological ledger.',
  },
  {
    id: 'heartwood',
    label: 'Heartwood',
    title: 'Heartwood (Duramen)',
    summary:
      'Older inner xylem whose cells have ceased water transport and accumulated dark phenolic resins and tannins that resist fungal decay.',
    archivalRole: 'Preserves centuries of early-life climate variability in high contrast.',
  },
  {
    id: 'sapwood',
    label: 'Sapwood',
    title: 'Sapwood (Alburnum)',
    summary:
      'Paler outer bands of active xylem tracheids still conducting water and dissolved minerals upward from roots to crown.',
    archivalRole: 'Records recent decades of moisture balance and modern warming trends.',
  },
  {
    id: 'cambium',
    label: 'Cambium',
    title: 'Vascular Cambium (Living Sheath)',
    summary:
      'A microscopic cylinder of dividing meristematic cells between xylem and inner bark. Each spring it initiates a new concentric growth ring.',
    archivalRole: 'The active scribe of the ecological ledger; injury here leaves permanent scars.',
  },
  {
    id: 'bark',
    label: 'Bark',
    title: 'Outer Bark (Rhytidome)',
    summary:
      'Fissured, corky protective armor shielding the living cambium from convective wildfire heat, frost, and bark beetles.',
    archivalRole: 'Thickens nonlinearly with age; scorched ridges often mark surface fire passes.',
  },
];

const TRAUMA_MARKERS: Array<{
  id: TraumaId;
  label: string;
  trigger: string;
  signature: string;
}> = [
  {
    id: 'false-ring',
    label: 'False Ring (IADF)',
    trigger: 'Mid-summer dry spell followed by late-season monsoon rain.',
    signature:
      'Growth slows prematurely, forming a faint band of darker cells inside the ring before resuming wide earlywood—distinguished from a true ring by its gradual outer boundary.',
  },
  {
    id: 'absent-ring',
    label: 'Locally Absent Ring',
    trigger: 'Extreme single-year or multi-year megadrought.',
    signature:
      'Cambial cell division fails around stressed sectors of the circumference, pinching the annual ring to zero width along part of the trunk.',
  },
  {
    id: 'fire-scar',
    label: 'Catface Fire Scar',
    trigger: 'Uphill surface fire eddies killing a sector of living cambium.',
    signature:
      'Leaves bare charred wood exposed while healthy cambium along both wound margins divides rapidly, curling inward year after year as ridges of healing woundwood.',
  },
  {
    id: 'resin-pocket',
    label: 'Traumatic Resin Pocket',
    trigger: 'Mechanical wind sway, frost shock, pathogens, or bark beetle attack.',
    signature:
      'Localized cell collapse creates a tangential cavity filled with oleoresin, which subsequent xylem growth seals permanently inside the ring record.',
  },
];

const TUTORIAL_STEPS = [
  { id: 'anatomy', label: '1. Cross-Section', icon: Layers },
  { id: 'seasons', label: '2. Early vs. Latewood', icon: Sun },
  { id: 'climate', label: '3. Climate & RWI', icon: TrendingUp },
  { id: 'trauma', label: '4. Trauma Markers', icon: Flame },
  { id: 'retrospection', label: '5. Peel & Grow', icon: History },
] as const;

export const DendroTutorialModal: React.FC<DendroTutorialModalProps> = ({
  isOpen,
  onClose,
  onSelectPreset,
  onSelectPalette,
  onSetTimeNavMode,
}) => {
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [activeZone, setActiveZone] = useState<AnatomyZoneId>('cambium');
  const [moisturePreview, setMoisturePreview] = useState<'pluvial' | 'drought'>('pluvial');
  const [activeTrauma, setActiveTrauma] = useState<TraumaId>('fire-scar');

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight') {
        setStepIndex((i) => Math.min(TUTORIAL_STEPS.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft') {
        setStepIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const selectedZoneInfo =
    ANATOMY_ZONES.find((z) => z.id === activeZone) ?? ANATOMY_ZONES[0];
  const selectedTraumaInfo =
    TRAUMA_MARKERS.find((t) => t.id === activeTrauma) ?? TRAUMA_MARKERS[0];

  const handleLoadPreset = (presetId: PresetId) => {
    onSelectPreset?.(presetId);
    onClose();
  };

  return (
    <div
      className="colophon-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="colophon-modal-card tutorial-modal-card">
        <header className="colophon-modal-header">
          <div className="colophon-header-badge-row">
            <span className="colophon-eyebrow">
              <BookOpen size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />
              Dendrochronology &amp; Wood Anatomy Field Guide
            </span>
            <span className="colophon-edition-tag">
              Step {stepIndex + 1} of {TUTORIAL_STEPS.length}
            </span>
          </div>
          <div className="colophon-title-row">
            <div>
              <h2 id="tutorial-modal-title" className="colophon-title">
                Reading the Ecological Ledger
              </h2>
              <p className="colophon-subtitle">
                How annual tree growth, cellular density, and trauma encode deep environmental time
              </p>
            </div>
            <button
              type="button"
              className="colophon-close-btn"
              onClick={onClose}
              aria-label="Close tutorial dialog"
              title="Close (Esc)"
            >
              <X size={18} />
            </button>
          </div>

          <nav className="tutorial-stepper" aria-label="Tutorial chapters">
            {TUTORIAL_STEPS.map((step, idx) => {
              const Icon = step.icon;
              return (
                <button
                  key={step.id}
                  type="button"
                  className={`tutorial-step-tab ${idx === stepIndex ? 'active' : ''}`}
                  onClick={() => setStepIndex(idx)}
                >
                  <Icon size={12} aria-hidden="true" />
                  <span>{step.label}</span>
                </button>
              );
            })}
          </nav>
        </header>

        <div className="colophon-modal-body tutorial-modal-body">
          {/* STEP 1: Cross-Section Anatomy */}
          {stepIndex === 0 && (
            <section className="tutorial-panel">
              <p className="tutorial-intro">
                A tree trunk grows outward like a living scroll. Only a paper-thin cylinder beneath
                the bark—the <strong>vascular cambium</strong>—actively divides each year, leaving
                every prior season’s xylem permanently archived toward the core. Click any zone below
                to inspect its anatomy:
              </p>

              <div className="tutorial-split-grid">
                <div className="tutorial-diagram-box">
                  <svg
                    viewBox="0 0 260 260"
                    className="tutorial-svg"
                    role="img"
                    aria-label="Interactive tree cross-section anatomy diagram"
                  >
                    {/* Outer Bark */}
                    <circle
                      cx="130"
                      cy="130"
                      r="116"
                      fill="#3e3024"
                      stroke={activeZone === 'bark' ? '#d97706' : '#261d15'}
                      strokeWidth={activeZone === 'bark' ? 4 : 2}
                      className="tutorial-svg-zone"
                      onClick={() => setActiveZone('bark')}
                    />
                    {/* Cambium */}
                    <circle
                      cx="130"
                      cy="130"
                      r="98"
                      fill="#e7d3ad"
                      stroke={activeZone === 'cambium' ? '#d97706' : '#8c6d46'}
                      strokeWidth={activeZone === 'cambium' ? 5 : 2.5}
                      className="tutorial-svg-zone"
                      onClick={() => setActiveZone('cambium')}
                    />
                    {/* Sapwood */}
                    <circle
                      cx="130"
                      cy="130"
                      r="93"
                      fill="#e5cda2"
                      stroke={activeZone === 'sapwood' ? '#d97706' : '#b7915f'}
                      strokeWidth={activeZone === 'sapwood' ? 3 : 1}
                      className="tutorial-svg-zone"
                      onClick={() => setActiveZone('sapwood')}
                    />
                    {/* Subtle sapwood rings */}
                    {[82, 71].map((r) => (
                      <circle
                        key={r}
                        cx="130"
                        cy="130"
                        r={r}
                        fill="none"
                        stroke="#a9804e"
                        strokeWidth="1.2"
                        pointerEvents="none"
                      />
                    ))}
                    {/* Heartwood */}
                    <circle
                      cx="130"
                      cy="130"
                      r="60"
                      fill="#9b6637"
                      stroke={activeZone === 'heartwood' ? '#fbbf24' : '#6f4520'}
                      strokeWidth={activeZone === 'heartwood' ? 3.5 : 1.5}
                      className="tutorial-svg-zone"
                      onClick={() => setActiveZone('heartwood')}
                    />
                    {[48, 36, 24].map((r) => (
                      <circle
                        key={r}
                        cx="130"
                        cy="130"
                        r={r}
                        fill="none"
                        stroke="#633a18"
                        strokeWidth="1.3"
                        pointerEvents="none"
                      />
                    ))}
                    {/* Pith (slightly eccentric) */}
                    <circle
                      cx="126"
                      cy="133"
                      r="9"
                      fill="#4a2810"
                      stroke={activeZone === 'pith' ? '#fbbf24' : '#2e1808'}
                      strokeWidth={activeZone === 'pith' ? 3 : 1.5}
                      className="tutorial-svg-zone"
                      onClick={() => setActiveZone('pith')}
                    />
                  </svg>
                </div>

                <div className="tutorial-detail-col">
                  <div className="tutorial-pill-row">
                    {ANATOMY_ZONES.map((z) => (
                      <button
                        key={z.id}
                        type="button"
                        className={`tutorial-pill ${activeZone === z.id ? 'active' : ''}`}
                        onClick={() => setActiveZone(z.id)}
                      >
                        {z.label}
                      </button>
                    ))}
                  </div>
                  <div className="tutorial-callout-card">
                    <h4>{selectedZoneInfo.title}</h4>
                    <p>{selectedZoneInfo.summary}</p>
                    <p className="tutorial-archival-note">
                      <strong>Archival Role:</strong> {selectedZoneInfo.archivalRole}
                    </p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* STEP 2: Earlywood vs Latewood */}
          {stepIndex === 1 && (
            <section className="tutorial-panel">
              <p className="tutorial-intro">
                Each annual ring is a two-act seasonal gradient rather than a uniform stripe. Under
                <strong> Mork’s anatomical criterion</strong>, dendrochronologists distinguish pale,
                wide spring cells from dark, compacted late-summer cell walls:
              </p>

              <div className="tutorial-pill-row" style={{ marginBottom: 12 }}>
                <button
                  type="button"
                  className={`tutorial-pill ${moisturePreview === 'pluvial' ? 'active' : ''}`}
                  onClick={() => setMoisturePreview('pluvial')}
                >
                  Pluvial Year (Abundant Snowmelt)
                </button>
                <button
                  type="button"
                  className={`tutorial-pill ${moisturePreview === 'drought' ? 'active' : ''}`}
                  onClick={() => setMoisturePreview('drought')}
                >
                  Drought Year (Water Deficit)
                </button>
              </div>

              <div className="tutorial-diagram-box tutorial-wedge-box">
                <svg
                  viewBox="0 0 520 150"
                  className="tutorial-svg-wide"
                  role="img"
                  aria-label="Earlywood to latewood cellular density gradient"
                >
                  <defs>
                    <linearGradient id="ewLwGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#ecd7b0" />
                      <stop offset="68%" stopColor="#dcb880" />
                      <stop offset="86%" stopColor="#9c6434" />
                      <stop offset="100%" stopColor="#563014" />
                    </linearGradient>
                  </defs>
                  {/* Prior year latewood */}
                  <rect x="20" y="26" width="38" height="84" fill="#683b18" rx="2" />
                  {/* Current annual ring */}
                  <rect
                    x="58"
                    y="26"
                    width={moisturePreview === 'pluvial' ? 360 : 120}
                    height="84"
                    fill="url(#ewLwGrad)"
                    stroke="#3b2310"
                    strokeWidth="1.5"
                  />
                  {/* Next year start */}
                  <rect
                    x={moisturePreview === 'pluvial' ? 418 : 178}
                    y="26"
                    width={moisturePreview === 'pluvial' ? 82 : 322}
                    height="84"
                    fill="#ebd5ad"
                    opacity="0.55"
                  />
                  {/* Labels */}
                  <text x="68" y="64" fontSize="13" fontWeight="700" fill="#3a2310">
                    Earlywood (Spring)
                  </text>
                  <text x="68" y="82" fontSize="11" fill="#5e3d21">
                    {moisturePreview === 'pluvial'
                      ? 'Wide, thin-walled tracheids · rapid cell expansion'
                      : 'Severely truncated spring growth'}
                  </text>
                  <text
                    x={moisturePreview === 'pluvial' ? 305 : 185}
                    y="128"
                    fontSize="11"
                    fontWeight="700"
                    fill="#3a2310"
                  >
                    Latewood Boundary (Sharp Annual Cut)
                  </text>
                </svg>
              </div>

              <div className="tutorial-two-col">
                <div className="tutorial-callout-card">
                  <h4>Earlywood (Spring Flush)</h4>
                  <p>
                    Driven by snowmelt and warm spring soils, the cambium produces large-lumen,
                    thin-walled cells optimized for rapid sap transport.
                  </p>
                </div>
                <div className="tutorial-callout-card">
                  <h4>Latewood (Summer Dormancy)</h4>
                  <p>
                    As soil moisture drops and day length shortens, cell walls thicken and flatten
                    radially, creating the crisp dark boundary that marks the end of the growing season.
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* STEP 3: Climate Memory, RWI & Reaction Wood */}
          {stepIndex === 2 && (
            <section className="tutorial-panel">
              <p className="tutorial-intro">
                Because trees at the same elevation and watershed experience the same droughts and
                wet years, their ring-width patterns align like barcodes—a foundational principle
                called <strong>cross-dating</strong>.
              </p>

              <div className="tutorial-two-col">
                <div className="tutorial-callout-card">
                  <h4>Relative Ring Width Index (RWI)</h4>
                  <p>
                    Trees naturally grow narrower rings as their trunk circumference expands
                    (biological age trend). Dividing raw ring width by this expected curve yields
                    the <strong>RWI</strong>: values above <code>1.00</code> indicate pluvial
                    abundance, while values below <code>0.50</code> signal severe moisture or
                    temperature stress.
                  </p>
                </div>
                <div className="tutorial-callout-card">
                  <h4>Eccentricity &amp; Reaction Wood</h4>
                  <p>
                    Conifers on steep mountain slopes or exposed ridges thicken their rings
                    asymmetrically on the downhill/leeward side (<strong>compression wood</strong>)
                    to keep the trunk vertical, displacing the pith off-center.
                  </p>
                </div>
              </div>

              {onSelectPreset && (
                <div className="tutorial-action-bar">
                  <span>Inspect climate-driven ring width live:</span>
                  <div className="tutorial-action-buttons">
                    <button
                      type="button"
                      className="tutorial-action-btn"
                      onClick={() => handleLoadPreset('pluvial-megadrought')}
                    >
                      <Play size={12} /> Load Pluvial-to-Megadrought
                    </button>
                    <button
                      type="button"
                      className="tutorial-action-btn"
                      onClick={() => handleLoadPreset('bristlecone-ancient')}
                    >
                      <Play size={12} /> Load Old-Growth Bristlecone
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* STEP 4: Disturbance Forensics */}
          {stepIndex === 3 && (
            <section className="tutorial-panel">
              <p className="tutorial-intro">
                Beyond gradual climate cycles, wood anatomy archives acute ecological shocks. Select
                a trauma marker below to see how dendrochronologists date disturbances to the exact
                year:
              </p>

              <div className="tutorial-pill-row" style={{ marginBottom: 12 }}>
                {TRAUMA_MARKERS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`tutorial-pill ${activeTrauma === t.id ? 'active' : ''}`}
                    onClick={() => setActiveTrauma(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="tutorial-callout-card">
                <h4>{selectedTraumaInfo.label}</h4>
                <p>
                  <strong>Trigger:</strong> {selectedTraumaInfo.trigger}
                </p>
                <p style={{ marginTop: 6 }}>
                  <strong>Anatomical Signature:</strong> {selectedTraumaInfo.signature}
                </p>
              </div>

              {onSelectPreset && (
                <div className="tutorial-action-bar">
                  <span>Examine trauma markers in the main specimen:</span>
                  <div className="tutorial-action-buttons">
                    <button
                      type="button"
                      className="tutorial-action-btn"
                      onClick={() => handleLoadPreset('wildfire-scar-healing')}
                    >
                      <Play size={12} /> Load Wildfire Catface Specimen
                    </button>
                    <button
                      type="button"
                      className="tutorial-action-btn"
                      onClick={() => handleLoadPreset('volcanic-frost-shock')}
                    >
                      <Play size={12} /> Load Volcanic Frost Shock
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* STEP 5: Retrospection & Modes */}
          {stepIndex === 4 && (
            <section className="tutorial-panel">
              <p className="tutorial-intro">
                Traditional simulations only run forward. <strong>XYLEM</strong> is built around
                <em> retrospection</em>—reading environmental history backward from the present bark
                to the ancient pith:
              </p>

              <div className="tutorial-two-col">
                <div className="tutorial-callout-card">
                  <h4>Peel Mode vs. Grow Mode</h4>
                  <p>
                    In <strong>Peel Mode</strong>, dragging the timeline scrubber backward physically
                    strips away outer annual rings, shrinking the trunk to its exact historical
                    diameter in that year. Switch to <strong>Grow Mode</strong> to watch the tree
                    accrete outward from germination.
                  </p>
                </div>
                <div className="tutorial-callout-card">
                  <h4>Skeleton Plot &amp; Exhibition Mode</h4>
                  <p>
                    Switch palettes to <strong>Skeleton Plot Mode</strong> for high-contrast
                    diagnostic ink-on-parchment linework, hover any ring for its RWI and stress
                    tags, or press <code>F</code> for distraction-free gallery exhibition.
                  </p>
                </div>
              </div>

              {(onSetTimeNavMode || onSelectPalette) && (
                <div className="tutorial-action-bar">
                  <span>Jump straight into exploration:</span>
                  <div className="tutorial-action-buttons">
                    {onSetTimeNavMode && (
                      <button
                        type="button"
                        className="tutorial-action-btn"
                        onClick={() => {
                          onSetTimeNavMode('peel');
                          onClose();
                        }}
                      >
                        <History size={12} /> Try Peel Mode
                      </button>
                    )}
                    {onSelectPalette && (
                      <button
                        type="button"
                        className="tutorial-action-btn"
                        onClick={() => {
                          onSelectPalette('skeleton-plot');
                          onClose();
                        }}
                      >
                        <Layers size={12} /> Switch to Skeleton Plot
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        <footer className="colophon-modal-footer tutorial-modal-footer">
          <button
            type="button"
            className="btn-colophon-dismiss"
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            disabled={stepIndex === 0}
          >
            <ChevronLeft size={14} style={{ verticalAlign: '-2px' }} /> Previous
          </button>
          <span className="tutorial-footer-hint">Use ← / → arrow keys or click chapters</span>
          {stepIndex < TUTORIAL_STEPS.length - 1 ? (
            <button
              type="button"
              className="btn-colophon-dismiss"
              onClick={() => setStepIndex((i) => Math.min(TUTORIAL_STEPS.length - 1, i + 1))}
            >
              Next <ChevronRight size={14} style={{ verticalAlign: '-2px' }} />
            </button>
          ) : (
            <button type="button" className="btn-colophon-dismiss" onClick={onClose}>
              Start Exploring
            </button>
          )}
        </footer>
      </div>
    </div>
  );
};
