/**
 * Dev labs mirror their event log to the browser console, so a hand test can be read from
 * DevTools (or Safari's Web Inspector) as well as from the page. Event kinds and ids only:
 * never transcripts, names or audio.
 */
export function devLog(line: string): void {
  // eslint-disable-next-line no-console -- dev-only lab pages
  console.info(`[bolbill] ${line}`);
}
