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
  explicitTargetAgentId?: string;
  action?: ChatResponse["action"];
  actionSeconds?: number;
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
  defaultSeconds?: number;
  response: (seconds?: number) => string;
  detail: (seconds?: number) => string;
}> = [
  {
    action: "pause",
    pattern: /\b(pause|hold|stop the video|stop video)\b/i,
    response: () => "Paused.",
    detail: () => "pause video",
  },
  {
    action: "play",
    pattern: /\b(play|continue|resume|start the video|start video|play the scene|play scene)\b/i,
    response: () => "Playing.",
    detail: () => "play video",
  },
  {
    action: "rewind",
    pattern: /\b(rewind|go back|back|skip back)\b/i,
    defaultSeconds: 10,
    response: (seconds = 10) => `Rewinding ${seconds} seconds.`,
    detail: (seconds = 10) => `rewind ${seconds} seconds`,
  },
  {
    action: "forward",
    pattern: /\b(fast forward|skip ahead|forward|next|jump ahead)\b/i,
    defaultSeconds: 20,
    response: (seconds = 20) => `Skipping ahead ${seconds} seconds.`,
    detail: (seconds = 20) => `fast forward ${seconds} seconds`,
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
    const nameTokens = name
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 2 && !["the", "and"].includes(part));
    return (
      new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(text) ||
      nameTokens.some((part) => new RegExp(`\\b${escapeRegExp(part)}\\b`, "i").test(text)) ||
      text.includes(role)
    );
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

const numberWords: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
};

function parseSpokenDurationSeconds(text: string, fallbackSeconds?: number) {
  const numericMatch = text.match(/\b(\d{1,3})\s*(second|seconds|sec|secs|s|minute|minutes|min|mins|m)?\b/i);
  if (numericMatch) {
    const amount = Number(numericMatch[1]);
    const unit = numericMatch[2]?.toLowerCase() ?? "seconds";
    return unit.startsWith("m") ? amount * 60 : amount;
  }

  const wordPattern = Object.keys(numberWords).join("|");
  const wordMatch = text.match(new RegExp(`\\b(${wordPattern})(?:\\s+(second|seconds|sec|secs|minute|minutes|min|mins))?\\b`, "i"));
  if (wordMatch) {
    const amount = numberWords[wordMatch[1].toLowerCase()];
    const unit = wordMatch[2]?.toLowerCase() ?? "seconds";
    return unit.startsWith("m") ? amount * 60 : amount;
  }

  return fallbackSeconds;
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
    const actionSeconds = parseSpokenDurationSeconds(text, videoCommand.defaultSeconds);
    return {
      kind: "video_control",
      intent: "video_control",
      action: videoCommand.action,
      actionSeconds,
      response: videoCommand.response(actionSeconds),
      tool: { label: "Router: video command", detail: videoCommand.detail(actionSeconds) },
      agentTrace: trace(`routed to video tool: ${videoCommand.detail(actionSeconds)}`),
    };
  }

  if (
    mode === "watching" &&
    (/\b(step into|enter|generate|open|create).*\b(scene|vera|moment)\b/i.test(text) ||
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
      explicitTargetAgentId: mentionedAgent.id,
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
