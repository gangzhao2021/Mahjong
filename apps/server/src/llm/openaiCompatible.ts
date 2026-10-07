/**
 * China build provider (PRD Appendix D.4): a domestic model that has
 * completed generative-AI filing, reached through its OpenAI-compatible
 * chat-completions endpoint (e.g. Qwen via DashScope, DeepSeek, Doubao).
 */
import type { DialogueReply, DialogueRequest } from '@mahjong/dialogue';
import { MemorySummarySchema, ReplySchema, type LlmProvider, type MemorySummaryReply, type MemorySummaryRequest } from './provider';

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string;
  routineModel: string;
  highValueModel: string;
  timeoutMs: number;
}

const JSON_INSTRUCTION =
  '\n\n只输出一个 JSON 对象，不要输出任何其他文字：{"text": "要说的话（可为空字符串）", "target": "table 或座位号 0-3", "sticker": "laugh|angry|cry|cool|think|clap|shock|smug|tea|pray|none"}';

export class OpenAiCompatibleLlm implements LlmProvider {
  readonly name = 'openai-compatible';

  constructor(private readonly options: OpenAiCompatibleOptions) {}

  async generate(request: DialogueRequest): Promise<DialogueReply | null> {
    const o = this.options;
    const json = await this.complete(request.tier === 'highValue' ? o.highValueModel : o.routineModel, request.system + JSON_INSTRUCTION, request.user, 200, 0.9, o.timeoutMs);
    const parsed = ReplySchema.safeParse(json);
    return parsed.success ? (parsed.data as DialogueReply) : null;
  }

  async summarizeMemory(request: MemorySummaryRequest): Promise<MemorySummaryReply | null> {
    const o = this.options;
    const instruction =
      '\n\n只输出一个 JSON 对象：{"events": [{"id": 数字, "summary": "改写后的一句话"}], "profile": {"playStyle": "一句话", "habits": ["短语"]}}';
    const parsed = MemorySummarySchema.safeParse(await this.complete(o.routineModel, request.system + instruction, request.user, 1500, 0.4, o.timeoutMs * 3));
    return parsed.success ? parsed.data : null;
  }

  private async complete(model: string, system: string, user: string, maxTokens: number, temperature: number, timeoutMs: number): Promise<unknown> {
    const o = this.options;
    try {
      const res = await fetch(`${o.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${o.apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: { type: 'json_object' },
          max_tokens: maxTokens,
          temperature,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        console.warn(`Dialogue provider HTTP ${res.status}`);
        return null;
      }
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = body.choices?.[0]?.message?.content;
      return content ? JSON.parse(content) : null;
    } catch (error) {
      console.warn('Dialogue provider failed:', error instanceof Error ? error.message : error);
      return null;
    }
  }
}
