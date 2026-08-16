import { describe, expect, it } from 'vitest';
import { evaluateRateOfChange, evaluateThreshold } from '../src/platform/rules/rules.logic';

describe('evaluateThreshold', () => {
  it('breaches and clears a simple gt rule', () => {
    const params = { operator: 'gt' as const, value: 2.5 };
    expect(evaluateThreshold(params, 2.6)).toBe('breach');
    expect(evaluateThreshold(params, 2.5)).toBe('clear');
    expect(evaluateThreshold(params, 1.0)).toBe('clear');
  });

  it('holds inside the hysteresis band', () => {
    const params = { operator: 'gt' as const, value: 2.5, clear: 2.0 };
    expect(evaluateThreshold(params, 3.0)).toBe('breach');
    expect(evaluateThreshold(params, 2.2)).toBe('hold');
    expect(evaluateThreshold(params, 1.9)).toBe('clear');
  });

  it('supports lt rules with hysteresis', () => {
    const params = { operator: 'lt' as const, value: 1.0, clear: 1.5 };
    expect(evaluateThreshold(params, 0.5)).toBe('breach');
    expect(evaluateThreshold(params, 1.2)).toBe('hold');
    expect(evaluateThreshold(params, 1.6)).toBe('clear');
  });
});

describe('evaluateRateOfChange', () => {
  it('breaches on absolute change in either direction', () => {
    expect(evaluateRateOfChange(0.5, 1.0, 1.6)).toBe(true);
    expect(evaluateRateOfChange(0.5, 1.6, 1.0)).toBe(true);
    expect(evaluateRateOfChange(0.5, 1.0, 1.3)).toBe(false);
  });
});
