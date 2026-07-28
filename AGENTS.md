# AGENTS.md

## Cursor Cloud specific instructions

Kindred Objects (`conversational-object-twins`) is a single npm package: a React 19 + Vite 6 frontend plus an Express 5 API. All persistent data lives in the browser's `localStorage`; there is no database or other external infrastructure to run.

Standard commands are in `README.md` and `package.json` scripts (`dev`, `lint`, `test`, `build`, `start`). Notes that aren't obvious from those:

- `npm run dev` starts BOTH services via `concurrently`: `WEB` (vite) on port `5173` and `API` (`tsx watch server/index.ts`) on port `8787`. Vite proxies `/api` → `http://127.0.0.1:8787`, so always open the app at `http://localhost:5173` (not the API port). It runs in the foreground; use tmux to keep it alive.
- Express routes live in `server/app.ts` (a reusable app, no `listen`/static). `server/index.ts` imports it and adds static serving + `app.listen` for local/Render; the Vercel serverless function `api/[...path].ts` re-exports the same app. Add/modify API routes in `server/app.ts` so both deploy targets stay in sync. `api/` is intentionally outside every `tsconfig` include — Vercel's builder compiles it, so our `tsc` lint does not.
- `OPENROUTER_API_KEY` (in `.env`, copied from `.env.example`) is only used server-side for `POST /api/world/analyze` (World Mode). Without a valid key that endpoint returns `503`. The core product — introducing/enrolling object twins, conversing with them, and recording stateful memory changes — works fully without any API key using the typed/keyboard inputs (enrollment has a "Need to type instead?" fallback; conversation and "Notice change" use text inputs). `GET /api/health` reports `openRouterConfigured: true` whenever `.env` has any non-empty value, so it does not validate the key.
- `/api/world/analyze` picks a model by request: when the client sends a camera frame (`image` data URL) it uses the vision model `OPENROUTER_VISION_MODEL` (default `nvidia/nemotron-nano-12b-v2-vl:free`); with no frame it falls back to the text-only `OPENROUTER_MODEL` (default `openai/gpt-oss-20b:free`, which cannot accept images). Voice input uses the browser Web Speech API (Chrome only; needs a mic + `localhost`/HTTPS); there is no `/api/transcribe` endpoint. Free OpenRouter models are rate-limited and their availability changes (e.g. `gpt-oss-120b:free` was removed), so expect occasional `429`/`404` from the provider.
- `npm run lint` is typecheck only (`tsc -b` + `tsc -p server`). `.oxlintrc.json` exists but oxlint is NOT installed or wired into any script, so there is no runtime linter to run.
- `npm start` (production) requires `npm run build` first and serves the built SPA + API together on port `8787`.
- Camera and microphone features require `localhost` or HTTPS; when testing in the cloud VM browser, use `http://localhost:5173`. State-change phrases must map to a category's supported state fields (e.g. `condition`, `location`, `display`) — unrelated phrases like "the lid is open" for a vase are rejected with a non-fatal banner rather than an error.
- Node 22 works locally even though `render.yaml` pins `NODE_VERSION=20.19.0` for deployment.
