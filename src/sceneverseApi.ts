import { logAppEvent } from "./appLogger";
import { logVeraDebug } from "./veraDebug";

export type AppMode = "watching" | "generating" | "in-scene";

export type Intent =
  | "video_control"
  | "scene_generation"
  | "character_chat"
  | "director_question"
  | "commerce_collect"
  | "fallback_clarify";

export type AgentTrace = {
  agent: string;
  step: string;
  status: "queued" | "active" | "done" | "fallback" | "error";
};

export type CharacterAgent = {
  id: string;
  name: string;
  role: string;
  emotionalState?: string;
  personality?: string;
  goals?: string[];
  knowledgeBoundaries?: string[];
  speakingStyle?: string;
};

type BackendTraceStatus = "pending" | "complete" | "fallback" | "error";

type BackendAgentTrace = {
  agent: string;
  step: string;
  status: BackendTraceStatus;
  detail?: string | null;
};

type BackendCharacter = {
  characterId: string;
  sceneId: string;
  name: string;
  role: string;
  personality: string;
  emotionalState: string;
  goals: string[];
  knowledgeBoundaries: string[];
  speakingStyle: string;
};

type BackendSceneAnalysisResponse = {
  sceneId: string;
  sceneSummary: string;
  analysisMode?: "live" | "fallback";
  sourceModelId?: string | null;
  scene: {
    objects: string[];
    emotionalTone: string;
    memorySummary: string;
  };
  characters: BackendCharacter[];
  directorContext: string;
  memorySummary: string;
  agentTrace: BackendAgentTrace[];
};

type BackendChatResponse = {
  respondingAgent: {
    id: string;
    name: string;
    type: "character" | "director" | "research" | "fallback";
  };
  response: string;
  updatedMemorySummary: string;
  agentTrace: BackendAgentTrace[];
};

type BackendCharacterRouterResponse = {
  sceneId: string;
  targetAgent: {
    id: string;
    name: string;
    type: "character";
  };
  reason: string;
  confidence: number;
  agentTrace: BackendAgentTrace[];
};

type BackendResearchResponse = {
  summary: string;
  sources: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
  recommendedContext: string;
};

export type RealtimeTranscriptionToken = {
  value: string;
  expiresAt: number;
  model: string;
  provider: "openai";
  turnDetection: {
    type: "server_vad";
    threshold: number;
    prefixPaddingMs: number;
    silenceDurationMs: number;
  };
};

export type SceneAnalysisRequest = {
  frame: string | null;
  timestamp: number;
  transcriptSegment: string;
  videoMetadata: {
    videoId?: string;
    title: string;
    source: string;
    duration: number;
  };
};

export type SceneAnalysisResponse = {
  sceneId: string;
  sceneSummary: string;
  analysisMode: "live" | "fallback" | "local-fallback";
  sourceModelId?: string | null;
  source: "backend" | "local-fallback";
  emotionalTone: string;
  objects: string[];
  characters: CharacterAgent[];
  memorySummary: string;
  agentTrace: AgentTrace[];
};

export type ChatRequest = {
  sceneId: string | null;
  message: string;
  targetAgentId?: string;
  playback: {
    currentTime: number;
    isPlaying: boolean;
    mode: AppMode;
  };
};

export type CharacterRouteResponse = {
  sceneId: string;
  targetAgentId: string;
  targetAgentName: string;
  reason: string;
  confidence: number;
  agentTrace: AgentTrace[];
};

export type ChatResponse = {
  intent: Intent;
  respondingAgent: string;
  response: string;
  updatedMemorySummary: string;
  agentTrace: AgentTrace[];
  action?: "play" | "pause" | "rewind" | "forward";
  targetAgentId?: string;
  savedMoment?: {
    title: string;
    description: string;
    items: string[];
  };
};

export type CommerceCollectible = {
  title: string;
  summary: string;
  sourceTitle: string;
  sourceUrl: string;
  recommendedContext: string;
};

export type VideoAsset = {
  videoId: string;
  sourceType: "upload" | "youtube" | "external_url";
  title: string | null;
  description: string | null;
  originalUrl: string | null;
  originalFilename: string | null;
  storageBackend: string | null;
  storageKey: string | null;
  playbackUrl: string | null;
  contentType: string | null;
  fileSizeBytes: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type VideoListResponse = {
  items: VideoAsset[];
  limit: number;
  offset: number;
  rowCount: number;
};

export type DatabaseHealthResponse = {
  status: "ok" | "error";
  database: string;
  engine: string;
  environment?: string | null;
  databasePath?: string | null;
  sqliteVersion?: string | null;
  quickCheck?: string | null;
  journalMode?: string | null;
  schemaRevision?: string | null;
  tableCount?: number | null;
};

export type CreateVideoLinkPayload = {
  url: string;
  title?: string;
  description?: string;
  sourceType: "youtube" | "external_url";
};

export type UpdateVideoPayload = {
  title?: string | null;
  description?: string | null;
  status?: string;
};

export type DeleteVideoResponse = {
  deleted: boolean;
  videoId: string;
};

const apiBaseUrl = (import.meta.env.VITE_SCENEVERSE_API_BASE_URL ?? "/backend").replace(/\/$/, "");
const apiTimeoutMs = 2400;
const catalogueReadTimeoutMs = 15000;
const sceneAnalysisTimeoutMs = 45000;
const characterRouterTimeoutMs = 10000;
const characterChatTimeoutMs = 30000;

export function resolveBackendAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  if (!apiBaseUrl) return path;

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${apiBaseUrl}${normalizedPath}`;
}

async function getJson<TResponse>(path: string, timeoutMs = apiTimeoutMs): Promise<TResponse | null> {
  if (!apiBaseUrl) return null;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const url = `${apiBaseUrl}${path}`;

  try {
    logVeraDebug("api request", { path, url, timeoutMs });
    logAppEvent({
      category: "api",
      label: `GET ${path}`,
      detail: "request started",
      status: "active",
    });
    const response = await fetch(url, { signal: controller.signal });
    logVeraDebug("api response", { path, status: response.status, ok: response.ok });

    if (!response.ok) {
      logAppEvent({
        category: "api",
        label: `GET ${path}`,
        detail: `HTTP ${response.status}`,
        status: "fallback",
      });
      return null;
    }
    logAppEvent({
      category: "api",
      label: `GET ${path}`,
      detail: "response received",
      status: "done",
    });
    return (await response.json()) as TResponse;
  } catch (error) {
    logVeraDebug("api error", {
      path,
      name: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : String(error),
    });
    logAppEvent({
      category: "api",
      label: `GET ${path}`,
      detail: error instanceof DOMException && error.name === "AbortError" ? "request timed out" : "request failed",
      status: "fallback",
    });
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function postJson<TResponse>(
  path: string,
  payload: unknown,
  timeoutMs = apiTimeoutMs,
): Promise<TResponse | null> {
  if (!apiBaseUrl) return null;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const url = `${apiBaseUrl}${path}`;

  try {
    logVeraDebug("api request", { path, url, timeoutMs });
    logAppEvent({
      category: "api",
      label: `POST ${path}`,
      detail: "request started",
      status: "active",
    });
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    logVeraDebug("api response", { path, status: response.status, ok: response.ok });

    if (!response.ok) {
      logAppEvent({
        category: "api",
        label: `POST ${path}`,
        detail: `HTTP ${response.status}`,
        status: "fallback",
      });
      return null;
    }
    logAppEvent({
      category: "api",
      label: `POST ${path}`,
      detail: "response received",
      status: "done",
    });
    return (await response.json()) as TResponse;
  } catch (error) {
    logVeraDebug("api error", {
      path,
      name: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : String(error),
    });
    logAppEvent({
      category: "api",
      label: `POST ${path}`,
      detail: error instanceof DOMException && error.name === "AbortError" ? "request timed out" : "request failed",
      status: "fallback",
    });
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function patchJson<TResponse>(
  path: string,
  payload: unknown,
  timeoutMs = apiTimeoutMs,
): Promise<TResponse | null> {
  if (!apiBaseUrl) return null;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const url = `${apiBaseUrl}${path}`;

  try {
    logVeraDebug("api request", { path, url, timeoutMs });
    logAppEvent({
      category: "api",
      label: `PATCH ${path}`,
      detail: "request started",
      status: "active",
    });
    const response = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    logVeraDebug("api response", { path, status: response.status, ok: response.ok });

    if (!response.ok) {
      logAppEvent({
        category: "api",
        label: `PATCH ${path}`,
        detail: `HTTP ${response.status}`,
        status: "fallback",
      });
      return null;
    }
    logAppEvent({
      category: "api",
      label: `PATCH ${path}`,
      detail: "response received",
      status: "done",
    });
    return (await response.json()) as TResponse;
  } catch (error) {
    logVeraDebug("api error", {
      path,
      name: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : String(error),
    });
    logAppEvent({
      category: "api",
      label: `PATCH ${path}`,
      detail: error instanceof DOMException && error.name === "AbortError" ? "request timed out" : "request failed",
      status: "fallback",
    });
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function deleteJson<TResponse>(path: string, timeoutMs = apiTimeoutMs): Promise<TResponse | null> {
  if (!apiBaseUrl) return null;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const url = `${apiBaseUrl}${path}`;

  try {
    logVeraDebug("api request", { path, url, timeoutMs });
    logAppEvent({
      category: "api",
      label: `DELETE ${path}`,
      detail: "request started",
      status: "active",
    });
    const response = await fetch(url, {
      method: "DELETE",
      signal: controller.signal,
    });
    logVeraDebug("api response", { path, status: response.status, ok: response.ok });

    if (!response.ok) {
      logAppEvent({
        category: "api",
        label: `DELETE ${path}`,
        detail: `HTTP ${response.status}`,
        status: "fallback",
      });
      return null;
    }
    logAppEvent({
      category: "api",
      label: `DELETE ${path}`,
      detail: "response received",
      status: "done",
    });
    return (await response.json()) as TResponse;
  } catch (error) {
    logVeraDebug("api error", {
      path,
      name: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : String(error),
    });
    logAppEvent({
      category: "api",
      label: `DELETE ${path}`,
      detail: error instanceof DOMException && error.name === "AbortError" ? "request timed out" : "request failed",
      status: "fallback",
    });
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function createRealtimeTranscriptionToken(): Promise<RealtimeTranscriptionToken | null> {
  return postJson<RealtimeTranscriptionToken>("/api/realtime/transcription-token", {}, 10000);
}

export async function listVideos(limit = 24, offset = 0): Promise<VideoListResponse | null> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return getJson<VideoListResponse>(`/api/videos?${params.toString()}`, catalogueReadTimeoutMs);
}

export async function getDatabaseHealth(): Promise<DatabaseHealthResponse | null> {
  return getJson<DatabaseHealthResponse>("/health/db", catalogueReadTimeoutMs);
}

export async function getVideo(videoId: string): Promise<VideoAsset | null> {
  return getJson<VideoAsset>(`/api/videos/${encodeURIComponent(videoId)}`, 8000);
}

export async function createVideoLink(payload: CreateVideoLinkPayload): Promise<VideoAsset | null> {
  return postJson<VideoAsset>("/api/videos/link", payload, 10000);
}

export async function updateVideo(videoId: string, payload: UpdateVideoPayload): Promise<VideoAsset | null> {
  return patchJson<VideoAsset>(`/api/admin/videos/${encodeURIComponent(videoId)}`, payload, 10000);
}

export async function deleteVideo(videoId: string): Promise<DeleteVideoResponse | null> {
  return deleteJson<DeleteVideoResponse>(`/api/admin/videos/${encodeURIComponent(videoId)}`, 10000);
}

export async function uploadVideo(file: File, title?: string, description?: string): Promise<VideoAsset | null> {
  if (!apiBaseUrl) return null;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 60000);
  const formData = new FormData();
  formData.append("file", file);
  if (title?.trim()) formData.append("title", title.trim());
  if (description?.trim()) formData.append("description", description.trim());
  const path = "/api/videos/upload";
  const url = `${apiBaseUrl}${path}`;

  try {
    logVeraDebug("api request", { path, url, timeoutMs: 60000 });
    logAppEvent({
      category: "api",
      label: `POST ${path}`,
      detail: "upload started",
      status: "active",
    });
    const response = await fetch(url, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    logVeraDebug("api response", { path, status: response.status, ok: response.ok });

    if (!response.ok) {
      logAppEvent({
        category: "api",
        label: `POST ${path}`,
        detail: `HTTP ${response.status}`,
        status: "fallback",
      });
      return null;
    }
    logAppEvent({
      category: "api",
      label: `POST ${path}`,
      detail: "upload complete",
      status: "done",
    });
    return (await response.json()) as VideoAsset;
  } catch (error) {
    logVeraDebug("api error", {
      path,
      name: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : String(error),
    });
    logAppEvent({
      category: "api",
      label: `POST ${path}`,
      detail: error instanceof DOMException && error.name === "AbortError" ? "upload timed out" : "upload failed",
      status: "fallback",
    });
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function normalizeTrace(trace: BackendAgentTrace[]): AgentTrace[] {
  return trace.map((step) => ({
    agent: step.agent,
    step: step.step,
    status:
      step.status === "complete"
        ? "done"
        : step.status === "pending"
          ? "queued"
          : step.status,
  }));
}

function normalizeCharacter(character: BackendCharacter): CharacterAgent {
  return {
    id: character.characterId,
    name: character.name,
    role: character.role,
    emotionalState: character.emotionalState,
    personality: character.personality,
    goals: character.goals,
    knowledgeBoundaries: character.knowledgeBoundaries,
    speakingStyle: character.speakingStyle,
  };
}

function inferIntentFromResponse(request: ChatRequest, response: BackendChatResponse): Intent {
  const text = request.message.toLowerCase();
  const agentType = response.respondingAgent.type;

  if (/(where can i buy|where can i purchase|where can i find|shop|collect|save|replica|poster|scene card|buy.*item|buy.*lightsaber)/.test(text)) {
    return "commerce_collect";
  }

  if (agentType === "director" || /(director|meaning|symbol|cinematic|story|theme|why)/.test(text)) {
    return "director_question";
  }

  if (agentType === "character") {
    return "character_chat";
  }

  return "fallback_clarify";
}

export async function analyzeScene(
  request: SceneAnalysisRequest,
): Promise<SceneAnalysisResponse> {
  const backendResponse = await postJson<BackendSceneAnalysisResponse>("/api/scenes/analyze", {
    frame: request.frame,
    timestamp: request.timestamp,
    transcriptSegment: request.transcriptSegment,
    videoMetadata: {
      videoId: request.videoMetadata.videoId,
      title: request.videoMetadata.title,
      source: request.videoMetadata.source,
    },
  }, sceneAnalysisTimeoutMs);
  if (backendResponse) {
    return {
      sceneId: backendResponse.sceneId,
      sceneSummary: backendResponse.sceneSummary,
      analysisMode: backendResponse.analysisMode ?? "live",
      sourceModelId: backendResponse.sourceModelId ?? null,
      source: "backend",
      emotionalTone: backendResponse.scene.emotionalTone,
      objects: backendResponse.scene.objects,
      characters: backendResponse.characters.map(normalizeCharacter),
      memorySummary: backendResponse.memorySummary,
      agentTrace: normalizeTrace(backendResponse.agentTrace),
    };
  }

  return {
    sceneId: `scene-${Math.round(request.timestamp * 1000)}`,
    sceneSummary:
      "A mist-covered duel pauses at the moment two opposing forces face each other across the forest.",
    analysisMode: "local-fallback",
    sourceModelId: null,
    source: "local-fallback",
    emotionalTone: "ancient tension, restraint, threat",
    objects: ["green blade", "masked armor", "mist", "forest crossing"],
    characters: [
      {
        id: "mentor",
        name: "Yoda",
        role: "mentor",
        emotionalState: "calm but burdened",
        personality: "patient, cryptic, disciplined",
        goals: ["understand the threat", "protect balance"],
        knowledgeBoundaries: ["Only knows what can be inferred from this paused scene."],
        speakingStyle: "short, reflective, indirect",
      },
      {
        id: "shadow",
        name: "Vader",
        role: "antagonist",
        emotionalState: "controlled fury",
        personality: "dominant, severe, wounded",
        goals: ["force submission", "test the opponent's resolve"],
        knowledgeBoundaries: ["Only knows what can be inferred from this paused scene."],
        speakingStyle: "terse, imposing, absolute",
      },
      {
        id: "director",
        name: "Director",
        role: "story lens",
        emotionalState: "observant",
        personality: "analytical, cinematic, continuity-focused",
        goals: ["explain scene meaning", "maintain story consistency"],
        knowledgeBoundaries: ["Can use scene metadata and public context when routed by the orchestrator."],
        speakingStyle: "clear, interpretive, concise",
      },
    ],
    memorySummary:
      "The viewer has entered a duel scene where Vader challenges Yoda's restraint and the blade functions as a symbol of choice.",
    agentTrace: [
      { agent: "Vercel Frontend", step: "paused frame + timestamp prepared", status: "done" },
      { agent: "Local Scene Fallback", step: "backend analysis unavailable after extended wait", status: "fallback" },
      { agent: "Memory", step: "in-memory scene state initialized", status: "done" },
      { agent: "Orchestrator", step: "agents ready for chat", status: "done" },
    ],
  };
}

export async function sendChat(request: ChatRequest): Promise<ChatResponse> {
  if (request.sceneId) {
    const backendResponse = await postJson<BackendChatResponse>("/api/chat", {
      sceneId: request.sceneId,
      message: request.message,
      targetAgentId: request.targetAgentId,
    }, characterChatTimeoutMs);
    if (backendResponse) {
      return {
        intent: inferIntentFromResponse(request, backendResponse),
        respondingAgent: backendResponse.respondingAgent.name,
        response: backendResponse.response,
        updatedMemorySummary: backendResponse.updatedMemorySummary,
        agentTrace: normalizeTrace(backendResponse.agentTrace),
        targetAgentId: backendResponse.respondingAgent.id,
      };
    }
  }

  return mockChat(request);
}

export async function routeCharacter(
  sceneId: string | null,
  message: string,
  targetAgentId?: string,
): Promise<CharacterRouteResponse | null> {
  if (!sceneId) return null;

  const backendResponse = await postJson<BackendCharacterRouterResponse>("/api/character/router", {
    sceneId,
    message,
    targetAgentId,
  }, characterRouterTimeoutMs);
  if (!backendResponse) return null;

  return {
    sceneId: backendResponse.sceneId,
    targetAgentId: backendResponse.targetAgent.id,
    targetAgentName: backendResponse.targetAgent.name,
    reason: backendResponse.reason,
    confidence: backendResponse.confidence,
    agentTrace: normalizeTrace(backendResponse.agentTrace),
  };
}

export async function sendCharacterChat(request: ChatRequest): Promise<ChatResponse> {
  if (request.sceneId) {
    const backendResponse = await postJson<BackendChatResponse>("/api/character/chat", {
      sceneId: request.sceneId,
      message: request.message,
      characterId: request.targetAgentId,
    }, characterChatTimeoutMs);
    if (backendResponse) {
      return {
        intent: "character_chat",
        respondingAgent: backendResponse.respondingAgent.name,
        response: backendResponse.response,
        updatedMemorySummary: backendResponse.updatedMemorySummary,
        agentTrace: normalizeTrace(backendResponse.agentTrace),
        targetAgentId: backendResponse.respondingAgent.id,
      };
    }
  }

  return mockChat(request);
}

export async function findCollectible(
  sceneId: string | null,
  query: string,
): Promise<CommerceCollectible> {
  if (sceneId) {
    const backendResponse = await postJson<BackendResearchResponse>("/api/research", {
      sceneId,
      query,
    });

    if (backendResponse) {
      const primarySource = backendResponse.sources[0];
      return {
        title: primarySource?.title ?? "Scene collectible",
        summary: backendResponse.summary,
        sourceTitle: primarySource?.title ?? "Exa research result",
        sourceUrl: primarySource?.url ?? "#",
        recommendedContext: backendResponse.recommendedContext,
      };
    }
  }

  return {
    title: "Green lightsaber replica",
    summary:
      "A researched collectible match for the scene: a green-blade saber hilt inspired by Yoda's defensive, mentor-like role.",
    sourceTitle: "Exa fallback preview",
    sourceUrl: "#",
    recommendedContext: "Use the Exa research source here once the backend research route is reachable.",
  };
}

function mockChat(request: ChatRequest): ChatResponse {
  const text = request.message.toLowerCase();
  const traceBase: AgentTrace[] = [
    { agent: "Vercel Frontend", step: "message + playback state sent", status: "done" },
    { agent: "Orchestrator", step: "intent classified", status: "done" },
  ];

  if (/(step into|enter|generate|ciniverse|sceneverse|this scene)/.test(text)) {
    return {
      intent: "scene_generation",
      respondingAgent: "Orchestrator",
      response: "Stepping into this moment.",
      updatedMemorySummary: "Viewer requested scene generation from the current paused frame.",
      agentTrace: [
        ...traceBase,
        { agent: "Video Tool", step: "pause current frame", status: "done" },
        { agent: "Scene Parser", step: "scene analysis requested", status: "active" },
      ],
    };
  }

  if (/(pause|stop|hold)/.test(text)) {
    return {
      intent: "video_control",
      action: "pause",
      respondingAgent: "CineVerse",
      response: "Paused.",
      updatedMemorySummary: "Viewer requested video pause.",
      agentTrace: [...traceBase, { agent: "Video Tool", step: "pause video", status: "done" }],
    };
  }

  if (/(play|continue|resume)/.test(text)) {
    return {
      intent: "video_control",
      action: "play",
      respondingAgent: "CineVerse",
      response: "Continuing.",
      updatedMemorySummary: "Viewer resumed playback.",
      agentTrace: [...traceBase, { agent: "Video Tool", step: "play video", status: "done" }],
    };
  }

  if (/(rewind|go back|back ten)/.test(text)) {
    return {
      intent: "video_control",
      action: "rewind",
      respondingAgent: "CineVerse",
      response: "Rewinding 10 seconds.",
      updatedMemorySummary: "Viewer moved backward in the clip.",
      agentTrace: [...traceBase, { agent: "Video Tool", step: "rewind 10 seconds", status: "done" }],
    };
  }

  if (/(fast forward|forward|skip ahead|ahead twenty|next twenty)/.test(text)) {
    return {
      intent: "video_control",
      action: "forward",
      respondingAgent: "CineVerse",
      response: "Skipping ahead 20 seconds.",
      updatedMemorySummary: "Viewer moved forward in the clip.",
      agentTrace: [...traceBase, { agent: "Video Tool", step: "fast forward 20 seconds", status: "done" }],
    };
  }

  if (/(where can i buy|where can i purchase|where can i find|shop|buy that lightsaber|buy.*hilt|buy.*replica|buy.*blade)/.test(text)) {
    return {
      intent: "commerce_collect",
      respondingAgent: "Director",
      targetAgentId: "director",
      response:
        "The replica kit is available in the scene shop: a saber hilt, duel poster, and scene card are available after this moment ends.",
      updatedMemorySummary: "Viewer asked where the lightsaber replica can be purchased.",
      agentTrace: [
        ...traceBase,
        { agent: "Commerce Tool", step: "commerce catalog requested", status: "done" },
        { agent: "Memory", step: "commerce intent stored", status: "done" },
      ],
    };
  }

  if (/(collect|save|replica|poster|item|scene card)/.test(text)) {
    return {
      intent: "commerce_collect",
      respondingAgent: "Director",
      targetAgentId: "director",
      response:
        "Moment saved. The duel can unlock a limited scene card, replica hilt, and poster after the clip.",
      updatedMemorySummary: "Viewer saved the duel moment for checkout.",
      savedMoment: {
        title: "Duel in the mist",
        description: "Scene card, replica hilt, and poster saved for checkout.",
        items: ["Scene card", "Replica hilt", "Poster"],
      },
      agentTrace: [
        ...traceBase,
        { agent: "Commerce Tool", step: "save moment", status: "done" },
        { agent: "Memory", step: "collect intent stored", status: "done" },
      ],
    };
  }

  if (/(yoda.?s lightsaber|yoda.*lightsaber|why is.*lightsaber green|why.*green lightsaber)/.test(text)) {
    return {
      intent: "director_question",
      respondingAgent: "Director",
      targetAgentId: "director",
      response:
        "Yoda’s saber carries a green tone from his deep connection to equilibrium and defense; green in this language means control, balance, and restraint.",
      updatedMemorySummary: "Director explained the meaning of Yoda’s green lightsaber.",
      agentTrace: [
        ...traceBase,
        { agent: "Memory", step: "scene state loaded", status: "done" },
        { agent: "Director Agent", step: "symbolism answer generated", status: "done" },
      ],
    };
  }

  if (/(director|mean|symbol|why is this framed|what does this)/.test(text)) {
    return {
      intent: "director_question",
      respondingAgent: "Director",
      targetAgentId: "director",
      response:
        "This moment is staged as a clash between restraint and domination. The blade is less a weapon than a test of will.",
      updatedMemorySummary: "Director explained the symbolic tension in the duel.",
      agentTrace: [
        ...traceBase,
        { agent: "Memory", step: "scene state loaded", status: "done" },
        { agent: "Director Agent", step: "story-level answer generated", status: "done" },
      ],
    };
  }

  if (/(vader|shadow|dark)/.test(text)) {
    return {
      intent: "character_chat",
      respondingAgent: "Vader",
      targetAgentId: "shadow",
      response: "Power is never offered. It is taken by the one willing to pay its price.",
      updatedMemorySummary: "Vader framed the duel as domination and sacrifice.",
      agentTrace: [
        ...traceBase,
        { agent: "Memory", step: "conversation context loaded", status: "done" },
        { agent: "Vader Agent", step: "in-character response generated", status: "done" },
      ],
    };
  }

  if (/(yoda|blade|sword|force|feeling|why)/.test(text) || request.playback.mode === "in-scene") {
    return {
      intent: "character_chat",
      respondingAgent: "Yoda",
      targetAgentId: "mentor",
      response: "A weapon, the blade is not. A mirror, it becomes. What you bring to it, it reveals.",
      updatedMemorySummary: "Yoda described the blade as a mirror of inner intent.",
      agentTrace: [
        ...traceBase,
        { agent: "Memory", step: "conversation context loaded", status: "done" },
        { agent: "Yoda Agent", step: "in-character response generated", status: "done" },
      ],
    };
  }

  return {
    intent: "fallback_clarify",
    respondingAgent: "CineVerse",
    response:
      "I can pause, rewind, fast forward, step into the scene, explain why Yoda’s lightsaber is green, or tell you where to buy the replica.",
    updatedMemorySummary: "Viewer received available command options.",
    agentTrace: [...traceBase, { agent: "Fallbacks", step: "safe command guidance returned", status: "fallback" }],
  };
}
