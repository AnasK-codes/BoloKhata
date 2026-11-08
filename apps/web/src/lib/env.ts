const DEFAULT_GATEWAY_URL = 'http://localhost:8080';

/**
 * The only public setting. It is a URL, not a secret. Next.js inlines
 * `process.env.NEXT_PUBLIC_*` at build time only when written out literally,
 * so read it directly here.
 */
export function getGatewayUrl(): string {
  const raw = process.env.NEXT_PUBLIC_GATEWAY_URL;
  // When running in a browser on an external host (e.g. testing on a phone via an ngrok tunnel
  // or LAN IP) and the gateway URL is unset or points to default localhost, connect back to
  // the same origin so WebSocket and session calls route through the reverse proxy / tunnel.
  if (typeof window !== 'undefined') {
    const { hostname, origin } = window.location;
    if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1' && (!raw || raw.trim() === DEFAULT_GATEWAY_URL)) {
      return origin;
    }
  }
  return normalizeGatewayUrl(raw);
}

export function normalizeGatewayUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_GATEWAY_URL;
  return value.replace(/\/+$/, '');
}
