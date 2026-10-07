/**
 * LLM provider interface for table dialogue (PRD §41.1: one implementation
 * per region behind the same interface). Providers never throw: any failure
 * returns null and the caller falls back to a template line.
 */
import type { DialogueReply, DialogueRequest } from '@mahjong/dialogue';
import { z } from 'zod';
import { STICKER_IDS } from '@mahjong/dialogue';

export interface LlmProvider {
  readonly name: string;
  generate(request: DialogueRequest): Promise<DialogueReply | null>;
  /** Once per game: rewrite memory summaries and the player profile (Appendix B.2). */
  summarizeMemory?(request: MemorySummaryRequest): Promise<MemorySummaryReply | null>;
}

export interface MemorySummaryRequest {
  system: string;
  user: string;
}

export const MemorySummarySchema = z.object({
  events: z.array(z.object({ id: z.number().int(), summary: z.string() })),
  profile: z.object({ playStyle: z.string(), habits: z.array(z.string()) }),
});

export type MemorySummaryReply = z.infer<typeof MemorySummarySchema>;

export const ReplySchema = z.object({
  text: z.string().describe('One short spoken line in Chinese. Empty string to stay silent.'),
  target: z.enum(['table', '0', '1', '2', '3']),
  sticker: z.enum(['none', ...STICKER_IDS] as unknown as [string, ...string[]]),
});

export class NoLlm implements LlmProvider {
  readonly name = 'none';
  async generate(): Promise<DialogueReply | null> {
    return null;
  }
}

/** Caps total requests per day (PRD §46 cost control); over budget, dialogue uses templates. */
export class BudgetedLlm implements LlmProvider {
  private day = '';
  private used = 0;

  constructor(
    private readonly inner: LlmProvider,
    private readonly dailyCap: number,
    private readonly today: () => string = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10),
  ) {}

  get name(): string {
    return this.inner.name;
  }

  async generate(request: DialogueRequest): Promise<DialogueReply | null> {
    const day = this.today();
    if (day !== this.day) {
      this.day = day;
      this.used = 0;
    }
    if (this.used >= this.dailyCap) return null;
    this.used++;
    return this.inner.generate(request);
  }

  async summarizeMemory(request: MemorySummaryRequest): Promise<MemorySummaryReply | null> {
    if (!this.inner.summarizeMemory) return null;
    const day = this.today();
    if (day === this.day && this.used >= this.dailyCap) return null;
    this.used++;
    return this.inner.summarizeMemory(request);
  }
}
