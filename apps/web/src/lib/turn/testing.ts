import type { ClientMessage, DraftMessage, ServerMessage } from '@bolbill/shared';
import type { CapturePort, ClientPort, PlaybackPort } from './controller';
import { initialTurnState, reduce } from './reducer';
import type { Effect, TurnEvent, TurnState } from './types';

export function draftMessage(turnId: number, overrides: Partial<DraftMessage> = {}): DraftMessage {
  return {
    type: 'draft',
    turnId,
    draftId: `d${turnId}`,
    intent: 'create_bill',
    source: 'rules',
    confidence: 0.95,
    customer: { id: 'c1', name: 'Sharma ji', isNew: false },
    bill: {
      items: [{ productId: 'p1', name: 'Aata', quantity: 2, unit: 'kg', unitPrice: 45, lineTotal: 90 }],
      total: 90,
      paid: 0,
      udhaar: 90,
    },
    unresolved: [],
    warnings: [],
    replyText: ['Do kilo aata, nabbe rupaye.'],
    ...overrides,
  };
}

/** Drives the reducer like the controller would, keeping every effect it asks for. */
export class Sim {
  state: TurnState;
  effects: Effect[] = [];
  private clock = 1000;

  constructor(overrides: Partial<TurnState> = {}) {
    this.state = initialTurnState({ connected: true, ...overrides });
  }

  /** Advances the fake clock and returns the new time. */
  tick(ms = 10): number {
    this.clock += ms;
    return this.clock;
  }

  send(event: TurnEvent): Effect[] {
    const result = reduce(this.state, event);
    this.state = result.state;
    this.effects.push(...result.effects);
    return result.effects;
  }

  press(): Effect[] {
    return this.send({ type: 'press', at: this.tick() });
  }
  release(): Effect[] {
    return this.send({ type: 'release', at: this.tick() });
  }
  server(message: ServerMessage): Effect[] {
    return this.send({ type: 'server', message, at: this.tick() });
  }
  /** Press, release and the gateway's acknowledgements up to the transcript. */
  speak(): number {
    this.press();
    const turnId = this.state.turnId as number;
    this.send({ type: 'frame_sent', turnId, at: this.tick() });
    this.release();
    this.server({ type: 'processing', turnId });
    this.server({ type: 'transcript', turnId, text: 'do kilo aata Sharma ji ko udhaar' });
    return turnId;
  }
  /** A full turn through to a pending draft. */
  draft(overrides: Partial<DraftMessage> = {}): number {
    const turnId = this.speak();
    this.server(draftMessage(turnId, overrides));
    return turnId;
  }
  get phase() {
    return this.state.phase;
  }
  get record() {
    return this.state.turns.find((t) => t.turnId === this.state.turnId);
  }
  types(): string[] {
    return this.effects.map((e) => e.type);
  }
}

/** One shared, ordered log so tests can assert what happened first. */
export class World {
  log: string[] = [];
  sent: ClientMessage[] = [];
  audio: ArrayBuffer[] = [];
  gateOpen = false;
  gateClosing: (() => void) | null = null;
  holdGateClose = false;
  connected = true;

  client: ClientPort = {
    send: (message) => {
      if (!this.connected) return false;
      this.sent.push(message);
      this.log.push(message.type === 'speak' ? 'speak' : message.type);
      return true;
    },
    sendAudio: (frame) => {
      if (!this.connected) return false;
      this.audio.push(frame);
      return true;
    },
  };

  capture: CapturePort = {
    openGate: () => {
      this.gateOpen = true;
      this.log.push('gate_open');
    },
    closeGate: () => {
      return new Promise<void>((resolve) => {
        const finish = () => {
          this.gateOpen = false;
          this.log.push('gate_closed');
          resolve();
        };
        if (this.holdGateClose) this.gateClosing = finish;
        else finish();
      });
    },
  };

  played: string[] = [];
  playback: PlaybackPort = {
    beginTurn: (turnId, rate) => this.played.push(`begin:${turnId}:${rate}`),
    pushPcm: (turnId, pcm) => this.played.push(`pcm:${turnId}:${pcm.byteLength}`),
    endTurn: (turnId) => this.played.push(`end:${turnId}`),
    flush: () => {
      this.played.push('flush');
      this.log.push('flush');
    },
  };
}

