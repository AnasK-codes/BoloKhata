/**
 * The few AudioWorkletGlobalScope names the worklet sources use. TypeScript's DOM lib does
 * not declare them (they only exist inside the worklet), so they are declared here.
 */
declare const sampleRate: number;
declare const currentTime: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(name: string, processor: new (options?: unknown) => AudioWorkletProcessor): void;
