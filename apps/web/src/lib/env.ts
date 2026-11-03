const DEFAULT_GATEWAY_URL = 'http://localhost:8080';

/**
 * The only public setting. It is a URL, not a secret. Next.js inlines
 * `process.env.NEXT_PUBLIC_*` at build time only when written out literally,
 * so read it directly here.
 */
export function getGatewayUrl(): string {
  const raw = process.env.NEXT_PUBLIC_GATEWAY_URL;
  return normalizeGatewayUrl(raw);
}

export function normalizeGatewayUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_GATEWAY_URL;
  return value.replace(/\/+$/, '');
}
