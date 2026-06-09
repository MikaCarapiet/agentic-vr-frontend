import type { AgentTrace, AppMode, ChatResponse, Intent } from "./sceneverseApi";

export type RouterAgent = {
  id: string;
  name: string;
  role: string;
};

export type FrontendRouteKind =
  | "video_control"
  | "scene_generation"
  | "scene_exit"
  | "character_chat"
  | "director_question"
  | "commerce_collect"
  | "fallback_clarify";

export type FrontendRoute = {
  kind: FrontendRouteKind;
  intent: Intent;
  targetAgentId?: string;
  action?: ChatResponse["action"];
  objectLabel?: string;
  response?: string;
  tool: {
    label: string;
    detail?: string;
  };
  agentTrace: AgentTrace[];
};

type RouteUtteranceInput = {
  utterance: string;
  mode: AppMode;
  agents: RouterAgent[];
  activeAgentId: string;
  sceneObjects: string[];
};

const videoCommandPatterns: Array<{
  action: ChatResponse["action"];
  pattern: RegExp;
  response: string;
  detail: string;
}> = [
  {
    action: "pause",
    pattern: /\b(pause|hold|stop the video|stop video)\b/i,
    response: "Paused.",
    detail: "pause video",
  },
  {
    action: "play",
    pattern: /\b(play|continue|resume|start the video|start video)\b/i,
    response: "Playing.",
    detail: "play video",
  },
  {
    action: "rewind",
    pattern: /\b(rewind|go back|back 10|back ten)\b/i,
    response: "Rewinding 10 seconds.",
    detail: "rewind 10 seconds",
  },
  {
    action: "forward",
    pattern: /\b(fast forward|skip ahead|forward 20|forward twenty|next 20|next twenty)\b/i,
    response: "Skipping ahead 20 seconds.",
    detail: "fast forward 20 seconds",
  },
];

function trace(step: string, status: AgentTrace["status"] = "done"): AgentTrace[] {
  return [
    { agent: "Frontend Router", step: "speech intent classified", status: "done" },
    { agent: "Frontend Router", step, status },
  ];
}

function normalize(text: string) {
  return text.toLowerCase().replace(/[“”]/g, "\"").replace(/[’]/g, "'");
}

function findMentionedAgent(text: string, agents: RouterAgent[]) {
  return agents.find((agent) => {
    const name = agent.name.toLowerCase();
    const role = agent.role.toLowerCase();
    return new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(text) || text.includes(role);
  });
}

function findMentionedObject(text: string, sceneObjects: string[]) {
  const normalizedObjects = sceneObjects
    .map((object) => object.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  return (
    normalizedObjects.find((object) => {
      const lowered = object.toLowerCase();
      return text.includes(lowered) || lowered.split(/\s+/).some((part) => part.length > 4 && text.includes(part));
    }) ?? null
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function routeUtterance({
  utterance,
  mode,
  agents,
  activeAgentId,
  sceneObjects,
}: RouteUtteranceInput): FrontendRoute {
  const text = normalize(utterance);
  const mentionedAgent = findMentionedAgent(text, agents);
  const mentionedObject = findMentionedObject(text, sceneObjects);
  const director = agents.find((agent) => agent.id === "director");

  const videoCommand = videoCommandPatterns.find((command) => command.pattern.test(text));
  if (videoCommand) {
    return {
      kind: "video_control",
      intent: "video_control",
      action: videoCommand.action,
      response: videoCommand.response,
      tool: { label: "Router: video command", detail: videoCommand.detail },
      agentTrace: trace(`routed to video tool: ${videoCommand.detail}`),
    };
  }

  if (
    mode === "watching" &&
    (/\b(step into|enter|generate|open|create).*\b(scene|ciniverse|moment)\b/i.test(text) ||
      /\bstep into this scene\b/i.test(text))
  ) {
    return {
      kind: "scene_generation",
      intent: "scene_generation",
      tool: { label: "Router: scene command", detail: "capture frame + analyze" },
      agentTrace: trace("routed to scene parser"),
    };
  }

  if (mode === "in-scene" && /\b(exit the scene|leave scene|return to video|return to cinematic|cinematic controls)\b/i.test(text)) {
    return {
      kind: "scene_exit",
      intent: "director_question",
      response: "Returning to cinematic controls.",
      tool: { label: "Router: exit scene", detail: "cinematic controls" },
      agentTrace: trace("routed to scene exit"),
    };
  }

  if (/\b(where can i buy|where can i purchase|where can i find|shop|buy|purchase|replica|collect this|collect|save this)\b/i.test(text)) {
    return {
      kind: "commerce_collect",
      intent: "commerce_collect",
      targetAgentId: director?.id ?? activeAgentId,
      objectLabel: mentionedObject ?? sceneObjects[0] ?? "scene item",
      tool: {
        label: "Router: collect intent",
        detail: mentionedObject ?? "visible scene object",
      },
      agentTrace: trace("routed to commerce + Exa enrichment"),
    };
  }

  if (mentionedAgent && mentionedAgent.id !== "director") {
    return {
      kind: "character_chat",
      intent: "character_chat",
      targetAgentId: mentionedAgent.id,
      objectLabel: mentionedObject ?? undefined,
      tool: { label: "Router: character question", detail: mentionedAgent.name },
      agentTrace: trace(`routed to ${mentionedAgent.name}`),
    };
  }

  if (mentionedAgent?.id === "director" || /\b(what is happening|what does this mean|meaning|symbol|theme|framed|why is this|explain)\b/i.test(text)) {
    return {
      kind: "director_question",
      intent: "director_question",
      targetAgentId: director?.id ?? activeAgentId,
      objectLabel: mentionedObject ?? undefined,
      tool: { label: "Router: director question", detail: mentionedObject ?? "scene context" },
      agentTrace: trace("routed to director"),
    };
  }

  if (mode === "in-scene") {
    const activeAgent = agents.find((agent) => agent.id === activeAgentId);
    return {
      kind: "character_chat",
      intent: "character_chat",
      targetAgentId: activeAgent?.id ?? mentionedAgent?.id ?? director?.id,
      objectLabel: mentionedObject ?? undefined,
      tool: {
        label: "Router: in-scene chat",
        detail: activeAgent?.name ?? "active character",
      },
      agentTrace: trace(`routed to active scene agent: ${activeAgent?.name ?? "Director"}`),
    };
  }

  return {
    kind: "fallback_clarify",
    intent: "fallback_clarify",
    targetAgentId: director?.id ?? activeAgentId,
    tool: { label: "Router: clarify", detail: "no scene route matched" },
    agentTrace: trace("routed to fallback", "fallback"),
  };
}
