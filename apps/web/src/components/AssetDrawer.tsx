import { useState } from 'react';
import { ASSET_STATUSES } from '@urbivue/shared';
import { api, ApiError } from '../lib/api';
import { InspectionForm } from './InspectionForm';
import type { AssetFeature } from '../types';

interface TraceResult {
  start: string;
  direction: 'upstream' | 'downstream';
  lines: { code: string; depth: number; blockagePct?: number | null }[];
  nodes: { code: string; kind: string | null; name: string | null }[];
}

/** Up/downstream walk of the drain network from this line or node. */
function DrainTrace({ code }: { code: string }) {
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (direction: 'upstream' | 'downstream') => {
    setBusy(true);
    try {
      setTrace(await api<TraceResult>(`/drainage/network/${code}/trace?direction=${direction}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drain-trace">
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button onClick={() => run('upstream')} disabled={busy}>
          ↑ Trace upstream
        </button>
        <button onClick={() => run('downstream')} disabled={busy}>
          ↓ Trace downstream
        </button>
      </div>
      {trace && (
        <div style={{ marginTop: '0.5rem' }}>
          {trace.lines.length === 0 && (
            <p className="muted">
              Nothing {trace.direction} of {trace.start}.
            </p>
          )}
          {trace.lines
            .filter((l) => l.code !== code)
            .map((l) => (
              <p key={l.code} className="muted" style={{ margin: '0.15rem 0' }}>
                {'· '.repeat(l.depth)}
                {l.code}
                {l.blockagePct != null && l.blockagePct >= 50 && (
                  <strong style={{ color: '#b91c1c' }}> — {l.blockagePct}% blocked</strong>
                )}
              </p>
            ))}
          {trace.nodes.map((n) => (
            <p key={n.code} className="muted" style={{ margin: '0.15rem 0' }}>
              {n.code} ({n.kind ?? 'node'}){n.kind === 'outfall' ? ' — discharge point' : ''}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const [inspecting, setInspecting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

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
      {inspecting ? (
        <div className="drawer-body">
          <InspectionForm
            asset={asset}
            onClose={() => setInspecting(false)}
            onSubmitted={(result) => {
              setInspecting(false);
              setFlash(
                result.queuedOffline
                  ? 'No connection — inspection saved offline and will sync automatically.'
                  : result.workOrderId
                    ? 'Inspection saved — cleaning work order auto-created.'
                    : 'Inspection saved.',
              );
            }}
          />
        </div>
      ) : (
        <div className="drawer-body">
          {flash && <div className="flash">{flash}</div>}
          <button onClick={() => setInspecting(true)} style={{ marginBottom: '0.75rem' }}>
            New inspection
          </button>
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
          {(p.typeId === 'drain_line' || p.typeId === 'drain_node') && <DrainTrace code={p.code} />}
          <p className="muted">Last updated {new Date(p.updatedAt).toLocaleString()}</p>
          {error && <div className="error">{error}</div>}
        </div>
      )}
      {!inspecting && (
        <div className="drawer-footer">
          <button className="danger" onClick={decommission} disabled={busy}>
            Decommission
          </button>
          <button className="primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}
