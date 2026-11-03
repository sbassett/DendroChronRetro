import { SpeciesProfile } from './species';
import { EnvironmentDataset } from './types';

export type UnitSystem = 'us' | 'metric';

export function mmToInches(mm: number): number {
  return mm / 25.4;
}

export function metersToFeet(m: number): number {
  return m * 3.28084;
}

export function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

export function formatDiameter(mm: number, units: UnitSystem): string {
  if (units === 'us') {
    return `${mmToInches(mm).toFixed(1)} in`;
  }
  return `${(mm / 10).toFixed(1)} cm`;
}

export function formatBarkThickness(mm: number, units: UnitSystem): string {
  if (units === 'us') {
    return `${mmToInches(mm).toFixed(2)} in`;
  }
  return `${mm.toFixed(1)} mm`;
}

export function formatRingWidth(mm: number, units: UnitSystem): string {
  if (units === 'us') {
    return `${mmToInches(mm).toFixed(3)} in`;
  }
  return `${mm.toFixed(2)} mm`;
}

export function formatElevation(meters: number, units: UnitSystem): string {
  if (units === 'us') {
    return `${Math.round(metersToFeet(meters)).toLocaleString('en-US')} ft`;
  }
  return `${Math.round(meters).toLocaleString('en-US')} m`;
}

export function formatSlope(slopeDeg: number, units: UnitSystem): string {
  if (units === 'us') {
    const pctGrade = Math.round(Math.tan((slopeDeg * Math.PI) / 180) * 100);
    return `${Math.round(slopeDeg)}° (${pctGrade}%)`;
  }
  return `${slopeDeg.toFixed(1)}°`;
}

export function formatTemperature(tempC: number, units: UnitSystem): string {
  if (units === 'us') {
    return `${celsiusToFahrenheit(tempC).toFixed(1)} °F`;
  }
  return `${tempC.toFixed(1)} °C`;
}

export function formatAnnualPrecip(precipMm: number, units: UnitSystem): string {
  if (units === 'us') {
    return `${mmToInches(precipMm).toFixed(1)} in/yr`;
  }
  return `${Math.round(precipMm).toLocaleString('en-US')} mm/yr`;
}

export function formatStumpHeightLong(meters: number, units: UnitSystem): string {
  if (units === 'us') {
    const ft = metersToFeet(meters);
    const inches = Math.round(ft * 12);
    return `${ft.toFixed(1)} ft (${inches} in)`;
  }
  return `${meters.toFixed(2)} m (${Math.round(meters * 100)} cm)`;
}

export function formatStumpHeightShort(meters: number, units: UnitSystem): string {
  if (units === 'us') {
    return `${metersToFeet(meters).toFixed(1)} ft`;
  }
  return `${meters.toFixed(2)} m`;
}

export interface ScaleBarSpec {
  lengthMm: number;
  label: string;
}

/**
 * Picks a clean, physically accurate ruler bar in either US inches/feet or Metric mm/cm.
 */
export function chooseScaleBar(
  maxSpanMm: number,
  units: UnitSystem
): ScaleBarSpec {
  const targetMm = maxSpanMm * 0.24;

  if (units === 'us') {
    const targetIn = mmToInches(targetMm);
    const candidatesIn = [0.25, 0.5, 1, 2, 3, 4, 6, 12, 18, 24];
    let bestIn = candidatesIn[0];
    for (const c of candidatesIn) {
      if (Math.abs(c - targetIn) < Math.abs(bestIn - targetIn)) {
        bestIn = c;
      }
    }
    const label =
      bestIn >= 12 && bestIn % 12 === 0
        ? `${bestIn / 12} ft (${bestIn} in)`
        : `${bestIn} in`;
    return {
      lengthMm: bestIn * 25.4,
      label,
    };
  }

  const candidatesMm = [5, 10, 20, 25, 50, 100, 200, 250, 500];
  let bestMm = candidatesMm[0];
  for (const c of candidatesMm) {
    if (Math.abs(c - targetMm) < Math.abs(bestMm - targetMm)) {
      bestMm = c;
    }
  }
  const label =
    bestMm >= 10 ? `${bestMm / 10} cm (${bestMm} mm)` : `${bestMm} mm`;
  return {
    lengthMm: bestMm,
    label,
  };
}

/**
 * Formats ecological viability reason strings in the active unit system.
 */
export function formatViabilityReason(
  profile: SpeciesProfile,
  env: EnvironmentDataset,
  units: UnitSystem
): string | null {
  if (env.terrain.isWaterOrInvalid) {
    return units === 'us'
      ? 'Elevation grid indicates open water (0 ft across surrounding area).'
      : 'Elevation grid indicates open water (0 m across surrounding area).';
  }

  const { minAnnualPrecipMm, minMeanTempC, maxMeanTempC } =
    profile.viabilityBounds;

  if (env.meanAnnualPrecipMm < minAnnualPrecipMm) {
    return `Mean annual precipitation (${formatAnnualPrecip(env.meanAnnualPrecipMm, units)}) is below ${profile.commonName}'s typical dry-site threshold (${formatAnnualPrecip(minAnnualPrecipMm, units)}).`;
  }

  if (env.meanAnnualTempC < minMeanTempC) {
    return `Mean annual temperature (${formatTemperature(env.meanAnnualTempC, units)}) approaches alpine/subarctic treeline limits (${formatTemperature(minMeanTempC, units)}).`;
  }

  if (env.meanAnnualTempC > maxMeanTempC) {
    return `Mean annual temperature (${formatTemperature(env.meanAnnualTempC, units)}) exceeds ${profile.commonName}'s warm thermal limit (${formatTemperature(maxMeanTempC, units)}) — winter chilling and heat stress limit survival.`;
  }

  return null;
}

/**
 * Parses numeric or compass-suffixed coordinate input (e.g. "-111.74", "111.74 W", "35.26N").
 */
export function parseCoordinateInput(
  raw: string,
  axis: 'lat' | 'lon'
): number | null {
  const trimmed = raw.trim().toUpperCase().replace(/°/g, '');
  if (!trimmed) return null;

  const match = trimmed.match(/^([+-]?\d+(?:\.\d+)?)\s*([NSEW])?$/);
  if (!match) return null;

  let value = Number(match[1]);
  if (Number.isNaN(value)) return null;

  const dir = match[2];
  if (dir) {
    if (axis === 'lat' && (dir === 'E' || dir === 'W')) return null;
    if (axis === 'lon' && (dir === 'N' || dir === 'S')) return null;
    if (dir === 'S' || dir === 'W') {
      value = -Math.abs(value);
    } else {
      value = Math.abs(value);
    }
  }

  const maxAbs = axis === 'lat' ? 85 : 180;
  if (value < -maxAbs || value > maxAbs) return null;
  return value;
}
