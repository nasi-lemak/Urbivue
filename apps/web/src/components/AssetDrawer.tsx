import { useState } from 'react';
import { ASSET_STATUSES } from '@urbivue/shared';
import { api, ApiError } from '../lib/api';
import type { AssetFeature } from '../types';

interface Props {
  asset: AssetFeature;
  onClose: () => void;
  onChanged: () => void;
}

export function AssetDrawer({ asset, onClose, onChanged }: Props) {
  const p = asset.properties;
  const [name, setName] = useState(p.name);
  const [status, setStatus] = useState(p.status);
  const [attributesText, setAttributesText] = useState(JSON.stringify(p.attributes, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      let attributes: unknown;
      try {
        attributes = JSON.parse(attributesText);
      } catch {
        throw new Error('Attributes must be valid JSON');
      }
      await api(`/assets/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, status, attributes }),
      });
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.errors?.length) setError(err.errors.join('; '));
      else setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const decommission = async () => {
    if (!window.confirm(`Decommission ${p.code}? It will be hidden from active layers.`)) return;
    setBusy(true);
    try {
      await api(`/assets/${p.id}`, { method: 'DELETE' });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer">
      <div className="drawer-header">
        <div>
          <h2>{p.name}</h2>
          <p className="muted">
            {p.code} · {p.typeId}
          </p>
        </div>
        <button onClick={onClose}>✕</button>
      </div>
      <div className="drawer-body">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {ASSET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Attributes (JSON)
          <textarea
            rows={8}
            value={attributesText}
            onChange={(e) => setAttributesText(e.target.value)}
          />
        </label>
        <p className="muted">Last updated {new Date(p.updatedAt).toLocaleString()}</p>
        {error && <div className="error">{error}</div>}
      </div>
      <div className="drawer-footer">
        <button className="danger" onClick={decommission} disabled={busy}>
          Decommission
        </button>
        <button className="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
