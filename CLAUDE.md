# NC State Campus Life Sim

A 2D top-down browser game. The player is a student; the people around them are LLM
agents with schedules, memories and goals. Time is the scarce resource. See
`BUILD_PLAN.md` for phases and gates.

## Commands

```
npm run dev        # game at http://localhost:5173, with the LLM proxy
npm test           # Vitest: engine rules, map validity, agent schema
npm run typecheck  # tsc --noEmit
npm run build      # typecheck, then a static build in dist/
```

## The one design rule

**Numbers decide, agents narrate.** The rules engine owns time, money, stats,
relationships and invitations. A model only picks one action from a fixed list and
writes the words. Nothing a model returns is applied until `validateTurn` has checked it
and the engine has accepted it.

When adding a feature, put the state change in `src/engine/` and let the agent choose
or describe it. Never let model text set a number directly.

## Layout

```
server/llmProxy.ts     Vite middleware: /api/llm/status, /api/llm/chat. Holds the keys.
src/data/names.ts      Every real proper noun (university, buildings, streets, venues)
src/data/venues.ts     Venues and menus as data rows
src/data/agents.ts     Persona cards, schedules, invitations, scripted lines
src/engine/            Pure TypeScript. No DOM, no Phaser, no model calls.
  types.ts             Tile and map types
  mapBuilder.ts        Code-built tile maps (rooms, booths, counters, portals)
  state.ts             GameState and newGame
  engine.ts            Clock, meters, actions, dialogue rules, invitations, sleep
  schedule.ts          Where each agent is at a given day and minute
  grid.ts              Breadth-first pathfinding
src/maps/              talley.ts (three floors), campus.ts (road plan), index.ts
src/agents/            gateway.ts (client), runtime.ts (prompts), schema.ts, fallback.ts, filter.ts
src/game/              Phaser scene, canvas tile renderer, actors
src/ui/                DOM overlay: HUD, dialogue, phone, menus, character creation
tests/                 Vitest
```

## Rules for working here

- `src/engine/` stays free of DOM, Phaser and network code so it can be tested in Node.
- Real names live only in `src/data/names.ts`. Restaurants on Hillsborough Street use
  invented stand-ins. Every character is fictional; never add a real person.
- API keys go in `.env.local`, read only by `server/llmProxy.ts`. Never import them into
  `src/`, and never commit `.env.local`.
- Every model call has a timeout and a scripted fallback. The game must be fully
  playable with no key set.
- Model calls are async and never block the frame loop.
- Maps are built in code for now. After changing one, run `npm test`: it checks that
  every portal, schedule spot and interactable can be reached on foot.
- Durations and prices are balancing placeholders, not measured figures.

## LLM setup

Copy `.env.example` to `.env.local` and set one provider. Groq's free tier is the
default. The proxy picks a provider in this order: `LLM_PROVIDER` if set, else Groq if
`GROQ_API_KEY` is set, else OpenRouter if `OPENROUTER_API_KEY` is set, else scripted
mode. Two tiers are used: `small` for dialogue, `large` for nightly reflection and the
director. Model names are set per tier in `.env.local`.

## Known gaps

- Talley's interior and the campus road plan are schematic, laid out from memory. They
  are not surveyed. Phase 2 replaces the campus with OpenStreetMap footprints.
- No art assets; everything is drawn on a canvas in `src/game/render.ts`.
- The content filter is a short word list.
