import { describe, expect, it } from 'vitest';
import { can } from '../src/permissions';

describe('can()', () => {
  it('grants admin full access to any module', () => {
    expect(can('admin', 'platform', 'manage')).toBe(true);
    expect(can('admin', 'drainage', 'write')).toBe(true);
  });

  it('lets dispatchers and crew write but not manage', () => {
    expect(can('dispatcher', 'platform', 'write')).toBe(true);
    expect(can('dispatcher', 'platform', 'manage')).toBe(false);
    expect(can('crew', 'flood', 'write')).toBe(true);
    expect(can('crew', 'flood', 'manage')).toBe(false);
  });

  it('restricts viewers to read', () => {
    expect(can('viewer', 'platform', 'read')).toBe(true);
    expect(can('viewer', 'platform', 'write')).toBe(false);
  });
});
