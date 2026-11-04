import { getAudioContext, unlockAudio } from '../audio/audioContext';
import { MicCapture, type MicSettings, type MicState } from '../audio/micCapture';
import { PlaybackEngine, type PlaybackStats } from '../audio/playbackEngine';
import { RealtimeClient } from '../realtime/client';
import type { CatalogSnapshot } from '../realtime/types';
import { TurnController, type TurnHandlers } from '../turn/controller';

/** The microphone as the session sees it; `MicCapture` is the real one. */
export interface MicPort {
  getState(): MicState;
  subscribe(listener: (state: MicState) => void): () => void;
  start(): Promise<void>;
  openGate(): void;
  closeGate(): Promise<void>;
  dispose(): void;
  updateSettings?(settings: MicSettings): Promise<void>;
}

export interface SessionOptions {
  gatewayUrl: string;
  getCatalog: () => CatalogSnapshot | Promise<CatalogSnapshot>;
  handlers?: TurnHandlers;
  micSettings?: MicSettings;
  /** Dev labs only: replace the microphone (see lib/dev/toneMic.ts). Must be labelled in the UI. */
  createMic?: (onFrame: (frame: ArrayBuffer) => void) => MicPort;
  onPlaybackStats?: (stats: PlaybackStats) => void;
}

export interface RealtimeSession {
  controller: TurnController;
  client: RealtimeClient;
  playback: PlaybackEngine;
  mic: MicPort;
  /** Latest microphone level (RMS, 0 to 1), written by the capture worklet's reports. */
  level: { current: number };
  /** Resume audio, load the worklets and open the microphone. Call from a user gesture. */
  enableAudio(): Promise<void>;
  dispose(): void;
}

/**
 * Builds the whole browser realtime stack and wires its parts together:
 *
 *   mic ──frames──► controller ──► client ──► gateway ──► client ──► controller ──► playback
 *
 * The gateway connection is started right away (pre-warming); audio waits for a gesture.
 */
export function createRealtimeSession(options: SessionOptions): RealtimeSession {
  const context = getAudioContext();
  // The pieces refer to each other, so the controller is assigned once everything exists.
  const wired: { controller?: TurnController } = {};

  const playback = new PlaybackEngine(context, {
    onFirstAudible: (event) => wired.controller?.handlePlaybackStarted(event.turnId, event.perfMs),
    onFinished: (turnId) => wired.controller?.handlePlaybackFinished(turnId),
    onFlushed: (perfMs) => wired.controller?.handleSilenced(perfMs),
    ...(options.onPlaybackStats ? { onStats: options.onPlaybackStats } : {}),
  });

  const level = { current: 0 };
  const onFrame = (frame: ArrayBuffer) => wired.controller?.handleFrame(frame);
  const mic: MicPort =
    options.createMic?.(onFrame) ??
    new MicCapture(context, {
      ...(options.micSettings ? { settings: options.micSettings } : {}),
      onFrame,
      onLevel: (rms) => {
        level.current = rms;
      },
    });

  const client = new RealtimeClient(
    { gatewayUrl: options.gatewayUrl, getCatalog: options.getCatalog },
    {
      onState: (state) => wired.controller?.handleConnection(state),
      onMessage: (message) => wired.controller?.handleServerMessage(message),
      onTtsAudio: (turnId, pcm) => wired.controller?.handleTtsAudio(turnId, pcm),
    },
  );

  let audioReady: Promise<void> | null = null;
  const enableAudio = () => {
    audioReady ??= (async () => {
      await unlockAudio();
      await playback.init();
      await mic.start();
    })().catch((error: unknown) => {
      audioReady = null; // allow another try from the next gesture
      throw error;
    });
    return audioReady;
  };

  const turn = new TurnController({
    client,
    capture: mic,
    playback,
    ...(options.handlers ? { handlers: options.handlers } : {}),
    ensureAudio: () => void enableAudio().catch(() => undefined),
    isMicLive: () => mic.getState().live,
    maxUtteranceSeconds: () => {
      const state = client.getState();
      return state.status === 'ready' ? state.maxUtteranceSeconds : 20;
    },
  });
  wired.controller = turn;

  const stopWatchingMic = mic.subscribe((state) => {
    if (!state.live) turn.handleMicLost();
  });
  const detachLifecycle = client.attachPageLifecycle(document, window);
  client.connect();

  return {
    controller: turn,
    client,
    playback,
    mic,
    level,
    enableAudio,
    dispose() {
      stopWatchingMic();
      detachLifecycle();
      turn.dispose();
      client.close();
      playback.dispose();
      mic.dispose();
    },
  };
}
