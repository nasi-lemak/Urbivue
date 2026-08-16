import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Incident {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  status: 'open' | 'acknowledged' | 'resolved';
  title: string;
  openedAt: string;
  ruleKey: string | null;
  module: string | null;
  sensorExternalId: string | null;
}

const SEVERITY_COLORS: Record<Incident['severity'], string> = {
  info: '#3b82f6',
  warning: '#f59e0b',
  critical: '#dc2626',
};

const POLL_MS = 8000;

export function IncidentsPanel() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  const refresh = useCallback(() => {
    api<Incident[]>('/incidents?status=unresolved')
      .then(setIncidents)
      .catch(() => undefined); // transient poll failures are fine
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const act = async (id: string, action: 'acknowledge' | 'resolve') => {
    await api(`/incidents/${id}/${action}`, { method: 'POST' });
    refresh();
  };

  const critical = incidents.filter((i) => i.severity === 'critical').length;

  return (
    <div className={`incidents-panel ${critical ? 'has-critical' : ''}`}>
      <button className="incidents-header" onClick={() => setCollapsed((c) => !c)}>
        <span>
          Incidents <strong>{incidents.length}</strong>
          {critical > 0 && <span className="critical-badge">{critical} critical</span>}
        </span>
        <span>{collapsed ? '▴' : '▾'}</span>
      </button>
      {!collapsed && (
        <div className="incidents-list">
          {incidents.length === 0 && <p className="muted">No active incidents</p>}
          {incidents.map((i) => (
            <div key={i.id} className="incident-row">
              <span className="dot" style={{ background: SEVERITY_COLORS[i.severity] }} />
              <div className="incident-main">
                <div className="incident-title">{i.title}</div>
                <div className="muted">
                  {new Date(i.openedAt).toLocaleTimeString()} · {i.status}
                </div>
              </div>
              <div className="incident-actions">
                {i.status === 'open' && (
                  <button onClick={() => act(i.id, 'acknowledge')}>Ack</button>
                )}
                <button onClick={() => act(i.id, 'resolve')}>Resolve</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
