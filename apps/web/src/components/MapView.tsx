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
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
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
      return [`${type.id}-circle`, `${type.id}-clusters`, `${type.id}-cluster-count`];
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
    // 'load' can be long delayed (or effectively lost) when basemap tiles
    // fail, e.g. offline; 'idle' always fires once rendering settles.
    const ready = () => setMapReady(true);
    map.once('load', ready);
    map.once('idle', ready);
    mapRef.current = map;
    // Dev/debug hook (also used by the UI smoke tests to drive the camera).
    (window as unknown as Record<string, unknown>).__urbivueMap = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync sources/layers with loaded data. Data usually arrives before the
  // style finishes loading, and the 'load'/'idle' events are unreliable
  // when basemap tiles fail (offline, blocked CDN) — so poll readiness
  // instead of trusting a single event.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      syncLayers(map, types, data, onSelectRef);
      setMapReady(true); // lets the visibility effect catch up
    };
    if (map.isStyleLoaded()) {
      apply();
      return;
    }
    const timer = setInterval(() => {
      if (map.isStyleLoaded()) {
        clearInterval(timer);
        apply();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [types, data]);

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

function syncLayers(
  map: maplibregl.Map,
  types: AssetTypeInfo[],
  data: Record<string, FeatureCollection>,
  onSelectRef: { current: (assetId: string, typeId: string) => void },
) {
  for (const type of types) {
    const fc = data[type.id];
    if (!fc) continue;

    const source = map.getSource(type.id) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(fc as GeoJSON.GeoJSON);
      continue;
    }

    const color = type.style.color;
    if (type.geometryKind === 'point') {
      // Per-type clustering keeps color = identity: bins cluster with
      // bins, poles with poles. Clicking a cluster zooms into it.
      map.addSource(type.id, {
        type: 'geojson',
        data: fc as GeoJSON.GeoJSON,
        cluster: true,
        clusterMaxZoom: 15,
        clusterRadius: 42,
      });
      map.addLayer({
        id: `${type.id}-circle`,
        type: 'circle',
        source: type.id,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': 7,
          'circle-color': color,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
      map.addLayer({
        id: `${type.id}-clusters`,
        type: 'circle',
        source: type.id,
        filter: ['has', 'point_count'],
        paint: {
          'circle-radius': ['step', ['get', 'point_count'], 12, 10, 16, 50, 22],
          'circle-color': color,
          'circle-opacity': 0.85,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
      map.addLayer({
        id: `${type.id}-cluster-count`,
        type: 'symbol',
        source: type.id,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 11,
        },
        paint: { 'text-color': '#ffffff' },
      });
      map.on('click', `${type.id}-clusters`, async (e) => {
        const feature = e.features?.[0];
        const clusterId = feature?.properties?.cluster_id as number | undefined;
        if (clusterId === undefined) return;
        const source = map.getSource(type.id) as maplibregl.GeoJSONSource;
        const zoom = await source.getClusterExpansionZoom(clusterId);
        map.easeTo({
          center: (feature!.geometry as GeoJSON.Point).coordinates as [number, number],
          zoom,
        });
      });
      map.on('mouseenter', `${type.id}-clusters`, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', `${type.id}-clusters`, () => {
        map.getCanvas().style.cursor = '';
      });
    } else if (type.geometryKind === 'line') {
      map.addSource(type.id, { type: 'geojson', data: fc as GeoJSON.GeoJSON });
      map.addLayer({
        id: `${type.id}-line`,
        type: 'line',
        source: type.id,
        paint: { 'line-color': color, 'line-width': 3 },
      });
    } else {
      map.addSource(type.id, { type: 'geojson', data: fc as GeoJSON.GeoJSON });
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
}
