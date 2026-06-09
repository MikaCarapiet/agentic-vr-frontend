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
  emotionalState: string;
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

const apiBaseUrl = (import.meta.env.VITE_SCENEVERSE_API_BASE_URL ?? "/backend").replace(/\/$/, "");

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
      videoId: "demo-duel",
      title: request.videoMetadata.title,
      source: request.videoMetadata.source,
    },
  });
  if (backendResponse) {
    return {
      sceneId: backendResponse.sceneId,
      sceneSummary: backendResponse.sceneSummary,
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
  if (request.sceneId) {
    const backendResponse = await postJson<BackendChatResponse>("/api/chat", {
      sceneId: request.sceneId,
      message: request.message,
      targetAgentId: request.targetAgentId,
    });
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
