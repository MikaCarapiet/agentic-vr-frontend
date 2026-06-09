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

When `VITE_SCENEVERSE_API_BASE_URL` is set, the frontend calls the AWS FastAPI backend. When it is empty, the frontend uses built-in fallback responses with the same response shapes.

## Run locally

```bash
npm install
npm run dev
```

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
VITE_SCENEVERSE_API_BASE_URL=https://your-aws-fastapi-url
```

## Build

```bash
npm run build
```
