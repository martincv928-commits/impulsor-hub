// Cliente del LLM (Anthropic Messages API). Detrás de una interfaz para poder probar sin red.
export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
export interface LlmMessage { role: 'user' | 'assistant'; content: string | Block[] }
export interface ToolSpec { name: string; description: string; input_schema: Record<string, unknown> }
export interface LlmRequest { system: string; messages: LlmMessage[]; tools: ToolSpec[] }
export interface LlmResponse { stop_reason: string; content: Block[] }
export interface LlmClient { complete(req: LlmRequest): Promise<LlmResponse> }

export class AnthropicClient implements LlmClient {
  constructor(private apiKey: string, private model = 'claude-sonnet-5-5', private fetcher: typeof fetch = fetch) {}
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const res = await this.fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: this.model, max_tokens: 1500, system: req.system, messages: req.messages, ...(req.tools.length ? { tools: req.tools } : {}) }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j: any = await res.json();
    return { stop_reason: j.stop_reason, content: j.content as Block[] };
  }
}
