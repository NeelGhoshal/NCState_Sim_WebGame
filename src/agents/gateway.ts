// Browser side of the LLM gateway. Talks only to the local proxy (server/llmProxy.ts).
export type Tier = 'small' | 'large';
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface LlmStatus { configured: boolean; provider: string | null; models: Record<Tier, string> | null }
export interface ChatResult { content: string; model: string; usage: { prompt_tokens?: number; completion_tokens?: number } | null }

let status: LlmStatus = { configured: false, provider: null, models: null };

export async function refreshStatus(): Promise<LlmStatus> {
  try {
    const r = await fetch('/api/llm/status');
    if (r.ok) status = await r.json();
  } catch {
    status = { configured: false, provider: null, models: null };
  }
  return status;
}

export const llmStatus = () => status;

export async function chat(messages: ChatMessage[], tier: Tier, opts: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {}): Promise<ChatResult | null> {
  if (!status.configured) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? (status.provider === 'ollama' ? 60000 : 20000));
  try {
    const r = await fetch('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, tier, maxTokens: opts.maxTokens, temperature: opts.temperature }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      console.warn('[llm] proxy error', r.status, await r.text().catch(() => ''));
      return null;
    }
    return await r.json();
  } catch (e) {
    console.warn('[llm] call failed', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
