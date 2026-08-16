import { describe, expect, it } from 'vitest';
import {
  canTransition,
  validateResponses,
  type InspectionTemplateDefinition,
} from '../src/workflow';

const template: InspectionTemplateDefinition = {
  key: 't.test',
  assetTypeId: 'demo_poi',
  name: 'Test',
  items: [
    { key: 'pct', label: 'Percent', type: 'number', required: true, min: 0, max: 100 },
    { key: 'score', label: 'Score', type: 'score', required: true },
    { key: 'ok', label: 'OK', type: 'boolean' },
    { key: 'note', label: 'Note', type: 'note' },
  ],
};

describe('validateResponses', () => {
  it('accepts a valid response set', () => {
    const r = validateResponses(template, { pct: 80, score: 3, ok: true, note: 'silted' });
    expect(r.success).toBe(true);
  });

  it('flags missing required, out-of-range, wrong types, and unknown keys', () => {
    const r = validateResponses(template, { pct: 130, ok: 'yes', bogus: 1 });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors.join(' ')).toContain('pct');
      expect(r.errors.join(' ')).toContain('score');
      expect(r.errors.join(' ')).toContain('ok');
      expect(r.errors.join(' ')).toContain('bogus');
    }
  });

  it('allows omitting optional items', () => {
    const r = validateResponses(template, { pct: 10, score: 5 });
    expect(r.success).toBe(true);
  });
});

describe('canTransition', () => {
  it('follows the lifecycle', () => {
    expect(canTransition('open', 'assigned')).toBe(true);
    expect(canTransition('assigned', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'done')).toBe(true);
    expect(canTransition('done', 'verified')).toBe(true);
    expect(canTransition('done', 'in_progress')).toBe(true); // rework
  });

  it('rejects skips and terminal transitions', () => {
    expect(canTransition('open', 'done')).toBe(false);
    expect(canTransition('verified', 'open')).toBe(false);
    expect(canTransition('cancelled', 'open')).toBe(false);
  });
});
