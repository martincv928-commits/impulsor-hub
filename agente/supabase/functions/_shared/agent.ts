// Bucle del agente: LLM + herramientas. Las herramientas permitidas se pasan explícitamente; cualquier otra se rechaza.
import type { LlmClient, LlmMessage, Block } from './llm.ts';
import type { ToolCtx, ToolDef } from './tools.ts';

export interface ToolTrace { tool: string; params: Record<string, unknown>; ok: boolean; summary: string }
export interface AgentUsage { input_tokens: number; output_tokens: number; calls: number }
export interface AgentResult { text: string; traces: ToolTrace[]; usage: AgentUsage }

const MAX_RESULT_CHARS = 14000;
export function compactResult(v: unknown): string {
  const s = JSON.stringify(v);
  return s.length <= MAX_RESULT_CHARS ? s : s.slice(0, MAX_RESULT_CHARS) + '…[resultado recortado: hay más datos de los mostrados]';
}

export async function runAgent(opts: {
  llm: LlmClient; system: string; history: LlmMessage[]; userText: string;
  tools: ToolDef[]; ctx: ToolCtx; maxSteps?: number;
}): Promise<AgentResult> {
  const { llm, system, tools, ctx } = opts;
  const messages: LlmMessage[] = [...opts.history, { role: 'user', content: opts.userText }];
  const traces: ToolTrace[] = [];
  const usage: AgentUsage = { input_tokens: 0, output_tokens: 0, calls: 0 };
  const specs = tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));

  for (let step = 0; step < (opts.maxSteps ?? 6); step++) {
    const r = await llm.complete({ system, messages, tools: specs });
    usage.calls += 1; usage.input_tokens += r.usage?.input_tokens ?? 0; usage.output_tokens += r.usage?.output_tokens ?? 0;
    const uses = r.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    if (r.stop_reason !== 'tool_use' || !uses.length) {
      return { text: r.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n').trim(), traces, usage };
    }
    messages.push({ role: 'assistant', content: r.content });
    const results: Block[] = [];
    for (const u of uses) {
      const def = tools.find((t) => t.name === u.name);
      if (!def) {
        traces.push({ tool: u.name, params: u.input ?? {}, ok: false, summary: 'herramienta no disponible en este modo' });
        results.push({ type: 'tool_result', tool_use_id: u.id, content: 'Herramienta no disponible.', is_error: true });
        continue;
      }
      try {
        const out = await def.run(ctx, u.input ?? {});
        const content = compactResult(out);
        traces.push({ tool: u.name, params: u.input ?? {}, ok: true, summary: `${content.length} caracteres` });
        results.push({ type: 'tool_result', tool_use_id: u.id, content });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        traces.push({ tool: u.name, params: u.input ?? {}, ok: false, summary: msg.slice(0, 200) });
        results.push({ type: 'tool_result', tool_use_id: u.id, content: `Error: ${msg}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: 'No pude completar la consulta con los datos disponibles. Intenta de nuevo con una pregunta más concreta.', traces, usage };
}
