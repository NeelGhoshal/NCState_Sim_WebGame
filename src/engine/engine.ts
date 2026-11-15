// The rules engine. Owns time, meters, money, relationships and invitations.
// Pure TypeScript: no DOM, no Phaser, no network. Mutates the GameState it is given.
import { AGENTS, AGENT_BY_ID, ALL_INVITES, INVITE_OWNER, type InviteDef } from '../data/agents';
import { VENUES, DINING_HALLS, type MenuItem, type Venue } from '../data/venues';
import { MAPS } from '../maps/index';
import { BUS_STOPS } from '../maps/campus';
import { agentWhere } from './schedule';
import { type GameState, DAY_END, DAYS, WAKE, PLAYER_CLASS, BUCKET } from './state';
import type { Pt } from './types';

export interface Ev { kind: 'toast' | 'text' | 'feed' | 'invite' | 'passout' | 'bucket'; text: string }
export interface Result { ok: boolean; msg: string; events: Ev[] }

export const EXCHANGE_MIN = 5;
export const TALK_RANGE = 2;
export const BUS = { interval: 8, ride: 4, first: 7 * 60, last: 22 * 60, order: ['talley', 'carmichael', 'fountain', 'belltower'] };

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const fail = (msg: string): Result => ({ ok: false, msg, events: [] });

export function fmtTime(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const hh = Math.floor(m / 60), mm = m % 60;
  return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}`;
}
export const fmtMoney = (v: number) => `$${v.toFixed(2)}`;

export function logEvent(s: GameState, text: string) { s.log.push({ day: s.day, minute: s.minute, text }); }

export function changeRel(s: GameState, id: string, delta: number) {
  const a = s.agents[id];
  a.rel = clamp(Math.round(a.rel + delta), 0, 100);
}

export function addMemory(s: GameState, id: string, text: string, importance: number) {
  const mem = s.agents[id].memories;
  mem.push({ day: s.day, minute: s.minute, text: text.slice(0, 240), importance: clamp(Math.round(importance), 1, 10) });
  while (mem.length > 40) {
    let drop = 0;
    for (let i = 1; i < mem.length; i++) if (mem[i].importance < mem[drop].importance) drop = i;
    mem.splice(drop, 1);
  }
}

function completeBucket(s: GameState, id: string, evs: Ev[]) {
  if (s.bucket[id]) return;
  s.bucket[id] = true;
  const item = BUCKET.find((b) => b.id === id);
  evs.push({ kind: 'bucket', text: `Bucket list: ${item?.text ?? id}` });
  logEvent(s, `Checked off the bucket list: ${item?.text ?? id}`);
}

// ---------------------------------------------------------------- time

export function inviteOfferable(s: GameState, inv: InviteDef): boolean {
  if (s.invites[inv.id].status !== 'unoffered' || inv.day !== s.day || s.minute >= inv.to) return false;
  return !inv.requires || s.invites[inv.requires].status === 'attended';
}

function nearSpot(s: GameState, mapId: string, spot: string, radius: number): boolean {
  if (s.mapId !== mapId) return false;
  const p = MAPS[mapId].spots[spot];
  return !!p && Math.max(Math.abs(p.x - s.x), Math.abs(p.y - s.y)) <= radius;
}

function finishInvite(s: GameState, inv: InviteDef, evs: Ev[]) {
  const st = s.invites[inv.id];
  const owner = INVITE_OWNER[inv.id];
  const name = AGENT_BY_ID[owner].name.split(' ')[0];
  if (st.presentMin >= 15) {
    st.status = 'attended';
    changeRel(s, owner, inv.reward.rel);
    if (inv.reward.knowledge) s.knowledge = clamp(s.knowledge + inv.reward.knowledge, 0, 100);
    if (inv.reward.stress) s.stress = clamp(s.stress + inv.reward.stress, 0, 100);
    addMemory(s, owner, inv.attendedMemory, 7);
    s.agents[owner].met = true;
    logEvent(s, `Went to: ${inv.label}`);
    evs.push({ kind: 'toast', text: `${inv.label}: you were there. ${name} noticed.` });
  } else if (st.status === 'accepted' || st.status === 'pending') {
    const wasAccepted = st.status === 'accepted';
    st.status = 'missed';
    changeRel(s, owner, wasAccepted ? -6 : -2);
    if (wasAccepted) s.stress = clamp(s.stress + 4, 0, 100);
    addMemory(s, owner, inv.missedMemory, wasAccepted ? 8 : 5);
    logEvent(s, `Missed: ${inv.label}${wasAccepted ? ' (after saying yes)' : ''}`);
    evs.push({ kind: 'toast', text: `You missed ${inv.label}.${wasAccepted ? ` ${name} will remember.` : ''}` });
  }
}

function tick(s: GameState, evs: Ev[]) {
  for (const def of AGENTS) {
    for (const e of def.schedule) {
      if (e.feed && e.from === s.minute && (!e.days || e.days.includes(s.day))) {
        const text = `${def.name.split(' ')[0]}: ${e.feed}`;
        s.feed.push({ day: s.day, minute: s.minute, text });
        evs.push({ kind: 'feed', text });
      }
    }
  }
  for (const inv of ALL_INVITES) {
    if (inv.day !== s.day) continue;
    const st = s.invites[inv.id];
    if (inv.textAt === s.minute && inviteOfferable(s, inv)) {
      const owner = INVITE_OWNER[inv.id];
      st.status = 'pending';
      s.texts.push({ from: owner, day: s.day, minute: s.minute, body: inv.textBody, read: false });
      evs.push({ kind: 'text', text: `${AGENT_BY_ID[owner].name}: ${inv.textBody}` });
    }
    if (st.status === 'unoffered' || st.status === 'attended' || st.status === 'missed') continue;
    if (s.minute > inv.from && s.minute <= inv.to && nearSpot(s, inv.mapId, inv.spot, inv.radius)) st.presentMin++;
    if (s.minute === inv.to) finishInvite(s, inv, evs);
  }
}

/** Moves the clock forward minute by minute, updating meters and the world. */
export function advance(s: GameState, minutes: number): Ev[] {
  const evs: Ev[] = [];
  const n = Math.max(0, Math.round(minutes));
  const drainBase = (4 / 60) * (1.15 - s.setup.traits.discipline * 0.03);
  for (let i = 0; i < n; i++) {
    s.minute++;
    s.hunger = clamp(s.hunger + 5 / 60, 0, 100);
    let drain = drainBase;
    if (s.hunger > 75) { drain *= 1.6; s.stress = clamp(s.stress + 2 / 60, 0, 100); }
    s.energy = clamp(s.energy - drain, 0, 100);
    if (s.energy < 15) s.stress = clamp(s.stress + 2 / 60, 0, 100);
    tick(s, evs);
    if (s.minute >= DAY_END) {
      evs.push({ kind: 'passout', text: 'It is 2:00 AM. You can barely keep your eyes open.' });
      break;
    }
  }
  return evs;
}

/** Walking runs the clock continuously; fractions accumulate until a whole minute passes. */
export function walkTime(s: GameState, minutes: number): Ev[] {
  s.walkFrac += minutes;
  const whole = Math.floor(s.walkFrac);
  if (whole <= 0) return [];
  s.walkFrac -= whole;
  const evs = advance(s, whole);
  s.energy = clamp(s.energy - whole * 0.02 * (1.2 - s.setup.traits.athletics * 0.04), 0, 100);
  return evs;
}

// ---------------------------------------------------------------- food and shopping

export const venueOpen = (v: Venue, minute: number) => minute >= v.open && minute < v.close;

export function itemPrice(s: GameState, item: MenuItem): number {
  const discount = (s.setup.traits.streetSmarts - 1) * 0.012;
  return Math.round(item.price * (1 - discount) * 100) / 100;
}

export function buy(s: GameState, venueId: string, itemId: string): Result {
  const v = VENUES[venueId];
  const item = v?.items.find((i) => i.id === itemId);
  if (!v || !item) return fail('That is not on the menu.');
  if (!venueOpen(v, s.minute)) return fail(`${v.name} is closed. Hours: ${fmtTime(v.open)} to ${fmtTime(v.close)}.`);
  if (item.swipe) {
    if (s.swipes < 1) return fail('You are out of meal swipes.');
    s.swipes--;
  } else {
    const price = itemPrice(s, item);
    if (s.money < price) return fail(`You cannot afford that. You have ${fmtMoney(s.money)}.`);
    s.money = Math.round((s.money - price) * 100) / 100;
    s.txns.push({ day: s.day, minute: s.minute, label: `${v.name}: ${item.name}`, amount: -price });
  }
  const events = advance(s, item.minutes);
  s.hunger = clamp(s.hunger + item.hunger, 0, 100);
  s.energy = clamp(s.energy + item.energy, 0, 100);
  s.stress = clamp(s.stress + item.stress, 0, 100);
  if (item.flag) s.flags[item.flag] = (s.flags[item.flag] ?? 0) + 1;
  if (item.bucket) completeBucket(s, item.bucket, events);
  if (DINING_HALLS.includes(venueId)) {
    s.flags[`dining_${venueId}`] = 1;
    if (DINING_HALLS.every((d) => s.flags[`dining_${d}`])) completeBucket(s, 'dining', events);
  }
  logEvent(s, `${item.name} at ${v.name}`);
  return { ok: true, msg: `${item.name} at ${v.name}. ${item.minutes} minutes.`, events };
}

// ---------------------------------------------------------------- study, rest, class

export function study(s: GameState, place: 'booth' | 'library'): Result {
  if (s.energy < 10) return fail('You are too tired to focus. Eat, rest or sleep.');
  const t = s.setup.traits;
  let gain = 2 + t.academics * 0.6;
  if (place === 'library') gain *= 1.3;
  if (s.energy < 30) gain *= 0.6;
  if (s.stress > 70) gain *= 0.7;
  if (s.flags.notebook) gain *= 1.1;
  gain = Math.round(gain * 10) / 10;
  const events = advance(s, 60);
  s.knowledge = clamp(s.knowledge + gain, 0, 100);
  s.energy = clamp(s.energy - 10 * (1.2 - t.discipline * 0.04), 0, 100);
  s.stress = clamp(s.stress + 2, 0, 100);
  logEvent(s, `Studied for an hour (${place === 'library' ? 'library' : 'Talley booth'})`);
  return { ok: true, msg: `Studied for 60 minutes. Knowledge +${gain}.`, events };
}

export function rest(s: GameState): Result {
  const events = advance(s, 30);
  s.energy = clamp(s.energy + 8, 0, 100);
  s.stress = clamp(s.stress - 4, 0, 100);
  return { ok: true, msg: 'You rest for 30 minutes.', events };
}

export function wait(s: GameState, minutes: number): Result {
  return { ok: true, msg: `${minutes} minutes pass.`, events: advance(s, minutes) };
}

export function classStatus(s: GameState): { canAttend: boolean; msg: string } {
  const c = PLAYER_CLASS;
  if (!c.days.includes(s.day)) return { canAttend: false, msg: 'No class today.' };
  if (s.classAttended[s.day]) return { canAttend: false, msg: 'You already went to class today.' };
  if (s.minute < c.from - 15) return { canAttend: false, msg: `${c.name} starts at ${fmtTime(c.from)}.` };
  if (s.minute > c.from + 20) return { canAttend: false, msg: 'Too late. The lecture is half over.' };
  return { canAttend: true, msg: s.day === c.quizDay ? 'Quiz today.' : 'Class is about to start.' };
}

export function attendClass(s: GameState): Result {
  const st = classStatus(s);
  if (!st.canAttend) return fail(st.msg);
  const c = PLAYER_CLASS;
  const late = s.minute > c.from + 5;
  const events = advance(s, c.to - s.minute);
  s.classAttended[s.day] = true;
  const gain = Math.round((6 + s.setup.traits.academics * 0.4) * (late ? 0.5 : 1) * 10) / 10;
  s.knowledge = clamp(s.knowledge + gain, 0, 100);
  s.energy = clamp(s.energy - 6, 0, 100);
  let msg = `${c.name}${late ? ' (late)' : ''}. Knowledge +${gain}.`;
  if (s.day === c.quizDay) {
    s.quizScore = clamp(Math.round(35 + s.knowledge * 0.55 + s.setup.traits.academics * 1.5 + (s.energy > 40 ? 5 : -5)), 0, 100);
    msg += ` Quiz score: ${s.quizScore}/100.`;
    logEvent(s, `Took the CH 101 quiz: ${s.quizScore}/100`);
  } else {
    logEvent(s, `Went to ${c.name}${late ? ', late' : ''}`);
  }
  return { ok: true, msg, events };
}

// ---------------------------------------------------------------- campus actions

export function paintTunnel(s: GameState): Result {
  if (!s.flags.paint) return fail('You need spray paint. Talley Market sells it.');
  s.flags.paint--;
  const events = advance(s, 25);
  s.stress = clamp(s.stress - 10, 0, 100);
  completeBucket(s, 'tunnel', events);
  logEvent(s, 'Painted the Free Expression Tunnel');
  return { ok: true, msg: 'You add your own mark to the tunnel wall.', events };
}

export function whisperEars(s: GameState): Result {
  const events = advance(s, 5);
  s.stress = clamp(s.stress - 4, 0, 100);
  completeBucket(s, 'wolfears', events);
  return { ok: true, msg: 'You whisper into the Wolf Ears. Somewhere across the lawn, someone laughs.', events };
}

export function busWait(minute: number): number {
  if (minute < BUS.first) return BUS.first - minute;
  const r = minute % BUS.interval;
  return r === 0 ? 0 : BUS.interval - r;
}

export function busOptions(s: GameState, from: string) {
  const i = BUS.order.indexOf(from);
  const wait = busWait(s.minute);
  return BUS.order.filter((id) => id !== from).map((id) => {
    const hops = (BUS.order.indexOf(id) - i + BUS.order.length) % BUS.order.length;
    return { id, name: BUS_STOPS[id].name, wait, ride: hops * BUS.ride, available: s.minute + wait <= BUS.last };
  });
}

export function rideBus(s: GameState, from: string, to: string): Result {
  const opt = busOptions(s, from).find((o) => o.id === to);
  if (!opt) return fail('That stop is not on this route.');
  if (!opt.available) return fail(`No more buses tonight. Service ends at ${fmtTime(BUS.last)}.`);
  const events = advance(s, opt.wait + opt.ride);
  const stop = BUS_STOPS[to];
  s.mapId = 'campus';
  s.x = stop.x; s.y = stop.y;
  completeBucket(s, 'wolfline', events);
  logEvent(s, `Rode the Wolfline to ${stop.name}`);
  return { ok: true, msg: `Waited ${opt.wait} min, rode ${opt.ride} min to ${stop.name}.`, events };
}

// ---------------------------------------------------------------- conversations

export function agentHere(s: GameState, id: string): { pos: Pt; activity: string; endsAt: number } | null {
  const where = agentWhere(AGENT_BY_ID[id], s.day, s.minute);
  if (!where || where.entry.mapId !== s.mapId || !where.entry.spot) return null;
  const pos = MAPS[s.mapId].spots[where.entry.spot];
  return pos ? { pos, activity: where.entry.activity, endsAt: where.endsAt } : null;
}

export function talkCheck(s: GameState, id: string): string | null {
  const def = AGENT_BY_ID[id];
  const first = def.name.split(' ')[0];
  const here = agentHere(s, id);
  if (!here) return `${first} isn't here.`;
  if (s.agents[id].battery <= 0) return def.tired[0];
  if (s.energy < 5) return 'You are too exhausted to hold a conversation.';
  if (here.endsAt - s.minute < EXCHANGE_MIN) return `${first} is heading out.`;
  return null;
}

export function startConversation(s: GameState, id: string) {
  const a = s.agents[id];
  if (!a.met) { a.met = true; logEvent(s, `Met ${AGENT_BY_ID[id].name}`); }
  else if (a.talkedToday === 0) logEvent(s, `Talked with ${AGENT_BY_ID[id].name}`);
}

/** Each exchange costs five minutes and one point of the agent's social battery. */
export function spendExchange(s: GameState, id: string): Ev[] {
  const evs = advance(s, EXCHANGE_MIN);
  s.agents[id].battery = Math.max(0, s.agents[id].battery - 1);
  s.agents[id].talkedToday++;
  return evs;
}

export interface Allowed { actions: string[]; argsFor: Record<string, string[]> }

export function allowedActions(s: GameState, id: string): Allowed {
  const def = AGENT_BY_ID[id];
  const a = s.agents[id];
  const actions = ['none', 'end_conversation'];
  const argsFor: Record<string, string[]> = {};
  const invites = def.invites.filter((inv) => inviteOfferable(s, inv)).map((i) => i.id);
  if (invites.length) { actions.push('invite'); argsFor.invite = invites; }
  const facts = def.facts.filter((f) => !a.shared.includes(f.id)).map((f) => f.id);
  if (facts.length) { actions.push('share_info'); argsFor.share_info = facts; }
  if (def.gift && a.giftDay !== s.day) { actions.push('give'); argsFor.give = [def.gift.id]; }
  return { actions, argsFor };
}

export interface AgentTurn {
  say: string;
  action: string;
  action_arg: string;
  relationship_delta: number;
  replies: string[];
  memory: string;
}

export interface Applied { notes: string[]; inviteId?: string; end: boolean }

/** Applies a validated agent turn. The engine decides what each action is worth. */
export function applyAgentTurn(s: GameState, id: string, turn: AgentTurn): Applied {
  const def = AGENT_BY_ID[id];
  const a = s.agents[id];
  const allowed = allowedActions(s, id);
  const out: Applied = { notes: [], end: turn.action === 'end_conversation' };
  let d = clamp(Math.round(turn.relationship_delta), -3, 3);
  if (d > 0 && s.setup.traits.charisma >= 7) d += 1;
  changeRel(s, id, d);
  if (turn.memory) addMemory(s, id, turn.memory, 4);

  const arg = turn.action_arg;
  if (!allowed.actions.includes(turn.action) || (allowed.argsFor[turn.action] && !allowed.argsFor[turn.action].includes(arg))) {
    return out;
  }
  if (turn.action === 'invite') {
    const inv = def.invites.find((i) => i.id === arg)!;
    s.invites[arg].status = 'pending';
    out.inviteId = arg;
    out.notes.push(`${def.name.split(' ')[0]} invited you: ${inv.label}, ${fmtTime(inv.from)}.`);
  } else if (turn.action === 'share_info') {
    const fact = def.facts.find((f) => f.id === arg)!;
    a.shared.push(arg);
    s.notes.push(`${def.name.split(' ')[0]}: ${fact.text}`);
    out.notes.push('Saved to Notes on your phone.');
  } else if (turn.action === 'give' && def.gift) {
    a.giftDay = s.day;
    s.energy = clamp(s.energy + def.gift.energy, 0, 100);
    s.hunger = clamp(s.hunger + def.gift.hunger, 0, 100);
    s.stress = clamp(s.stress + def.gift.stress, 0, 100);
    out.notes.push(`${def.name.split(' ')[0]} gave you ${def.gift.label}.`);
  }
  return out;
}

export function respondInvite(s: GameState, inviteId: string, accept: boolean): string {
  const st = s.invites[inviteId];
  const inv = ALL_INVITES.find((i) => i.id === inviteId)!;
  const owner = INVITE_OWNER[inviteId];
  if (st.status !== 'pending') return 'That invitation is no longer open.';
  st.status = accept ? 'accepted' : 'declined';
  changeRel(s, owner, accept ? 1 : -1);
  addMemory(s, owner, accept ? `The player said yes to ${inv.label}.` : `The player said no to ${inv.label}.`, accept ? 5 : 4);
  logEvent(s, `${accept ? 'Said yes to' : 'Turned down'}: ${inv.label}`);
  return accept ? `You said yes: ${inv.label} at ${fmtTime(inv.from)}.` : `You turned down ${inv.label}.`;
}

// ---------------------------------------------------------------- night

export interface Reflection { summary: string; importance: number; note: string; goal: string; text: string }

export function applyReflection(s: GameState, id: string, r: Reflection) {
  const a = s.agents[id];
  const today = a.memories.filter((m) => m.day === s.day);
  a.memories = a.memories.filter((m) => m.day !== s.day || m.importance >= 7);
  if (r.summary && today.length) a.memories.push({ day: s.day, minute: DAY_END, text: r.summary.slice(0, 300), importance: clamp(Math.round(r.importance), 1, 10) });
  if (r.note) a.note = r.note.slice(0, 160);
  if (r.goal) a.goal = r.goal.slice(0, 200);
  if (r.text) s.texts.push({ from: id, day: s.day + 1, minute: WAKE, body: r.text.slice(0, 280), read: false });
}

export function hoursOfSleep(s: GameState): number {
  return Math.round(((1440 + WAKE - s.minute) / 60) * 10) / 10;
}

export function sleep(s: GameState, passedOut = false): { hours: number } {
  const hours = hoursOfSleep(s);
  if (hours >= 6) {
    s.energy = clamp(40 + hours * 8, 0, 100);
    s.stress = clamp(s.stress - hours * 2, 0, 100);
  } else {
    s.energy = clamp(30 + hours * 6, 0, 100);
    s.stress = clamp(s.stress + 8, 0, 100);
  }
  if (passedOut) { s.energy = clamp(s.energy - 10, 0, 100); s.stress = clamp(s.stress + 10, 0, 100); }
  s.hunger = clamp(s.hunger + hours * 2, 0, 100);
  logEvent(s, passedOut ? `Crashed at 2 AM (${hours} hours of sleep)` : `Slept ${hours} hours`);
  for (const id of Object.keys(s.agents)) {
    const def = AGENT_BY_ID[id];
    s.agents[id].battery = def.battery;
    s.agents[id].talkedToday = 0;
    if (def.tier === 'supporting') s.agents[id].goal = def.dayGoals[Math.min(s.day, def.dayGoals.length - 1)];
  }
  s.day++;
  s.minute = WAKE;
  s.walkFrac = 0;
  s.mapId = 'campus';
  s.x = MAPS.campus.spawn.x; s.y = MAPS.campus.spawn.y;
  if (s.day > DAYS) s.ended = true;
  return { hours };
}

// ---------------------------------------------------------------- phone

export interface Upcoming { minute: number; label: string; where: string; status?: string }

export function upcoming(s: GameState): Upcoming[] {
  const out: Upcoming[] = [];
  const c = PLAYER_CLASS;
  if (c.days.includes(s.day)) {
    out.push({
      minute: c.from, label: s.day === c.quizDay ? `${c.name} (QUIZ)` : c.name, where: c.building,
      status: s.classAttended[s.day] ? 'attended' : s.minute > c.from + 20 ? 'missed' : undefined,
    });
  }
  for (const inv of ALL_INVITES) {
    const st = s.invites[inv.id].status;
    if (inv.day !== s.day || st === 'unoffered') continue;
    out.push({ minute: inv.from, label: inv.label, where: MAPS[inv.mapId].name, status: st });
  }
  return out.sort((a, b) => a.minute - b.minute);
}

export function nextEventMinute(s: GameState): number | null {
  const times = upcoming(s)
    .filter((u) => !u.status || u.status === 'pending' || u.status === 'accepted')
    .map((u) => u.minute - 10)
    .filter((m) => m > s.minute);
  return times.length ? Math.min(...times) : null;
}
