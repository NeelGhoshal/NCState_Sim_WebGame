// Browser side of the AI service (ai/, Python). Talks only to /api/*, which Vite proxies
// to the service in development.
export type Tier = 'small' | 'large';
export interface LlmStatus { server: boolean; configured: boolean; provider: string | null; models: Record<Tier, string> | null }
export interface CallUsage { tier: Tier; calls: number; promptTokens: number; completionTokens: number }

let status: LlmStatus = { server: false, configured: false, provider: null, models: null };

export async function refreshStatus(): Promise<LlmStatus> {
  try {
    const r = await fetch('/api/llm/status');
    status = r.ok ? { server: true, ...(await r.json()) } : { server: false, configured: false, provider: null, models: null };
  } catch {
    status = { server: false, configured: false, provider: null, models: null };
  }
  return status;
}

export const llmStatus = () => status;

/** POSTs to the AI service. Returns null when the service is down, slow or erroring. */
export async function post<T>(path: string, body: unknown): Promise<T | null> {
  if (!status.configured) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), status.provider === 'ollama' ? 75000 : 25000);
  try {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      console.warn('[ai] service error', r.status, await r.text().catch(() => ''));
      return null;
    }
    return (await r.json()) as T;
  } catch (e) {
    console.warn('[ai] call failed', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
