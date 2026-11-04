/**
 * Pre-deploy check: nothing secret may be in what the browser downloads. Scans the built web app
 * (apps/web/.next/static and public) for the names and values that must stay on the gateway, and
 * lists every NEXT_PUBLIC_ variable in the source (only NEXT_PUBLIC_GATEWAY_URL is allowed).
 *
 *   pnpm --filter @bolbill/web build && pnpm check:bundle
 *
 * If a .env exists, its secret VALUES are searched for too (never printed).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps/web');

const FORBIDDEN_TEXT = ['GNANI_API_KEY', 'x-api-key-id', 'SESSION_TOKEN_SECRET', 'METRICS_TOKEN', 'DEMO_ACCESS_CODE', 'OPENAI_API_KEY', 'AWS_SECRET', 'api.vachana.ai', 'BEDROCK_MODEL_ID', 'SUPABASE_ANON_KEY', 'DATABASE_URL'];
const SECRET_ENV = ['GNANI_API_KEY', 'SESSION_TOKEN_SECRET', 'METRICS_TOKEN', 'DEMO_ACCESS_CODE', 'OPENAI_API_KEY', 'SUPABASE_ANON_KEY', 'DATABASE_URL'];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function envValues(): string[] {
  const values: string[] = [];
  for (const file of [join(root, '.env'), join(web, '.env.local'), join(web, '.env')]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && SECRET_ENV.includes(m[1] ?? '') && (m[2] ?? '').length >= 8) values.push((m[2] ?? '').replace(/^["']|["']$/g, ''));
    }
  }
  return values;
}

const bundleDir = join(web, '.next/static');
if (!existsSync(bundleDir)) {
  console.error('No build found. Run `pnpm --filter @bolbill/web build` first.');
  process.exit(2);
}

const files = [...walk(bundleDir), ...walk(join(web, 'public'))].filter((f) => !/\.(png|ico|woff2?)$/.test(f));
const secrets = envValues();
const problems: string[] = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const rel = file.replace(`${root}/`, '');
  for (const word of FORBIDDEN_TEXT) if (text.includes(word)) problems.push(`${rel}: contains "${word}"`);
  for (const value of secrets) if (text.includes(value)) problems.push(`${rel}: contains a secret value from .env`);
}

const publicVars = new Set<string>();
for (const file of walk(join(web, 'src'))) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  for (const m of readFileSync(file, 'utf8').matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) publicVars.add(m[0]);
}
for (const name of publicVars) if (name !== 'NEXT_PUBLIC_GATEWAY_URL') problems.push(`source uses ${name}: only NEXT_PUBLIC_GATEWAY_URL may reach the browser`);

// Server-only code must not be imported by client components.
for (const file of walk(join(web, 'src'))) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  if (/@bolbill\/gateway|from 'ws'|from "ws"|@aws-sdk/.test(text) && !/\.test\.tsx?$/.test(file)) problems.push(`${file.replace(`${root}/`, '')}: imports server-only code`);
}

console.log(`scanned ${files.length} client files; NEXT_PUBLIC variables in source: ${[...publicVars].join(', ') || 'none'}; secret values checked: ${secrets.length}`);
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('OK: no secrets or server-only imports in the client bundle.');
