import { describe, it, expect } from 'vitest';
import { newGame, type GameState, WAKE, PLAYER_CLASS, validTraits } from '../src/engine/state';
import {
  advance, buy, study, sleep, attendClass, spendExchange, talkCheck, applyAgentTurn, respondInvite,
  busWait, rideBus, allowedActions, walkTime,
} from '../src/engine/engine';
import { MAPS } from '../src/maps/index';

const traits = { athletics: 4, academics: 5, charisma: 5, creativity: 3, discipline: 5, streetSmarts: 4 };
const fresh = (): GameState => newGame({ name: 'Test', pronouns: 'they/them', traits: { ...traits }, budget: 'steady' });
const at = (s: GameState, mapId: string, spot: string) => { const p = MAPS[mapId].spots[spot]; s.mapId = mapId; s.x = p.x; s.y = p.y; };

describe('engine', () => {
  it('validates trait budgets', () => {
    expect(validTraits(traits)).toBe(true);
    expect(validTraits({ ...traits, athletics: 10, academics: 10 })).toBe(false);
  });

  it('time raises hunger and drains energy', () => {
    const s = fresh();
    const e0 = s.energy, h0 = s.hunger;
    advance(s, 120);
    expect(s.minute).toBe(8 * 60 + 120);
    expect(s.hunger).toBeGreaterThan(h0);
    expect(s.energy).toBeLessThan(e0);
  });

  it('walking accumulates fractional minutes', () => {
    const s = fresh();
    walkTime(s, 0.4); expect(s.minute).toBe(480);
    walkTime(s, 0.7); expect(s.minute).toBe(481);
  });

  it('buying costs money and time, and respects hours', () => {
    const s = fresh();
    s.minute = 12 * 60;
    const m0 = s.money;
    const r = buy(s, 'tuffys', 'burger');
    expect(r.ok).toBe(true);
    expect(s.money).toBeLessThan(m0);
    expect(s.minute).toBe(12 * 60 + 30);
    s.minute = 22 * 60;
    expect(buy(s, 'tuffys', 'burger').ok).toBe(false);
  });

  it('cannot buy without money', () => {
    const s = fresh();
    s.minute = 12 * 60; s.money = 1;
    expect(buy(s, 'tuffys', 'burger').ok).toBe(false);
    expect(s.money).toBe(1);
  });

  it('dining halls use swipes and complete the bucket item', () => {
    const s = fresh();
    s.minute = 12 * 60;
    for (const d of ['fountain', 'clark', 'case']) expect(buy(s, d, `${d}-meal`).ok).toBe(true);
    expect(s.swipes).toBe(4);
    expect(s.bucket.dining).toBe(true);
  });

  it('study costs an hour and adds knowledge', () => {
    const s = fresh();
    const k0 = s.knowledge;
    expect(study(s, 'library').ok).toBe(true);
    expect(s.knowledge).toBeGreaterThan(k0);
    expect(s.minute).toBe(9 * 60);
  });

  it('class only during its window; quiz on day 3', () => {
    const s = fresh();
    expect(attendClass(s).ok).toBe(false);
    s.minute = PLAYER_CLASS.from - 5;
    expect(attendClass(s).ok).toBe(true);
    expect(s.minute).toBe(PLAYER_CLASS.to);
    expect(attendClass(s).ok).toBe(false);
    s.day = 3; s.minute = PLAYER_CLASS.from;
    attendClass(s);
    expect(s.quizScore).not.toBeNull();
  });

  it('sleep advances the day and ends the episode after day 3', () => {
    const s = fresh();
    s.minute = 23 * 60;
    sleep(s);
    expect(s.day).toBe(2);
    expect(s.minute).toBe(WAKE);
    expect(s.energy).toBeGreaterThan(80);
    sleep(s); sleep(s);
    expect(s.ended).toBe(true);
  });

  it('conversations cost 5 minutes and social battery', () => {
    const s = fresh();
    s.minute = 12 * 60 + 10;
    at(s, 'talley2', 'f2.oneearth.seat');
    expect(talkCheck(s, 'maya')).toBeNull();
    const b0 = s.agents.maya.battery;
    spendExchange(s, 'maya');
    expect(s.minute).toBe(12 * 60 + 15);
    expect(s.agents.maya.battery).toBe(b0 - 1);
    s.agents.maya.battery = 0;
    expect(talkCheck(s, 'maya')).not.toBeNull();
  });

  it('agents are absent when their schedule says so', () => {
    const s = fresh();
    s.minute = 9 * 60;
    at(s, 'talley2', 'f2.oneearth.seat');
    expect(talkCheck(s, 'maya')).not.toBeNull();
  });

  it('agent turns cannot exceed engine caps or invent actions', () => {
    const s = fresh();
    const r0 = s.agents.dev.rel;
    applyAgentTurn(s, 'dev', { say: 'hi', action: 'give', action_arg: 'gold', relationship_delta: 50, replies: [], memory: '' });
    expect(s.agents.dev.rel - r0).toBeLessThanOrEqual(3);
    expect(s.energy).toBe(85);
  });

  it('invites: offered in person, accepted, attended', () => {
    const s = fresh();
    s.minute = 12 * 60;
    expect(allowedActions(s, 'jordan').argsFor.invite).toEqual(['jordan_meeting']);
    applyAgentTurn(s, 'jordan', { say: 'come!', action: 'invite', action_arg: 'jordan_meeting', relationship_delta: 0, replies: [], memory: '' });
    expect(s.invites.jordan_meeting.status).toBe('pending');
    respondInvite(s, 'jordan_meeting', true);
    const r0 = s.agents.jordan.rel;
    s.minute = 17 * 60 + 55;
    at(s, 'talley3', 'f3.club');
    advance(s, 70);
    expect(s.invites.jordan_meeting.status).toBe('attended');
    expect(s.agents.jordan.rel).toBeGreaterThan(r0);
  });

  it('invites: arrive by text, then missed after accepting', () => {
    const s = fresh();
    advance(s, 13 * 60 - s.minute);
    expect(s.invites.jordan_meeting.status).toBe('pending');
    expect(s.texts.length).toBe(1);
    respondInvite(s, 'jordan_meeting', true);
    const r0 = s.agents.jordan.rel;
    advance(s, 19 * 60 - s.minute);
    expect(s.invites.jordan_meeting.status).toBe('missed');
    expect(s.agents.jordan.rel).toBeLessThan(r0);
    expect(s.agents.jordan.memories.some((m) => m.importance >= 8)).toBe(true);
  });

  it('day 3 build night needs the first meeting attended', () => {
    const s = fresh();
    s.day = 3; s.minute = 12 * 60;
    expect(allowedActions(s, 'jordan').argsFor.invite).toBeUndefined();
    s.invites.jordan_meeting.status = 'attended';
    expect(allowedActions(s, 'jordan').argsFor.invite).toEqual(['jordan_build']);
  });

  it('the bus waits for the next departure and moves you', () => {
    expect(busWait(8 * 60)).toBe(0);
    expect(busWait(8 * 60 + 3)).toBe(5);
    const s = fresh();
    s.minute = 8 * 60 + 3;
    const r = rideBus(s, 'talley', 'belltower');
    expect(r.ok).toBe(true);
    expect(s.minute).toBe(8 * 60 + 3 + 5 + 12);
    expect(s.bucket.wolfline).toBe(true);
  });

  it('staying up to 2 AM triggers a pass-out event', () => {
    const s = fresh();
    s.minute = 25 * 60 + 55;
    expect(advance(s, 10).some((e) => e.kind === 'passout')).toBe(true);
  });
});
