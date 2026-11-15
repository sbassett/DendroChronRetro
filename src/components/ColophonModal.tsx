import React, { useEffect, useRef } from 'react';
import { X, BookOpen, Thermometer, Droplets, Snowflake, Flame, Compass } from 'lucide-react';

export interface ColophonModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ColophonModal: React.FC<ColophonModalProps> = ({ isOpen, onClose }) => {
  const modalCardRef = useRef<HTMLDivElement | null>(null);

  // Keyboard dismissal on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Lock background scroll when modal is active
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="colophon-modal-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={modalCardRef}
        className="colophon-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="colophon-modal-title"
        aria-describedby="colophon-artist-statement"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <header className="colophon-modal-header">
          <div className="colophon-header-badge-row">
            <span className="colophon-eyebrow">Exhibition Colophon &amp; Curatorial Notes</span>
            <span className="colophon-edition-tag">Edition 2026.1</span>
          </div>
          <div className="colophon-title-row">
            <div>
              <h2 id="colophon-modal-title" className="colophon-title">
                XYLEM: An Ecological Ledger of Deep Time
              </h2>
              <p className="colophon-subtitle">
                The Radial Ledger of Environmental Time &amp; Biological Climate Memory
              </p>
            </div>
            <button
              type="button"
              className="colophon-close-btn"
              onClick={onClose}
              aria-label="Close colophon dialog"
              title="Close (Esc)"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Modal Scrollable Body */}
        <div className="colophon-modal-body">
          {/* 1. Artist Statement */}
          <section className="colophon-section artist-statement-section">
            <h3 className="colophon-section-heading">
              <BookOpen size={14} className="colophon-heading-icon" /> Artist Statement
            </h3>
            <blockquote id="colophon-artist-statement" className="colophon-blockquote">
              “The transverse cross-section of a tree is an unbribable ecological ledger—a living
              palimpsest recording centuries of environmental flux within the micro-architecture of its
              secondary xylem. Each annual ring does not merely mark the passage of orbital time, but
              physically incorporates the atmospheric turbulence, hydrologic stress, and thermal memory
              of a dynamic planet. Through retrospective dendrochronology, we decipher this biological
              archive backwards from the outermost living cambium into deep planetary time.”
            </blockquote>
          </section>

          {/* 2. Climate Index Translation Layer */}
          <section className="colophon-section translation-layer-section">
            <h3 className="colophon-section-heading">
              <Thermometer size={14} className="colophon-heading-icon" /> Climate Index Translation Layer
            </h3>
            <p className="colophon-intro-p">
              Dendrochronological reconstructions bridge meteorological physics and tree-ring anatomy.
              Climatic indices govern annual ring boundaries and cellular morphology through distinct
              biophysical mechanisms:
            </p>

            <div className="translation-grid">
              <div className="translation-card">
                <div className="translation-card-header">
                  <Thermometer size={14} />
                  <strong>Temperature Forcing (T₁ … T₄)</strong>
                </div>
                <p>
                  Cambial cell division (xylogenesis) is activated when daily temperatures exceed species-specific
                  cardinal thresholds (T₁ ≈ 3.2°C). Peak cell division occurs within the optimal
                  thermal window (16.5°C – 25.5°C). Extreme summer thermal stress
                  (T &gt; 35.5°C) induces stomatal closure, suppressing carbon assimilation and halting
                  radial expansion.
                </p>
              </div>

              <div className="translation-card">
                <div className="translation-card-header">
                  <Droplets size={14} />
                  <strong>Moisture, Soil Bucket &amp; PDSI</strong>
                </div>
                <p>
                  Cell enlargement depends directly on intracellular turgor pressure. Root-zone soil moisture is modeled
                  via a leaky bucket integrating monthly precipitation against Hamon potential evapotranspiration (PET).
                  Severe moisture deficits (M &lt; M₁) arrest cellular division, producing hairline drought marker
                  rings or locally absent rings where the cambium remains dormant along entire stem sectors.
                </p>
              </div>

              <div className="translation-card">
                <div className="translation-card-header">
                  <Snowflake size={14} />
                  <strong>Snowpack Buffering &amp; Frost Rings</strong>
                </div>
                <p>
                  High-elevation winter snowpack acts as a hydraulic capacitor, delaying melt to nourish spring earlywood
                  formation during arid early summers. Conversely, volcanic stratospheric aerosol veils (e.g., 1816 Tambora)
                  trigger abrupt sub-freezing growing season shocks, collapsing thin-walled dividing tracheids into
                  distorted, traumatic frost rings.
                </p>
              </div>

              <div className="translation-card">
                <div className="translation-card-header">
                  <Compass size={14} />
                  <strong>Earlywood-Latewood Transition (Mork’s Criterion)</strong>
                </div>
                <p>
                  As daylength declines and late-summer moisture wanes, cambial division shifts from wide, thin-walled,
                  light conductive tracheids (earlywood) to dense, thick-walled, narrow-lumen structural latewood fibers.
                  Anatomically defined by Mork’s criterion (2 × cell wall ≥ lumen width), latewood
                  terminates sharply at winter dormancy, forming the indelible boundary line of the annual ring.
                </p>
              </div>

              <div className="translation-card full-width">
                <div className="translation-card-header">
                  <Flame size={14} />
                  <strong>Disturbance Forensics: Wildfire Scars &amp; Resin Pockets</strong>
                </div>
                <p>
                  Wildfires generate intense thermal necrosis on uphill/leeward bark faces, creating an open triangular
                  catface of exposed dead xylem. In subsequent post-fire seasons, adjacent living cambial margins roll
                  inward as protective woundwood calluses, curling gradually over decades to re-envelope the charred void.
                  Concomitantly, traumatic resin canals form lenticular fluid pockets walled off in secondary xylem to seal
                  pathogen breaches.
                </p>
              </div>
            </div>
          </section>

          {/* 3. Specimen Analog & Biophysical Methodology */}
          <section className="colophon-section methodology-section">
            <h3 className="colophon-section-heading">
              <Compass size={14} className="colophon-heading-icon" /> Specimen Analog &amp; Biophysical Methodology
            </h3>
            <p>
              The installation’s generative engine synthesizes biophysical forward modeling with empirical dendroclimatology:
            </p>
            <ul className="methodology-list">
              <li>
                <strong>Vaganov-Shashkin Formulation (VS-Lite)</strong>: Daily growth rates integrate non-linear
                trapezoidal thermal responses and piecewise soil moisture balances coupled with astronomical daylength.
              </li>
              <li>
                <strong>Basal Area Increment (BAI) Allometry</strong>: Compensates for geometric stem expansion, ensuring
                biological wood volume increment remains physically calibrated as stem circumference increases.
              </li>
              <li>
                <strong>Anatomical Reaction Wood &amp; Eccentricity</strong>: Models non-concentric growth rings and
                pith displacement resulting from terrain slope gravity vectors and prevailing wind load harmonics.
              </li>
              <li>
                <strong>Deterministic Seeding &amp; Climatology</strong>: Merges historical reanalysis (NASA POWER MERRA-2
                and ECMWF ERA5) with topographically downscaled PRISM/WorldClim baselines, sealed with a reproducible
                cryptographic PRNG seed.
              </li>
            </ul>
          </section>

          {/* 4. Colophon Metadata & Credits */}
          <section className="colophon-section metadata-section">
            <h3 className="colophon-section-heading">Curatorial Metadata &amp; Credits</h3>
            <div className="colophon-meta-grid">
              <div className="meta-item">
                <span className="meta-label">Project</span>
                <span className="meta-value">XYLEM: An Ecological Ledger of Deep Time</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Curatorial Identity</span>
                <span className="meta-value">The Radial Ledger: Biological Climate Archives</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Scientific Lineage</span>
                <span className="meta-value">Laboratory of Tree-Ring Research (LTRR), Tucson, AZ</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Climatological Source</span>
                <span className="meta-value">NASA POWER MERRA-2 &amp; ECMWF ERA5 Reanalyses</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Date &amp; Edition</span>
                <span className="meta-value">November 2026 · First Archival Exhibition Release</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Geographic Transect</span>
                <span className="meta-value">North American Western Montane Forests (32°N – 49°N)</span>
              </div>
            </div>
          </section>
        </div>

        {/* Modal Footer */}
        <footer className="colophon-modal-footer">
          <span className="colophon-footer-note">
            Press <kbd>Esc</kbd> or click outside to return to the interactive specimen stage.
          </span>
          <button type="button" className="btn-primary" onClick={onClose}>
            Return to Specimen
          </button>
        </footer>
      </div>
    </div>
  );
};
