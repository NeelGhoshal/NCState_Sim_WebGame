import { describe, it, expect } from 'vitest';
import { validateTurn, validateReflection, extractJson } from '../src/agents/schema';

const allowed = { actions: ['none', 'end_conversation', 'invite', 'share_info'], argsFor: { invite: ['jordan_meeting'], share_info: ['a', 'b'] } };

describe('agent output validation', () => {
  it('accepts a well-formed turn', () => {
    const r = validateTurn('{"say":"Hey!","action":"invite","action_arg":"jordan_meeting","relationship_delta":2,"replies":["a","b","c"],"memory":"met"}', allowed);
    expect(r.ok && r.value.action).toBe('invite');
  });

  it('strips code fences and think blocks', () => {
    expect(extractJson('<think>hmm</think>```json\n{"say":"x"}\n```')).toEqual({ say: 'x' });
  });

  it('downgrades actions that are not allowed', () => {
    const r = validateTurn('{"say":"Take my money","action":"give_money","relationship_delta":1}', allowed);
    expect(r.ok && r.value.action).toBe('none');
    expect(r.ok && r.warnings.length).toBe(1);
  });

  it('downgrades invalid arguments when there is a choice, fills them when there is one option', () => {
    const a = validateTurn('{"say":"x","action":"share_info","action_arg":"zzz"}', allowed);
    expect(a.ok && a.value.action).toBe('none');
    const b = validateTurn('{"say":"x","action":"invite","action_arg":"party"}', allowed);
    expect(b.ok && b.value.action_arg).toBe('jordan_meeting');
  });

  it('clamps relationship changes', () => {
    const r = validateTurn('{"say":"x","relationship_delta":40}', allowed);
    expect(r.ok && r.value.relationship_delta).toBe(3);
  });

  it('rejects missing speech and bad JSON', () => {
    expect(validateTurn('{"action":"none"}', allowed).ok).toBe(false);
    expect(validateTurn('sure! here you go', allowed).ok).toBe(false);
  });

  it('validates reflections', () => {
    const r = validateReflection('{"summary":"Good day.","importance":"12","tomorrow_goal":"Study","text_player":""}');
    expect(r.ok && r.value.importance).toBe(10);
  });
});
