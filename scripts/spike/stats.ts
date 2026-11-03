export interface Summary {
  n: number;
  min: number;
  median: number;
  mean: number;
  max: number;
  stdev: number;
}

export function summarize(values: number[]): Summary | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return null;
  const mean = sorted.reduce((sum, v) => sum + v, 0) / n;
  const mid = Math.floor(n / 2);
  const median = n % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  const variance = sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  return { n, min: sorted[0] ?? 0, median, mean, max: sorted[n - 1] ?? 0, stdev: Math.sqrt(variance) };
}

/** "median (min-max)" for a latency column; "-" when there is nothing to report. */
export function formatSummary(summary: Summary | null, digits = 0): string {
  if (!summary) return '-';
  const f = (v: number) => v.toFixed(digits);
  return `${f(summary.median)} (${f(summary.min)}-${f(summary.max)})`;
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  const text = value.toFixed(digits);
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}

export interface Table {
  title: string;
  headers: string[];
  rows: string[][];
}

export function renderMarkdownTable(table: Table): string {
  const line = (cells: string[]) => `| ${cells.map((c) => c.replaceAll('|', '/')).join(' | ')} |`;
  return [
    `**${table.title}**`,
    '',
    line(table.headers),
    line(table.headers.map(() => '---')),
    ...table.rows.map(line),
    '',
  ].join('\n');
}

/** Lowercase, letters and digits only (Unicode aware, so Devanagari survives), single spaces. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized === '' ? [] : normalized.split(' ');
}

/** Word error rate = word-level edit distance / reference length. null when the reference is empty. */
export function wordErrorRate(reference: string, hypothesis: string): number | null {
  const ref = words(reference);
  const hyp = words(hypothesis);
  if (ref.length === 0) return null;
  let previous = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const current = [i];
    for (let j = 1; j <= hyp.length; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost);
    }
    previous = current;
  }
  return (previous[hyp.length] ?? 0) / ref.length;
}

/** Of the key terms that appear in the reference, how many also appear in the hypothesis. */
export function keytermHits(
  keyterms: string[],
  reference: string,
  hypothesis: string,
): { expected: number; hit: number } {
  const ref = ` ${normalizeText(reference)} `;
  const hyp = ` ${normalizeText(hypothesis)} `;
  let expected = 0;
  let hit = 0;
  for (const term of keyterms) {
    const needle = ` ${normalizeText(term)} `;
    if (needle.trim() === '' || !ref.includes(needle)) continue;
    expected += 1;
    if (hyp.includes(needle)) hit += 1;
  }
  return { expected, hit };
}
