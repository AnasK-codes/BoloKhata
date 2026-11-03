import { startMockStt, type MockSttOptions, type MockSttServer } from './sttMock';
import { startMockTts, type MockTtsOptions, type MockTtsServer } from './ttsMock';

export * from './audio';
export * from './sttMock';
export * from './ttsMock';

export interface MockGnaniOptions {
  stt?: MockSttOptions;
  tts?: MockTtsOptions;
}

export interface MockGnani {
  stt: MockSttServer;
  tts: MockTtsServer;
  close(): Promise<void>;
}

/** Starts both mocks on free ports (unless ports are given) and returns controls and observations. */
export async function startMockGnani(options: MockGnaniOptions = {}): Promise<MockGnani> {
  const stt = await startMockStt(options.stt);
  let tts: MockTtsServer;
  try {
    tts = await startMockTts(options.tts);
  } catch (error) {
    await stt.close();
    throw error;
  }
  return {
    stt,
    tts,
    close: async () => {
      await Promise.all([stt.close(), tts.close()]);
    },
  };
}
