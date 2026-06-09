# CineVerse Frontend

Vercel-hosted frontend for the CineVerse / SceneVerse AI hackathon demo.

The frontend owns the viewer surface from the MVP architecture diagram:

- cinematic video player
- voice-first prompt surface
- pause and timestamp handling
- frame capture for scene generation
- caption/chat UI
- agent trace display
- fallback demo state while the AWS backend is still being built

By default, the frontend calls `/backend`, and Vercel rewrites that path to the deployed AWS FastAPI backend. For local backend testing, override `VITE_SCENEVERSE_API_BASE_URL`.
Local Vite dev also proxies `/backend` to the deployed backend through `vite.config.ts`.

## Run locally

```bash
npm install
npm run dev
```

Restart `npm run dev` after changing `vite.config.ts`; Vite does not apply proxy config edits to an already-running dev server.

## Backend contract

```text
POST /api/scenes/analyze
  frame, timestamp, transcriptSegment, videoMetadata
  -> sceneId, sceneSummary, characters, memorySummary, agentTrace

POST /api/chat
  sceneId, message, targetAgentId, playback
  -> intent, respondingAgent, response, updatedMemorySummary, agentTrace
```

Set the backend URL in Vercel or local env:

```bash
VITE_SCENEVERSE_API_BASE_URL=/backend
```

Current Vercel rewrite target:

```text
http://18.207.53.115
```

## Build

```bash
npm run build
```
