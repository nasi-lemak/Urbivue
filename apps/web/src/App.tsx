import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api';
import { useAuth } from './lib/auth';
import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { MapView } from './components/MapView';
import { AssetDrawer } from './components/AssetDrawer';
import { IncidentsPanel } from './components/IncidentsPanel';
import type { AssetFeature, AssetTypeInfo, FeatureCollection } from './types';

export function App() {
  const { user, loading } = useAuth();

  if (loading) return <div className="centered">Loading…</div>;
  if (!user) return <Login />;
  return <Workspace />;
}

function Workspace() {
  const [types, setTypes] = useState<AssetTypeInfo[]>([]);
  const [data, setData] = useState<Record<string, FeatureCollection>>({});
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<AssetFeature | null>(null);

  useEffect(() => {
    api<AssetTypeInfo[]>('/asset-types').then((list) => {
      setTypes(list);
      setEnabled(Object.fromEntries(list.map((t) => [t.id, true])));
    });
  }, []);

  const refresh = useCallback((typeIds: string[]) => {
    for (const id of typeIds) {
      api<FeatureCollection>(`/assets?type=${encodeURIComponent(id)}`).then((fc) =>
        setData((prev) => ({ ...prev, [id]: fc })),
      );
    }
  }, []);

  useEffect(() => {
    if (types.length) refresh(types.map((t) => t.id));
  }, [types, refresh]);

  const handleSelect = useCallback(
    (assetId: string, typeId: string) => {
      const feature = data[typeId]?.features.find((f) => f.properties.id === assetId) ?? null;
      setSelected(feature);
    },
    [data],
  );

  return (
    <div className="workspace">
      <Sidebar
        types={types}
        data={data}
        enabled={enabled}
        onToggle={(id) => setEnabled((prev) => ({ ...prev, [id]: !prev[id] }))}
      />
      <MapView types={types} data={data} enabled={enabled} onSelect={handleSelect} />
      <IncidentsPanel />
      {selected && (
        <AssetDrawer
          asset={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            refresh([selected.properties.typeId]);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}
