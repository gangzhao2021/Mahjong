/**
 * China build provider (PRD Appendix D.4): a domestic model that has
 * completed generative-AI filing, reached through its OpenAI-compatible
 * chat-completions endpoint (e.g. Qwen via DashScope, DeepSeek, Doubao).
 */
import type { DialogueReply, DialogueRequest } from '@mahjong/dialogue';
import { ReplySchema, type LlmProvider } from './provider';

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
    try {
      const res = await fetch(`${o.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${o.apiKey}` },
        body: JSON.stringify({
          model: request.tier === 'highValue' ? o.highValueModel : o.routineModel,
          messages: [
            { role: 'system', content: request.system + JSON_INSTRUCTION },
            { role: 'user', content: request.user },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 200,
          temperature: 0.9,
        }),
        signal: AbortSignal.timeout(o.timeoutMs),
      });
      if (!res.ok) {
        console.warn(`Dialogue provider HTTP ${res.status}`);
        return null;
      }
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = body.choices?.[0]?.message?.content;
      if (!content) return null;
      const parsed = ReplySchema.safeParse(JSON.parse(content));
      return parsed.success ? (parsed.data as DialogueReply) : null;
    } catch (error) {
      console.warn('Dialogue provider failed:', error instanceof Error ? error.message : error);
      return null;
    }
  }
}
