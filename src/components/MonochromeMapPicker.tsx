import React, { useEffect, useRef } from 'react';
import L from 'leaflet';

interface MonochromeMapPickerProps {
  latitude: number;
  longitude: number;
  onSelectLocation: (lat: number, lon: number) => void;
}

export const MonochromeMapPicker: React.FC<MonochromeMapPickerProps> = ({
  latitude,
  longitude,
  onSelectLocation,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
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

    // CartoDB Positron clean light grayscale basemap
    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      {
        attribution: '&copy; OSM &amp; CARTO',
        subdomains: 'abcd',
        maxZoom: 18,
      }
    ).addTo(map);

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

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
