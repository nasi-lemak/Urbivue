import type { ThresholdParams } from '@urbivue/shared';

export type ThresholdOutcome = 'breach' | 'clear' | 'hold';

/**
 * Evaluate a threshold rule with optional hysteresis. With `clear` set, the
 * band between `clear` and `value` returns 'hold' so an incident neither
 * opens nor auto-resolves while the reading hovers around the trigger level.
 */
export function evaluateThreshold(params: ThresholdParams, value: number): ThresholdOutcome {
  const clear = params.clear ?? params.value;
  if (params.operator === 'gt') {
    if (value > params.value) return 'breach';
    if (value <= clear) return 'clear';
    return 'hold';
  }
  // 'lt'
  if (value < params.value) return 'breach';
  if (value >= clear) return 'clear';
  return 'hold';
}

/** A rate-of-change rule breaches when |current - baseline| >= delta. */
export function evaluateRateOfChange(delta: number, baseline: number, current: number): boolean {
  return Math.abs(current - baseline) >= delta;
}
