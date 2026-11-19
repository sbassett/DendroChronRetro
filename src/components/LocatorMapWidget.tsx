import React, { useMemo } from 'react';
import { Pencil } from 'lucide-react';
import {
  LOCATOR_MAP_HEIGHT,
  LOCATOR_MAP_WIDTH,
  NA_GREAT_LAKES_PATH,
  NA_LAND_PATH,
  projectToLocatorMap,
  SPECIES_NATIVE_RANGE_PATH,
} from '../model/locatorMapData';
import { SpeciesId } from '../model/types';

export interface LocatorMapWidgetProps {
  species: SpeciesId;
  latitude: number;
  longitude: number;
  paletteBackground: string;
  annotationColor: string;
  transparentBackground?: boolean;
  onEdit?: () => void;
  isEditing?: boolean;
  compact?: boolean;
}

/**
 * Minimalist Tuftean North America locator map displaying the active species range
 * and specimen pin, with an optional interactive edit trigger.
 */
export const LocatorMapWidget: React.FC<LocatorMapWidgetProps> = ({
  species,
  latitude,
  longitude,
  paletteBackground,
  annotationColor,
  transparentBackground = false,
  onEdit,
  isEditing = false,
  compact = false,
}) => {
  const projPin = useMemo(
    () => projectToLocatorMap(latitude, longitude),
    [latitude, longitude]
  );

  const px = projPin.inFrame ? projPin.x : projPin.clampedX;
  const py = projPin.inFrame ? projPin.y : projPin.clampedY;
  const lakeFill = transparentBackground ? '#ededeb' : paletteBackground;

  const mapSvg = (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${LOCATOR_MAP_WIDTH} ${LOCATOR_MAP_HEIGHT}`}
      className={`locator-map-svg ${compact ? 'compact' : ''}`}
      aria-hidden="true"
    >
      <path
        d={NA_LAND_PATH}
        fill="#ffffff"
        stroke="#8f8f88"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <path
        d={NA_GREAT_LAKES_PATH}
        fill={lakeFill}
        stroke="#8f8f88"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <path
        data-species-range={species}
        fillRule="evenodd"
        d={SPECIES_NATIVE_RANGE_PATH[species]}
        fill="#42423e"
        fillOpacity={0.68}
      />
      {projPin.inFrame ? (
        <circle
          cx={px.toFixed(1)}
          cy={py.toFixed(1)}
          r={22}
          fill="#0a0a0a"
          stroke="#ffffff"
          strokeWidth={10}
        />
      ) : (
        <circle
          cx={px.toFixed(1)}
          cy={py.toFixed(1)}
          r={20}
          fill="none"
          stroke={annotationColor}
          strokeWidth={7}
          strokeDasharray="10 7"
        />
      )}
    </svg>
  );

  if (onEdit) {
    return (
      <button
        type="button"
        className={`locator-map-trigger ${isEditing ? 'editing' : ''} ${compact ? 'compact' : ''}`}
        onClick={onEdit}
        aria-label="Edit specimen location on map"
        aria-expanded={Boolean(isEditing)}
        title="Click to edit geographic location on map"
      >
        {mapSvg}
        <span className="locator-edit-badge" aria-hidden="true">
          <Pencil size={11} />
        </span>
      </button>
    );
  }

  return (
    <div className={`locator-map-preview ${compact ? 'compact' : ''}`}>
      {mapSvg}
    </div>
  );
};
