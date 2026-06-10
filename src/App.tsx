import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeScene,
  buildCollectiblePlaceholderImage,
  createCheckoutSession,
  createRealtimeTranscriptionToken,
  downloadVideo,
  findCollectible,
  getVideo,
  listVideos,
  prepareVideoDownload,
  routeCharacter,
  sendChat,
  sendCharacterChat,
  synthesizeSpeech,
  type AgentTrace,
  type AppMode,
  type ChatResponse,
  type CommerceCollectible,
  type Intent,
} from "./sceneverseApi";
import { logAppEvent } from "./appLogger";
import {
  isOpenAIRealtimeTranscriptionSupported,
  OpenAIRealtimeTranscriptionInput,
  type VoiceInputController,
} from "./openaiRealtimeTranscription";
import { routeUtterance } from "./sceneRouter";
import { logVeraDebug } from "./veraDebug";
import { getSceneComposition } from "./sceneComposition";
import SceneCompositionCanvas from "./SceneCompositionCanvas";
import type { SceneRegion } from "./sceneVision";
import {
  publishStereoEvent,
  stereoRole,
  subscribeStereoChannel,
  subscribeStereoEvents,
  type StereoEvent,
} from "./stereoSync";
import "./styles.css";
import AdminVideosPage from "./AdminVideosPage";
import Landing from "./Landing";
import LogsPage from "./LogsPage";
import MovieCatalogPage from "./MovieCatalogPage";
import StereoViewer from "./StereoViewer";
import { SceneExperienceProvider, useSceneExperience } from "./sceneExperienceContext";
import {
  buildCatalogVideos,
  catalogVideoFromAsset,
  FALLBACK_CATALOG_VIDEO,
  type CatalogVideo,
} from "./videoCatalog";

type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "error";

type HistoryItem = {
  id?: string;
  speaker: string;
  text: string;
  streaming?: boolean;
};

type FormattedHistorySegment = {
  kind: "speech" | "stage";
  text: string;
};

type ToolEvent = {
  label: string;
  detail?: string;
};

type CommerceCartState = "idle" | "awaiting_confirmation" | "added";

type CartItem = CommerceCollectible & {
  id: string;
  quantity: number;
};

type InSceneCommand = {
  label: string;
  aliases: string[];
  response: string;
  detail: string;
  targetAgentId?: string;
  exitMode?: AppMode;
};

const generationSteps: ToolEvent[] = [
  { label: "Frame captured", detail: "hero moment locked" },
  { label: "Scene Parser", detail: "reading tension" },
  { label: "Agents created", detail: "mentor, shadow, director" },
  { label: "Memory initialized", detail: "scene state ready" },
];

const controlPrompts = [
  "play the video",
  "pause the video",
  "step into this scene",
  "rewind 10 seconds",
  "fast forward 20 seconds",
];

const videoPreparationTimeoutMs = 45_000;

const inSceneNavigationPrompts: InSceneCommand[] = [
  {
    label: "Look left",
    aliases: ["look left", "pan left", "shift left"],
    response: "You drift the scene view slightly left.",
    detail: "Navigation: pan left",
  },
  {
    label: "Look right",
    aliases: ["look right", "pan right", "shift right"],
    response: "You drift the scene view slightly right.",
    detail: "Navigation: pan right",
  },
  {
    label: "Move closer",
    aliases: ["move closer", "step closer", "go forward", "approach"],
    response: "You move a step forward into the haze.",
    detail: "Navigation: move closer",
  },
  {
    label: "Focus Yoda",
    aliases: ["focus yoda", "yoda focus", "talk yoda"],
    targetAgentId: "mentor",
    response: "Audio focus shifts to Yoda. Ask what he sees.",
    detail: "Navigation: focus Yoda",
  },
  {
    label: "Focus Vader",
    aliases: ["focus vader", "vader focus", "talk vader"],
    targetAgentId: "shadow",
    response: "Audio focus shifts to Vader. Ask him for a response.",
    detail: "Navigation: focus Vader",
  },
  {
    label: "Exit the scene",
    aliases: [
      "return to cinematic controls",
      "return",
      "exit the scene",
      "exit",
      "leave scene",
      "cinematic controls",
    ],
    exitMode: "watching",
    response: "Returning to cinematic controls.",
    detail: "Navigation: exited scene",
  },
];

function matchInSceneNavigationCommand(text: string): InSceneCommand | null {
  const normalized = text.toLowerCase().trim();
  return (
    inSceneNavigationPrompts.find((command) =>
      command.aliases.some((alias) => normalized.includes(alias))
    ) ?? null
  );
}

type WakeCommandParse = {
  isWakeInvocation: boolean;
  command: string;
};

function parseWakeCommand(text: string): WakeCommandParse {
  const trimmed = text
    .trim()
    .replace(/[“”]/g, "\"")
    .replace(/[’]/g, "'");
  const match = trimmed.match(
    /^\s*(?:(?:hey|hi|hello|ok(?:ay)?)\s*[,;:!?.-]?\s*)?vera\b[\s,:;!\-?.]*\s*(.*)$/i,
  );

  if (!match) {
    logVeraDebug("wake parse miss", { text: trimmed });
    return { isWakeInvocation: false, command: text.trim() };
  }

  const rawCommand = (match[1] ?? "").trim();
  logVeraDebug("wake parse hit", { text: trimmed, command: rawCommand });
  return {
    isWakeInvocation: true,
    command: rawCommand,
  };
}

function normalizeCommerceCartDecision(text: string): "yes" | "no" | null {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:"']/g, "")
    .replace(/\s+/g, " ");

  if (normalized === "yes") return "yes";
  if (normalized === "no") return "no";
  return null;
}

function matchCartCommand(text: string): "open" | "close" | "checkout" | null {
  if (/\b(open|show|view)\s+(the\s+|my\s+)?cart\b/i.test(text)) return "open";
  if (/\b(close|hide|dismiss)\s+(the\s+|my\s+)?cart\b/i.test(text)) return "close";
  if (/\b(checkout|check out|buy now|purchase|pay now)\b/i.test(text)) return "checkout";
  return null;
}

function isStopListeningCommand(text: string) {
  return /\b(stop listening|mute|turn off (the )?(mic|microphone)|disable (the )?(mic|microphone))\b/i.test(
    text,
  );
}

function formatWakeCaption(command: string) {
  return command ? `Hey Vera, ${command}` : "Hey Vera";
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${remaining}`;
}

function createHistoryId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function stripRepeatedSpeaker(text: string, speaker: string) {
  const speakerName = speaker.trim();
  if (!speakerName || speakerName.toLowerCase() === "you") return text.trim();
  const escapedSpeaker = speakerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const speakerParts = speakerName
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const speakerPattern = [escapedSpeaker, ...speakerParts].join("|");
  return text.replace(new RegExp(`^\\s*(?:${speakerPattern})\\s*:\\s*`, "i"), "").trim();
}

function formatHistoryText(text: string, speaker: string): FormattedHistorySegment[] {
  const cleanedText = stripRepeatedSpeaker(text, speaker);
  const segments: FormattedHistorySegment[] = [];
  const stageDirectionPattern = /(\*{1,2})([^*]+?)\1/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = stageDirectionPattern.exec(cleanedText)) !== null) {
    const before = cleanedText.slice(cursor, match.index).trim();
    if (before) segments.push({ kind: "speech", text: before });

    const stageText = match[2]?.trim();
    if (stageText) segments.push({ kind: "stage", text: stageText });
    cursor = match.index + match[0].length;
  }

  const remaining = cleanedText.slice(cursor).trim();
  if (remaining) segments.push({ kind: "speech", text: remaining });
  return segments.length > 0 ? segments : [{ kind: "speech", text: cleanedText }];
}

type AppProps = {
  video: CatalogVideo;
  onExit: () => void;
  presentationOnly?: boolean;
};

function App({ video: sceneVideo, onExit, presentationOnly = false }: AppProps) {
  return (
    <SceneExperienceProvider>
      <SceneExperienceView video={sceneVideo} onExit={onExit} presentationOnly={presentationOnly} />
    </SceneExperienceProvider>
  );
}

function SceneExperienceView({ video: sceneVideo, onExit, presentationOnly = false }: AppProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const voiceInputRef = useRef<VoiceInputController | null>(null);
  const handleVoiceFinalRef = useRef<(utterance: string) => void>(() => {});
  const voiceEnabledRef = useRef(true);
  const veraSessionActiveRef = useRef(false);
  const generationTimerRef = useRef<number | null>(null);
  const responseTimerRef = useRef<number | null>(null);
  const replyStreamTimerRef = useRef<number | null>(null);
  const replyAnimationFrameRef = useRef<number | null>(null);
  const replyAudioRef = useRef<HTMLAudioElement | null>(null);
  const replyAudioCleanupRef = useRef<(() => void) | null>(null);
  const activeHistoryStreamIdsRef = useRef<Record<string, string>>({});
  const voiceRestartTimerRef = useRef<number | null>(null);
  const stereoApplyRef = useRef<(event: StereoEvent) => void>(() => {});
  const hudTimerRef = useRef<number | null>(null);
  const hudPinnedRef = useRef(false);
  const isScrubbingRef = useRef(false);

  const [mode, setMode] = useState<AppMode>("watching");
  const [hudVisible, setHudVisible] = useState(true);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [caption, setCaption] = useState("Say “step into this scene”");
  const [heardText, setHeardText] = useState("");
  const [latestTool, setLatestTool] = useState<ToolEvent | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [generationStep, setGenerationStep] = useState(-1);
  const [debugOpen, setDebugOpen] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [veraSessionActive, setVeraSessionActive] = useState(false);
  const [lastIntent, setLastIntent] = useState<Intent | "none">("none");
  const [selectedLayer, setSelectedLayer] = useState("scene-video");
  const [commerceCollectible, setCommerceCollectible] = useState<CommerceCollectible | null>(null);
  const [commerceCartState, setCommerceCartState] = useState<CommerceCartState>("idle");
  const [cartOpen, setCartOpen] = useState(false);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [checkoutState, setCheckoutState] = useState<"idle" | "loading" | "error">("idle");
  const [checkoutError, setCheckoutError] = useState("");
  const [characterRegions, setCharacterRegions] = useState<SceneRegion[]>([]);
  const {
    activeAgent,
    activeAgentId,
    agentTrace,
    agents,
    applySceneAnalysis,
    memorySummary,
    sceneId,
    sceneObjects,
    setActiveAgentId,
    setAgentTrace,
    setMemorySummary,
  } = useSceneExperience();
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const visibleHistory = history.slice(-4);
  const cartItemCount = cartItems.reduce((total, item) => total + item.quantity, 0);
  const cartUnitCount = cartItems.length;
  const isStereoFrame = stereoRole !== null;
  const centerCaption =
    caption && caption !== "Say “step into this scene”" ? caption : "";
  const hudPinned =
    !isStereoFrame &&
    voiceEnabled &&
    (veraSessionActive ||
      voiceState === "listening" ||
      voiceState === "thinking" ||
      voiceState === "speaking");
  const scenePrompts = useMemo(() => {
    const characterAgents = agents.filter((agent) => agent.id !== "director");
    const primary = characterAgents[0]?.name ?? "the closest character";
    const secondary = characterAgents[1]?.name ?? "the other character";

    return [
      `ask ${primary} what they sense`,
      `ask ${secondary} what they want`,
      "ask about the most important object",
      "where can I buy that item?",
      "collect this moment",
      inSceneNavigationPrompts[5],
    ] satisfies Array<InSceneCommand | string>;
  }, [agents]);
  const sceneComposition = useMemo(
    () => getSceneComposition(sceneVideo.id, currentTime, activeAgentId),
    [activeAgentId, currentTime, sceneVideo.id],
  );
  const isNativeVideo = sceneVideo.mediaKind === "html-video";
  const isYouTubeVideo = sceneVideo.mediaKind === "youtube" && Boolean(sceneVideo.embedUrl);
  const isPrimaryStereo = stereoRole === "primary";
  const isMirrorStereo = stereoRole === "mirror";
  const youTubeEmbedUrl = useMemo(() => {
    if (!sceneVideo.embedUrl) return "";
    const separator = sceneVideo.embedUrl.includes("?") ? "&" : "?";
    return `${sceneVideo.embedUrl}${separator}origin=${encodeURIComponent(window.location.origin)}`;
  }, [sceneVideo.embedUrl]);

  function layerClass(baseClass: string, layerId: string) {
    return `${baseClass} layer-target ${selectedLayer === layerId ? "layer-selected" : ""}`;
  }

  function selectLayer(layerId: string) {
    setSelectedLayer(layerId);
  }

  function postYouTubeCommand(func: "playVideo" | "pauseVideo" | "seekTo", args: Array<number | boolean> = []) {
    const iframeWindow = iframeRef.current?.contentWindow;
    if (!iframeWindow) return false;

    iframeWindow.postMessage(JSON.stringify({ event: "command", func, args }), "https://www.youtube-nocookie.com");
    iframeWindow.postMessage(JSON.stringify({ event: "command", func, args }), "https://www.youtube.com");
    return true;
  }

  function resolveCommandTargetAgent(command: InSceneCommand) {
    if (command.targetAgentId && agents.some((agent) => agent.id === command.targetAgentId)) {
      return command.targetAgentId;
    }

    const commandText = `${command.label} ${command.aliases.join(" ")}`.toLowerCase();
    return agents.find((agent) => commandText.includes(agent.name.toLowerCase()))?.id;
  }

  function resolveAgentIdBySpeaker(speaker: string) {
    return agents.find((agent) => agent.name.toLowerCase() === speaker.toLowerCase())?.id;
  }

  function resolveSpeechCharacter(speaker: string) {
    const normalized = speaker.trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === "you") return null;
    if (normalized === "cineverse") return "director";
    if (normalized === "darth vader") return "vader";
    return normalized;
  }

  function stopReplyPlayback() {
    if (replyStreamTimerRef.current) {
      window.clearInterval(replyStreamTimerRef.current);
      replyStreamTimerRef.current = null;
    }
    if (replyAnimationFrameRef.current) {
      window.cancelAnimationFrame(replyAnimationFrameRef.current);
      replyAnimationFrameRef.current = null;
    }
    if (replyAudioRef.current) {
      replyAudioRef.current.pause();
      replyAudioRef.current.removeAttribute("src");
      replyAudioRef.current.load();
      replyAudioRef.current = null;
    }
    if (replyAudioCleanupRef.current) {
      replyAudioCleanupRef.current();
      replyAudioCleanupRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      voiceEnabledRef.current = false;
      veraSessionActiveRef.current = false;
      if (generationTimerRef.current) window.clearInterval(generationTimerRef.current);
      if (responseTimerRef.current) window.clearTimeout(responseTimerRef.current);
      stopReplyPlayback();
      if (voiceRestartTimerRef.current) window.clearTimeout(voiceRestartTimerRef.current);
      if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
      voiceInputRef.current?.abort?.();
      voiceInputRef.current?.stop();
    };
  }, []);

  function revealHud(duration = 7600) {
    setHudVisible(true);
    if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
    if (hudPinnedRef.current) {
      hudTimerRef.current = null;
      return;
    }

    hudTimerRef.current = window.setTimeout(() => {
      if (hudPinnedRef.current) return;
      setHudVisible(false);
      hudTimerRef.current = null;
    }, duration);
  }

  useEffect(() => {
    revealHud();
  }, []);

  useEffect(() => {
    if (isNativeVideo || !isPlaying) return;

    const timer = window.setInterval(() => {
      setCurrentTime((value) => value + 0.5);
    }, 500);

    return () => window.clearInterval(timer);
  }, [isNativeVideo, isPlaying]);

  useEffect(() => {
    hudPinnedRef.current = hudPinned;
    if (!hudPinned) {
      revealHud();
      return;
    }

    setHudVisible(true);
    if (hudTimerRef.current) {
      window.clearTimeout(hudTimerRef.current);
      hudTimerRef.current = null;
    }
  }, [hudPinned]);

  function updateHeardTranscript(text: string) {
    const heard = text.trim();
    if (!heard) return;

    const heardWake = heard ? parseWakeCommand(heard) : null;
    logVeraDebug("transcript update", {
      heard,
      veraSessionActive: veraSessionActiveRef.current,
      isWakeInvocation: heardWake?.isWakeInvocation ?? false,
      command: heardWake?.command,
    });
    if (veraSessionActiveRef.current && heard) {
      setHeardText(heard);
      setCaption(heard);
      upsertStreamingHistory("You", heard);
      return;
    } else if (heardWake?.isWakeInvocation) {
      const visibleCommand = heardWake.command || "Hey Vera";
      setHeardText(visibleCommand);
      setCaption(heardWake.command ? heardWake.command : "Listening...");
      upsertStreamingHistory("You", visibleCommand);
    }
  }

  function formatVoiceStartError(error: unknown) {
    if (!(error instanceof Error)) return "OpenAI realtime voice could not start.";

    if (error.name === "NotFoundError" || /device not found|requested device not found/i.test(error.message)) {
      return "No microphone found. Check Chrome and macOS microphone input settings.";
    }

    if (error.name === "NotAllowedError" || /permission/i.test(error.message)) {
      return "Microphone permission is blocked. Allow microphone access in Chrome.";
    }

    return "OpenAI realtime voice could not start.";
  }

  async function startVoiceInput(controller = voiceInputRef.current) {
    logVeraDebug("voice start requested", {
      hasController: Boolean(controller),
      voiceEnabled: voiceEnabledRef.current,
    });
    if (!controller || !voiceEnabledRef.current) return false;

    try {
      await controller.start();
      logVeraDebug("voice start succeeded");
      return true;
    } catch (error) {
      logVeraDebug("voice start failed", {
        name: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : String(error),
      });
      setVoiceState(voiceEnabledRef.current ? "error" : "idle");
      setCaption(formatVoiceStartError(error));
      return false;
    }
  }

  useEffect(() => {
    let cancelled = false;

    if (presentationOnly) {
      voiceEnabledRef.current = false;
      setVoiceEnabled(false);
      setVoiceSupported(false);
      setVoiceState("idle");
      setCaption("");
      return () => {
        cancelled = true;
      };
    }

    async function startOpenAIRealtime() {
      logVeraDebug("voice bootstrap", {
        supported: isOpenAIRealtimeTranscriptionSupported(),
        voiceEnabled: voiceEnabledRef.current,
      });
      if (!isOpenAIRealtimeTranscriptionSupported()) {
        setVoiceSupported(false);
        setVoiceState("idle");
        setCaption("OpenAI realtime voice unavailable in this browser.");
        logAppEvent({
          category: "voice",
          label: "OpenAI Realtime STT unavailable",
          detail: "WebRTC microphone capture unavailable",
          status: "error",
        });
        return;
      }

      const realtimeInput = new OpenAIRealtimeTranscriptionInput({
        getToken: createRealtimeTranscriptionToken,
        onReady: (token) => {
          if (cancelled || !voiceEnabledRef.current) return;
          logVeraDebug("voice ready", {
            model: token.model,
            turnDetection: token.turnDetection,
          });
          setVoiceSupported(true);
          setVoiceState("listening");
          logAppEvent({
            category: "voice",
            label: "OpenAI Realtime STT connected",
            detail: `${token.model}, silence ${token.turnDetection.silenceDurationMs}ms`,
            status: "active",
          });
        },
        onSpeechStarted: () => {
          if (cancelled || !voiceEnabledRef.current) return;
          logVeraDebug("speech started", {
            veraSessionActive: veraSessionActiveRef.current,
          });
          setVoiceState("listening");
        },
        onSpeechStopped: () => {
          if (cancelled || !voiceEnabledRef.current) return;
          logVeraDebug("speech stopped", {
            veraSessionActive: veraSessionActiveRef.current,
          });
          setVoiceState(veraSessionActiveRef.current ? "thinking" : "listening");
        },
        onTranscriptDelta: (text) => {
          if (cancelled || !voiceEnabledRef.current) return;
          logVeraDebug("transcript delta callback", { text });
          updateHeardTranscript(text);
        },
        onTranscriptCompleted: (text) => {
          if (cancelled || !voiceEnabledRef.current) return;
          logVeraDebug("transcript completed callback", { text });
          const transcript = text.trim();
          if (!transcript) return;
          const wake = parseWakeCommand(transcript);
          updateHeardTranscript(transcript);
          logAppEvent({
            category: "voice",
            label: wake.isWakeInvocation ? "Wake phrase heard" : "OpenAI transcript final",
            detail: transcript,
            status: "done",
            metadata: {
              wakePhrase: wake.isWakeInvocation,
              command: wake.command,
              veraSessionActive: veraSessionActiveRef.current,
            },
          });
          handleVoiceFinalRef.current(text);
        },
        onError: (message) => {
          if (cancelled) return;
          logVeraDebug("voice callback error", { message });
          logAppEvent({
            category: "voice",
            label: "OpenAI Realtime STT error",
            detail: message,
            status: "error",
          });
          setVoiceState(voiceEnabledRef.current ? "error" : "idle");
          setCaption(message);
        },
      });

      voiceInputRef.current = realtimeInput;
      try {
        if (voiceEnabledRef.current) await realtimeInput.start();
      } catch (error) {
        if (cancelled) return;
        const detail = formatVoiceStartError(error);
        setVoiceSupported(true);
        setVoiceState("error");
        setCaption(detail);
        logAppEvent({
          category: "voice",
          label: "OpenAI Realtime STT unavailable",
          detail,
          status: "error",
        });
      }
    }

    void startOpenAIRealtime();

    return () => {
      cancelled = true;
      voiceInputRef.current?.abort?.();
      voiceInputRef.current?.stop();
      voiceInputRef.current = null;
    };
  }, [presentationOnly]);

  function upsertStreamingHistory(speaker: string, text: string, streamId = activeHistoryStreamIdsRef.current[speaker]) {
    const historyId = streamId ?? createHistoryId();
    activeHistoryStreamIdsRef.current[speaker] = historyId;
    setHistory((items) => {
      const next = [...items];
      const existingIndex = next.findIndex((historyItem) => historyItem.id === historyId);
      const streamingItem = { id: historyId, speaker, text, streaming: true };
      if (existingIndex >= 0) {
        next[existingIndex] = streamingItem;
      } else {
        next.push(streamingItem);
      }
      return next.slice(-8);
    });
    return historyId;
  }

  function pushHistory(item: HistoryItem, streamId = activeHistoryStreamIdsRef.current[item.speaker]) {
    const historyId = streamId ?? item.id ?? createHistoryId();
    if (streamId && activeHistoryStreamIdsRef.current[item.speaker] === streamId) {
      delete activeHistoryStreamIdsRef.current[item.speaker];
    }

    setHistory((items) => {
      const next = [...items];
      const existingIndex = next.findIndex((historyItem) => historyItem.id === historyId);
      const completedItem = { ...item, id: historyId, streaming: false };
      if (existingIndex >= 0) {
        next[existingIndex] = completedItem;
      } else {
        next.push(completedItem);
      }
      return next.slice(-8);
    });
    logAppEvent({
      category: item.speaker === "You" ? "voice" : "agent",
      label: item.speaker,
      detail: item.text,
      status: "done",
    });
  }

  function showTool(event: ToolEvent, clearAfter = 2400) {
    publishStereoEvent(sceneVideo.id, { type: "tool", label: event.label, detail: event.detail });
    setLatestTool(event);
    revealHud(Math.max(6200, clearAfter + 1500));
    logAppEvent({
      category: "system",
      label: event.label,
      detail: event.detail,
      status: "active",
    });
    if (responseTimerRef.current) window.clearTimeout(responseTimerRef.current);
    responseTimerRef.current = window.setTimeout(() => setLatestTool(null), clearAfter);
  }

  function logTrace(source: string, trace: AgentTrace[]) {
    trace.forEach((step) => {
      logAppEvent({
        category: "agent",
        label: step.agent,
        detail: step.step,
        status: step.status,
        metadata: { source },
      });
    });
  }

  function activateVeraSession() {
    revealHud();
    logVeraDebug("vera session activating", {
      voiceSupported,
      voiceEnabled: voiceEnabledRef.current,
    });
    if (voiceRestartTimerRef.current) {
      window.clearTimeout(voiceRestartTimerRef.current);
      voiceRestartTimerRef.current = null;
    }
    veraSessionActiveRef.current = true;
    setVeraSessionActive(true);
    setVoiceState(voiceSupported ? "listening" : "idle");
    setCaption("I'm listening.");
    logAppEvent({ category: "voice", label: "Vera active", detail: "wake phrase accepted", status: "active" });
    showTool({ label: "Vera active", detail: "Say “stop listening” to end" });
  }

  function restartStandbyRecognition() {
    const voiceInput = voiceInputRef.current;
    logVeraDebug("standby recognition restart requested", {
      hasVoiceInput: Boolean(voiceInput),
      voiceEnabled: voiceEnabledRef.current,
    });
    if (!voiceInput || !voiceEnabledRef.current) return;

    if (voiceRestartTimerRef.current) {
      window.clearTimeout(voiceRestartTimerRef.current);
      voiceRestartTimerRef.current = null;
    }

    try {
      voiceInput.abort?.();
      voiceInput.stop();
    } catch {
      // The delayed start below re-arms standby if the provider is already closing.
    }

    voiceRestartTimerRef.current = window.setTimeout(() => {
      voiceRestartTimerRef.current = null;
      if (!voiceEnabledRef.current || voiceInputRef.current !== voiceInput) return;

      startVoiceInput(voiceInput);
    }, 180);
  }

  function deactivateVeraSession() {
    revealHud();
    logVeraDebug("vera session deactivating");
    veraSessionActiveRef.current = false;
    setVeraSessionActive(false);
    setVoiceState(voiceSupported && voiceEnabledRef.current ? "listening" : "idle");
    setCaption("");
    logAppEvent({ category: "voice", label: "Vera standby", detail: "stop listening command", status: "done" });
    showTool({ label: "Vera standby", detail: "Say “Hey Vera” to activate" });
    restartStandbyRecognition();
  }

  function stopVeraListening() {
    revealHud();
    logVeraDebug("vera muted");
    voiceEnabledRef.current = false;
    veraSessionActiveRef.current = false;
    if (voiceRestartTimerRef.current) {
      window.clearTimeout(voiceRestartTimerRef.current);
      voiceRestartTimerRef.current = null;
    }
    setVoiceEnabled(false);
    setVeraSessionActive(false);
    setVoiceState("idle");
    setCaption("");
    voiceInputRef.current?.abort?.();
    voiceInputRef.current?.stop();
    logAppEvent({ category: "voice", label: "Vera muted", detail: "manual mute", status: "done" });
    showTool({ label: "Vera muted", detail: "Click Vera to listen again" });
  }

  function startVeraListening() {
    revealHud();
    logVeraDebug("vera listening requested", {
      voiceSupported,
      hasVoiceInput: Boolean(voiceInputRef.current),
    });
    if (!voiceSupported) {
      showTool({ label: "Voice unavailable", detail: "Use the guide prompts" });
      return;
    }

    voiceEnabledRef.current = true;
    veraSessionActiveRef.current = false;
    if (voiceRestartTimerRef.current) {
      window.clearTimeout(voiceRestartTimerRef.current);
      voiceRestartTimerRef.current = null;
    }
    setVoiceEnabled(true);
    setVeraSessionActive(false);
    setVoiceState("listening");
    setCaption("Say “Hey Vera” to activate.");
    void startVoiceInput().then((started) => {
      if (!started) {
        showTool({ label: "Vera unavailable", detail: "Check microphone input" });
        return;
      }

      logAppEvent({ category: "voice", label: "Vera listening", detail: "standby wake phrase mode", status: "active" });
      showTool({ label: "Vera listening", detail: "Say “Hey Vera” to activate" });
    });
  }

  function speakResponse(response: string, speaker: string) {
    publishStereoEvent(sceneVideo.id, { type: "speak", speaker, text: response });
    const speakerAgentId = resolveAgentIdBySpeaker(speaker);
    if (speakerAgentId) setActiveAgentId(speakerAgentId);
    stopReplyPlayback();
    setVoiceState("speaking");
    setCaption("");

    const trimmedResponse = response.trim();
    if (!trimmedResponse) {
      pushHistory({ speaker, text: "" });
      setVoiceState(voiceSupported ? "listening" : "idle");
      return;
    }

    const responseStreamId = upsertStreamingHistory(speaker, "");
    const speechTokens = trimmedResponse.match(/\S+\s*/g) ?? [trimmedResponse];
    const estimatedDurationMs = Math.max(
      1400,
      Math.min(14000, Math.round((speechTokens.length / 2.7) * 1000)),
    );

    function finishResponseStream() {
      stopReplyPlayback();
      setCaption(trimmedResponse);
      pushHistory({ speaker, text: trimmedResponse }, responseStreamId);
      window.setTimeout(() => {
        setVoiceState(voiceSupported ? "listening" : "idle");
        if (mode === "watching") setCaption("");
      }, 900);
    }

    function startTimedReveal(audio?: HTMLAudioElement) {
      const startedAt = performance.now();

      const tick = () => {
        const durationMs =
          audio && Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration * 1000
            : estimatedDurationMs;
        const elapsedMs = audio ? audio.currentTime * 1000 : performance.now() - startedAt;
        const progress = Math.max(0, Math.min(1, elapsedMs / durationMs));
        const visibleTokenCount =
          progress <= 0 ? 0 : Math.max(1, Math.min(speechTokens.length, Math.ceil(speechTokens.length * progress)));
        const partial = speechTokens.slice(0, visibleTokenCount).join("").trimEnd();

        setCaption(partial);
        upsertStreamingHistory(speaker, partial, responseStreamId);

        if ((audio && audio.ended) || progress >= 1) {
          finishResponseStream();
          return;
        }

        replyAnimationFrameRef.current = window.requestAnimationFrame(tick);
      };

      replyAnimationFrameRef.current = window.requestAnimationFrame(tick);
    }

    const speechCharacter = resolveSpeechCharacter(speaker);
    if (isMirrorStereo || !speechCharacter) {
      startTimedReveal();
      return;
    }

    void synthesizeSpeech(speechCharacter, trimmedResponse).then((speechAudio) => {
      if (!speechAudio) {
        startTimedReveal();
        return;
      }

      const audio = new Audio(speechAudio.audioUrl);
      audio.preload = "auto";
      replyAudioRef.current = audio;
      replyAudioCleanupRef.current = speechAudio.revoke;

      const playPromise = audio.play();
      startTimedReveal(audio);

      void playPromise.catch(() => {
        stopReplyPlayback();
        startTimedReveal();
      });
    });
  }

  function captureFrame() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return null;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  }

  function buildSceneContextHint(frameCaptured: boolean) {
    const contextParts = [
      `Catalogue title: ${sceneVideo.title}.`,
      `Catalogue description: ${sceneVideo.tagline}.`,
      `Genre/source context: ${sceneVideo.genre}; ${sceneVideo.sourceLabel}.`,
      sceneVideo.agents.length ? `Suggested visible agents: ${sceneVideo.agents.join(", ")}.` : "",
      frameCaptured
        ? "A paused frame is attached for visual grounding."
        : "No same-origin video frame is available, so use catalogue metadata conservatively.",
    ].filter(Boolean);

    return contextParts.join(" ");
  }

  async function runGeneration() {
    publishStereoEvent(sceneVideo.id, { type: "mode", mode: "generating" });
    const video = videoRef.current;
    if (isNativeVideo) {
      video?.pause();
    } else if (isYouTubeVideo) {
      postYouTubeCommand("pauseVideo");
    }
    setIsPlaying(false);
    setMode("generating");
    setCharacterRegions([]);
    setGenerationStep(0);
    setCaption("Stepping into this scene...");
    setAgentTrace([
      { agent: "Vercel Frontend", step: "paused frame + timestamp captured", status: "active" },
      { agent: "AWS FastAPI Backend", step: "scene analysis request pending", status: "queued" },
    ]);
    logAppEvent({
      category: "scene",
      label: "Scene generation started",
      detail: "frame capture + analyze request queued",
      status: "active",
      metadata: { timestamp: video?.currentTime ?? currentTime },
    });
    showTool(generationSteps[0], 5200);

    let step = 0;
    if (generationTimerRef.current) window.clearInterval(generationTimerRef.current);
    generationTimerRef.current = window.setInterval(() => {
      step += 1;
      if (step < generationSteps.length) {
        setGenerationStep(step);
        showTool(generationSteps[step], 5200);
      } else {
        if (generationTimerRef.current) window.clearInterval(generationTimerRef.current);
        void finishGeneration();
      }
    }, 900);
  }

  async function finishGeneration() {
    const video = videoRef.current;
    let frame: string | null = null;
    try {
      frame = captureFrame();
    } catch (error) {
      logVeraDebug("frame capture failed", {
        name: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const frameBytes = frame?.length ?? 0;
    logAppEvent({
      category: "scene",
      label: frame ? "Frame captured" : "Frame unavailable",
      detail: frame ? "paused frame prepared for analysis" : "video frame could not be read",
      status: frame ? "done" : "fallback",
      metadata: {
        frameCaptured: Boolean(frame),
        frameBytes,
        timestamp: video?.currentTime ?? currentTime,
        videoWidth: video?.videoWidth ?? 0,
        videoHeight: video?.videoHeight ?? 0,
      },
    });
    const analysis = await analyzeScene({
      frame,
      timestamp: video?.currentTime ?? currentTime,
      transcriptSegment: buildSceneContextHint(Boolean(frame)),
      videoMetadata: {
        videoId: sceneVideo.id,
        title: sceneVideo.title,
        description: sceneVideo.tagline,
        source: sceneVideo.playbackUrl,
        sourceLabel: sceneVideo.sourceLabel,
        sourceKind: sceneVideo.sourceKind,
        agents: sceneVideo.agents,
        thumbnailUrl: sceneVideo.thumbnailUrl,
        duration: duration || video?.duration || 0,
      },
    });

    applySceneAnalysis(analysis);
    publishStereoEvent(sceneVideo.id, { type: "scene-analysis", analysis });
    setCharacterRegions(
      analysis.characters
        .filter((character) => character.box)
        .map((character) => ({
          id: character.id,
          label: character.name,
          box: character.box as [number, number, number, number],
        })),
    );
    logTrace("scene-analysis", analysis.agentTrace);
    logAppEvent({
      category: "scene",
      label: "Scene parsed",
      detail: analysis.source === "local-fallback" ? `Local fallback: ${analysis.sceneSummary}` : analysis.sceneSummary,
      status: analysis.source === "local-fallback" || analysis.agentTrace.some((step) => step.status === "fallback") ? "fallback" : "done",
      metadata: {
        sceneId: analysis.sceneId,
        analysisMode: analysis.analysisMode,
        analysisSource: analysis.source,
        sourceModelId: analysis.sourceModelId,
        frameCaptured: Boolean(frame),
        frameBytes,
        objects: analysis.objects,
        characters: analysis.characters.map((agent) => agent.name),
        emotionalTone: analysis.emotionalTone,
      },
    });
    setMode("in-scene");
    publishStereoEvent(sceneVideo.id, { type: "mode", mode: "in-scene" });
    setGenerationStep(-1);
    setActiveAgentId(analysis.characters[0]?.id ?? "director");
    showTool({
      label: "Scene agents created",
      detail: analysis.characters.map((agent) => agent.name).join(", ") || "Director",
    });
    speakResponse("The scene has opened. Speak, and this moment will answer.", "Director");
  }

  async function playVideo() {
    const video = videoRef.current;
    if (!isNativeVideo) {
      if (!isYouTubeVideo || !postYouTubeCommand("playVideo")) return false;
      setIsPlaying(true);
      return true;
    }

    if (!video) return false;

    if (video.ended) {
      video.currentTime = 0;
    }

    try {
      await video.play();
    } catch (error) {
      logVeraDebug("video play initial failed", {
        name: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : String(error),
      });
      try {
        video.muted = true;
        await video.play();
        logVeraDebug("video muted play fallback succeeded");
      } catch (mutedError) {
        logVeraDebug("video muted play fallback failed", {
          name: mutedError instanceof Error ? mutedError.name : "unknown",
          message: mutedError instanceof Error ? mutedError.message : String(mutedError),
        });
        setIsPlaying(false);
        showTool({ label: "Playback blocked", detail: "Tap Play once to resume" });
        return false;
      }
    }

    setIsPlaying(!video.paused);
    return !video.paused;
  }

  function pauseVideo() {
    const video = videoRef.current;
    if (!isNativeVideo) {
      if (isYouTubeVideo) postYouTubeCommand("pauseVideo");
      setIsPlaying(false);
      return true;
    }

    if (!video) return false;

    video.pause();
    setIsPlaying(false);
    return video.paused;
  }

  function seekVideo(nextTime: number) {
    const video = videoRef.current;
    const safeDuration = duration || video?.duration || 0;
    if (!isNativeVideo) {
      const targetTime = safeDuration > 0 ? Math.min(Math.max(nextTime, 0), safeDuration) : Math.max(nextTime, 0);
      if (isYouTubeVideo) postYouTubeCommand("seekTo", [targetTime, true]);
      setCurrentTime(targetTime);
      revealHud();
      return;
    }

    if (!video || safeDuration <= 0) return;

    const targetTime = Math.min(Math.max(nextTime, 0), safeDuration);
    video.currentTime = targetTime;
    setCurrentTime(targetTime);
    revealHud();
  }

  function seekFromTimelinePointer(event: React.PointerEvent<HTMLInputElement>) {
    const safeDuration = duration || videoRef.current?.duration || 0;
    if (safeDuration <= 0) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    seekVideo(Math.min(Math.max(ratio, 0), 1) * safeDuration);
  }

  function returnToLanding() {
    pauseVideo();
    onExit();
  }

  async function handleVideoControl(action: ChatResponse["action"], actionSeconds?: number) {
    if (!action) return false;
    publishStereoEvent(sceneVideo.id, { type: "video-control", action, seconds: actionSeconds });
    const video = videoRef.current;
    const skipSeconds = actionSeconds ?? (action === "rewind" ? 10 : 20);
    logVeraDebug("video control requested", {
      action,
      actionSeconds: skipSeconds,
      hasVideo: Boolean(video) || !isNativeVideo,
      paused: video?.paused,
      currentTime: video?.currentTime,
      muted: video?.muted,
      mediaKind: sceneVideo.mediaKind,
    });
    if (isNativeVideo && !video) return false;

    if (action === "pause") {
      const paused = pauseVideo();
      logVeraDebug("video pause result", { paused });
      logAppEvent({ category: "playback", label: "Pause", detail: paused ? "video paused" : "pause unavailable", status: paused ? "done" : "error" });
      showTool({ label: paused ? "Tool: pause video" : "Pause unavailable" });
      return paused;
    }

    if (action === "play") {
      if (mode === "in-scene") {
        setMode("watching");
        publishStereoEvent(sceneVideo.id, { type: "mode", mode: "watching" });
        setActiveAgentId("director");
      }
      const played = await playVideo();
      logVeraDebug("video play result", {
        played,
        paused: video?.paused,
        currentTime: video?.currentTime ?? currentTime,
        muted: video?.muted,
      });
      logAppEvent({ category: "playback", label: "Play", detail: played ? "video playing" : "playback blocked", status: played ? "done" : "error" });
      if (played) showTool({ label: "Tool: play video" });
      return played;
    }

    if (action === "rewind") {
      const nextTime = Math.max(0, (video?.currentTime ?? currentTime) - skipSeconds);
      seekVideo(nextTime);
      logAppEvent({ category: "playback", label: "Rewind", detail: `-${skipSeconds} seconds`, status: "done", metadata: { currentTime: nextTime } });
      showTool({ label: "Tool: rewind", detail: `-${skipSeconds} seconds` });
      return true;
    }

    if (action === "forward") {
      const nextTime = Math.min(
        duration || video?.duration || currentTime + skipSeconds,
        (video?.currentTime ?? currentTime) + skipSeconds,
      );
      seekVideo(nextTime);
      logAppEvent({ category: "playback", label: "Fast forward", detail: `+${skipSeconds} seconds`, status: "done", metadata: { currentTime: nextTime } });
      showTool({ label: "Tool: fast forward", detail: `+${skipSeconds} seconds` });
      return true;
    }

    return false;
  }

  function activateVeraWakePrompt() {
    if (!voiceEnabled) {
      startVeraListening();
      return;
    }

    activateVeraSession();
  }

  function promptForCommerceCartDecision(collectible: CommerceCollectible) {
    setCommerceCollectible(collectible);
    setCommerceCartState("awaiting_confirmation");
    speakResponse(
      collectible.sourceUrl === "#"
        ? "I found a possible collectible match. Do you want to add it to cart? Answer yes or no only."
        : `I found a likely match: ${collectible.title}. Do you want to add it to cart? Answer yes or no only.`,
      "Director",
    );
  }

  function addCollectibleToCart(collectible: CommerceCollectible) {
    const id = collectible.sourceUrl !== "#" ? collectible.sourceUrl : collectible.title;
    setCartItems((items) => {
      const existingIndex = items.findIndex((item) => item.id === id);
      if (existingIndex < 0) return [{ ...collectible, id, quantity: 1 }, ...items];

      return items.map((item, index) =>
        index === existingIndex ? { ...item, quantity: item.quantity + 1 } : item,
      );
    });
    setCartOpen(true);
  }

  async function handleCheckout() {
    if (isMirrorStereo || checkoutState === "loading") return;
    if (cartItems.length === 0) {
      setCartOpen(true);
      showTool({ label: "Cart empty", detail: "add a scene item first" });
      return;
    }

    if (!sceneId) {
      setCheckoutState("error");
      setCheckoutError("Step into the scene before checkout.");
      showTool({ label: "Checkout unavailable", detail: "scene not initialized" });
      speakResponse("Step into the scene first, then checkout will be ready.", "Vera");
      return;
    }

    setCheckoutState("loading");
    setCheckoutError("");
    showTool({ label: "Stripe Checkout", detail: "creating secure session" });
    logAppEvent({
      category: "commerce",
      label: "Checkout started",
      detail: `${cartItemCount} item${cartItemCount === 1 ? "" : "s"}`,
      status: "active",
      metadata: {
        sceneId,
        cartItems: cartItems.map((item) => ({
          title: item.title,
          quantity: item.quantity,
          sourceUrl: item.sourceUrl,
        })),
      },
    });

    try {
      const checkout = await createCheckoutSession({
        sceneId,
        unlockType: "agentic_commerce_cart",
      });
      logAppEvent({
        category: "commerce",
        label: checkout.mode === "stripe" ? "Stripe Checkout ready" : "Simulated checkout ready",
        detail: checkout.checkoutUrl,
        status: "done",
        metadata: { sceneId, mode: checkout.mode },
      });
      window.location.assign(checkout.checkoutUrl);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Could not start checkout.";
      setCheckoutState("error");
      setCheckoutError(detail);
      showTool({ label: "Checkout failed", detail });
      logAppEvent({
        category: "commerce",
        label: "Checkout failed",
        detail,
        status: "error",
        metadata: { sceneId },
      });
    }
  }

  function handleCartCommand(utterance: string) {
    const command = matchCartCommand(utterance);
    if (!command) return false;

    if (command === "checkout") {
      void handleCheckout();
      return true;
    }

    const nextOpen = command === "open";
    setCartOpen(nextOpen);
    showTool({
      label: nextOpen ? "Cart opened" : "Cart closed",
      detail: cartItemCount > 0 ? `${cartItemCount} item${cartItemCount === 1 ? "" : "s"}` : "cart empty",
    });
    speakResponse(
      nextOpen
        ? cartItemCount > 0
          ? "Cart is open."
          : "Cart is open. It is empty."
        : "Cart is closed.",
      "Vera",
    );
    return true;
  }

  function handleCommerceCartDecision(utterance: string) {
    if (commerceCartState !== "awaiting_confirmation" || !commerceCollectible) return false;

    const decision = normalizeCommerceCartDecision(utterance);
    if (!decision) {
      showTool({ label: "Cart confirmation", detail: "Answer yes or no only" });
      speakResponse("Please answer yes or no only.", "Director");
      return true;
    }

    if (decision === "yes") {
      addCollectibleToCart(commerceCollectible);
      setCommerceCartState("added");
      showTool({ label: "Cart request", detail: commerceCollectible.title });
      logAppEvent({
        category: "commerce",
        label: "Add to cart acknowledged",
        detail: commerceCollectible.title,
        status: "done",
        metadata: {
          sourceUrl: commerceCollectible.sourceUrl,
          sourceTitle: commerceCollectible.sourceTitle,
        },
      });
      speakResponse("Will add to cart.", "Director");
      return true;
    }

    setCommerceCartState("idle");
    setCommerceCollectible(null);
    showTool({ label: "Scene resumed", detail: "commerce recommendation skipped" });
    logAppEvent({
      category: "commerce",
      label: "Cart recommendation declined",
      detail: commerceCollectible.title,
      status: "done",
      metadata: {
        sourceUrl: commerceCollectible.sourceUrl,
        sourceTitle: commerceCollectible.sourceTitle,
      },
    });
    speakResponse("Resuming back to the scene.", "Director");
    return true;
  }

  async function handleUtterancePayload(utterance: string) {
    if (isMirrorStereo) return;
    logVeraDebug("utterance payload", {
      utterance,
      mode,
      isPlaying,
      currentTime,
      veraSessionActive: veraSessionActiveRef.current,
    });
    setVoiceState("thinking");

    if (handleCommerceCartDecision(utterance)) return;
    if (handleCartCommand(utterance)) return;

    if (/\b(back to landing|go home|home page|landing page|return home|exit video)\b/i.test(utterance)) {
      logAppEvent({ category: "system", label: "Return to landing", detail: utterance, status: "done" });
      showTool({ label: "Returning home", detail: "landing page" });
      window.setTimeout(returnToLanding, 180);
      return;
    }

    const route = routeUtterance({
      utterance,
      mode,
      agents,
      activeAgentId,
      sceneObjects,
    });
    logVeraDebug("route result", {
      utterance,
      kind: route.kind,
      intent: route.intent,
      action: route.action,
      tool: route.tool,
    });
    setLastIntent(route.intent);
    setAgentTrace(route.agentTrace);
    logTrace("frontend-router", route.agentTrace);
    logAppEvent({
      category: "router",
      label: route.kind,
      detail: route.tool.detail ?? route.tool.label,
      status: route.kind === "fallback_clarify" ? "fallback" : "done",
      metadata: {
        utterance,
        intent: route.intent,
        targetAgentId: route.targetAgentId,
        action: route.action,
        objectLabel: route.objectLabel,
      },
    });
    showTool(route.tool);

    if (route.kind === "video_control") {
      const handled = await handleVideoControl(route.action, route.actionSeconds);
      setLastIntent("video_control");
      speakResponse(
        !handled ? "Playback needs a tap first." : route.response ?? "Done.",
        "Vera",
      );
      return;
    }

    if (route.kind === "scene_generation") {
      setLastIntent("scene_generation");
      runGeneration();
      return;
    }

    if (route.kind === "scene_exit") {
      setMode("watching");
      publishStereoEvent(sceneVideo.id, { type: "mode", mode: "watching" });
      setActiveAgentId("director");
      speakResponse(route.response ?? "Returning to cinematic controls.", "Director");
      return;
    }

    if (mode === "in-scene") {
      const inSceneNavigation = matchInSceneNavigationCommand(utterance);
      if (inSceneNavigation) {
        const commandTargetAgentId = resolveCommandTargetAgent(inSceneNavigation);
        if (commandTargetAgentId) {
          setActiveAgentId(commandTargetAgentId);
        }
        if (inSceneNavigation.exitMode) {
          setMode(inSceneNavigation.exitMode);
          publishStereoEvent(sceneVideo.id, { type: "mode", mode: inSceneNavigation.exitMode });
        }
        showTool({ label: "Navigation control", detail: inSceneNavigation.detail });
        speakResponse(inSceneNavigation.response, "Director");
        return;
      }
    }

    const collectiblePromise =
      route.kind === "commerce_collect"
        ? findCollectible(
            sceneId,
            `${utterance} collectible replica ${route.objectLabel ?? sceneObjects.join(" ")} scene item`,
          )
        : null;
    if (collectiblePromise) {
      showTool({ label: "Exa: finding collectible", detail: route.objectLabel ?? "scene item" });
    }

    if (route.kind === "commerce_collect") {
      const collectible =
        (await collectiblePromise) ??
        (await findCollectible(
          sceneId,
          `${utterance} collectible replica ${route.objectLabel ?? sceneObjects.join(" ")} scene item`,
        ));
      setLastIntent("commerce_collect");
      setCommerceCollectible(collectible);
      publishStereoEvent(sceneVideo.id, { type: "commerce", collectible });
      setAgentTrace(route.agentTrace);
      logAppEvent({
        category: "commerce",
        label: collectible.title,
        detail: collectible.summary,
        status: collectible.sourceUrl === "#" ? "fallback" : "done",
        metadata: {
          sourceTitle: collectible.sourceTitle,
          sourceUrl: collectible.sourceUrl,
          objectLabel: route.objectLabel,
        },
      });
      showTool({
        label: collectible.sourceUrl === "#" ? "Collectible fallback" : "Collectible found",
        detail: collectible.sourceTitle,
      });
      promptForCommerceCartDecision(collectible);
      return;
    }

    let routerTrace: AgentTrace[] = [];
    let routedTargetAgentId = route.targetAgentId ?? activeAgentId;
    if (route.kind === "character_chat" && route.explicitTargetAgentId) {
      routedTargetAgentId = route.explicitTargetAgentId;
      setActiveAgentId(route.explicitTargetAgentId);
      logAppEvent({
        category: "router",
        label: "character-router",
        detail: "explicit character mention",
        status: "done",
        metadata: {
          sceneId,
          targetAgentId: route.explicitTargetAgentId,
        },
      });
    } else if (route.kind === "character_chat") {
      const routerDecision = await routeCharacter(sceneId, utterance, routedTargetAgentId);
      if (routerDecision) {
        routedTargetAgentId = routerDecision.targetAgentId;
        routerTrace = routerDecision.agentTrace;
        setActiveAgentId(routerDecision.targetAgentId);
        logTrace("character-router", routerDecision.agentTrace);
        logAppEvent({
          category: "router",
          label: "character-router",
          detail: routerDecision.reason,
          status: "done",
          metadata: {
            sceneId,
            targetAgentId: routerDecision.targetAgentId,
            targetAgentName: routerDecision.targetAgentName,
            confidence: routerDecision.confidence,
          },
        });
        showTool({
          label: "Character Router",
          detail: `${routerDecision.targetAgentName}: ${routerDecision.reason}`,
        });
      }
    }

    const chatPayload = {
      sceneId,
      message: utterance,
      targetAgentId: routedTargetAgentId,
      targetAgentName: agents.find((agent) => agent.id === routedTargetAgentId)?.name,
      playback: {
        currentTime,
        isPlaying,
        mode,
      },
    };
    const routed =
      route.kind === "character_chat"
        ? await sendCharacterChat(chatPayload)
        : await sendChat(chatPayload);

    const finalIntent = route.intent === "fallback_clarify" ? routed.intent : route.intent;
    setLastIntent(finalIntent);
    setMemorySummary(routed.updatedMemorySummary);
    setAgentTrace([...route.agentTrace, ...routerTrace, ...routed.agentTrace]);
    logTrace("chat-response", routed.agentTrace);
    logAppEvent({
      category: "memory",
      label: "Memory updated",
      detail: routed.updatedMemorySummary,
      status: routed.agentTrace.some((step) => step.status === "fallback") ? "fallback" : "done",
      metadata: { intent: finalIntent, respondingAgent: routed.respondingAgent },
    });
    showTool({
      label:
        finalIntent === "video_control"
          ? "Router: video command"
          : finalIntent === "scene_generation"
            ? "Router: scene command"
            : finalIntent === "commerce_collect"
              ? "Router: collect intent"
              : finalIntent === "director_question"
                ? "Router: director question"
                : finalIntent === "character_chat"
                  ? "Router: character question"
                  : "Router: clarify",
      detail: route.objectLabel,
    });

    const targetAgentId = routed.targetAgentId ?? routedTargetAgentId;
    if (targetAgentId) setActiveAgentId(targetAgentId);

    if (finalIntent === "video_control") {
      await handleVideoControl(routed.action);
      speakResponse(routed.response ?? "Done.", "Vera");
      return;
    }

    if (finalIntent === "scene_generation") {
      runGeneration();
      return;
    }

    if (finalIntent === "commerce_collect") {
      const collectible =
        (await collectiblePromise) ??
        (await findCollectible(
          sceneId,
          `${utterance} collectible replica ${route.objectLabel ?? sceneObjects.join(" ")} scene item`,
        ));
      setCommerceCollectible(collectible);
      publishStereoEvent(sceneVideo.id, { type: "commerce", collectible });
      logAppEvent({
        category: "commerce",
        label: collectible.title,
        detail: collectible.summary,
        status: collectible.sourceUrl === "#" ? "fallback" : "done",
        metadata: {
          sourceTitle: collectible.sourceTitle,
          sourceUrl: collectible.sourceUrl,
          objectLabel: route.objectLabel,
        },
      });
      showTool({
        label: collectible.sourceUrl === "#" ? "Collectible fallback" : "Collectible found",
        detail: collectible.sourceTitle,
      });
      promptForCommerceCartDecision(collectible);
      return;
    }

    window.setTimeout(() => {
      const speaker = routed.respondingAgent;
      showTool({ label: "Memory updated", detail: finalIntent.replace("_", " ") });
      speakResponse(routed.response, speaker);
    }, 650);
  }

  function handleUtterance(utterance: string) {
    if (!utterance.trim()) return;
    logVeraDebug("utterance received", {
      utterance,
      voiceState,
      veraSessionActive: veraSessionActiveRef.current,
    });
    revealHud();
    const parsed = parseWakeCommand(utterance);
    setHeardText(utterance);
    pushHistory({ speaker: "You", text: utterance });
    publishStereoEvent(sceneVideo.id, { type: "heard", text: utterance });

    if (parsed.isWakeInvocation) {
      logVeraDebug("utterance wake invocation", { command: parsed.command });
      if (!parsed.command) {
        activateVeraWakePrompt();
        return;
      }
      if (isStopListeningCommand(parsed.command)) {
        deactivateVeraSession();
        return;
      }
      handleUtterancePayload(parsed.command);
      return;
    }

    if (isStopListeningCommand(utterance)) {
      deactivateVeraSession();
      return;
    }

    handleUtterancePayload(utterance);
  }

  function handleGuideClick(prompt: string) {
    void handleUtterance(`Hey Vera, ${prompt}`);
  }

  const handleUtteranceRef = useRef(handleUtterance);
  handleUtteranceRef.current = handleUtterance;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const devWindow = window as typeof window & { __sceneverseSay?: (utterance: string) => void };
    devWindow.__sceneverseSay = (utterance: string) => handleUtteranceRef.current(utterance);
    return () => {
      delete devWindow.__sceneverseSay;
    };
  }, []);

  function handleVoiceFinal(utterance: string) {
    if (!utterance.trim()) return;
    logVeraDebug("voice final", {
      utterance,
      veraSessionActive: veraSessionActiveRef.current,
    });

    if (veraSessionActiveRef.current) {
      const activeParsed = parseWakeCommand(utterance);
      handleUtterance(activeParsed.isWakeInvocation && activeParsed.command ? activeParsed.command : utterance);
      return;
    }

    const parsed = parseWakeCommand(utterance);
    logVeraDebug("voice final parsed", {
      isWakeInvocation: parsed.isWakeInvocation,
      command: parsed.command,
    });
    if (!parsed.isWakeInvocation) return;

    activateVeraSession();
    if (parsed.command) {
      setHeardText(parsed.command);
      setCaption(parsed.command);
      pushHistory({ speaker: "You", text: parsed.command });
      void handleUtterancePayload(parsed.command);
    }
  }

  useEffect(() => {
    handleVoiceFinalRef.current = handleVoiceFinal;
  });

  async function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      await playVideo();
    } else {
      pauseVideo();
    }
  }

  const latestSpeakerHistoryIndex = visibleHistory.reduce((latestIndex, item, index) => {
    return resolveAgentIdBySpeaker(item.speaker) ? index : latestIndex;
  }, -1);
  const shouldShowResponseHistory = visibleHistory.length > 0;

  useEffect(() => {
    if (stereoRole === null) return;
    const startTime = Number.parseFloat(new URLSearchParams(window.location.search).get("t") ?? "");
    const video = videoRef.current;
    if (!video || !Number.isFinite(startTime) || startTime <= 0) return;

    const seekOnMetadata = () => {
      video.currentTime = Math.min(startTime, video.duration || startTime);
      setCurrentTime(video.currentTime);
    };

    if (video.readyState >= 1) seekOnMetadata();
    else video.addEventListener("loadedmetadata", seekOnMetadata, { once: true });
    return () => video.removeEventListener("loadedmetadata", seekOnMetadata);
  }, []);

  useEffect(() => {
    if (!isMirrorStereo) return;
    const video = videoRef.current;
    if (video) video.muted = true;
  }, [isMirrorStereo]);

  useEffect(() => {
    if (!isPrimaryStereo) return;
    const intervalId = window.setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      publishStereoEvent(sceneVideo.id, {
        type: "time",
        t: video.currentTime,
        playing: !video.paused,
      });
    }, 500);
    return () => window.clearInterval(intervalId);
  }, [isPrimaryStereo, sceneVideo.id]);

  stereoApplyRef.current = (event: StereoEvent) => {
    if (event.type === "time") {
      const video = videoRef.current;
      if (!video) return;
      video.muted = true;
      if (Math.abs(video.currentTime - event.t) > 0.3) {
        video.currentTime = event.t;
        setCurrentTime(event.t);
      }
      if (event.playing && video.paused) void playVideo();
      if (!event.playing && !video.paused) pauseVideo();
      return;
    }

    if (event.type === "video-control") {
      void handleVideoControl(event.action, event.seconds);
      return;
    }

    if (event.type === "heard") {
      setHeardText(event.text);
      setCaption(event.text);
      pushHistory({ speaker: "You", text: event.text });
      return;
    }

    if (event.type === "speak") {
      speakResponse(event.text, event.speaker);
      return;
    }

    if (event.type === "mode") {
      setMode(event.mode);
      if (event.mode === "generating") setGenerationStep(0);
      if (event.mode === "watching") setActiveAgentId("director");
      return;
    }

    if (event.type === "scene-analysis") {
      const analysis = event.analysis as Parameters<typeof applySceneAnalysis>[0];
      applySceneAnalysis(analysis);
      setCharacterRegions(
        analysis.characters
          .filter((character) => character.box)
          .map((character) => ({
            id: character.id,
            label: character.name,
            box: character.box as [number, number, number, number],
          })),
      );
      setActiveAgentId(analysis.characters[0]?.id ?? "director");
      return;
    }

    if (event.type === "tool") {
      showTool({ label: event.label, detail: event.detail });
      return;
    }

    if (event.type === "commerce") {
      setCommerceCollectible(event.collectible as CommerceCollectible);
    }
  };

  useEffect(() => {
    if (isPrimaryStereo) {
      return subscribeStereoChannel(sceneVideo.id, (event) => {
        if (event.type === "video-control") stereoApplyRef.current(event);
      });
    }
    return subscribeStereoEvents(sceneVideo.id, (event) => stereoApplyRef.current(event));
  }, [isPrimaryStereo, sceneVideo.id]);

  return (
    <main
      className={`experience mode-${mode} ${hudVisible ? "hud-visible" : "hud-idle"}${
        isStereoFrame ? ` stereo-frame stereo-frame-${stereoRole}` : ""
      }`}
      data-layer-id="app-root"
      data-layer-label="App root"
      onPointerMove={() => revealHud()}
      onPointerDownCapture={(event) => {
        revealHud();
        const target = event.target as HTMLElement | null;
        const layer = target?.closest<HTMLElement>("[data-layer-id]");
        if (layer?.dataset.layerId) {
          setSelectedLayer(layer.dataset.layerId);
        }
      }}
    >

      {isNativeVideo ? (
        <video
          ref={videoRef}
          className={layerClass("scene-video", "scene-video")}
          data-layer-id="scene-video"
          data-layer-label="Scene video"
          aria-label={sceneVideo.title}
          src={sceneVideo.playbackUrl}
          crossOrigin="anonymous"
          playsInline
          preload="metadata"
          onClick={() => selectLayer("scene-video")}
          onFocus={() => selectLayer("scene-video")}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        />
      ) : isYouTubeVideo ? (
        <iframe
          ref={iframeRef}
          className={layerClass("scene-video scene-video-frame", "scene-video")}
          data-layer-id="scene-video"
          data-layer-label="Scene video"
          title={sceneVideo.title}
          src={youTubeEmbedUrl}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          onClick={() => selectLayer("scene-video")}
          onFocus={() => selectLayer("scene-video")}
        />
      ) : (
        <section
          className={layerClass("scene-video scene-reference-poster", "scene-video")}
          data-layer-id="scene-video"
          data-layer-label="Scene reference"
          aria-label={sceneVideo.title}
          tabIndex={0}
          onClick={() => selectLayer("scene-video")}
          onFocus={() => selectLayer("scene-video")}
        >
          {sceneVideo.thumbnailUrl ? <img src={sceneVideo.thumbnailUrl} alt="" draggable={false} /> : null}
          <div>
            <span>{sceneVideo.sourceLabel}</span>
            <strong>{sceneVideo.title}</strong>
            <p>{sceneVideo.tagline}</p>
            {sceneVideo.externalUrl ? (
              <a href={sceneVideo.externalUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                Open source
              </a>
            ) : null}
          </div>
        </section>
      )}

      <button
        className={layerClass("home-button", "home-button")}
        data-layer-id="home-button"
        data-layer-label="Back to landing"
        aria-label="Back to landing page"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          selectLayer("home-button");
          returnToLanding();
        }}
        onFocus={() => selectLayer("home-button")}
      >
        Back
      </button>

      {stereoRole === null && isNativeVideo ? (
        <button
          className={layerClass("home-button vr-button", "vr-button")}
          data-layer-id="vr-button"
          data-layer-label="Enter stereo VR"
          aria-label="Enter stereo VR"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            selectLayer("vr-button");
            const t = videoRef.current?.currentTime ?? currentTime;
            pauseVideo();
            navigateTo(`/stereo/video/${encodeURIComponent(sceneVideo.id)}?t=${t.toFixed(2)}`);
          }}
          onFocus={() => selectLayer("vr-button")}
        >
          VR
        </button>
      ) : null}

      <button
        className={layerClass("home-button cart-button", "cart-button")}
        data-layer-id="cart-button"
        data-layer-label={cartOpen ? "Close cart" : "Open cart"}
        aria-label={cartOpen ? "Close cart" : "Open cart"}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          selectLayer("cart-button");
          setCartOpen((open) => !open);
          revealHud();
        }}
        onFocus={() => selectLayer("cart-button")}
      >
        Cart
        {cartItemCount > 0 ? <span className="cart-count">{cartItemCount}</span> : null}
      </button>

      <div className="scene-vignette" />
      <div className="ambient-field" aria-hidden="true">
        <span className="spark spark-one" />
        <span className="spark spark-two" />
        <span className="spark spark-three" />
      </div>
      <div className="scene-composition-layer" aria-hidden="true" data-composition-id={sceneComposition.id}>
        <SceneCompositionCanvas videoRef={videoRef} mode={mode} fallback={sceneComposition} regions={characterRegions} />
      </div>

      {cartOpen ? (
        <aside
          className={layerClass("cart-panel", "cart-panel")}
          data-layer-id="cart-panel"
          data-layer-label="Shopping cart"
          aria-label="Shopping cart"
          tabIndex={0}
          onClick={() => selectLayer("cart-panel")}
          onFocus={() => selectLayer("cart-panel")}
        >
          <header>
            <span>Scene cart</span>
            <button
              type="button"
              aria-label="Close cart"
              onClick={(event) => {
                event.stopPropagation();
                setCartOpen(false);
              }}
            >
              Close
            </button>
          </header>
          {cartItems.length > 0 ? (
            <>
              <div className="cart-items">
                {cartItems.map((item) => (
                  <article className="cart-item" key={item.id}>
                    <img
                      src={item.imageUrl}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={(event) => {
                        const image = event.currentTarget;
                        if (image.dataset.fallbackApplied === "true") return;
                        image.dataset.fallbackApplied = "true";
                        image.src = buildCollectiblePlaceholderImage(item.title);
                      }}
                    />
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.sourceTitle}</span>
                      <em>Qty {item.quantity}</em>
                    </div>
                  </article>
                ))}
              </div>
              <footer className="cart-checkout">
                <span>
                  {cartItemCount} item{cartItemCount === 1 ? "" : "s"} from {cartUnitCount} scene match
                  {cartUnitCount === 1 ? "" : "es"}
                </span>
                <button
                  type="button"
                  disabled={checkoutState === "loading" || isMirrorStereo}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleCheckout();
                  }}
                >
                  {checkoutState === "loading" ? "Opening..." : "Checkout"}
                </button>
                {checkoutError ? <em>{checkoutError}</em> : null}
              </footer>
            </>
          ) : (
            <p className="cart-empty">No scene items added yet.</p>
          )}
        </aside>
      ) : null}

      {commerceCollectible ? (
        <aside
          className={layerClass("commerce-card", "commerce-card")}
          data-layer-id="commerce-card"
          data-layer-label="Agentic commerce collectible"
          aria-label="Agentic commerce collectible"
          title="Agentic commerce collectible"
          tabIndex={0}
          onClick={() => selectLayer("commerce-card")}
          onFocus={() => selectLayer("commerce-card")}
        >
          <img
            alt={`${commerceCollectible.title} product preview`}
            className="commerce-card-image"
            loading="lazy"
            referrerPolicy="no-referrer"
            src={commerceCollectible.imageUrl}
            onError={(event) => {
              const image = event.currentTarget;
              if (image.dataset.fallbackApplied === "true") return;
              image.dataset.fallbackApplied = "true";
              image.src = buildCollectiblePlaceholderImage(commerceCollectible.title);
            }}
          />
          <div className="commerce-card-copy">
            <span className="commerce-card-kicker">
              {commerceCartState === "awaiting_confirmation"
                ? "Add to cart?"
                : commerceCartState === "added"
                  ? "Cart request"
                  : "Exa collectible"}
            </span>
            <strong>{commerceCollectible.title}</strong>
            <p>{commerceCollectible.summary}</p>
            {commerceCollectible.sourceUrl === "#" ? (
              <span className="commerce-source-disabled">{commerceCollectible.sourceTitle}</span>
            ) : (
              <a
                href={commerceCollectible.sourceUrl}
                onClick={(event) => event.stopPropagation()}
                target="_blank"
                rel="noreferrer"
              >
                {commerceCollectible.sourceTitle}
              </a>
            )}
          </div>
          {commerceCartState === "awaiting_confirmation" ? (
            <div className="commerce-actions" aria-label="Add item to cart confirmation">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void handleUtterance("yes");
                }}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void handleUtterance("no");
                }}
              >
                No
              </button>
              <span>Say yes or no only</span>
            </div>
          ) : commerceCartState === "added" ? (
            <div className="commerce-actions commerce-actions-done" aria-label="Cart add acknowledged">
              <span>Will add to cart</span>
            </div>
          ) : null}
        </aside>
      ) : null}

      <aside
        className={layerClass(
          `control-guide${mode === "in-scene" ? " navigation-mode" : ""}`,
          "control-guide",
        )}
        data-layer-id="control-guide"
        data-layer-label="Voice controls guide"
        aria-label="Voice controls guide"
        aria-live="polite"
        title="Voice controls guide"
        tabIndex={0}
        onClick={() => selectLayer("control-guide")}
        onFocus={() => selectLayer("control-guide")}
      >
        <div className="guide-wake">
          <span>Wake phrase</span>
          <strong>Hey Vera</strong>
        </div>
        <ul>
          {(mode === "in-scene" ? scenePrompts : controlPrompts).map((prompt) => {
            const label = typeof prompt === "string" ? prompt : prompt.label;
            const layerId = `control-prompt-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
            return (
              <li
                className={layerClass("control-prompt", layerId)}
                data-layer-id={layerId}
                data-layer-label={`Control prompt: ${label}`}
                key={label}
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  selectLayer(layerId);
                  handleGuideClick(label);
                }}
                onFocus={() => selectLayer(layerId)}
                role={mode === "in-scene" ? "button" : undefined}
                aria-label={`Use command: Hey Vera, ${label}`}
              >
                “{label}”
              </li>
            );
          })}
        </ul>
      </aside>

      {shouldShowResponseHistory ? (
        <aside
          className={layerClass("response-history", "response-history")}
          aria-label="Latest response history"
          data-layer-id="response-history"
          data-layer-label="Latest response history"
          title="Latest response history"
          tabIndex={0}
          onClick={() => selectLayer("response-history")}
          onFocus={() => selectLayer("response-history")}
        >
          {visibleHistory.map((item, index) => {
            const speakerAgentId = resolveAgentIdBySpeaker(item.speaker);
            const isActiveSpeaker = Boolean(speakerAgentId && index === latestSpeakerHistoryIndex);
            const speakerClass = item.speaker.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            const segments = formatHistoryText(item.text, item.speaker);
            return (
            <article
              className={`${layerClass("history-item", `history-item-${index}`)} history-item-speaker-${speakerClass} ${
                isActiveSpeaker ? "speaker-highlight" : ""
              }`}
              data-layer-id={`history-item-${index}`}
              data-layer-label={`History item ${index + 1}: ${item.speaker}`}
              key={item.id ?? `${item.speaker}-${index}`}
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                selectLayer(`history-item-${index}`);
              }}
              onFocus={() => selectLayer(`history-item-${index}`)}
            >
              <strong>{item.speaker}</strong>
              <p>
                {segments.map((segment, segmentIndex) => (
                  <span
                    className={segment.kind === "stage" ? "history-stage-direction" : "history-speech"}
                    key={`${segment.kind}-${segment.text}-${segmentIndex}`}
                  >
                    {segment.text}
                  </span>
                ))}
              </p>
            </article>
            );
          })}
        </aside>
      ) : null}

      {latestTool ? (
        <div
          className={layerClass("tool-card", "tool-card")}
          aria-live="polite"
          data-layer-id="tool-card"
          data-layer-label="Router/tool call"
          title="Router/tool call"
          tabIndex={0}
          onClick={() => selectLayer("tool-card")}
          onFocus={() => selectLayer("tool-card")}
        >
          <strong>{latestTool.label}</strong>
          {latestTool.detail ? <span>{latestTool.detail}</span> : null}
        </div>
      ) : null}

      {mode === "generating" ? (
        <div
          className={layerClass("generation-panel", "generation-panel")}
          aria-label="Generation progress"
          data-layer-id="generation-panel"
          data-layer-label="Generation progress"
          tabIndex={0}
          onClick={() => selectLayer("generation-panel")}
          onFocus={() => selectLayer("generation-panel")}
        >
          {generationSteps.map((step, index) => (
            <span
              className={`${layerClass("", `generation-step-${index}`)} ${
                index < generationStep ? "done" : index === generationStep ? "active" : ""
              }`}
              data-layer-id={`generation-step-${index}`}
              data-layer-label={`Generation step: ${step.label}`}
              key={step.label}
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                selectLayer(`generation-step-${index}`);
              }}
              onFocus={() => selectLayer(`generation-step-${index}`)}
            >
              {step.label}
            </span>
          ))}
        </div>
      ) : null}

      <footer
        className={layerClass(
          `bottom-bar${mode === "in-scene" ? " in-scene" : ""}`,
          "bottom-bar",
        )}
        data-layer-id="bottom-bar"
        data-layer-label="Bottom controls bar"
        tabIndex={0}
        onClick={() => selectLayer("bottom-bar")}
        onFocus={() => selectLayer("bottom-bar")}
      >
        {mode === "in-scene" ? (
          <span
            className={layerClass("scene-hint", "scene-hint")}
            data-layer-id="scene-hint"
            data-layer-label="In-scene nav hint"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              selectLayer("scene-hint");
            }}
            onFocus={() => selectLayer("scene-hint")}
          >
            In scene
          </span>
        ) : (
          <>
            <button
              className={layerClass("play-button", "play-button")}
              data-layer-id="play-button"
              data-layer-label="Play button"
              onClick={(event) => {
                event.stopPropagation();
                selectLayer("play-button");
                togglePlayback();
              }}
              onFocus={() => selectLayer("play-button")}
              aria-label="Play or pause"
            >
              {isPlaying ? "Pause" : "Play"}
            </button>
            <span
              className={layerClass("timecode", "current-time")}
              data-layer-id="current-time"
              data-layer-label="Current time"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                selectLayer("current-time");
              }}
              onFocus={() => selectLayer("current-time")}
            >
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              className={layerClass("timeline", "timeline")}
              aria-label="Video progress"
              data-layer-id="timeline"
              data-layer-label="Video timeline"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Number.isFinite(currentTime) ? currentTime : 0}
              disabled={!duration}
              style={{ "--progress": `${progress}%` } as React.CSSProperties}
              onChange={(event) => seekVideo(Number(event.currentTarget.value))}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                selectLayer("timeline");
                isScrubbingRef.current = true;
                event.currentTarget.setPointerCapture(event.pointerId);
                seekFromTimelinePointer(event);
              }}
              onPointerMove={(event) => {
                if (!isScrubbingRef.current) return;
                event.preventDefault();
                event.stopPropagation();
                seekFromTimelinePointer(event);
              }}
              onPointerUp={(event) => {
                event.preventDefault();
                event.stopPropagation();
                isScrubbingRef.current = false;
                event.currentTarget.releasePointerCapture(event.pointerId);
                seekFromTimelinePointer(event);
              }}
              onPointerCancel={() => {
                isScrubbingRef.current = false;
              }}
              onClick={(event) => {
                event.stopPropagation();
                selectLayer("timeline");
              }}
              onFocus={() => selectLayer("timeline")}
            />
            <span
              className={layerClass("timecode", "duration-time")}
              data-layer-id="duration-time"
              data-layer-label="Duration time"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                selectLayer("duration-time");
              }}
              onFocus={() => selectLayer("duration-time")}
            >
              {formatTime(duration)}
            </span>
          </>
        )}
      </footer>

      <button
        className={`${layerClass("vera-dock vera-orb", "vera-orb")} ${
          !voiceEnabled ? "muted" : veraSessionActive ? "session-active" : voiceState
        }`}
        data-layer-id="vera-orb"
        data-layer-label="Vera wake word"
        title={
          !voiceEnabled
            ? "Vera is muted. Click to listen."
            : voiceState === "error"
              ? "OpenAI realtime voice failed. Click to retry."
            : veraSessionActive
              ? "Vera is active. Say stop listening to return to standby."
              : "Vera is in standby. Say Hey Vera to activate. Click to mute."
        }
        aria-label={
          !voiceEnabled
            ? "Start Vera listening"
            : voiceState === "error"
              ? "Retry Vera listening"
            : veraSessionActive
              ? "Vera active"
              : "Mute Vera listening"
        }
        aria-pressed={voiceEnabled}
        onClick={(event) => {
          event.stopPropagation();
          revealHud();
          selectLayer("vera-orb");
          if (!voiceEnabled || voiceState === "error" || !voiceInputRef.current) {
            startVeraListening();
          } else {
            stopVeraListening();
          }
        }}
        onFocus={() => {
          revealHud();
          selectLayer("vera-orb");
        }}
      >
        <span />
        <span />
        <span />
      </button>

      {debugOpen ? (
        <section
          className={layerClass("debug-drawer", "debug-drawer")}
          data-layer-id="debug-drawer"
          data-layer-label="Debug drawer"
          tabIndex={0}
          onClick={() => selectLayer("debug-drawer")}
          onFocus={() => selectLayer("debug-drawer")}
        >
          <div>
            <strong>mode</strong>
            <span>{mode}</span>
          </div>
          <div>
            <strong>voice</strong>
            <span>{voiceState}</span>
          </div>
          <div>
            <strong>intent</strong>
            <span>{lastIntent}</span>
          </div>
          <div>
            <strong>heard</strong>
            <span>{heardText || "none"}</span>
          </div>
          <div>
            <strong>scene</strong>
            <span>{sceneId ?? "not generated"}</span>
          </div>
          <div>
            <strong>memory</strong>
            <span>{memorySummary}</span>
          </div>
          <ol className="trace-list">
            {agentTrace.map((trace, index) => (
              <li key={`${trace.agent}-${trace.step}-${index}`}>
                <strong>{trace.agent}</strong>
                <span>{trace.step}</span>
                <em>{trace.status}</em>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="orientation-lock" aria-live="polite" aria-label="Rotate device prompt">
        <div className="orientation-lock-card">
          <div className="phone-rotate-mark" aria-hidden="true">
            <span className="rotate-arrow" />
          </div>
          <span>Landscape required</span>
          <strong>Rotate your phone</strong>
          <p>Vera is built for horizontal viewing so the scene stays immersive.</p>
        </div>
      </section>


    </main>
  );
}

type AppRoute =
  | { name: "adminVideos" }
  | { name: "catalog" }
  | { name: "logs" }
  | { name: "stereoVideo"; videoId: string }
  | { name: "unlockStatus"; status: "success" | "cancel" }
  | { name: "videos" }
  | { name: "video"; videoId: string };

function parseAppRoute(): AppRoute {
  const searchParams = new URLSearchParams(window.location.search);
  if (window.location.pathname === "/logs" || searchParams.has("logs")) {
    return { name: "logs" };
  }

  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  if (pathname === "/admin/videos") {
    return { name: "adminVideos" };
  }
  if (pathname === "/catalog") {
    return { name: "catalog" };
  }
  if (pathname === "/unlock/success") {
    return { name: "unlockStatus", status: "success" };
  }
  if (pathname === "/unlock/cancel" || pathname === "/unlock/simulated") {
    return { name: "unlockStatus", status: pathname === "/unlock/cancel" ? "cancel" : "success" };
  }

  const stereoVideoMatch = pathname.match(/^\/stereo\/video\/([^/]+)$/);
  if (stereoVideoMatch?.[1]) {
    return { name: "stereoVideo", videoId: decodeURIComponent(stereoVideoMatch[1]) };
  }

  const videoMatch = pathname.match(/^\/video\/([^/]+)$/);
  if (videoMatch?.[1]) {
    return { name: "video", videoId: decodeURIComponent(videoMatch[1]) };
  }

  return { name: "videos" };
}

let routeChangeHandler: (() => void) | null = null;

function registerRouteChangeHandler(handler: () => void) {
  routeChangeHandler = handler;
  return () => {
    routeChangeHandler = null;
  };
}

function navigateTo(path: string, replace = false) {
  window.history[replace ? "replaceState" : "pushState"]({}, "", path);
  routeChangeHandler?.();
}

function videoPath(videoId: string) {
  return `/video/${encodeURIComponent(videoId)}`;
}

function formatVideoPrepareError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/sign in to confirm|not a bot|cookies/i.test(message)) {
    return (
      "YouTube blocked server download, so CineVerse cannot capture frames from this source yet. " +
      "Configure backend YouTube cookies, upload the video, or use a direct MP4 source."
    );
  }

  return message || "Could not prepare video for frame capture.";
}

export default function Root() {
  const [route, setRoute] = useState<AppRoute>(() => parseAppRoute());
  const [videos, setVideos] = useState<CatalogVideo[]>([FALLBACK_CATALOG_VIDEO]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [directVideo, setDirectVideo] = useState<CatalogVideo | null>(null);
  const [directVideoLoading, setDirectVideoLoading] = useState(false);
  const [preparingVideoId, setPreparingVideoId] = useState<string | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const catalogLoadedRef = useRef(false);
  const activeRouteVideoId =
    route.name === "video" || route.name === "stereoVideo" ? route.videoId : null;
  const presentationOnly = new URLSearchParams(window.location.search).get("stereoFrame") === "mirror";
  const prepareInFlightRef = useRef<string | null>(null);
  const routeVideoCandidate =
    activeRouteVideoId
      ? videos.find((video) => video.id === activeRouteVideoId) ??
        directVideo ??
        (activeRouteVideoId === FALLBACK_CATALOG_VIDEO.id ? FALLBACK_CATALOG_VIDEO : null)
      : null;

  function upsertCatalogVideo(video: CatalogVideo) {
    setVideos((current) => {
      const existingIndex = current.findIndex((item) => item.id === video.id);
      if (existingIndex < 0) return [current[0] ?? FALLBACK_CATALOG_VIDEO, video, ...current.slice(1)];

      return current.map((item) => (item.id === video.id ? video : item));
    });
    setDirectVideo((current) => (current?.id === video.id ? video : current));
  }

  useEffect(() => {
    const syncRoute = () => setRoute(parseAppRoute());
    const unregisterRouteHandler = registerRouteChangeHandler(syncRoute);
    window.addEventListener("popstate", syncRoute);
    return () => {
      unregisterRouteHandler();
      window.removeEventListener("popstate", syncRoute);
    };
  }, []);

  useEffect(() => {
    if (window.location.pathname === "/" && route.name === "videos") {
      navigateTo("/videos", true);
    }
  }, [route.name]);

  useEffect(() => {
    document.body.style.overflow =
      route.name === "video" || route.name === "stereoVideo" || route.name === "logs"
        ? "hidden"
        : "auto";
    return () => {
      document.body.style.overflow = "";
    };
  }, [route.name]);

  useEffect(() => {
    if (route.name === "logs" || route.name === "adminVideos" || catalogLoadedRef.current) return;

    catalogLoadedRef.current = true;
    let cancelled = false;
    setCatalogLoading(true);

    listVideos(100)
      .then((response) => {
        if (cancelled) return;
        setVideos(buildCatalogVideos(response?.items ?? []));
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [route.name]);

  useEffect(() => {
    if (!activeRouteVideoId) {
      setDirectVideo(null);
      setDirectVideoLoading(false);
      setPreparingVideoId(null);
      setPrepareError(null);
      prepareInFlightRef.current = null;
      return;
    }

    if (
      activeRouteVideoId === FALLBACK_CATALOG_VIDEO.id ||
      videos.some((video) => video.id === activeRouteVideoId)
    ) {
      setDirectVideo(null);
      setDirectVideoLoading(false);
      return;
    }

    let cancelled = false;
    setDirectVideo(null);
    setDirectVideoLoading(true);

    getVideo(activeRouteVideoId)
      .then((asset) => {
        if (cancelled) return;
        const resolvedVideo = asset ? catalogVideoFromAsset(asset) : null;
        if (!resolvedVideo) {
          navigateTo("/videos", true);
          return;
        }
        setDirectVideo(resolvedVideo);
      })
      .finally(() => {
        if (!cancelled) setDirectVideoLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeRouteVideoId, videos]);

  useEffect(() => {
    if (route.name !== "video" || !routeVideoCandidate) return;
    if (routeVideoCandidate.id === FALLBACK_CATALOG_VIDEO.id || routeVideoCandidate.mediaKind !== "youtube") {
      if (preparingVideoId === routeVideoCandidate.id) setPreparingVideoId(null);
      if (prepareInFlightRef.current === routeVideoCandidate.id) prepareInFlightRef.current = null;
      return;
    }
    if (prepareInFlightRef.current === routeVideoCandidate.id || preparingVideoId === routeVideoCandidate.id || prepareError) return;

    let cancelled = false;
    prepareInFlightRef.current = routeVideoCandidate.id;
    setPreparingVideoId(routeVideoCandidate.id);
    setPrepareError(null);
    logAppEvent({
      category: "api",
      label: `POST /api/admin/videos/${routeVideoCandidate.id}/download`,
      detail: "preparing linked video for frame capture",
      status: "active",
    });
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      const detail =
        "Video preparation timed out. The backend did not return a stored playback URL, so frame capture is not available yet.";
      setPrepareError(detail);
      setPreparingVideoId(null);
      if (prepareInFlightRef.current === routeVideoCandidate.id) prepareInFlightRef.current = null;
      logAppEvent({
        category: "api",
        label: `POST /api/admin/videos/${routeVideoCandidate.id}/download`,
        detail,
        status: "error",
      });
    }, videoPreparationTimeoutMs);

    prepareVideoDownload(routeVideoCandidate.id)
      .then(async (asset) => {
        if (cancelled) return;
        window.clearTimeout(timeoutId);
        const resolvedAsset = asset ?? (await getVideo(routeVideoCandidate.id));
        if (cancelled) return;
        const preparedVideo = resolvedAsset ? catalogVideoFromAsset(resolvedAsset) : null;
        if (!preparedVideo || preparedVideo.mediaKind !== "html-video") {
          setPrepareError("Could not prepare a capturable video copy.");
          logAppEvent({
            category: "api",
            label: `POST /api/admin/videos/${routeVideoCandidate.id}/download`,
            detail: "download did not return a playable media URL",
            status: "error",
          });
          return;
        }

        upsertCatalogVideo(preparedVideo);
        logAppEvent({
          category: "api",
          label: `POST /api/admin/videos/${routeVideoCandidate.id}/download`,
          detail: "stored playback URL ready for frame capture",
          status: "done",
        });
      })
      .catch((error) => {
        if (cancelled) return;
        window.clearTimeout(timeoutId);
        const detail = formatVideoPrepareError(error);
        setPrepareError(detail);
        logAppEvent({
          category: "api",
          label: `POST /api/admin/videos/${routeVideoCandidate.id}/download`,
          detail,
          status: "error",
        });
      })
      .finally(() => {
        if (!cancelled) {
          setPreparingVideoId(null);
          if (prepareInFlightRef.current === routeVideoCandidate.id) prepareInFlightRef.current = null;
        }
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      if (prepareInFlightRef.current === routeVideoCandidate.id) prepareInFlightRef.current = null;
    };
  }, [prepareError, route.name, routeVideoCandidate?.id, routeVideoCandidate?.mediaKind]);

  if (route.name === "logs") {
    return <LogsPage />;
  }

  if (route.name === "adminVideos") {
    return <AdminVideosPage onOpenVideo={(videoId) => navigateTo(videoPath(videoId))} />;
  }

  if (route.name === "catalog") {
    return (
      <MovieCatalogPage
        videos={videos}
        isLoading={catalogLoading}
        onOpenVideo={(videoId) => navigateTo(videoPath(videoId))}
        onGoHome={() => navigateTo("/videos")}
        onOpenAdmin={() => navigateTo("/admin/videos")}
      />
    );
  }

  if (route.name === "videos") {
    return (
      <Landing
        videos={videos}
        isLoading={catalogLoading}
        onOpenVideo={(videoId) => navigateTo(videoPath(videoId))}
        onOpenCatalog={() => navigateTo("/catalog")}
        onOpenAdmin={() => navigateTo("/admin/videos")}
      />
    );
  }

  if (route.name === "unlockStatus") {
    const searchParams = new URLSearchParams(window.location.search);
    const sceneParam = searchParams.get("sceneId");
    const sessionId = searchParams.get("session_id");
    const success = route.status === "success";
    return (
      <main className={`route-loading unlock-status ${success ? "success" : "cancel"}`} aria-live="polite">
        <span>{success ? "Checkout complete" : "Checkout canceled"}</span>
        <p>
          {success
            ? "Scene commerce is confirmed. You can return to the catalog or continue the demo."
            : "No payment was completed. Your scene cart can be rebuilt from the movie moment."}
        </p>
        {sessionId ? <p className="unlock-session">Session {sessionId}</p> : null}
        {sceneParam ? <p className="unlock-session">Scene {sceneParam}</p> : null}
        <div className="route-actions">
          <button type="button" onClick={() => navigateTo("/catalog")}>Back to catalog</button>
          <button type="button" onClick={() => navigateTo("/videos")}>Open app</button>
        </div>
      </main>
    );
  }

  const activeVideo = routeVideoCandidate;

  if (!activeVideo) {
    return (
      <main className="route-loading" aria-live="polite">
        <span>{directVideoLoading ? "Loading video..." : "Video unavailable"}</span>
        <button type="button" onClick={() => navigateTo("/catalog")}>Back to catalog</button>
      </main>
    );
  }

  if (activeVideo.mediaKind === "youtube") {
    return (
      <main className="route-loading" aria-live="polite">
        <span>{prepareError ? "Video preparation failed" : "Preparing interactive video..."}</span>
        <p>
          {prepareError ??
            "Downloading and storing this source so CineVerse can capture frames from the movie scene. This can take a minute."}
        </p>
        {prepareError ? <button type="button" onClick={() => window.location.reload()}>Retry download</button> : null}
        <button type="button" onClick={() => navigateTo("/catalog")}>Back to catalog</button>
      </main>
    );
  }

  if (route.name === "stereoVideo") {
    return (
      <StereoViewer
        video={activeVideo}
        onExit={(time = 0) => navigateTo(`${videoPath(activeVideo.id)}?t=${Math.max(0, time).toFixed(2)}`)}
      />
    );
  }

  return (
    <App
      key={activeVideo.id}
      video={activeVideo}
      onExit={() => navigateTo("/videos")}
      presentationOnly={presentationOnly}
    />
  );
}
