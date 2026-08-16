import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { UsersPanel } from './UsersPanel';
import type { AssetTypeInfo, FeatureCollection } from '../types';

interface Props {
  types: AssetTypeInfo[];
  data: Record<string, FeatureCollection>;
  enabled: Record<string, boolean>;
  onToggle: (typeId: string) => void;
}

export function Sidebar({ types, data, enabled, onToggle }: Props) {
  const { user, logout } = useAuth();
  const [showUsers, setShowUsers] = useState(false);

  const changeOwnPassword = async () => {
    const current = window.prompt('Current password:');
    if (!current) return;
    const next = window.prompt('New password (min 8 chars):');
    if (!next) return;
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      window.alert('Password changed.');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Change failed');
    }
  };

  const byModule = new Map<string, AssetTypeInfo[]>();
  for (const t of types) {
    byModule.set(t.module, [...(byModule.get(t.module) ?? []), t]);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>Urbivue</h1>
        <p className="muted">Asset layers</p>
      </div>
      <div className="sidebar-body">
        {[...byModule.entries()].map(([module, moduleTypes]) => (
          <section key={module}>
            <h2>{module}</h2>
            {moduleTypes.map((t) => (
              <label key={t.id} className="layer-row">
                <input
                  type="checkbox"
                  checked={enabled[t.id] ?? false}
                  onChange={() => onToggle(t.id)}
                />
                <span className="swatch" style={{ background: t.style.color }} />
                <span className="layer-name">{t.name}</span>
                <span className="count">{data[t.id]?.features.length ?? '…'}</span>
              </label>
            ))}
          </section>
        ))}
      </div>
      <div className="sidebar-footer">
        <div>
          <div>{user?.displayName}</div>
          <div className="muted">{user?.role}</div>
        </div>
        <div className="sidebar-footer-actions">
          {user?.role === 'admin' && <button onClick={() => setShowUsers(true)}>Users</button>}
          <button onClick={changeOwnPassword} title="Change password">
            PW
          </button>
          <button onClick={logout}>Sign out</button>
        </div>
      </div>
      {showUsers && <UsersPanel onClose={() => setShowUsers(false)} />}
    </aside>
  );
}
