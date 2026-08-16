import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

const POLL_MS = 8000;

interface Incident {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  status: 'open' | 'acknowledged' | 'resolved';
  title: string;
  openedAt: string;
}

interface WorkOrder {
  id: string;
  code: string;
  status: string;
  priority: string;
  title: string;
  assetCode: string | null;
  assigneeName: string | null;
  createdAt: string;
}

const SEVERITY_COLORS: Record<Incident['severity'], string> = {
  info: '#3b82f6',
  warning: '#f59e0b',
  critical: '#dc2626',
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#dc2626',
  high: '#ea580c',
  medium: '#f59e0b',
  low: '#6b7280',
};

/** Bottom operations panel: live incidents and active work orders. */
export function OpsPanel() {
  const [tab, setTab] = useState<'incidents' | 'workOrders'>('incidents');
  const [collapsed, setCollapsed] = useState(false);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);

  const refresh = useCallback(() => {
    api<Incident[]>('/incidents?status=unresolved')
      .then(setIncidents)
      .catch(() => undefined);
    api<WorkOrder[]>('/work-orders?status=active')
      .then(setWorkOrders)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const incidentAct = async (id: string, action: 'acknowledge' | 'resolve') => {
    await api(`/incidents/${id}/${action}`, { method: 'POST' });
    refresh();
  };

  const woAct = async (id: string, action: 'assign' | 'start' | 'complete' | 'verify') => {
    await api(`/work-orders/${id}/${action}`, { method: 'POST', body: JSON.stringify({}) });
    refresh();
  };

  const critical = incidents.filter((i) => i.severity === 'critical').length;

  return (
    <div className={`incidents-panel ${critical ? 'has-critical' : ''}`}>
      <div className="incidents-header">
        <div className="ops-tabs">
          <button
            className={tab === 'incidents' ? 'active' : ''}
            onClick={() => setTab('incidents')}
          >
            Incidents <strong>{incidents.length}</strong>
            {critical > 0 && <span className="critical-badge">{critical} critical</span>}
          </button>
          <button
            className={tab === 'workOrders' ? 'active' : ''}
            onClick={() => setTab('workOrders')}
          >
            Work orders <strong>{workOrders.length}</strong>
          </button>
        </div>
        <button className="collapse-btn" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? '▴' : '▾'}
        </button>
      </div>

      {!collapsed && tab === 'incidents' && (
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
                  <button onClick={() => incidentAct(i.id, 'acknowledge')}>Ack</button>
                )}
                <button onClick={() => incidentAct(i.id, 'resolve')}>Resolve</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!collapsed && tab === 'workOrders' && (
        <div className="incidents-list">
          {workOrders.length === 0 && <p className="muted">No active work orders</p>}
          {workOrders.map((w) => (
            <div key={w.id} className="incident-row">
              <span
                className="dot"
                style={{ background: PRIORITY_COLORS[w.priority] ?? '#6b7280' }}
              />
              <div className="incident-main">
                <div className="incident-title">
                  {w.code} · {w.title}
                </div>
                <div className="muted">
                  {w.status.replace(/_/g, ' ')}
                  {w.assigneeName ? ` · ${w.assigneeName}` : ' · unassigned'}
                </div>
              </div>
              <div className="incident-actions">
                {w.status === 'open' && <button onClick={() => woAct(w.id, 'assign')}>Take</button>}
                {w.status === 'assigned' && (
                  <button onClick={() => woAct(w.id, 'start')}>Start</button>
                )}
                {w.status === 'in_progress' && (
                  <button onClick={() => woAct(w.id, 'complete')}>Done</button>
                )}
                {w.status === 'done' && (
                  <button onClick={() => woAct(w.id, 'verify')}>Verify</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
