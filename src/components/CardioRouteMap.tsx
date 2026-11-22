import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Layers } from 'lucide-react';
import type { GpsPoint } from '../types/fitness';

interface CardioRouteMapProps {
  points: GpsPoint[];
  liveCenter?: GpsPoint | null;
  heightClass?: string;
  interactive?: boolean;
}

type MapTileMode = 'dark' | 'satellite';

const TILE_LAYERS: Record<
  MapTileMode,
  { url: string; attribution: string; subdomains?: string }
> = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
  },
};

export const CardioRouteMap: React.FC<CardioRouteMapProps> = ({
  points,
  liveCenter = null,
  heightClass = 'h-64',
  interactive = true,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const startMarkerRef = useRef<L.CircleMarker | null>(null);
  const currentMarkerRef = useRef<L.CircleMarker | null>(null);
  const [tileMode, setTileMode] = useState<MapTileMode>('dark');

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialPoint =
      points[points.length - 1] ?? liveCenter ?? { lat: 19.4326, lng: -99.1332 };

    const map = L.map(containerRef.current, {
      center: [initialPoint.lat, initialPoint.lng],
      zoom: 16,
      zoomControl: interactive,
      dragging: interactive,
      scrollWheelZoom: interactive,
      attributionControl: true,
    });

    const cfg = TILE_LAYERS.dark;
    const layer = L.tileLayer(cfg.url, {
      maxZoom: 19,
      subdomains: cfg.subdomains ?? 'abc',
      attribution: cfg.attribution,
    }).addTo(map);

    const polyline = L.polyline([], {
      color: '#D4FF33',
      weight: 5,
      opacity: 0.95,
      lineJoin: 'round',
    }).addTo(map);

    mapRef.current = map;
    tileLayerRef.current = layer;
    polylineRef.current = polyline;

    const resizeTimer = window.setTimeout(() => {
      map.invalidateSize();
    }, 120);

    return () => {
      window.clearTimeout(resizeTimer);
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      polylineRef.current = null;
      startMarkerRef.current = null;
      currentMarkerRef.current = null;
    };
  }, [interactive]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }

    const cfg = TILE_LAYERS[tileMode];
    const nextLayer = L.tileLayer(cfg.url, {
      maxZoom: 19,
      ...(cfg.subdomains ? { subdomains: cfg.subdomains } : {}),
      attribution: cfg.attribution,
    });
    nextLayer.addTo(map);
    nextLayer.bringToBack();
    tileLayerRef.current = nextLayer;
  }, [tileMode]);

  useEffect(() => {
    const map = mapRef.current;
    const polyline = polylineRef.current;
    if (!map || !polyline) return;

    const latLngs: L.LatLngExpression[] = points.map((p) => [p.lat, p.lng]);
    polyline.setLatLngs(latLngs);

    if (points.length > 0) {
      const first = points[0];
      const last = points[points.length - 1];

      if (!startMarkerRef.current) {
        startMarkerRef.current = L.circleMarker([first.lat, first.lng], {
          radius: 7,
          color: '#0A0B0D',
          weight: 2,
          fillColor: '#34D399',
          fillOpacity: 1,
        }).addTo(map);
      } else {
        startMarkerRef.current.setLatLng([first.lat, first.lng]);
      }

      if (!currentMarkerRef.current) {
        currentMarkerRef.current = L.circleMarker([last.lat, last.lng], {
          radius: 8,
          color: '#0A0B0D',
          weight: 2.5,
          fillColor: '#D4FF33',
          fillOpacity: 1,
        }).addTo(map);
      } else {
        currentMarkerRef.current.setLatLng([last.lat, last.lng]);
      }

      if (points.length > 1 && !liveCenter) {
        map.fitBounds(polyline.getBounds(), { padding: [24, 24], maxZoom: 17 });
      } else {
        map.panTo([last.lat, last.lng], { animate: true });
      }
    } else if (liveCenter) {
      if (!currentMarkerRef.current) {
        currentMarkerRef.current = L.circleMarker([liveCenter.lat, liveCenter.lng], {
          radius: 8,
          color: '#0A0B0D',
          weight: 2.5,
          fillColor: '#D4FF33',
          fillOpacity: 1,
        }).addTo(map);
      } else {
        currentMarkerRef.current.setLatLng([liveCenter.lat, liveCenter.lng]);
      }
      map.setView([liveCenter.lat, liveCenter.lng], 16, { animate: true });
    }
  }, [points, liveCenter]);

  return (
    <div
      className={`relative w-full ${heightClass} rounded-2xl overflow-hidden border border-[#252A36] bg-[#0B0C0F]`}
    >
      <div ref={containerRef} className="w-full h-full z-0" />
      <button
        type="button"
        onClick={() => setTileMode((m) => (m === 'dark' ? 'satellite' : 'dark'))}
        aria-label={
          tileMode === 'dark'
            ? 'Cambiar mapa a vista Satélite'
            : 'Cambiar mapa a vista Oscura'
        }
        className="absolute top-2.5 right-2.5 z-[400] min-h-[36px] inline-flex items-center gap-1.5 rounded-xl border border-[#2F3545] bg-[#0B0D12]/90 backdrop-blur-md px-3 text-xs font-extrabold text-[#D4FF33] hover:border-[#D4FF33] shadow-lg active:scale-95 transition-all"
      >
        <Layers className="w-3.5 h-3.5" />
        {tileMode === 'dark' ? 'Satélite' : 'Oscuro'}
      </button>
    </div>
  );
};
