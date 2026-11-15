# NCState_Sim_WebGame

A 2D top-down campus life sim prototype. You play a student; the people around you are
LLM agents with schedules, memories and goals. This is Phase 0 of `BUILD_PLAN.md`: a
three-day loop around Talley Student Union.

## Run it

```
npm install
npm run dev     # http://localhost:5173
npm test
```

The game runs in scripted mode with no setup. To give the characters a model, copy
`.env.example` to `.env.local` and set one of:

- `GROQ_API_KEY` — free tier at https://console.groq.com/keys (recommended)
- `OPENROUTER_API_KEY` — free models at https://openrouter.ai/keys
- `LLM_PROVIDER=ollama` — a local model, for development

Restart `npm run dev` after changing `.env.local`. Keys stay in the dev server and never
reach the browser.

## Controls

WASD or arrows to walk, or click a spot. E to talk or use. P for the phone. M for a map
overview. Mouse wheel to zoom. Esc to close panels.

See `CLAUDE.md` for the architecture and the rules for working in this repo.
