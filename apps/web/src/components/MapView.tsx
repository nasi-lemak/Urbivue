import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { AssetTypeInfo, FeatureCollection } from '../types';

interface Props {
  types: AssetTypeInfo[];
  data: Record<string, FeatureCollection>;
  enabled: Record<string, boolean>;
  onSelect: (assetId: string, typeId: string) => void;
}

const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

/** Layer ids contributed by an asset type's source. */
function layerIdsFor(type: AssetTypeInfo): string[] {
  switch (type.geometryKind) {
    case 'point':
      return [`${type.id}-circle`];
    case 'line':
      return [`${type.id}-line`];
    case 'polygon':
      return [`${type.id}-fill`, `${type.id}-outline`];
  }
}

export function MapView({ types, data, enabled, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [101.6932, 3.1466], // Kuala Lumpur demo seed area
      zoom: 13,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('load', () => setMapReady(true));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync sources/layers with loaded data.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    for (const type of types) {
      const fc = data[type.id];
      if (!fc) continue;

      const source = map.getSource(type.id) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(fc as GeoJSON.GeoJSON);
        continue;
      }

      map.addSource(type.id, { type: 'geojson', data: fc as GeoJSON.GeoJSON });
      const color = type.style.color;
      if (type.geometryKind === 'point') {
        map.addLayer({
          id: `${type.id}-circle`,
          type: 'circle',
          source: type.id,
          paint: {
            'circle-radius': 7,
            'circle-color': color,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
          },
        });
      } else if (type.geometryKind === 'line') {
        map.addLayer({
          id: `${type.id}-line`,
          type: 'line',
          source: type.id,
          paint: { 'line-color': color, 'line-width': 3 },
        });
      } else {
        map.addLayer({
          id: `${type.id}-fill`,
          type: 'fill',
          source: type.id,
          paint: { 'fill-color': color, 'fill-opacity': 0.3 },
        });
        map.addLayer({
          id: `${type.id}-outline`,
          type: 'line',
          source: type.id,
          paint: { 'line-color': color, 'line-width': 2 },
        });
      }

      for (const layerId of layerIdsFor(type)) {
        map.on('click', layerId, (e) => {
          const feature = e.features?.[0];
          const assetId = feature?.properties?.id as string | undefined;
          if (assetId) onSelectRef.current(assetId, type.id);
        });
        map.on('mouseenter', layerId, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', layerId, () => (map.getCanvas().style.cursor = ''));
      }
    }
  }, [types, data, mapReady]);

  // Sync layer visibility with toggles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const type of types) {
      for (const layerId of layerIdsFor(type)) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', enabled[type.id] ? 'visible' : 'none');
        }
      }
    }
  }, [types, enabled, mapReady, data]);

  return <div ref={containerRef} className="map" />;
}
