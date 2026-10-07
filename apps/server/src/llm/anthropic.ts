/**
 * Claude provider (global build). Routine reactions use a small, fast model;
 * high-value moments (big wins, replies to the player) use a larger model at
 * low effort (PRD §44). The per-character system prompt is cached.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { DialogueReply, DialogueRequest } from '@mahjong/dialogue';
import { MemorySummarySchema, ReplySchema, type LlmProvider, type MemorySummaryReply, type MemorySummaryRequest } from './provider';

export interface AnthropicModels {
  routine: string;
  highValue: string;
}

/** Models that accept `output_config.effort` and the server-side `fallbacks: "default"` mode. */
const MODERN_MODEL = /^claude-(opus-5|fable-5|sonnet-5-5)/;

export class AnthropicLlm implements LlmProvider {
  readonly name = 'anthropic';
  private disabled = false;

  constructor(
    private readonly models: AnthropicModels,
    private readonly timeoutMs: number,
    private readonly client: Anthropic = new Anthropic({ maxRetries: 1 }),
  ) {}

  /** Memory summaries are routine text work: the small model, once per game. */
  async summarizeMemory(request: MemorySummaryRequest): Promise<MemorySummaryReply | null> {
    if (this.disabled) return null;
    try {
      const response = await this.client.beta.messages.parse(
        {
          model: this.models.routine,
          max_tokens: 1500,
          system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: request.user }],
          output_config: { format: betaZodOutputFormat(MemorySummarySchema) },
        },
        { timeout: this.timeoutMs * 3 },
      );
      if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
      return (response.parsed_output as MemorySummaryReply | null) ?? null;
    } catch (error) {
      this.handleError(error);
      return null;
    }
  }

  async generate(request: DialogueRequest): Promise<DialogueReply | null> {
    if (this.disabled) return null;
    const model = request.tier === 'highValue' ? this.models.highValue : this.models.routine;
    const modern = MODERN_MODEL.test(model);
    try {
      const response = await this.client.beta.messages.parse(
        {
          model,
          // Thinking is always on for the modern models; leave room for it at low effort.
          max_tokens: modern ? 2000 : 400,
          system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: request.user }],
          output_config: {
            format: betaZodOutputFormat(ReplySchema),
            ...(modern ? { effort: 'low' as const } : {}),
          },
          // On a safety decline, let the API re-run the request on a suitable fallback model.
          ...(modern ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        },
        { timeout: this.timeoutMs },
      );
      if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
      return (response.parsed_output as DialogueReply | null) ?? null;
    } catch (error) {
      this.handleError(error);
      return null;
    }
  }

  private handleError(error: unknown): void {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        // Misconfigured credentials won't fix themselves: stop calling and use templates.
        this.disabled = true;
        console.error(`Claude dialogue disabled: ${error.message}`);
      } else if (error instanceof Anthropic.RateLimitError) {
        console.warn('Claude dialogue rate limited; using template lines');
      } else if (error instanceof Anthropic.APIError) {
        // Includes connection errors and timeouts: transient, keep trying on later lines.
        console.warn(`Claude dialogue error ${error.status ?? ''}: ${error.message}`);
      } else {
        // Not an API error: the client itself is misconfigured (e.g. no credentials found).
        this.disabled = true;
        console.error('Claude dialogue disabled:', error instanceof Error ? error.message : error);
      }
  }
}
