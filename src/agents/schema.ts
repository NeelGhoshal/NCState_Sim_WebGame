// Model output is untrusted. Everything is parsed and checked here before the engine sees it.
import type { AgentTurn, Allowed, Reflection } from '../engine/engine';

export type Checked<T> = { ok: true; value: T; warnings: string[] } | { ok: false; error: string };

/** Pulls the first JSON object out of a reply, tolerating code fences and stray prose. */
export function extractJson(raw: string): unknown {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object found');
  return JSON.parse(text.slice(start, end + 1));
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function validateTurn(raw: string, allowed: Allowed): Checked<AgentTurn> {
  let obj: Record<string, unknown>;
  try {
    const parsed = extractJson(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'not an object' };
    obj = parsed as Record<string, unknown>;
  } catch (e) {
    return { ok: false, error: `bad JSON: ${(e as Error).message}` };
  }
  const warnings: string[] = [];
  const say = str(obj.say, 600);
  if (!say) return { ok: false, error: 'missing "say"' };

  let action = str(obj.action, 40) || 'none';
  let arg = str(obj.action_arg, 60);
  if (!allowed.actions.includes(action)) {
    warnings.push(`action "${action}" not allowed; using none`);
    action = 'none'; arg = '';
  } else if (allowed.argsFor[action]) {
    const options = allowed.argsFor[action];
    if (!options.includes(arg)) {
      if (options.length === 1) { arg = options[0]; }
      else { warnings.push(`arg "${arg}" not valid for ${action}; using none`); action = 'none'; arg = ''; }
    }
  } else {
    arg = '';
  }

  const rd = Number(obj.relationship_delta);
  const relationship_delta = Number.isFinite(rd) ? Math.max(-3, Math.min(3, Math.round(rd))) : 0;
  const replies = Array.isArray(obj.replies)
    ? obj.replies.map((r) => str(r, 90)).filter(Boolean).slice(0, 3)
    : [];
  return {
    ok: true,
    value: { say, action, action_arg: arg, relationship_delta, replies, memory: str(obj.memory, 200) },
    warnings,
  };
}

export function validateReflection(raw: string): Checked<Reflection> {
  try {
    const o = extractJson(raw) as Record<string, unknown>;
    const summary = str(o.summary, 300);
    if (!summary) return { ok: false, error: 'missing summary' };
    const imp = Number(o.importance);
    return {
      ok: true,
      value: {
        summary,
        importance: Number.isFinite(imp) ? Math.max(1, Math.min(10, Math.round(imp))) : 5,
        note: str(o.relationship_note, 160),
        goal: str(o.tomorrow_goal, 200),
        text: str(o.text_player, 280),
      },
      warnings: [],
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function validateRecap(raw: string): Checked<{ recap: string; hook: string }> {
  try {
    const o = extractJson(raw) as Record<string, unknown>;
    const recap = str(o.recap, 700);
    if (!recap) return { ok: false, error: 'missing recap' };
    return { ok: true, value: { recap, hook: str(o.hook, 300) }, warnings: [] };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function validateEpilogue(raw: string, ids: string[]): Checked<{ closing: string; characters: Record<string, string> }> {
  try {
    const o = extractJson(raw) as Record<string, unknown>;
    const closing = str(o.closing, 1200);
    if (!closing) return { ok: false, error: 'missing closing' };
    const chars: Record<string, string> = {};
    const src = (o.characters && typeof o.characters === 'object') ? o.characters as Record<string, unknown> : {};
    for (const id of ids) { const line = str(src[id], 300); if (line) chars[id] = line; }
    return { ok: true, value: { closing, characters: chars }, warnings: [] };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
