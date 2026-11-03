/** WebSocket close codes the gateway uses. 4xxx are application codes. */
export const CLOSE = {
  normal: 1000,
  goingAway: 1001,
  policy: 1008,
  /** Demo busy or restarting: try again later. */
  busy: 1013,
  sessionExpired: 4001,
  budget: 4002,
  helloTimeout: 4003,
} as const;
