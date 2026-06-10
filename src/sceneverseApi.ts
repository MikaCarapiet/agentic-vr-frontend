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
    description?: string;
    source: string;
    sourceLabel?: string;
    sourceKind?: string;
    agents?: string[];
    thumbnailUrl?: string;
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
  targetAgentName?: string;
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
  thumbnailUrl: string | null;
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
  thumbnailUrl?: string;
  sourceType: "youtube" | "external_url";
};

export type UpdateVideoPayload = {
  title?: string | null;
  description?: string | null;
  thumbnailUrl?: string | null;
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
const researchTimeoutMs = 45000;

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

async function postJsonOrThrow<TResponse>(
  path: string,
  payload: unknown,
  timeoutMs = apiTimeoutMs,
): Promise<TResponse> {
  if (!apiBaseUrl) throw new Error("SceneVerse API base URL is not configured.");

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
      const detail = await readErrorDetail(response);
      logAppEvent({
        category: "api",
        label: `POST ${path}`,
        detail,
        status: "error",
      });
      throw new Error(detail);
    }

    logAppEvent({
      category: "api",
      label: `POST ${path}`,
      detail: "response received",
      status: "done",
    });
    return (await response.json()) as TResponse;
  } catch (error) {
    const detail =
      error instanceof DOMException && error.name === "AbortError"
        ? "request timed out"
        : error instanceof Error
          ? error.message
          : "request failed";
    logVeraDebug("api error", {
      path,
      name: error instanceof Error ? error.name : "unknown",
      message: detail,
    });
    logAppEvent({
      category: "api",
      label: `POST ${path}`,
      detail,
      status: "error",
    });
    throw error instanceof Error ? error : new Error(detail);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function readErrorDetail(response: Response) {
  const fallback = `HTTP ${response.status}`;
  try {
    const payload = await response.json();
    const detail = payload?.detail;
    if (typeof detail === "string" && detail.trim()) return detail.trim();
    return JSON.stringify(payload);
  } catch {
    try {
      const text = await response.text();
      return text.trim() || fallback;
    } catch {
      return fallback;
    }
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

export async function downloadVideo(videoId: string): Promise<VideoAsset | null> {
  return postJson<VideoAsset>(`/api/admin/videos/${encodeURIComponent(videoId)}/download`, {}, 300_000);
}

export async function prepareVideoDownload(videoId: string): Promise<VideoAsset> {
  return postJsonOrThrow<VideoAsset>(`/api/admin/videos/${encodeURIComponent(videoId)}/download`, {}, 300_000);
}

export async function uploadVideo(
  file: File,
  title?: string,
  description?: string,
  thumbnailUrl?: string,
  thumbnailFile?: File | null,
): Promise<VideoAsset | null> {
  if (!apiBaseUrl) return null;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 60000);
  const formData = new FormData();
  formData.append("file", file);
  if (title?.trim()) formData.append("title", title.trim());
  if (description?.trim()) formData.append("description", description.trim());
  if (thumbnailUrl?.trim()) formData.append("thumbnailUrl", thumbnailUrl.trim());
  if (thumbnailFile) formData.append("thumbnailFile", thumbnailFile);
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

export async function uploadVideoThumbnail(videoId: string, file: File): Promise<VideoAsset | null> {
  if (!apiBaseUrl) return null;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 60000);
  const formData = new FormData();
  formData.append("file", file);
  const path = `/api/admin/videos/${encodeURIComponent(videoId)}/thumbnail`;
  const url = `${apiBaseUrl}${path}`;

  try {
    logVeraDebug("api request", { path, url, timeoutMs: 60000 });
    logAppEvent({
      category: "api",
      label: `POST ${path}`,
      detail: "thumbnail upload started",
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
      detail: "thumbnail upload complete",
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
      detail: error instanceof DOMException && error.name === "AbortError" ? "request timed out" : "request failed",
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

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "scene-agent";
}

function looksLikeCharacterName(value: string) {
  const lowered = value.trim().toLowerCase();
  if (
    [
      "vera",
      "director",
      "scene",
      "agent",
      "scene agent",
      "youtube",
      "official",
      "video",
      "remaster",
      "the",
      "scene",
      "duel",
      "catalogue",
      "linked",
      "reference",
    ].includes(lowered)
  ) {
    return false;
  }
  return /^[A-Z][A-Za-z']+(?:\s+[A-Z][A-Za-z']+)?$/.test(value.trim());
}

function uniqueNames(names: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  names.forEach((name) => {
    const cleaned = name.trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) return;
    seen.add(key);
    unique.push(cleaned);
  });
  return unique;
}

function inferLocalCharacterNames(request: SceneAnalysisRequest) {
  const agentNames = uniqueNames(
    (request.videoMetadata.agents ?? []).filter((name) => looksLikeCharacterName(name)),
  );
  if (agentNames.length >= 2) return agentNames.slice(0, 4);

  const text = [request.videoMetadata.description, request.videoMetadata.title].filter(Boolean).join(" ");
  const names = [...agentNames];
  const parentheticalSubjectPattern = /\b([A-Z][A-Za-z']{2,}(?:\s+[A-Z][A-Za-z']{2,}){0,2})\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = parentheticalSubjectPattern.exec(text)) !== null) {
    const candidate = match[1]?.split(/\s+/).filter(looksLikeCharacterName).slice(0, 2).join(" ");
    if (candidate) names.push(candidate);
  }

  const normalized = text.replace(/[^A-Za-z0-9' ]+/g, " ");
  const tokenPattern = /\b[A-Z][A-Za-z']{2,}\b/g;
  while ((match = tokenPattern.exec(normalized)) !== null) {
    const candidate = match[0];
    if (looksLikeCharacterName(candidate)) names.push(candidate);
  }

  return uniqueNames(names).slice(0, 4);
}

function localFallbackCharacters(request: SceneAnalysisRequest): CharacterAgent[] {
  const names = inferLocalCharacterNames(request);
  const resolvedNames = names.length ? names : ["Scene Guide"];
  const sceneId = `scene-${Math.round(request.timestamp * 1000)}`;

  return resolvedNames.map((name) => ({
    id: `${sceneId}-${slugify(name)}`,
    name,
    role: "character inferred from catalogue metadata",
    emotionalState: "focused on the paused scene",
    personality: "scene-aware, responsive, grounded",
    goals: ["answer from inside the referenced moment", "help the viewer explore scene stakes"],
    knowledgeBoundaries: ["Only knows the catalogue metadata, supplied context, and visible scene cues."],
    speakingStyle: "concise, cinematic, grounded",
  }));
}

function localFallbackSceneAnalysis(request: SceneAnalysisRequest): SceneAnalysisResponse {
  return {
    sceneId: `scene-${Math.round(request.timestamp * 1000)}`,
    sceneSummary: `${request.videoMetadata.title} is opened as an interactive SceneVerse moment. ${request.videoMetadata.description ?? "The viewer can question the scene and branch the next interaction from catalogue context."}`,
    analysisMode: "local-fallback",
    sourceModelId: null,
    source: "local-fallback",
    emotionalTone: "uncertain, exploratory, cinematic",
    objects: ["catalogue frame", "scene setting", "character focus", "source reference"],
    characters: localFallbackCharacters(request),
    memorySummary: `The viewer entered ${request.videoMetadata.title} from the catalogue and can ask scene-grounded follow-ups.`,
    agentTrace: [
      { agent: "Vercel Frontend", step: "paused frame + timestamp prepared", status: "done" },
      { agent: "Local Scene Fallback", step: "metadata-grounded scene initialized", status: "fallback" },
      { agent: "Memory", step: "in-memory scene state initialized", status: "done" },
      { agent: "Orchestrator", step: "agents ready for chat", status: "done" },
    ],
  };
}

function shouldPreferLocalMetadataFallback(
  request: SceneAnalysisRequest,
  backendResponse: BackendSceneAnalysisResponse,
) {
  if (request.frame || backendResponse.analysisMode !== "fallback") return false;
  const localNames = inferLocalCharacterNames(request).map((name) => name.toLowerCase());
  if (localNames.length === 0) return false;

  const backendNames = backendResponse.characters.map((character) => character.name.toLowerCase());
  return !localNames.some((name) => backendNames.some((backendName) => backendName.includes(name) || name.includes(backendName)));
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
      description: request.videoMetadata.description,
      source: request.videoMetadata.source,
      sourceLabel: request.videoMetadata.sourceLabel,
      sourceKind: request.videoMetadata.sourceKind,
      agents: request.videoMetadata.agents,
      thumbnailUrl: request.videoMetadata.thumbnailUrl,
    },
  }, sceneAnalysisTimeoutMs);
  if (backendResponse) {
    if (shouldPreferLocalMetadataFallback(request, backendResponse)) {
      return localFallbackSceneAnalysis(request);
    }

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

  return localFallbackSceneAnalysis(request);
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
    }, researchTimeoutMs);

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
    title: "Scene collectible",
    summary:
      "A placeholder collectible match for this scene. Connect Exa results to ground this in the current movie moment and visible objects.",
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

  if (/(step into|enter|generate|vera|this scene)/.test(text)) {
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
      respondingAgent: "Vera",
      response: "Paused.",
      updatedMemorySummary: "Viewer requested video pause.",
      agentTrace: [...traceBase, { agent: "Video Tool", step: "pause video", status: "done" }],
    };
  }

  if (/(play|continue|resume)/.test(text)) {
    return {
      intent: "video_control",
      action: "play",
      respondingAgent: "Vera",
      response: "Continuing.",
      updatedMemorySummary: "Viewer resumed playback.",
      agentTrace: [...traceBase, { agent: "Video Tool", step: "play video", status: "done" }],
    };
  }

  if (/(rewind|go back|back ten)/.test(text)) {
    return {
      intent: "video_control",
      action: "rewind",
      respondingAgent: "Vera",
      response: "Rewinding 10 seconds.",
      updatedMemorySummary: "Viewer moved backward in the clip.",
      agentTrace: [...traceBase, { agent: "Video Tool", step: "rewind 10 seconds", status: "done" }],
    };
  }

  if (/(fast forward|forward|skip ahead|ahead twenty|next twenty)/.test(text)) {
    return {
      intent: "video_control",
      action: "forward",
      respondingAgent: "Vera",
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

  if (/(yoda|blade|sword|force|feeling|why)/.test(text) && !request.targetAgentName) {
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

  if (request.playback.mode === "in-scene" || request.targetAgentName) {
    const respondingAgent = request.targetAgentName || "Scene Agent";
    const targetAgentId = request.targetAgentId || slugify(respondingAgent);
    return {
      intent: "character_chat",
      respondingAgent,
      targetAgentId,
      response:
        "I can answer from this moment, but only from the scene context we have. Ask me about motive, risk, or what changes next.",
      updatedMemorySummary: `${respondingAgent} answered from the active scene context.`,
      agentTrace: [
        ...traceBase,
        { agent: "Memory", step: "conversation context loaded", status: "done" },
        { agent: `${respondingAgent} Agent`, step: "metadata-grounded fallback response generated", status: "fallback" },
      ],
    };
  }

  return {
    intent: "fallback_clarify",
    respondingAgent: "Vera",
    response:
      "I can pause, rewind, fast forward, step into the scene, answer as a character, explain the scene, or help collect an item from the moment.",
    updatedMemorySummary: "Viewer received available command options.",
    agentTrace: [...traceBase, { agent: "Fallbacks", step: "safe command guidance returned", status: "fallback" }],
  };
}
