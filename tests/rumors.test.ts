import { describe, it, expect } from 'vitest';
import { AGENTS, FACTS } from '../src/data/agents';
import { newGame, migrate, type GameState } from '../src/engine/state';
import { advance, allowedActions, applyAgentTurn } from '../src/engine/engine';
import { EXPOSED_REL, factsKnownBy, gossipTick, knowsFact, tellFact, tellable, together } from '../src/engine/rumors';
import { recallMemories } from '../src/engine/memory';

const traits = { athletics: 4, academics: 5, charisma: 5, creativity: 3, discipline: 5, streetSmarts: 4 };
const fresh = (): GameState => newGame({ name: 'Alex', pronouns: 'they/them', traits: { ...traits }, budget: 'steady' });
const turn = (action: string, arg = '') => ({ say: 'x', action, action_arg: arg, relationship_delta: 0, replies: [], memory: '' });

/** Every (pair, day, minute) where two characters share a place on the half hour. */
function meetings() {
  const out: { a: string; b: string; day: number; minute: number }[] = [];
  for (let day = 1; day <= 3; day++) for (let m = 6 * 60; m < 26 * 60; m += 30) {
    for (const a of AGENTS) for (const b of AGENTS) if (a.id < b.id && together(a.id, b.id, day, m)) out.push({ a: a.id, b: b.id, day, minute: m });
  }
  return out;
}

describe('rumor network', () => {
  it('characters know their own facts and nothing else at the start', () => {
    const s = fresh();
    for (const a of AGENTS) expect(factsKnownBy(s, a.id).every((f) => FACTS[f].owner === a.id)).toBe(true);
  });

  it('some characters share a place during the loop, so rumors can move', () => {
    expect(meetings().length).toBeGreaterThan(0);
  });

  it('facts spread only between characters in the same place, and deterministically', () => {
    const run = () => {
      const s = fresh();
      for (let d = 0; d < 3; d++) { s.minute = 6 * 60; advance(s, 20 * 60 - 1); s.day++; }
      return s;
    };
    const a = run(), b = run();
    expect(JSON.stringify(a.rumors)).toBe(JSON.stringify(b.rumors));
    expect(a.rumors.length).toBeGreaterThan(0);
    for (const r of a.rumors) {
      expect(r.from === 'player' || together(r.from, r.to, r.day, r.minute)).toBe(true);
      expect(FACTS[r.fact].owner).not.toBe(r.to);
    }
  });

  it('a character can pass on what they heard, labeled with who told them', () => {
    const s = fresh();
    s.agents.sam.heard.dev_quiz = { from: 'dev', origin: 'dev', day: 1, minute: 480 };
    expect(allowedActions(s, 'sam').argsFor.share_info).toContain('dev_quiz');
    applyAgentTurn(s, 'sam', turn('share_info', 'dev_quiz'));
    expect(s.knownFacts).toContain('dev_quiz');
    expect(allowedActions(s, 'dev').argsFor.share_info ?? []).not.toContain('dev_quiz'); // player knows it now
  });

  it('the player can tell what they learned; secrets cost trust with people who dislike gossip', () => {
    const s = fresh();
    s.knownFacts.push('maya_lab', 'jordan_funding');
    expect(tellable(s, 'dev')).toEqual(['maya_lab', 'jordan_funding']);
    expect(tellable(s, 'maya')).toEqual(['jordan_funding']); // Maya knows her own secret
    const rel = s.agents.dev.rel;
    expect(tellFact(s, 'dev', 'maya_lab').ok).toBe(true);
    expect(s.agents.dev.rel).toBe(rel - 2);                   // Dev dislikes gossip
    expect(knowsFact(s, 'dev', 'maya_lab')).toBe(true);
    expect(s.agents.dev.heard.maya_lab.origin).toBe('player');
    expect(tellFact(s, 'dev', 'maya_lab').ok).toBe(false);    // once
    expect(tellFact(s, 'sam', 'dev_parents').ok).toBe(false); // not known to the player
  });

  it('a secret the player started that reaches its owner costs the player, once, with a text', () => {
    const s = fresh();
    const m = meetings().find((x) => x.a === 'dev' || x.b === 'dev');
    expect(m).toBeDefined();
    const other = m!.a === 'dev' ? m!.b : m!.a;
    s.knownFacts.push('dev_parents');
    tellFact(s, other, 'dev_parents');
    // Gossip a lot, so the roll lands: set the teller to a sure gossip for this test
    const def = AGENTS.find((a) => a.id === other)!;
    const saved = def.gossip;
    def.gossip = 1;
    try {
      s.day = m!.day; s.minute = m!.minute;
      const rel = s.agents.dev.rel;
      gossipTick(s, []);
      expect(s.agents.dev.rel).toBe(rel + EXPOSED_REL);
      expect(s.texts.some((t) => t.from === 'dev' && /not cool/.test(t.body))).toBe(true);
      gossipTick(s, []);
      expect(s.agents.dev.rel).toBe(rel + EXPOSED_REL);       // only once
    } finally {
      def.gossip = saved;
    }
  });

  it('old saves gain the new fields', () => {
    const s = fresh() as unknown as Record<string, unknown>;
    delete s.knownFacts; delete s.rumors;
    for (const a of Object.values(s.agents as Record<string, Record<string, unknown>>)) delete a.heard;
    const m = migrate(s as unknown as GameState);
    expect(m.knownFacts).toEqual([]);
    expect(m.agents.maya.heard).toEqual({});
  });
});

describe('memory recall', () => {
  const mem = (day: number, minute: number, text: string, importance: number) => ({ day, minute, text, importance });

  it('returns everything when there is little', () => {
    const ms = [mem(1, 500, 'a', 3)];
    expect(recallMemories(ms, 'x', { day: 1, minute: 600 })).toEqual(ms);
  });

  it('keeps important and relevant memories over recent filler, in time order', () => {
    const ms = [
      mem(1, 480, 'The player stood me up for Tuffy\'s dinner', 9),
      mem(1, 500, 'The player asked about the stepper motor', 4),
      ...Array.from({ length: 12 }, (_, i) => mem(2, 600 + i, `small talk ${i}`, 2)),
    ];
    const got = recallMemories(ms, 'can you help with the stepper motor?', { day: 2, minute: 700 }, 8);
    expect(got).toHaveLength(8);
    expect(got[0].text).toMatch(/stood me up/);
    expect(got[1].text).toMatch(/stepper motor/);
    const times = got.map((m) => m.day * 1440 + m.minute);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe('scripted session', () => {
  it('three days of talking, telling and sleeping keep every number in range', async () => {
    const { fallbackTurn } = await import('../src/agents/fallback');
    const { sleep, spendExchange } = await import('../src/engine/engine');
    const { agentWhere } = await import('../src/engine/schedule');
    const s = fresh();
    let invalid = 0;
    for (let day = 1; day <= 3; day++) {
      while (s.minute < 23 * 60) {
        for (const a of AGENTS) {
          // Talk to whoever is somewhere this hour, as if the player walked over.
          const w = agentWhere(a, s.day, s.minute);
          if (!w?.entry.mapId || !w.entry.spot) continue;
          s.mapId = w.entry.mapId;
          spendExchange(s, a.id);
          const allowed = allowedActions(s, a.id);
          const t = fallbackTurn(s, a.id, allowed, 2, 'what do you know?');
          if (t.action !== 'none' && !allowed.actions.includes(t.action)) invalid++;
          applyAgentTurn(s, a.id, t);
          for (const f of tellable(s, a.id).slice(0, 1)) tellFact(s, a.id, f);
        }
        advance(s, 55);
      }
      sleep(s);
    }
    expect(invalid).toBe(0);
    for (const k of ['energy', 'hunger', 'stress', 'knowledge'] as const) expect(s[k]).toBeGreaterThanOrEqual(0), expect(s[k]).toBeLessThanOrEqual(100);
    for (const a of Object.values(s.agents)) { expect(a.rel).toBeGreaterThanOrEqual(0); expect(a.rel).toBeLessThanOrEqual(100); expect(a.memories.length).toBeLessThanOrEqual(40); }
    expect(s.knownFacts.length).toBeGreaterThan(0);
    expect(s.rumors.some((r) => r.from === 'player')).toBe(true);
  });
});
