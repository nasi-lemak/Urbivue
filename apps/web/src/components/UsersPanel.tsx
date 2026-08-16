import { useCallback, useEffect, useState } from 'react';
import { ROLES } from '@urbivue/shared';
import { api, ApiError } from '../lib/api';

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  role: string;
  active: boolean;
}

/** Admin-only user administration overlay. */
export function UsersPanel({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('crew');
  const [password, setPassword] = useState('');

  const refresh = useCallback(() => {
    api<UserRow[]>('/users')
      .then(setUsers)
      .catch(() => undefined);
  }, []);
  useEffect(refresh, [refresh]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      refresh();
    } catch (err) {
      if (err instanceof ApiError && err.errors?.length) setError(err.errors.join('; '));
      else setError(err instanceof Error ? err.message : 'Request failed');
    }
  };

  const createUser = () =>
    run(async () => {
      await api('/users', {
        method: 'POST',
        body: JSON.stringify({ email, displayName, role, password }),
      });
      setEmail('');
      setDisplayName('');
      setPassword('');
    });

  const setUserRole = (u: UserRow, newRole: string) =>
    run(() => api(`/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ role: newRole }) }));

  const toggleActive = (u: UserRow) =>
    run(() =>
      api(`/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ active: !u.active }) }),
    );

  const resetPassword = (u: UserRow) => {
    const pw = window.prompt(`New password for ${u.email} (min 8 chars):`);
    if (pw)
      run(() =>
        api(`/users/${u.id}/reset-password`, {
          method: 'POST',
          body: JSON.stringify({ password: pw }),
        }),
      );
  };

  return (
    <div className="users-overlay">
      <div className="users-panel">
        <div className="drawer-header">
          <h2>Users</h2>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="users-body">
          {users.map((u) => (
            <div key={u.id} className={`incident-row ${u.active ? '' : 'inactive-user'}`}>
              <div className="incident-main">
                <div className="incident-title">{u.displayName}</div>
                <div className="muted">{u.email}</div>
              </div>
              <div className="incident-actions">
                <select value={u.role} onChange={(e) => setUserRole(u, e.target.value)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button onClick={() => resetPassword(u)}>Reset PW</button>
                <button onClick={() => toggleActive(u)}>
                  {u.active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}

          <h3>Add user</h3>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label>
            Password (min 8 chars)
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <div className="error">{error}</div>}
          <button
            className="primary"
            onClick={createUser}
            disabled={!email || !displayName || password.length < 8}
          >
            Create user
          </button>
        </div>
      </div>
    </div>
  );
}
