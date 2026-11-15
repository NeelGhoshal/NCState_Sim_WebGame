// Dev/preview middleware that holds the API keys and forwards chat calls.
// The browser only ever talks to /api/llm/*; keys never ship in client code.
import type { Plugin, Connect } from 'vite';
import type { ServerResponse } from 'node:http';

type Tier = 'small' | 'large';
interface Provider {
  name: string;
  url: string;
  key?: string;
  models: Record<Tier, string>;
  timeoutMs: number;
}

const DEFAULT_MODELS: Record<string, Record<Tier, string>> = {
  groq: { small: 'openai/gpt-oss-20b', large: 'openai/gpt-oss-120b' },
  openrouter: { small: 'openai/gpt-oss-20b:free', large: 'openai/gpt-oss-120b:free' },
  ollama: { small: 'qwen3:8b', large: 'qwen3:8b' },
};

function pickProvider(env: Record<string, string>): Provider | null {
  let name = (env.LLM_PROVIDER || '').trim().toLowerCase();
  if (!name) name = env.GROQ_API_KEY ? 'groq' : env.OPENROUTER_API_KEY ? 'openrouter' : '';
  if (!name || !DEFAULT_MODELS[name]) return null;
  const models = {
    small: env.LLM_MODEL_SMALL || DEFAULT_MODELS[name].small,
    large: env.LLM_MODEL_LARGE || DEFAULT_MODELS[name].large,
  };
  if (name === 'groq') {
    if (!env.GROQ_API_KEY) return null;
    return { name, url: 'https://api.groq.com/openai/v1/chat/completions', key: env.GROQ_API_KEY, models, timeoutMs: 15000 };
  }
  if (name === 'openrouter') {
    if (!env.OPENROUTER_API_KEY) return null;
    return { name, url: 'https://openrouter.ai/api/v1/chat/completions', key: env.OPENROUTER_API_KEY, models, timeoutMs: 20000 };
  }
  const base = (env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
  return { name, url: `${base}/v1/chat/completions`, models, timeoutMs: 60000 };
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 200_000) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export function llmProxy(env: Record<string, string>): Plugin {
  const provider = pickProvider(env);

  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    const url = req.url || '';
    if (url.startsWith('/status')) {
      return send(res, 200, {
        configured: !!provider,
        provider: provider?.name ?? null,
        models: provider?.models ?? null,
      });
    }
    if (!url.startsWith('/chat') || req.method !== 'POST') return next();
    if (!provider) return send(res, 503, { error: 'no provider configured' });

    try {
      const body = JSON.parse(await readBody(req));
      const tier: Tier = body.tier === 'large' ? 'large' : 'small';
      const model = provider.models[tier];
      const payload: Record<string, unknown> = {
        model,
        messages: body.messages,
        temperature: typeof body.temperature === 'number' ? body.temperature : 0.8,
        max_tokens: Math.min(Number(body.maxTokens) || 500, 1500),
        response_format: { type: 'json_object' },
      };
      // Reasoning models spend output tokens on thinking; keep that short.
      if (/gpt-oss/.test(model)) payload.reasoning_effort = 'low';
      if (provider.name === 'ollama' && /qwen3|deepseek-r1/.test(model)) payload.reasoning_effort = 'none';

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), provider.timeoutMs);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (provider.key) headers.Authorization = `Bearer ${provider.key}`;
      let upstream: Response;
      try {
        upstream = await fetch(provider.url, { method: 'POST', headers, body: JSON.stringify(payload), signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      const text = await upstream.text();
      if (!upstream.ok) {
        return send(res, upstream.status, { error: `upstream ${upstream.status}`, detail: text.slice(0, 400) });
      }
      const json = JSON.parse(text);
      return send(res, 200, {
        content: json.choices?.[0]?.message?.content ?? '',
        model,
        usage: json.usage ?? null,
      });
    } catch (err) {
      return send(res, 502, { error: String((err as Error)?.message || err) });
    }
  };

  return {
    name: 'llm-proxy',
    configureServer(server) {
      server.middlewares.use('/api/llm', handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/llm', handler);
    },
  };
}
