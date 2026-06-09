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
  status: "queued" | "active" | "done" | "fallback";
};

export type CharacterAgent = {
  id: string;
  name: string;
  role: string;
  emotionalState: string;
};

export type SceneAnalysisRequest = {
  frame: string | null;
  timestamp: number;
  transcriptSegment: string;
  videoMetadata: {
    title: string;
    source: string;
    duration: number;
  };
};

export type SceneAnalysisResponse = {
  sceneId: string;
  sceneSummary: string;
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

const apiBaseUrl = import.meta.env.VITE_SCENEVERSE_API_BASE_URL?.replace(/\/$/, "");

async function postJson<TResponse>(path: string, payload: unknown): Promise<TResponse | null> {
  if (!apiBaseUrl) return null;

  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) return null;
    return (await response.json()) as TResponse;
  } catch {
    return null;
  }
}

export async function analyzeScene(
  request: SceneAnalysisRequest,
): Promise<SceneAnalysisResponse> {
  const backendResponse = await postJson<SceneAnalysisResponse>("/api/scenes/analyze", request);
  if (backendResponse) return backendResponse;

  return {
    sceneId: `scene-${Math.round(request.timestamp * 1000)}`,
    sceneSummary:
      "A mist-covered duel pauses at the moment two opposing forces face each other across the forest.",
    emotionalTone: "ancient tension, restraint, threat",
    objects: ["green blade", "masked armor", "mist", "forest crossing"],
    characters: [
      { id: "mentor", name: "Yoda", role: "mentor", emotionalState: "calm but burdened" },
      { id: "shadow", name: "Vader", role: "antagonist", emotionalState: "controlled fury" },
      { id: "director", name: "Director", role: "story lens", emotionalState: "observant" },
    ],
    memorySummary:
      "The viewer has entered a duel scene where Vader challenges Yoda's restraint and the blade functions as a symbol of choice.",
    agentTrace: [
      { agent: "Vercel Frontend", step: "paused frame + timestamp prepared", status: "done" },
      { agent: "Scene Parser", step: "fallback scene context loaded", status: "fallback" },
      { agent: "Memory", step: "in-memory scene state initialized", status: "done" },
      { agent: "Orchestrator", step: "agents ready for chat", status: "done" },
    ],
  };
}

export async function sendChat(request: ChatRequest): Promise<ChatResponse> {
  const backendResponse = await postJson<ChatResponse>("/api/chat", request);
  if (backendResponse) return backendResponse;

  return mockChat(request);
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

  if (/(collect|save|buy|replica|poster|item)/.test(text)) {
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
    response: "I can pause, rewind, fast forward, step into the scene, or collect this moment.",
    updatedMemorySummary: "Viewer received available command options.",
    agentTrace: [...traceBase, { agent: "Fallbacks", step: "safe command guidance returned", status: "fallback" }],
  };
}
