import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PRONUNCIATION_CORPUS } from '../../packages/shared/src/tts/pronunciationCorpus';
import { TtsSession, type TtsRequest } from './ttsClient';
import type { ExperimentContext, ExperimentResult } from './types';
import { pcmToWav } from './wav';

/**
 * Experiment P: pronunciation A/B. Synthesises every candidate spelling in the pronunciation
 * corpus with the gateway's own TTS settings, ONE request at a time on one connection (never in
 * parallel), and writes a numbered listening sheet. Nobody can pick a winner from numbers: a person
 * listens and marks the sheet; winners then go into PRONUNCIATION_OVERRIDES and docs/TTS-TUNING.md.
 *
 * Opt-in only (`pnpm spike --only P`): a full spike run never spends credits on it.
 */
export const P_SAMPLE_RATE = 24_000;

export function pronunciationRequest(text: string): TtsRequest {
  return {
    text,
    model: (process.env['GNANI_TTS_MODEL'] as TtsRequest['model'] | undefined) ?? 'timbre-v3.0',
    voice: process.env['GNANI_TTS_VOICE'] ?? 'Devansh',
    language: process.env['GNANI_TTS_LANGUAGE'] ?? 'hi-IN',
    sampleRate: P_SAMPLE_RATE,
    container: 'raw',
  };
}

/**
 * Every candidate in order, with a stable label: "03-kar-dun-C". The number is the entry's place in
 * the whole corpus, so a filtered run keeps the same names as a full one.
 */
export function pronunciationPlan(only: readonly string[] | null = null): { n: number; entry: string; label: string; text: string; file: string }[] {
  return PRONUNCIATION_CORPUS.flatMap((e, i) =>
    (only !== null && !only.includes(e.id) ? [] : e.candidates).map((text, k) => {
      const letter = String.fromCharCode(65 + k);
      const n = String(i + 1).padStart(2, '0');
      return { n: i + 1, entry: e.id, label: `${n}-${e.id}-${letter}`, text, file: `${n}-${e.id}-${letter}.wav` };
    }),
  );
}

export const pronunciationChars = (only: readonly string[] | null = null): number => pronunciationPlan(only).reduce((s, p) => s + p.text.length, 0);

function sheet(results: Map<string, { ok: boolean; note: string }>, settings: TtsRequest, only: readonly string[] | null): string {
  const lines = [
    '# Pronunciation listening sheet',
    '',
    `Settings: model \`${settings.model}\`, voice \`${settings.voice}\`, language \`${settings.language}\`, ${settings.sampleRate} Hz raw PCM wrapped as WAV.`,
    'For each word, play every clip and mark which one sounds like natural spoken Hindi. "Nasal" words must end in a soft nasal vowel (हाँ, दूँ), never a hard "n". "Consonant" words are controls: their "n"/"m" must still be heard.',
    'Clip A is always what the app sends today.',
    '',
  ];
  for (const [i, e] of PRONUNCIATION_CORPUS.entries()) {
    if (only !== null && !only.includes(e.id)) continue;
    lines.push(`## ${i + 1}. ${e.word} (${e.hindi}), ${e.kind}`, '', `Spoken in: ${e.usedIn}`, '', '| clip | text sent | file | sounds right? |', '| :- | :- | :- | :- |');
    for (const p of pronunciationPlan(only).filter((x) => x.entry === e.id)) {
      const r = results.get(p.label);
      const file = r?.ok ? `\`${p.file}\`` : `not made: ${r?.note ?? 'skipped (budget)'}`;
      lines.push(`| ${p.label.slice(-1)} | ${p.text.replace(/\|/g, '\\|')} | ${file} | |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

const escapeHtml = (t: string): string => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The same sheet as a page with a player per clip, to open next to the WAV files in any browser. */
export function listeningPage(made: ReadonlySet<string>, settings: TtsRequest, only: readonly string[] | null = null): string {
  const sections = PRONUNCIATION_CORPUS.map((e, i) => {
    if (only !== null && !only.includes(e.id)) return '';
    const rows = pronunciationPlan(only).filter((p) => p.entry === e.id).map((p) => {
      const player = made.has(p.label) ? `<audio controls preload="none" src="${p.file}"></audio>` : '<em>not made</em>';
      return `<tr><td>${p.label.slice(-1)}</td><td lang="hi">${escapeHtml(p.text)}</td><td>${player}</td><td><input type="radio" name="${e.id}" aria-label="${p.label} sounds right"></td></tr>`;
    }).join('');
    return `<section><h2>${i + 1}. ${escapeHtml(e.word)} <span lang="hi">(${escapeHtml(e.hindi)})</span> <small>${e.kind}</small></h2><p>Spoken in: ${escapeHtml(e.usedIn)}</p><table><thead><tr><th>clip</th><th>text sent</th><th>listen</th><th>best</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pronunciation A/B</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:860px;margin:0 auto;padding:16px;background:#fff;color:#111}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left}audio{height:32px;max-width:220px}small{color:#666}@media (prefers-color-scheme:dark){body{background:#111;color:#eee}td,th{border-color:#333}}</style></head>
<body><h1>Pronunciation A/B</h1><p>Settings: ${escapeHtml(settings.model)}, ${escapeHtml(settings.voice)}, ${escapeHtml(settings.language)}, ${settings.sampleRate} Hz. Clip A is what the app sends today. Nasal words should end in a soft nasal vowel (हाँ, दूँ), never a hard "n"; consonant words are controls whose n/m must still be heard. The radio buttons are only a scratchpad: write your picks down (or tell Claude).</p>${sections}</body></html>`;
}

export async function runExperimentP(ctx: ExperimentContext): Promise<ExperimentResult> {
  const dir = path.join(ctx.outDir, 'pronunciation');
  mkdirSync(dir, { recursive: true });
  const results = new Map<string, { ok: boolean; note: string }>();
  const settings = pronunciationRequest('');
  let session: TtsSession | null = null;
  let made = 0;
  let chars = 0;
  try {
    for (const p of pronunciationPlan(ctx.args.entries)) {
      if (!ctx.budget.canSpendChars(p.text.length)) {
        results.set(p.label, { ok: false, note: 'skipped (budget)' });
        continue;
      }
      session ??= await TtsSession.open(ctx.env.ttsUrl, ctx.apiKey);
      ctx.log(`  P ${p.label} (${p.text.length} chars)`);
      ctx.budget.spendChars('P', p.text.length);
      chars += p.text.length;
      const result = await session.synthesize(pronunciationRequest(p.text));
      if (result.error || result.audio.length === 0) {
        results.set(p.label, { ok: false, note: result.error ?? 'no audio' });
        continue;
      }
      writeFileSync(path.join(dir, p.file), pcmToWav(result.audio, P_SAMPLE_RATE));
      results.set(p.label, { ok: true, note: '' });
      made++;
    }
  } catch (error) {
    ctx.log(`  P failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (session) {
      ctx.budget.spendConnection('P', session.connectionSeconds);
      await session.close();
    }
  }
  const sheetFile = path.join(dir, 'LISTENING.md');
  writeFileSync(sheetFile, sheet(results, settings, ctx.args.entries));
  const madeLabels = new Set([...results.entries()].filter(([, r]) => r.ok).map(([label]) => label));
  writeFileSync(path.join(dir, 'LISTENING.html'), listeningPage(madeLabels, settings, ctx.args.entries));
  const failed = [...results.entries()].filter(([, r]) => !r.ok);
  return {
    id: 'P',
    title: 'P. Pronunciation A/B (listen to decide)',
    tables: [{
      title: 'Clips',
      headers: ['entries', 'clips planned', 'clips made', 'characters sent'],
      rows: [[String(PRONUNCIATION_CORPUS.length), String(pronunciationPlan(ctx.args.entries).length), String(made), String(chars)]],
    }],
    notes: [
      `Listening sheet: ${path.relative(path.dirname(ctx.outDir), sheetFile)}. Numbers cannot pick a winner; a person must listen.`,
      ...failed.slice(0, 10).map(([label, r]) => `Not made: ${label}: ${r.note}`),
    ],
    data: Object.fromEntries(results),
    suggestions: [],
  };
}
