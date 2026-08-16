import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { AssetFeature } from '../types';

interface ChecklistItem {
  key: string;
  label: string;
  type: 'boolean' | 'score' | 'number' | 'note';
  required?: boolean;
  min?: number;
  max?: number;
}

interface Template {
  key: string;
  assetTypeId: string;
  name: string;
  items: ChecklistItem[];
}

interface Props {
  asset: AssetFeature;
  onClose: () => void;
  onSubmitted: (result: { workOrderId?: string }) => void;
}

export function InspectionForm({ asset, onClose, onSubmitted }: Props) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateKey, setTemplateKey] = useState<string>('');
  const [responses, setResponses] = useState<Record<string, unknown>>({});
  const [conditionScore, setConditionScore] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Template[]>(`/inspection-templates?assetType=${asset.properties.typeId}`).then((list) => {
      setTemplates(list);
      if (list.length) setTemplateKey(list[0].key);
    });
  }, [asset.properties.typeId]);

  const template = templates.find((t) => t.key === templateKey);

  const setResponse = (key: string, value: unknown) =>
    setResponses((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ id: string; workOrderId?: string }>('/inspections', {
        method: 'POST',
        body: JSON.stringify({
          assetId: asset.properties.id,
          templateKey,
          responses,
          conditionScore: conditionScore ? Number(conditionScore) : undefined,
        }),
      });
      onSubmitted(result);
    } catch (err) {
      if (err instanceof ApiError && err.errors?.length) setError(err.errors.join('; '));
      else setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setBusy(false);
    }
  };

  if (!templates.length) {
    return (
      <div className="inspection-form">
        <p className="muted">No inspection template for this asset type.</p>
        <button onClick={onClose}>Back</button>
      </div>
    );
  }

  return (
    <div className="inspection-form">
      <label>
        Template
        <select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
          {templates.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      {template?.items.map((item) => (
        <label key={item.key}>
          {item.label}
          {item.required && ' *'}
          {item.type === 'boolean' && (
            <select
              value={String(responses[item.key] ?? '')}
              onChange={(e) =>
                setResponse(item.key, e.target.value === '' ? undefined : e.target.value === 'true')
              }
            >
              <option value="">—</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          )}
          {(item.type === 'number' || item.type === 'score') && (
            <input
              type="number"
              min={item.type === 'score' ? 1 : item.min}
              max={item.type === 'score' ? 5 : item.max}
              value={String(responses[item.key] ?? '')}
              onChange={(e) =>
                setResponse(item.key, e.target.value === '' ? undefined : Number(e.target.value))
              }
            />
          )}
          {item.type === 'note' && (
            <textarea
              rows={3}
              value={String(responses[item.key] ?? '')}
              onChange={(e) => setResponse(item.key, e.target.value || undefined)}
            />
          )}
        </label>
      ))}

      <label>
        Overall condition (1 failed – 5 excellent)
        <input
          type="number"
          min={1}
          max={5}
          value={conditionScore}
          onChange={(e) => setConditionScore(e.target.value)}
        />
      </label>

      {error && <div className="error">{error}</div>}
      <div className="drawer-footer" style={{ padding: '0.5rem 0 0' }}>
        <button onClick={onClose} disabled={busy}>
          Back
        </button>
        <button className="primary" onClick={submit} disabled={busy}>
          {busy ? 'Submitting…' : 'Submit inspection'}
        </button>
      </div>
    </div>
  );
}
