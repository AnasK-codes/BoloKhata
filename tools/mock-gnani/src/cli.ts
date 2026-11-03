import { startMockGnani } from './index';

/**
 * `pnpm dev:mock` entry point. These servers are FAKES: transcripts are scripted and the "voice"
 * is a sine tone. Never present anything produced with them as real Gnani output.
 */

// Fictional sample utterances, cycled in order. They exist only so the UI has something to show.
const SAMPLE_TRANSCRIPTS = [
  'Sharma ji ko do kilo aata aur ek Maggi, teen sau ka udhaar likh do',
  'haan',
  'Sharma ji ka kitna udhaar hai',
  'Verma ji ne do sau de diye',
];

async function main() {
  const sttPort = Number(process.env['MOCK_STT_PORT'] ?? 9101);
  const ttsPort = Number(process.env['MOCK_TTS_PORT'] ?? 9102);
  let next = 0;

  const mock = await startMockGnani({
    stt: {
      port: sttPort,
      transcriptLatencyMs: 200,
      defaultTranscript: () => SAMPLE_TRANSCRIPTS[next++ % SAMPLE_TRANSCRIPTS.length] ?? '',
    },
    tts: { port: ttsPort, msPerChar: 55 },
  });

  console.log('MOCK Gnani servers running. Transcripts are scripted and audio is a test tone.');
  console.log(`  STT  ${mock.stt.url}`);
  console.log(`  TTS  ${mock.tts.url}`);

  const stop = () => {
    mock.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error: unknown) => {
  console.error('mock-gnani failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
