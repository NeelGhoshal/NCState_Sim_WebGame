# NCState_Sim_WebGame

A 2D top-down campus life sim prototype. You play a student; the people around you are
LLM agents with schedules, memories and goals. This is Phase 0 of `BUILD_PLAN.md`: a
three-day loop around Talley Student Union.

The game client is TypeScript (Phaser 3, Vite). The AI side is a Python FastAPI service in
`ai/` that builds prompts, calls open-weight models and validates their output.

## Run it

```
npm install
python -m venv ai/.venv
ai/.venv/Scripts/pip install -r ai/requirements.txt    # bin/pip on macOS/Linux
npm run dev                                            # http://localhost:5173
```

Tests: `npm test` (TypeScript) and `npm run test:ai` (Python).

The game runs in scripted mode with no key. To give the characters a model, copy
`.env.example` to `.env.local` and set one of:

- `GROQ_API_KEY`: free tier at https://console.groq.com/keys (recommended)
- `OPENROUTER_API_KEY`: free models at https://openrouter.ai/keys
- `LLM_PROVIDER=ollama`: a local model, for development

Restart `npm run dev` after changing `.env.local`. Keys stay in the Python service and
never reach the browser.

## Controls

WASD or arrows to walk, or click a spot. E to talk or use. P for the phone. M for a map
overview. Mouse wheel to zoom. Esc to close panels.

See `CLAUDE.md` for the architecture and the rules for working in this repo.
