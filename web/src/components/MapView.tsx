import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, useMap } from 'react-leaflet';
import { useEffect } from 'react';
import type { LatLngBoundsExpression, LatLngExpression } from 'leaflet';
import type { ReactNode } from 'react';

/** The eight NE states plus the Siliguri corridor and the Kolkata gateway. */
export const NER_BOUNDS: LatLngBoundsExpression = [
  [22.2, 87.9],
  [28.6, 96.6],
];

function FitBounds({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 9 });
  }, [bounds, map]);
  return null;
}

export interface MapLine {
  id: string;
  coords: LatLngExpression[];
  color: string;
  weight?: number;
  dash?: string;
  opacity?: number;
  popup?: ReactNode;
}

export interface MapPoint {
  id: string;
  lat: number;
  lon: number;
  color: string;
  radius?: number;
  ring?: string;
  popup?: ReactNode;
}

/**
 * Shared Leaflet canvas.
 *
 * The OSM raster basemap is darkened by a CSS filter on the tile pane rather
 * than swapped for a dark tile provider, which keeps the demo dependency-free
 * and key-free. If tiles cannot load - the offline case - the corridors and
 * settlements still draw on the console plane.
 */
export function MapView({
  lines = [], points = [], fitTo = null, children, className = '',
}: {
  lines?: MapLine[];
  points?: MapPoint[];
  fitTo?: LatLngBoundsExpression | null;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative w-full h-full ${className}`}>
      <MapContainer
        bounds={NER_BOUNDS}
        className="w-full h-full"
        scrollWheelZoom
        zoomControl
        attributionControl
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap contributors'
          maxZoom={17}
        />
        <FitBounds bounds={fitTo} />

        {lines.map((l) => (
          <Polyline
            key={l.id}
            positions={l.coords}
            pathOptions={{
              color: l.color,
              weight: l.weight ?? 3,
              opacity: l.opacity ?? 0.9,
              dashArray: l.dash,
              lineCap: 'round',
            }}
          >
            {l.popup && <Popup>{l.popup}</Popup>}
          </Polyline>
        ))}

        {points.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lon]}
            radius={p.radius ?? 5}
            pathOptions={{
              color: p.ring ?? '#0f131a',
              weight: 2,
              fillColor: p.color,
              fillOpacity: 1,
            }}
          >
            {p.popup && <Popup>{p.popup}</Popup>}
          </CircleMarker>
        ))}
      </MapContainer>
      {children}
    </div>
  );
}

/** Floating legend panel anchored inside the map frame. */
export function MapLegend({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div
      className={`absolute bottom-4 left-4 z-[500] rounded-lg border px-3 py-2.5 backdrop-blur ${className}`}
      style={{ background: 'rgba(26, 31, 40, 0.92)', borderColor: 'var(--border)' }}
    >
      {title && (
        <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
          {title}
        </div>
      )}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export function LegendSwatch({ color, label, dash }: { color: string; label: string; dash?: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
      <svg width="20" height="8" aria-hidden className="shrink-0">
        <line x1="0" y1="4" x2="20" y2="4" stroke={color} strokeWidth="3" strokeDasharray={dash} strokeLinecap="round" />
      </svg>
      <span>{label}</span>
    </div>
  );
}

export function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} aria-hidden />
      <span>{label}</span>
    </div>
  );
}
