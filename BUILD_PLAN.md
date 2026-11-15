# Build plan

Phased plan for the NC State Campus Life Sim. Each phase ends in a gate: a question that
must be answered "yes" before the next phase starts. The source design is the game
blueprint (Nov 14, 2026); this file is the working version of its "Build plan" section.

Status key: `[x]` done, `[~]` partly done, `[ ]` not started.

## Phase 0 — Playable slice (this prototype)

The blueprint's first step is "Talley, three agents and a three-day loop". The prototype
does that, but with a simple drawn map instead of plain text, because the map of Talley
and the road plan were asked for up front.

- [x] Project scaffold: Vite, TypeScript, Phaser 3, Vitest
- [x] Deterministic rules engine: clock, energy, hunger, stress, money, knowledge
- [x] Talley Student Union, three floors, with venues, booths, lounges, ballrooms and offices
- [x] Schematic road plan of Main Campus: streets, railroad, the three tunnels, building footprints
- [x] Three core agents (roommate, club president, rival) and two supporting agents (barista, info desk)
- [x] Agent parts: persona card, schedule, goals, memory, relationship, knowledge boundary
- [x] Fixed action list, JSON output checked against a schema, scripted fallback
- [x] LLM gateway in the OpenAI chat format: Groq, OpenRouter or local Ollama
- [x] Dev-server proxy so API keys never reach browser code
- [x] Conversations that cost 5 minutes per exchange, with social battery and schedule limits
- [x] Invitations: agents invite, the engine tracks attended and missed
- [x] Phone: schedule, texts, feed, bank, bucket list, time skip
- [x] Three-day loop with nightly agent reflection and a director recap
- [x] Minimal character creation: name, pronouns, six traits, budget preset
- [x] Local save in browser storage
- [x] Token and call counter, to replace the blueprint's 125,000-tokens-per-episode estimate with a measurement

Verified so far: 47 unit tests (map reachability, engine rules, output validation), and a
headless-browser smoke run covering walking, the Talley doors and stairs, a model-written
conversation through local Ollama, the phone and the overnight flow.

**Gate 0:** Is a three-day loop in Talley fun with real model output? Play it five times
with a key set. Write down the measured calls and tokens per episode (phone → System, and
the end screen).

## Phase 1 — Make the agents worth talking to

- [ ] Rumor network: `share_info` moves facts between agents, each deciding whether to pass them on
- [ ] Persuasion with history: extension and shift-swap requests, capped by the engine
- [ ] Group decisions offscreen: a club vote settled by several agents
- [ ] Agent-written texts (now scripted) and agent-initiated favors
- [ ] Importance-scored memory retrieval instead of "last eight memories"
- [ ] Routing thresholds between the small and large model, taken from the LLM Cost Router results
- [ ] Saved-session replay as a regression test for agent behavior
- [ ] Content filter beyond the current word list; decide the age rating first

**Gate 1:** Do characters surprise you without breaking state? Zero invalid actions
applied across 20 recorded sessions.

## Phase 2 — Real map and Central Campus

- [ ] Replace the schematic campus with footprints generated from OpenStreetMap (credit OSM, publish the data file)
- [ ] Tiled editor pipeline for interiors; move Talley from code to Tiled maps
- [ ] Correct Talley against the real floor plans (the current layout is from memory)
- [ ] Residence hall interior with the roommate; one dining hall with meal swipes
- [ ] Wolfline routes 30, 40 and 60 on their real intervals
- [ ] Sprite art: layered character parts, tile set, decide tile size and art style
- [ ] Full character creator: appearance, home, college and major, housing
- [ ] Classes on the registrar's 50- and 75-minute blocks, with exams

**Gate 2:** Does walking the map make the time budget feel real? A new player can find
Talley, a class and their room without help.

## Phase 3 — One semester with a director

- [ ] Director agent with a story bible: character state, open threads, promises, themes
- [ ] Episode shape: recap, hook, free play, closing beat, reflection
- [ ] Fall season: 8 to 10 episodes hung on Convocation, Packapalooza, first home game, midterms, Red and White Week, finals
- [ ] Core cast of 8 to 12, about 40 supporting agents, crowd on schedules
- [ ] D.H. Hill, Hunt Library, the recreation center, three classroom halls as full interiors
- [ ] Clubs, a campus job, rec sports, game days
- [ ] The living Free Expression Tunnel
- [ ] Serverless proxy and static hosting; player-supplied keys

**Gate 3:** Does the story stay coherent over a semester? Replay tests find no
contradictions in the story bible.

## Phase 4 — Release decisions and the rest of college

- [ ] Ask NC State's Office of Strategic Brand Management, or ship under a fictional university name
- [ ] Greek life, student media, career fair, Centennial Campus, game-day venues
- [ ] Seasons two through eight and the graduation epilogue
- [ ] In-browser model option through WebLLM
- [ ] Cloud save

## Open decisions

These come from the blueprint and are still open. The prototype's current choice is noted.

| Decision | Prototype's choice |
| --- | --- |
| Private project or public release | Private; real names kept in one file |
| Free typing or suggested replies | Both |
| Home countries | Not in the prototype |
| Age rating, romance | Not decided; no romance, no parties |
| Art style and tile size | Drawn in code, 32 px tiles, placeholder |
| One semester or a freshman year first | Three days |
