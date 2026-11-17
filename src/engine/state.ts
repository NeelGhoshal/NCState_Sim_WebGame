import { AGENTS, ALL_INVITES } from '../data/agents';
import { START } from '../maps/index';

export const DAY_START = 6 * 60;   // 6:00 AM
export const DAY_END = 26 * 60;    // 2:00 AM
export const WAKE = 7 * 60 + 30;   // 7:30 AM
export const START_MINUTE = 8 * 60;
export const DAYS = 3;

export const TRAIT_KEYS = ['athletics', 'academics', 'charisma', 'creativity', 'discipline', 'streetSmarts'] as const;
export type TraitKey = (typeof TRAIT_KEYS)[number];
export type Traits = Record<TraitKey, number>;
export const TRAIT_POINTS = 20; // spent on top of a base of 1 each, max 10

export type Budget = 'tight' | 'steady' | 'comfortable';
export const BUDGETS: Record<Budget, { money: number; swipes: number; label: string }> = {
  tight: { money: 60, swipes: 4, label: 'Tight: $60 and 4 meal swipes' },
  steady: { money: 140, swipes: 7, label: 'Steady: $140 and 7 meal swipes' },
  comfortable: { money: 280, swipes: 10, label: 'Comfortable: $280 and 10 meal swipes' },
};

export const PLAYER_CLASS = {
  id: 'ch101', name: 'CH 101: Chemistry', building: 'Dabney Hall',
  from: 10 * 60 + 15, to: 11 * 60 + 5, days: [1, 2, 3], quizDay: 3,
};

export const BUCKET = [
  { id: 'howlingcow', text: 'Eat a scoop of Howling Cow ice cream' },
  { id: 'tunnel', text: 'Paint the Free Expression Tunnel' },
  { id: 'wolfears', text: 'Whisper in the Wolf Ears' },
  { id: 'wolfline', text: 'Ride the Wolfline' },
  { id: 'dining', text: 'Eat at every campus dining hall' },
];

export interface PlayerSetup { name: string; pronouns: string; traits: Traits; budget: Budget }
export interface Memory { day: number; minute: number; text: string; importance: number }
/** A fact a character heard from someone else. `origin` is 'player' when the player started it on its way. */
export interface Heard { from: string; origin: string; day: number; minute: number }
export interface AgentState {
  rel: number; note: string; battery: number; memories: Memory[]; goal: string;
  /** Facts this character has told the player. */
  shared: string[]; giftDay: number; talkedToday: number; met: boolean;
  /** Facts this character heard from others (fact id -> how). Their own facts are not listed. */
  heard: Record<string, Heard>;
}
/** One step of a fact moving between people. 'exposed' means the owner found out the player spread it. */
export interface Rumor { fact: string; from: string; to: string; day: number; minute: number; kind: 'told' | 'exposed' }
export type InviteStatus = 'unoffered' | 'pending' | 'accepted' | 'declined' | 'attended' | 'missed';
export interface InviteState { status: InviteStatus; presentMin: number }
export interface TextMsg { from: string; day: number; minute: number; body: string; read: boolean }
export interface Stamped { day: number; minute: number; text: string }
export interface Txn { day: number; minute: number; label: string; amount: number }
export interface TierUsage { calls: number; promptTokens: number; completionTokens: number }
export interface Usage { calls: number; fallbacks: number; small: TierUsage; large: TierUsage }

export interface GameState {
  version: 1;
  setup: PlayerSetup;
  day: number; minute: number; walkFrac: number;
  mapId: string; x: number; y: number;
  energy: number; hunger: number; stress: number; money: number; swipes: number; knowledge: number;
  quizScore: number | null;
  classAttended: Record<number, boolean>;
  agents: Record<string, AgentState>;
  invites: Record<string, InviteState>;
  texts: TextMsg[];
  feed: Stamped[];
  log: Stamped[];
  txns: Txn[];
  notes: string[];
  /** Fact ids the player has learned, so they can pass them on. */
  knownFacts: string[];
  rumors: Rumor[];
  bucket: Record<string, boolean>;
  flags: Record<string, number>;
  recaps: { day: number; text: string; source: 'llm' | 'fallback' }[];
  usage: Usage;
  ended: boolean;
  epilogue?: { closing: string; characters: Record<string, string>; source: 'llm' | 'fallback' };
}

const tier = (): TierUsage => ({ calls: 0, promptTokens: 0, completionTokens: 0 });

export function newGame(setup: PlayerSetup): GameState {
  const b = BUDGETS[setup.budget];
  return {
    version: 1,
    setup,
    day: 1, minute: START_MINUTE, walkFrac: 0,
    mapId: START.mapId, x: START.x, y: START.y,
    energy: 85, hunger: 30, stress: 20, money: b.money, swipes: b.swipes,
    knowledge: 10 + setup.traits.academics,
    quizScore: null,
    classAttended: {},
    agents: Object.fromEntries(AGENTS.map((a) => [a.id, {
      rel: a.startRel, note: a.startNote, battery: a.battery, memories: [], goal: a.dayGoals[0],
      shared: [], giftDay: 0, talkedToday: 0, met: false, heard: {},
    }])),
    invites: Object.fromEntries(ALL_INVITES.map((i) => [i.id, { status: 'unoffered' as InviteStatus, presentMin: 0 }])),
    texts: [], feed: [], log: [], txns: [], notes: [], knownFacts: [], rumors: [],
    bucket: {}, flags: {}, recaps: [],
    usage: { calls: 0, fallbacks: 0, small: tier(), large: tier() },
    ended: false,
  };
}

export function validTraits(t: Traits): boolean {
  const vals = TRAIT_KEYS.map((k) => t[k]);
  return vals.every((v) => Number.isInteger(v) && v >= 1 && v <= 10) && vals.reduce((a, b) => a + b, 0) <= TRAIT_KEYS.length + TRAIT_POINTS;
}

/** Fills fields added since a save was written, so old saves keep loading. */
export function migrate(s: GameState): GameState {
  s.knownFacts ??= [];
  s.rumors ??= [];
  for (const a of Object.values(s.agents)) a.heard ??= {};
  for (const def of AGENTS) {
    s.agents[def.id] ??= {
      rel: def.startRel, note: def.startNote, battery: def.battery, memories: [], goal: def.dayGoals[0],
      shared: [], giftDay: 0, talkedToday: 0, met: false, heard: {},
    };
  }
  return s;
}
