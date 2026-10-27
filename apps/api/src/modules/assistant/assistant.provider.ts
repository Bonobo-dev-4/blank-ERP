import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ToolDef } from './assistant.tools';

export type Provider = 'anthropic' | 'openai';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** Present on assistant turns that asked for tools. */
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
  /** Present on tool results. */
  toolCallId?: string;
}

export interface ChatReply {
  text: string | null;
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
}

/**
 * One interface over two APIs.
 *
 * Both are called with plain `fetch` rather than their SDKs. Two vendor SDKs
 * for what is one POST and one response shape each is dependency weight for
 * no benefit, and the tool-calling payloads differ enough that an SDK would
 * not have unified them anyway.
 *
 * The key never leaves the server. The browser sends a question and gets an
 * answer; it is never handed a credential, which is the whole reason this
 * lives in the API rather than in the client.
 */
@Injectable()
export class AssistantProvider {
  private readonly logger = new Logger(AssistantProvider.name);

  constructor(private readonly config: ConfigService) {}

  private get(key: string, fallback = ''): string {
    const raw = String(this.config.get(key) ?? '').trim();
    return raw.length > 0 ? raw : fallback;
  }

  /** Which provider is configured, preferring an explicit choice. */
  resolve(): { provider: Provider | null; model: string; missing: string[] } {
    const anthropicKey = this.get('ANTHROPIC_API_KEY');
    const openaiKey = this.get('OPENAI_API_KEY');
    const preferred = this.get('ASSISTANT_PROVIDER').toLowerCase();

    if (preferred === 'openai' && openaiKey) {
      return { provider: 'openai', model: this.get('OPENAI_MODEL', 'gpt-4o'), missing: [] };
    }
    if (preferred === 'anthropic' && anthropicKey) {
      return { provider: 'anthropic', model: this.get('ANTHROPIC_MODEL', 'claude-sonnet-5'), missing: [] };
    }
    if (anthropicKey) {
      return { provider: 'anthropic', model: this.get('ANTHROPIC_MODEL', 'claude-sonnet-5'), missing: [] };
    }
    if (openaiKey) {
      return { provider: 'openai', model: this.get('OPENAI_MODEL', 'gpt-4o'), missing: [] };
    }
    return { provider: null, model: '', missing: ['ANTHROPIC_API_KEY or OPENAI_API_KEY'] };
  }

  describe(): { configured: boolean; provider: Provider | null; model: string; missing: string[] } {
    const r = this.resolve();
    return { configured: r.provider !== null, provider: r.provider, model: r.model, missing: r.missing };
  }

  async chat(system: string, messages: ChatMessage[], tools: ToolDef[]): Promise<ChatReply> {
    const { provider, model } = this.resolve();
    if (!provider) {
      throw new ServiceUnavailableException({
        code: 'ASSISTANT_NOT_CONFIGURED',
        message: 'No AI provider is configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.',
      });
    }
    return provider === 'anthropic'
      ? this.anthropic(model, system, messages, tools)
      : this.openai(model, system, messages, tools);
  }

  // ---------------------------------------------------------------------------

  private async anthropic(
    model: string, system: string, messages: ChatMessage[], tools: ToolDef[],
  ): Promise<ChatReply> {
    // Anthropic takes the system prompt as its own field, and carries tool
    // results as user-role content blocks rather than a separate role.
    const body = {
      model,
      max_tokens: 2048,
      system,
      tools: tools.map((t) => ({
        name: t.name, description: t.description, input_schema: t.parameters,
      })),
      messages: messages.map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'user' as const,
            content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }],
          };
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
          return {
            role: 'assistant' as const,
            content: [
              ...(m.content ? [{ type: 'text', text: m.content }] : []),
              ...m.toolCalls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args })),
            ],
          };
        }
        return { role: m.role as 'user' | 'assistant', content: m.content };
      }),
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.get('ANTHROPIC_API_KEY'),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as {
      content?: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
      error?: { message?: string };
    } | null;

    if (!res.ok) {
      // Never echo the key or the request; only the shape of the failure.
      throw new ServiceUnavailableException({
        code: 'ASSISTANT_PROVIDER_ERROR',
        message: json?.error?.message ?? `Anthropic returned HTTP ${res.status}`,
        details: { status: res.status, provider: 'anthropic' },
      });
    }

    const blocks = json?.content ?? [];
    return {
      text: blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim() || null,
      toolCalls: blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: b.id ?? '', name: b.name ?? '', args: b.input ?? {} })),
    };
  }

  private async openai(
    model: string, system: string, messages: ChatMessage[], tools: ToolDef[],
  ): Promise<ChatReply> {
    const body = {
      model,
      max_completion_tokens: 2048,
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      messages: [
        { role: 'system', content: system },
        ...messages.map((m) => {
          if (m.role === 'tool') {
            return { role: 'tool' as const, tool_call_id: m.toolCallId, content: m.content };
          }
          if (m.role === 'assistant' && m.toolCalls?.length) {
            return {
              role: 'assistant' as const,
              content: m.content || null,
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id, type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.args) },
              })),
            };
          }
          return { role: m.role as 'user' | 'assistant', content: m.content };
        }),
      ],
    };

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.get('OPENAI_API_KEY')}`,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as {
      choices?: { message?: {
        content?: string | null;
        tool_calls?: { id: string; function: { name: string; arguments: string } }[];
      } }[];
      error?: { message?: string };
    } | null;

    if (!res.ok) {
      throw new ServiceUnavailableException({
        code: 'ASSISTANT_PROVIDER_ERROR',
        message: json?.error?.message ?? `OpenAI returned HTTP ${res.status}`,
        details: { status: res.status, provider: 'openai' },
      });
    }

    const msg = json?.choices?.[0]?.message;
    return {
      text: msg?.content?.trim() || null,
      toolCalls: (msg?.tool_calls ?? []).map((c) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(c.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          // A model occasionally emits malformed JSON. An empty object lets
          // the tool apply its own defaults instead of failing the turn.
          this.logger.warn(`Unparseable tool arguments for ${c.function.name}`);
        }
        return { id: c.id, name: c.function.name, args };
      }),
    };
  }
}
