/**
 * Float [-1, 1] to 16-bit PCM. Asymmetric scale (32768 down, 32767 up) so full-scale input
 * maps onto the full Int16 range, then clipped: a sample outside [-1, 1] must saturate
 * rather than wrap around, which would be a loud click.
 */
export function floatToInt16(x: number): number {
  const scaled = Math.round(x < 0 ? x * 32768 : x * 32767);
  return scaled > 32767 ? 32767 : scaled < -32768 ? -32768 : scaled;
}

export function int16ToFloat(x: number): number {
  return x / 32768;
}
