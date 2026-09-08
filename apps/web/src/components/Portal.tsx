import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { LANGS, useI18n } from '../lib/i18n';

/** Public citizen portal: no login — flood status, toilets, accessibility, reporting. */

interface Category {
  key: string;
  module: string;
  name: string;
}

interface FloodStatus {
  overall: string;
  stations: {
    code: string;
    name: string;
    level: number | null;
    status: string;
    geometry: { coordinates: [number, number] };
  }[];
  zones: { code: string; riskClass: string; geometry: unknown }[];
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

const STATION_COLORS: Record<string, string> = {
  normal: '#16a34a',
  warning: '#f59e0b',
  danger: '#dc2626',
  no_data: '#9ca3af',
};

const COMPLIANCE_COLORS: Record<string, string> = {
  compliant: '#16a34a',
  minor_issues: '#f59e0b',
  non_compliant: '#dc2626',
  unknown: '#9ca3af',
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export function Portal() {
  const { t, lang, setLang } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const [flood, setFlood] = useState<FloodStatus | null>(null);
  const [toilets, setToilets] = useState<any[]>([]);
  const [accessFeatures, setAccessFeatures] = useState<any[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [picking, setPicking] = useState(false);
  const pickingRef = useRef(false);
  pickingRef.current = picking;
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [contact, setContact] = useState('');
  const [location, setLocation] = useState<{ lon: number; lat: number } | null>(null);
  const [submitResult, setSubmitResult] = useState<{
    id: string;
    duplicateOfId: string | null;
  } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [trackId, setTrackId] = useState('');
  const [tracked, setTracked] = useState<{ status: string; category: string } | null>(null);

  useEffect(() => {
    getJson<FloodStatus>('/public/flood-status')
      .then(setFlood)
      .catch(() => undefined);
    getJson<any[]>('/public/toilets')
      .then(setToilets)
      .catch(() => undefined);
    getJson<any[]>('/public/accessibility')
      .then(setAccessFeatures)
      .catch(() => undefined);
    getJson<Category[]>('/public/report-categories')
      .then((list) => {
        setCategories(list);
        if (list.length) setCategory(list[0].key);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [101.6955, 3.1478],
      zoom: 14.5,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('load', () => setMapReady(true));
    map.on('click', (e) => {
      if (!pickingRef.current) return;
      const loc = { lon: e.lngLat.lng, lat: e.lngLat.lat };
      setLocation(loc);
      setPicking(false);
      markerRef.current?.remove();
      markerRef.current = new maplibregl.Marker({ color: '#dc2626' })
        .setLngLat([loc.lon, loc.lat])
        .addTo(map);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Layers once data + map are ready.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !flood) return;

    const addOrSet = (id: string, data: GeoJSON.GeoJSON) => {
      const source = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (source) source.setData(data);
      return !source;
    };

    const zonesFc = {
      type: 'FeatureCollection',
      features: flood.zones.map((z) => ({
        type: 'Feature',
        geometry: z.geometry,
        properties: { riskClass: z.riskClass },
      })),
    } as GeoJSON.GeoJSON;
    if (addOrSet('zones', zonesFc)) {
      map.addSource('zones', { type: 'geojson', data: zonesFc });
      map.addLayer({
        id: 'zones-fill',
        type: 'fill',
        source: 'zones',
        paint: { 'fill-color': '#dc2626', 'fill-opacity': 0.12 },
      });
      map.addLayer({
        id: 'zones-line',
        type: 'line',
        source: 'zones',
        paint: { 'line-color': '#dc2626', 'line-width': 1.5, 'line-dasharray': [2, 2] },
      });
    }

    const stationsFc = {
      type: 'FeatureCollection',
      features: flood.stations.map((s) => ({
        type: 'Feature',
        geometry: s.geometry,
        properties: { code: s.code, name: s.name, level: s.level, status: s.status },
      })),
    } as unknown as GeoJSON.GeoJSON;
    if (addOrSet('stations', stationsFc)) {
      map.addSource('stations', { type: 'geojson', data: stationsFc });
      map.addLayer({
        id: 'stations-circle',
        type: 'circle',
        source: 'stations',
        paint: {
          'circle-radius': 9,
          'circle-color': [
            'match',
            ['get', 'status'],
            'normal',
            STATION_COLORS.normal,
            'warning',
            STATION_COLORS.warning,
            'danger',
            STATION_COLORS.danger,
            STATION_COLORS.no_data,
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
      map.on('click', 'stations-circle', (e) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        new maplibregl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(
            `<b>${p.name}</b><br/>${t('popup.riverLevel')}: ${p.level ?? '—'} m (${p.status})`,
          )
          .addTo(map);
      });
    }

    const toiletsFc = {
      type: 'FeatureCollection',
      features: toilets.map((t) => ({
        type: 'Feature',
        geometry: t.geometry,
        properties: t,
      })),
    } as GeoJSON.GeoJSON;
    if (addOrSet('toilets', toiletsFc)) {
      map.addSource('toilets', { type: 'geojson', data: toiletsFc });
      map.addLayer({
        id: 'toilets-circle',
        type: 'circle',
        source: 'toilets',
        paint: {
          'circle-radius': 7,
          'circle-color': '#0d9488',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
      map.on('click', 'toilets-circle', (e) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        const cleaned = p.lastCleanedAt
          ? new Date(p.lastCleanedAt).toLocaleString()
          : t('popup.noRecord');
        new maplibregl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(
            `<b>${p.name}</b><br/>${t('popup.hours')}: ${p.openingHours ?? '—'}<br/>` +
              `${t('popup.accessibleFixtures')}: ${p.accessibleFixtures ?? 0}<br/>` +
              `${t('popup.rating')}: ${p.avgRating ?? '—'} (${p.ratingCount ?? 0})<br/>` +
              `${t('popup.lastCleaned')}: ${cleaned}`,
          )
          .addTo(map);
      });
    }

    const accessFc = {
      type: 'FeatureCollection',
      features: accessFeatures.map((f) => ({
        type: 'Feature',
        geometry: f.geometry,
        properties: f,
      })),
    } as GeoJSON.GeoJSON;
    if (addOrSet('access', accessFc)) {
      map.addSource('access', { type: 'geojson', data: accessFc });
      map.addLayer({
        id: 'access-circle',
        type: 'circle',
        source: 'access',
        paint: {
          'circle-radius': 6,
          'circle-color': [
            'match',
            ['get', 'complianceStatus'],
            'compliant',
            COMPLIANCE_COLORS.compliant,
            'minor_issues',
            COMPLIANCE_COLORS.minor_issues,
            'non_compliant',
            COMPLIANCE_COLORS.non_compliant,
            COMPLIANCE_COLORS.unknown,
          ],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#1d4ed8',
        },
      });
      map.on('click', 'access-circle', (e) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        new maplibregl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(
            `<b>${p.name}</b><br/>${String(p.featureKind).replace(/_/g, ' ')} · ` +
              `${String(p.complianceStatus).replace(/_/g, ' ')}`,
          )
          .addTo(map);
      });
    }
  }, [mapReady, flood, toilets, accessFeatures]);

  const submitReport = async () => {
    setSubmitError(null);
    if (!location) {
      setSubmitError(t('report.needLocation'));
      return;
    }
    try {
      const res = await fetch('/api/public/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          description,
          location,
          contact: contact.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.errors?.join('; ') ?? body.message);
      setSubmitResult(body);
      setDescription('');
      setContact('');
      markerRef.current?.remove();
      setLocation(null);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('report.submitFailed'));
    }
  };

  const track = async () => {
    setTracked(null);
    try {
      setTracked(await getJson(`/public/reports/${trackId.trim()}`));
    } catch {
      setTracked({ status: 'not found', category: '' });
    }
  };

  const banner =
    flood && flood.overall !== 'normal' && flood.overall !== 'no_data' ? flood.overall : null;

  return (
    <div className="portal">
      {banner && (
        <div className={`portal-banner ${banner}`}>
          {banner === 'danger' ? t('banner.danger') : t('banner.warning')}
        </div>
      )}
      <div className="portal-body">
        <aside className="portal-panel">
          <div className="portal-title-row">
            <h1>Urbivue</h1>
            <div className="lang-switch">
              {LANGS.map((l) => (
                <button
                  key={l.code}
                  className={lang === l.code ? 'active' : ''}
                  onClick={() => setLang(l.code)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          <p className="muted">{t('portal.tagline')}</p>

          <section>
            <h2>{t('portal.legend')}</h2>
            <div className="legend-row">
              <span className="dot" style={{ background: '#0d9488' }} /> {t('legend.toilet')}
            </div>
            <div className="legend-row">
              <span className="dot" style={{ background: '#16a34a' }} /> {t('legend.green')}
            </div>
            <div className="legend-row">
              <span className="dot" style={{ background: '#f59e0b' }} /> {t('legend.amber')}
            </div>
            <div className="legend-row">
              <span className="dot" style={{ background: '#dc2626' }} /> {t('legend.red')}
            </div>
          </section>

          <section>
            <h2>{t('report.title')}</h2>
            {submitResult ? (
              <div className="flash">
                {submitResult.duplicateOfId ? t('report.thanksDuplicate') : t('report.thanks')}
                <br />
                {t('report.trackingId')}: <code>{submitResult.id}</code>
                <label style={{ marginTop: '0.5rem' }}>
                  {t('report.addPhoto')}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const form = new FormData();
                      form.append('file', file);
                      const res = await fetch(`/api/public/reports/${submitResult.id}/photo`, {
                        method: 'POST',
                        body: form,
                      });
                      window.alert(res.ok ? t('report.photoOk') : t('report.photoFail'));
                    }}
                  />
                </label>
                <button style={{ marginTop: '0.5rem' }} onClick={() => setSubmitResult(null)}>
                  {t('report.another')}
                </button>
              </div>
            ) : (
              <>
                <label>
                  {t('report.category')}
                  <select value={category} onChange={(e) => setCategory(e.target.value)}>
                    {categories.map((c) => (
                      <option key={c.key} value={c.key}>
                        {t(`category.${c.key}`, c.name)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('report.whatsWrong')}
                  <textarea
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('report.describePlaceholder')}
                  />
                </label>
                <label>
                  {t('report.contact')}
                  <input
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder={t('report.contactPlaceholder')}
                  />
                </label>
                <button className={picking ? 'primary' : ''} onClick={() => setPicking(!picking)}>
                  {location
                    ? t('report.locationSet')
                    : picking
                      ? t('report.tapMap')
                      : t('report.pickLocation')}
                </button>
                {submitError && <div className="error">{submitError}</div>}
                <button
                  className="primary"
                  style={{ marginTop: '0.5rem', width: '100%' }}
                  onClick={submitReport}
                >
                  {t('report.submit')}
                </button>
              </>
            )}
          </section>

          <section>
            <h2>{t('track.title')}</h2>
            <input
              placeholder={t('report.trackingId')}
              value={trackId}
              onChange={(e) => setTrackId(e.target.value)}
            />
            <button style={{ marginTop: '0.4rem' }} onClick={track} disabled={!trackId.trim()}>
              {t('track.check')}
            </button>
            {tracked && (
              <p className="muted" style={{ marginTop: '0.4rem' }}>
                {t('track.status')}:{' '}
                <strong>{t(`status.${tracked.status}`, tracked.status.replace(/_/g, ' '))}</strong>
                {tracked.category
                  ? ` · ${t(`category.${tracked.category}`, tracked.category.replace(/_/g, ' '))}`
                  : ''}
              </p>
            )}
          </section>
        </aside>
        <div ref={containerRef} className="map" />
      </div>
    </div>
  );
}
