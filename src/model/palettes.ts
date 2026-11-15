/**
 * src/model/palettes.ts
 * Museum-grade organic palette profiles for XYLEM dendrochronology cross-sections.
 * Conforms to PROJECT.md § 5.2 interface specifications.
 */

export type PaletteId = 'aged-wood' | 'charred-subalpine' | 'skeleton-plot';

export interface PaletteDefinition {
  id: PaletteId;
  name: string;
  description: string;
  background: string;
  earlywoodColor: string;
  latewoodColor: string;
  transitionColors: string[];
  heartwoodTint: string;
  pithColor: string;
  fireCharColor: string;
  resinColor: string;
  barkPlateColor: string;
  barkFissureColor: string;
  annotationColor: string;
  rwiMarkerColor: string;
}

export const PALETTES: Record<PaletteId, PaletteDefinition> = {
  'aged-wood': {
    id: 'aged-wood',
    name: 'Aged Heartwood & Sapwood',
    description:
      'Warm botanical tones of seasoned conifer xylem, featuring honeyed sapwood, oxidized amber heartwood, and deep umber bark.',
    background: '#f5f0e6',
    earlywoodColor: '#ede3cb',
    latewoodColor: '#5c3a21',
    transitionColors: ['#dfd1b8', '#c49a6c', '#8b5a2b'],
    heartwoodTint: '#8b4513',
    pithColor: '#3d2616',
    fireCharColor: '#1a1412',
    resinColor: '#d97706',
    barkPlateColor: '#6e5441',
    barkFissureColor: '#261911',
    annotationColor: '#1c1c1c',
    rwiMarkerColor: '#9a3412',
  },
  'charred-subalpine': {
    id: 'charred-subalpine',
    name: 'Charred Sub-Alpine',
    description:
      'Subalpine high-elevation lithic profile inspired by ancient bristlecone snags, weathered ash-gray tracheids, and obsidian thermal scars.',
    background: '#e8ecef',
    earlywoodColor: '#d4dade',
    latewoodColor: '#1e252b',
    transitionColors: ['#b8c0c7', '#74808c', '#3e4852'],
    heartwoodTint: '#3a4249',
    pithColor: '#11161b',
    fireCharColor: '#080a0c',
    resinColor: '#ca8a04',
    barkPlateColor: '#374151',
    barkFissureColor: '#111827',
    annotationColor: '#0f172a',
    rwiMarkerColor: '#3b82f6',
  },
  'skeleton-plot': {
    id: 'skeleton-plot',
    name: 'Skeleton Plot Mode',
    description:
      'Analytical dendrochronological crossdating mode inspired by A.E. Douglass laboratory charts: stark high-contrast rings and crimson marker years.',
    background: '#fdfcf7',
    earlywoodColor: '#f5f5f4',
    latewoodColor: '#111111',
    transitionColors: ['#d4d4d4', '#8a8a8a', '#424242'],
    heartwoodTint: '#616161',
    pithColor: '#111111',
    fireCharColor: '#000000',
    resinColor: '#dc2626',
    barkPlateColor: '#71717a',
    barkFissureColor: '#18181b',
    annotationColor: '#111111',
    rwiMarkerColor: '#ef4444',
  },
};

export const DEFAULT_PALETTE_ID: PaletteId = 'aged-wood';

/**
 * Retrieves a palette definition by identifier with safe fallback to default.
 */
export function getPalette(id?: string | PaletteId | null): PaletteDefinition {
  if (!id || typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(PALETTES, id)) {
    return PALETTES[DEFAULT_PALETTE_ID];
  }
  return PALETTES[id as PaletteId];
}

/**
 * Alias for getPalette to support both naming styles.
 */
export function getPaletteById(id?: string | PaletteId | null): PaletteDefinition {
  return getPalette(id);
}

/**
 * Returns all available palette definitions in order.
 */
export function getAllPalettes(): PaletteDefinition[] {
  return Object.values(PALETTES);
}

/**
 * Resolves an arbitrary string to a valid PaletteId, falling back to default.
 */
export function resolvePaletteId(id?: string | null): PaletteId {
  if (id && typeof id === 'string' && Object.prototype.hasOwnProperty.call(PALETTES, id)) {
    return id as PaletteId;
  }
  return DEFAULT_PALETTE_ID;
}

/**
 * Computes linear RGB color blend between two hex color codes.
 * Returns a 7-character hexadecimal string '#rrggbb'.
 */
export function blendHex(hexA: string, hexB: string, t: number): string {
  const safeT = typeof t !== 'number' || Number.isNaN(t) ? 0 : Math.max(0, Math.min(1, t));
  const parse = (h: unknown) => {
    if (typeof h !== 'string') return { r: NaN, g: NaN, b: NaN };
    const raw = h.trim().replace(/^#/, '');
    if (raw.length === 3 && /^[0-9a-fA-F]{3}$/.test(raw)) {
      return {
        r: parseInt(raw[0] + raw[0], 16),
        g: parseInt(raw[1] + raw[1], 16),
        b: parseInt(raw[2] + raw[2], 16),
      };
    }
    if (raw.length >= 6 && /^[0-9a-fA-F]{6}/.test(raw)) {
      return {
        r: parseInt(raw.substring(0, 2), 16),
        g: parseInt(raw.substring(2, 4), 16),
        b: parseInt(raw.substring(4, 6), 16),
      };
    }
    return { r: NaN, g: NaN, b: NaN };
  };

  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

  const a = parse(hexA);
  const b = parse(hexB);

  const aInvalid = Number.isNaN(a.r) || Number.isNaN(a.g) || Number.isNaN(a.b);
  const bInvalid = Number.isNaN(b.r) || Number.isNaN(b.g) || Number.isNaN(b.b);

  if (aInvalid && bInvalid) return '#000000';
  if (aInvalid) return `#${toHex(b.r)}${toHex(b.g)}${toHex(b.b)}`;
  if (bInvalid) return `#${toHex(a.r)}${toHex(a.g)}${toHex(a.b)}`;

  const r = Math.round(a.r + (b.r - a.r) * safeT);
  const g = Math.round(a.g + (b.g - a.g) * safeT);
  const bVal = Math.round(a.b + (b.b - a.b) * safeT);

  return `#${toHex(r)}${toHex(g)}${toHex(bVal)}`;
}
