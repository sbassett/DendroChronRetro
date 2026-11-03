import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { UnitSystem } from '../model/units';

interface MonochromeMapPickerProps {
  latitude: number;
  longitude: number;
  unitSystem: UnitSystem;
  onSelectLocation: (lat: number, lon: number) => void;
}

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export const MonochromeMapPicker: React.FC<MonochromeMapPickerProps> = ({
  latitude,
  longitude,
  unitSystem,
  onSelectLocation,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const scaleControlRef = useRef<L.Control.Scale | null>(null);
  const callbackRef = useRef(onSelectLocation);
  callbackRef.current = onSelectLocation;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [latitude, longitude],
      zoom: 6,
      zoomControl: true,
      attributionControl: true,
    });

    const cartoKey = import.meta.env.VITE_CARTO_API_KEY?.trim();
    const initialUrl = cartoKey
      ? `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(cartoKey)}`
      : OSM_TILE_URL;
    const initialAttribution = cartoKey
      ? '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &amp; <a href="https://carto.com/attributions">CARTO</a>'
      : OSM_ATTRIBUTION;

    const tileLayer = L.tileLayer(initialUrl, {
      attribution: initialAttribution,
      maxZoom: 18,
    }).addTo(map);

    // If CARTO rejects the domain (e.g. localhost when restricted to github.io), fall back cleanly to OSM
    if (cartoKey) {
      let switchedToFallback = false;
      tileLayer.on('tileerror', () => {
        if (switchedToFallback) return;
        switchedToFallback = true;
        tileLayer.setUrl(OSM_TILE_URL);
      });
    }

    const scaleCtrl = L.control
      .scale({
        imperial: unitSystem === 'us',
        metric: unitSystem === 'metric',
        maxWidth: 100,
        position: 'bottomleft',
      })
      .addTo(map);

    const marker = L.circleMarker([latitude, longitude], {
      radius: 7,
      color: '#111111',
      weight: 2.2,
      fillColor: '#ffffff',
      fillOpacity: 0.9,
    }).addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      const wrappedLon = ((((e.latlng.lng + 180) % 360) + 360) % 360) - 180;
      const clampedLat = Math.max(-85, Math.min(85, e.latlng.lat));
      callbackRef.current(
        Number(clampedLat.toFixed(5)),
        Number(wrappedLon.toFixed(5))
      );
    });

    mapRef.current = map;
    markerRef.current = marker;
    scaleControlRef.current = scaleCtrl;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      scaleControlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync Leaflet scale bar with US / Metric switch
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (scaleControlRef.current) {
      scaleControlRef.current.remove();
    }
    scaleControlRef.current = L.control
      .scale({
        imperial: unitSystem === 'us',
        metric: unitSystem === 'metric',
        maxWidth: 100,
        position: 'bottomleft',
      })
      .addTo(map);
  }, [unitSystem]);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    marker.setLatLng([latitude, longitude]);
    const bounds = map.getBounds();
    if (!bounds.contains([latitude, longitude])) {
      map.panTo([latitude, longitude], { animate: true, duration: 0.35 });
    }
  }, [latitude, longitude]);

  return (
    <div className="map-picker-wrapper">
      <div ref={containerRef} className="monochrome-leaflet-map" />
      <div className="map-hint">Click map to sample exact coordinates</div>
    </div>
  );
};
