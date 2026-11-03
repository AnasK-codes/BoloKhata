/** Tracks what a spike run spends so it can stop before exceeding the limits (AGENTS.md section 7). */

export interface BudgetLimits {
  maxAudioSeconds: number;
  maxTtsChars: number;
}

interface Spend {
  audioSeconds: number;
  ttsChars: number;
  connectionSeconds: number;
}

export class Budget {
  private readonly perExperiment = new Map<string, Spend>();

  constructor(readonly limits: BudgetLimits) {}

  private entry(experiment: string): Spend {
    let spend = this.perExperiment.get(experiment);
    if (!spend) {
      spend = { audioSeconds: 0, ttsChars: 0, connectionSeconds: 0 };
      this.perExperiment.set(experiment, spend);
    }
    return spend;
  }

  private sum(key: keyof Spend): number {
    let total = 0;
    for (const spend of this.perExperiment.values()) total += spend[key];
    return total;
  }

  get audioSeconds(): number {
    return this.sum('audioSeconds');
  }

  get ttsChars(): number {
    return this.sum('ttsChars');
  }

  get connectionSeconds(): number {
    return this.sum('connectionSeconds');
  }

  canSpendAudio(seconds: number): boolean {
    return this.audioSeconds + seconds <= this.limits.maxAudioSeconds + 1e-9;
  }

  /** `reserve` keeps characters back for later experiments. */
  canSpendChars(chars: number, reserve = 0): boolean {
    return this.ttsChars + chars + reserve <= this.limits.maxTtsChars;
  }

  spendAudio(experiment: string, seconds: number): void {
    this.entry(experiment).audioSeconds += seconds;
  }

  spendChars(experiment: string, chars: number): void {
    this.entry(experiment).ttsChars += chars;
  }

  spendConnection(experiment: string, seconds: number): void {
    this.entry(experiment).connectionSeconds += seconds;
  }

  breakdown(): { experiment: string; audioSeconds: number; ttsChars: number; connectionSeconds: number }[] {
    return [...this.perExperiment.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([experiment, spend]) => ({ experiment, ...spend }));
  }
}
