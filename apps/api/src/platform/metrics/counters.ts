/**
 * Process-lifetime counters, incremented by the hot paths and exposed by the
 * metrics endpoint. Plain module state on purpose: no DI, no locking (Node is
 * single-threaded), resets on restart — which is exactly what a Prometheus
 * counter is allowed to do.
 */
export const counters = {
  readingsAccepted: 0,
  readingsRejected: 0,
  notificationsSent: 0,
};
