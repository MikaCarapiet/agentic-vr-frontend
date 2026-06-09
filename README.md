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

The frontend always calls `/backend` by default. The environment decides where `/backend` goes:

| Environment | `/backend` target |
| --- | --- |
| Vercel production | cloud backend through `vercel.json` rewrite |
| Local dev cloud mode | cloud backend through Vite proxy |
| Local dev local mode | local backend through Vite proxy |

This keeps deployed frontend users on the cloud backend while still letting local development switch between cloud and local backend debugging.

## Run locally

```bash
npm install
npm run dev
```

Default local dev uses the cloud backend:

```bash
npm run dev
```

Explicit cloud backend mode:

```bash
npm run dev:cloud
```

Local backend debugging mode:

```bash
npm run dev:local
```

Restart the dev server when switching modes because Vite loads proxy config on startup.

## Backend contract

```text
POST /api/scenes/analyze
  frame, timestamp, transcriptSegment, videoMetadata
  -> sceneId, sceneSummary, characters, memorySummary, agentTrace

POST /api/chat
  sceneId, message, targetAgentId, playback
  -> intent, respondingAgent, response, updatedMemorySummary, agentTrace
```

Frontend API base:

```bash
VITE_SCENEVERSE_API_BASE_URL=/backend
```

For Vercel production, leave this unset or set it to `/backend`. Do not set it to `localhost`.

Current Vercel rewrite target:

```text
http://18.207.53.115
```

## Build

```bash
npm run build
```
