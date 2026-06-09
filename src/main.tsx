import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  analyzeScene,
  findCollectible,
  sendChat,
  type AgentTrace,
  type AppMode,
  type ChatResponse,
  type CommerceCollectible,
  type Intent,
} from "./sceneverseApi";
import { routeUtterance } from "./sceneRouter";
import "./styles.css";
import Landing from "./Landing";

const videoSrc = "/demo-duel.mp4";

type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "error";

type Agent = {
  id: string;
  name: string;
  role: string;
};

type HistoryItem = {
  speaker: string;
  text: string;
};

type ToolEvent = {
  label: string;
  detail?: string;
};

type InSceneCommand = {
  label: string;
  aliases: string[];
  response: string;
  detail: string;
  targetAgentId?: string;
  exitMode?: AppMode;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{
          isFinal: boolean;
          0: { transcript: string };
        }>;
      }) => void)
    | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const defaultAgents: Agent[] = [
  { id: "mentor", name: "Yoda", role: "mentor" },
  { id: "shadow", name: "Vader", role: "antagonist" },
  { id: "director", name: "Director", role: "story lens" },
];

function withDirectorAgent(sceneAgents: Agent[]): Agent[] {
  const directorExists = sceneAgents.some((agent) => agent.id === "director");
  return directorExists
    ? sceneAgents
    : [...sceneAgents, { id: "director", name: "Director", role: "story lens" }];
}

const generationSteps: ToolEvent[] = [
  { label: "Frame captured", detail: "hero moment locked" },
  { label: "Scene Parser", detail: "reading tension" },
  { label: "Agents created", detail: "mentor, shadow, director" },
  { label: "Memory initialized", detail: "scene state ready" },
];

const promptSamples = [
  "Hey Vera, step into this scene",
  "Hey Vera, pause the video",
  "step into this scene",
  "pause",
  "rewind 10 seconds",
  "fast forward 20 seconds",
  "ask Yoda why the blade matters",
  "director, what does this duel mean?",
  "collect this moment",
  "ask Yoda why Yoda's lightsaber is green",
  "where can I buy that lightsaber?",
  "Exit the scene",
];

const controlPrompts = [
  "play the video",
  "pause the video",
  "rewind 10 seconds",
  "fast forward 20 seconds",
];

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
  const trimmed = text.trim();
  const match = trimmed.match(
    /\bhey\s+vera\b[\s,:;!\-?.]*\s*(.*)$/i,
  );

  if (!match) {
    return { isWakeInvocation: false, command: text.trim() };
  }

  const rawCommand = (match[1] ?? "").trim();
  return {
    isWakeInvocation: true,
    command: rawCommand,
  };
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

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceEnabledRef = useRef(true);
  const veraSessionActiveRef = useRef(false);
  const generationTimerRef = useRef<number | null>(null);
  const responseTimerRef = useRef<number | null>(null);
  const voiceRestartTimerRef = useRef<number | null>(null);

  const [mode, setMode] = useState<AppMode>("watching");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [caption, setCaption] = useState("Say “step into this scene”");
  const [heardText, setHeardText] = useState("");
  const [latestTool, setLatestTool] = useState<ToolEvent | null>(null);
  const [agents, setAgents] = useState<Agent[]>(defaultAgents);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeAgentId, setActiveAgentId] = useState("shadow");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [generationStep, setGenerationStep] = useState(-1);
  const [debugOpen, setDebugOpen] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [veraSessionActive, setVeraSessionActive] = useState(false);
  const [manualText, setManualText] = useState("");
  const [lastIntent, setLastIntent] = useState<Intent | "none">("none");
  const [selectedLayer, setSelectedLayer] = useState("scene-video");
  const [commerceCollectible, setCommerceCollectible] = useState<CommerceCollectible | null>(null);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [sceneObjects, setSceneObjects] = useState<string[]>([]);
  const [memorySummary, setMemorySummary] = useState(
    "Preview memory: Vader has challenged Yoda's restraint.",
  );
  const [agentTrace, setAgentTrace] = useState<AgentTrace[]>([
    { agent: "Vercel Frontend", step: "video player mounted", status: "done" },
    { agent: "MVP Memory", step: "cached fallback loaded", status: "fallback" },
  ]);
  const ttsEnabled = true;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) ?? agents[0],
    [activeAgentId, agents],
  );
  const visibleHistory = history.slice(-4);
  const centerCaption =
    caption && caption !== "Say “step into this scene”" ? caption : "";
  const liveTranscript = voiceState === "listening" ? centerCaption : "";
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

  function layerClass(baseClass: string, layerId: string) {
    return `${baseClass} layer-target ${selectedLayer === layerId ? "layer-selected" : ""}`;
  }

  function selectLayer(layerId: string) {
    setSelectedLayer(layerId);
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

  useEffect(() => {
    return () => {
      voiceEnabledRef.current = false;
      veraSessionActiveRef.current = false;
      if (generationTimerRef.current) window.clearInterval(generationTimerRef.current);
      if (responseTimerRef.current) window.clearTimeout(responseTimerRef.current);
      if (voiceRestartTimerRef.current) window.clearTimeout(voiceRestartTimerRef.current);
      recognitionRef.current?.abort?.();
      recognitionRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceSupported(false);
      setVoiceState("idle");
      setCaption("Voice prototype unavailable. Use demo text.");
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onstart = () => {
      if (voiceEnabledRef.current) setVoiceState("listening");
    };
    recognition.onerror = () => {
      setVoiceState(voiceEnabledRef.current ? "error" : "idle");
    };
    recognition.onend = () => {
      if (recognitionRef.current && voiceEnabledRef.current) {
        try {
          recognition.start();
        } catch {
          setVoiceState("idle");
        }
      } else {
        setVoiceState("idle");
      }
    };
    recognition.onresult = (event) => {
      let interim = "";
      let final = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }

      const heard = (final || interim).trim();
      const heardWake = heard ? parseWakeCommand(heard) : null;
      if (veraSessionActiveRef.current && heard) {
        setHeardText(heard);
        setCaption(heard);
      } else if (heardWake?.isWakeInvocation) {
        setHeardText(formatWakeCaption(heardWake.command));
        setCaption(heardWake.command ? heardWake.command : "Listening...");
      }
      if (final.trim()) {
        handleVoiceFinal(final.trim());
      }
    };

    recognitionRef.current = recognition;
    try {
      if (voiceEnabledRef.current) recognition.start();
    } catch {
      setVoiceState("idle");
    }
  }, []);

  function pushHistory(item: HistoryItem) {
    setHistory((items) => [...items.slice(-7), item]);
  }

  function showTool(event: ToolEvent, clearAfter = 2400) {
    setLatestTool(event);
    if (responseTimerRef.current) window.clearTimeout(responseTimerRef.current);
    responseTimerRef.current = window.setTimeout(() => setLatestTool(null), clearAfter);
  }

  function activateVeraSession() {
    if (voiceRestartTimerRef.current) {
      window.clearTimeout(voiceRestartTimerRef.current);
      voiceRestartTimerRef.current = null;
    }
    veraSessionActiveRef.current = true;
    setVeraSessionActive(true);
    setVoiceState(voiceSupported ? "listening" : "idle");
    setCaption("I'm listening.");
    showTool({ label: "Vera active", detail: "Say “stop listening” to end" });
  }

  function restartStandbyRecognition() {
    const recognition = recognitionRef.current;
    if (!recognition || !voiceEnabledRef.current) return;

    if (voiceRestartTimerRef.current) {
      window.clearTimeout(voiceRestartTimerRef.current);
      voiceRestartTimerRef.current = null;
    }

    try {
      recognition.abort?.();
      recognition.stop();
    } catch {
      // Recognition may already be ending; the delayed start below re-arms standby.
    }

    voiceRestartTimerRef.current = window.setTimeout(() => {
      voiceRestartTimerRef.current = null;
      if (!voiceEnabledRef.current || recognitionRef.current !== recognition) return;

      try {
        recognition.start();
      } catch {
        setVoiceState("listening");
      }
    }, 180);
  }

  function deactivateVeraSession() {
    veraSessionActiveRef.current = false;
    setVeraSessionActive(false);
    setVoiceState(voiceSupported && voiceEnabledRef.current ? "listening" : "idle");
    setCaption("");
    showTool({ label: "Vera standby", detail: "Say “Hey Vera” to activate" });
    restartStandbyRecognition();
  }

  function stopVeraListening() {
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
    recognitionRef.current?.abort?.();
    recognitionRef.current?.stop();
    showTool({ label: "Vera muted", detail: "Click Vera to listen again" });
  }

  function startVeraListening() {
    if (!voiceSupported) {
      showTool({ label: "Voice unavailable", detail: "Use demo text input" });
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
    try {
      recognitionRef.current?.start();
    } catch {
      setVoiceState("listening");
    }
    showTool({ label: "Vera listening", detail: "Say “Hey Vera” to activate" });
  }

  function speakWithTts(text: string, speaker: string) {
    if (!ttsEnabled || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.92;
    utterance.volume = 0.95;

    if (speaker === "Vader") {
      utterance.pitch = 0.55;
      utterance.rate = 0.82;
    } else if (speaker === "Yoda") {
      utterance.pitch = 1.18;
      utterance.rate = 0.86;
    } else if (speaker === "Director") {
      utterance.pitch = 0.92;
      utterance.rate = 0.9;
    }

    window.speechSynthesis.speak(utterance);
  }

  function speakResponse(response: string, speaker: string) {
    const speakerAgentId = resolveAgentIdBySpeaker(speaker);
    if (speakerAgentId) setActiveAgentId(speakerAgentId);
    setVoiceState("speaking");
    setCaption(response);
    pushHistory({ speaker, text: response });
    if (speaker !== "You" && speaker !== "CineVerse") {
      speakWithTts(response, speaker);
    }
    window.setTimeout(() => {
      setVoiceState(voiceSupported ? "listening" : "idle");
      if (mode === "watching") setCaption("");
    }, 3200);
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

  async function runGeneration() {
    const video = videoRef.current;
    video?.pause();
    setIsPlaying(false);
    setMode("generating");
    setGenerationStep(0);
    setCaption("Stepping into this scene...");
    setAgentTrace([
      { agent: "Vercel Frontend", step: "paused frame + timestamp captured", status: "active" },
      { agent: "AWS FastAPI Backend", step: "scene analysis request pending", status: "queued" },
    ]);
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
    const analysis = await analyzeScene({
      frame: captureFrame(),
      timestamp: video?.currentTime ?? currentTime,
      transcriptSegment:
        "Two powerful figures face each other in a misted forest. A green blade glows between restraint and threat.",
      videoMetadata: {
        title: "Yoda vs Vader: The Duel That Never Was",
        source: videoSrc,
        duration: duration || video?.duration || 0,
      },
    });

    setSceneId(analysis.sceneId);
    setSceneObjects(analysis.objects);
    setAgents(withDirectorAgent(analysis.characters));
    setMemorySummary(analysis.memorySummary);
    setAgentTrace(analysis.agentTrace);
    setMode("in-scene");
    setGenerationStep(-1);
    setActiveAgentId(analysis.characters[0]?.id ?? "director");
    showTool({
      label: "Scene agents created",
      detail: analysis.characters.map((agent) => agent.name).join(", ") || "Director",
    });
    speakResponse("The duel has opened. Speak, and the scene will answer.", "Director");
  }

  async function playVideo() {
    const video = videoRef.current;
    if (!video) return false;

    if (video.ended) {
      video.currentTime = 0;
    }

    try {
      await video.play();
    } catch {
      try {
        video.muted = true;
        await video.play();
      } catch {
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
    if (!video) return false;

    video.pause();
    setIsPlaying(false);
    return video.paused;
  }

  async function handleVideoControl(action: ChatResponse["action"]) {
    const video = videoRef.current;
    if (!video) return false;

    if (action === "pause") {
      const paused = pauseVideo();
      showTool({ label: paused ? "Tool: pause video" : "Pause unavailable" });
      return paused;
    }

    if (action === "play") {
      const played = await playVideo();
      if (played) showTool({ label: "Tool: play video" });
      return played;
    }

    if (action === "rewind") {
      video.currentTime = Math.max(0, video.currentTime - 10);
      setCurrentTime(video.currentTime);
      showTool({ label: "Tool: rewind", detail: "-10 seconds" });
      return true;
    }

    if (action === "forward") {
      video.currentTime = Math.min(
        duration || video.duration || video.currentTime + 20,
        video.currentTime + 20,
      );
      setCurrentTime(video.currentTime);
      showTool({ label: "Tool: fast forward", detail: "+20 seconds" });
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

  async function handleUtterancePayload(utterance: string) {
    setVoiceState("thinking");

    const route = routeUtterance({
      utterance,
      mode,
      agents,
      activeAgentId,
      sceneObjects,
    });
    setLastIntent(route.intent);
    setAgentTrace(route.agentTrace);
    showTool(route.tool);

    if (route.kind === "video_control") {
      const handled = await handleVideoControl(route.action);
      setLastIntent("video_control");
      speakResponse(
        !handled ? "Playback needs a tap first." : route.response ?? "Done.",
        "CineVerse",
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

    const routed = await sendChat({
      sceneId,
      message: utterance,
      targetAgentId: route.targetAgentId ?? activeAgentId,
      playback: {
        currentTime,
        isPlaying,
        mode,
      },
    });

    const finalIntent = route.intent === "fallback_clarify" ? routed.intent : route.intent;
    setLastIntent(finalIntent);
    setMemorySummary(routed.updatedMemorySummary);
    setAgentTrace([...route.agentTrace, ...routed.agentTrace]);
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

    const targetAgentId = route.targetAgentId ?? routed.targetAgentId;
    if (targetAgentId) setActiveAgentId(targetAgentId);

    if (finalIntent === "video_control") {
      await handleVideoControl(routed.action);
      speakResponse(routed.response ?? "Done.", "CineVerse");
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
    }

    window.setTimeout(() => {
      const speaker = routed.respondingAgent;
      showTool({ label: "Memory updated", detail: finalIntent.replace("_", " ") });
      speakResponse(routed.response, speaker);
    }, 650);
  }

  function handleUtterance(utterance: string) {
    if (!utterance.trim()) return;
    const parsed = parseWakeCommand(utterance);
    setHeardText(utterance);
    pushHistory({ speaker: "You", text: utterance });

    if (parsed.isWakeInvocation) {
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

  function handleManualSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = manualText.trim();
    if (!text) return;
    setManualText("");
    handleUtterance(text);
  }

  function handleGuideClick(prompt: string) {
    const matched = matchInSceneNavigationCommand(prompt);
    if (mode === "in-scene" && matched) {
      void handleUtterance(`Hey Vera, ${prompt}`);
      return;
    }
    setManualText(`Hey Vera, ${prompt}`);
  }

  function handleVoiceFinal(utterance: string) {
    if (!utterance.trim()) return;

    if (veraSessionActiveRef.current) {
      handleUtterance(utterance);
      return;
    }

    const parsed = parseWakeCommand(utterance);
    if (!parsed.isWakeInvocation) return;

    activateVeraSession();
    if (parsed.command) {
      handleUtterance(formatWakeCaption(parsed.command));
    }
  }

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
  const shouldShowResponseHistory = visibleHistory.length > 0 || Boolean(liveTranscript);

  return (
    <main
      className={`experience mode-${mode}`}
      data-layer-id="app-root"
      data-layer-label="App root"
      onPointerDownCapture={(event) => {
        const target = event.target as HTMLElement | null;
        const layer = target?.closest<HTMLElement>("[data-layer-id]");
        if (layer?.dataset.layerId) {
          setSelectedLayer(layer.dataset.layerId);
        }
      }}
    >
      <video
        ref={videoRef}
        className={layerClass("scene-video", "scene-video")}
        data-layer-id="scene-video"
        data-layer-label="Scene video"
        aria-label="Scene video"
        src={videoSrc}
        playsInline
        preload="metadata"
        onClick={() => selectLayer("scene-video")}
        onFocus={() => selectLayer("scene-video")}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
      />

      <div className="scene-vignette" />
      <div className="ambient-field" aria-hidden="true">
        <span className="spark spark-one" />
        <span className="spark spark-two" />
        <span className="spark spark-three" />
      </div>
      <div className="generation-wave" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

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
          <span>Exa collectible</span>
          <strong>{commerceCollectible.title}</strong>
          <p>{commerceCollectible.summary}</p>
          <a
            href={commerceCollectible.sourceUrl}
            onClick={(event) => event.stopPropagation()}
            target="_blank"
            rel="noreferrer"
          >
            {commerceCollectible.sourceTitle}
          </a>
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
            return (
            <article
              className={`${layerClass("history-item", `history-item-${index}`)} ${
                isActiveSpeaker ? "speaker-highlight" : ""
              }`}
              data-layer-id={`history-item-${index}`}
              data-layer-label={`History item ${index + 1}: ${item.speaker}`}
              key={`${item.speaker}-${item.text}-${index}`}
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                selectLayer(`history-item-${index}`);
              }}
              onFocus={() => selectLayer(`history-item-${index}`)}
            >
              <strong>{item.speaker}</strong>
              <p>{item.text}</p>
            </article>
            );
          })}
          {liveTranscript ? (
            <article
              className={layerClass("history-item live-transcript", "live-transcript")}
              data-layer-id="live-transcript"
              data-layer-label="Live voice transcript"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                selectLayer("live-transcript");
              }}
              onFocus={() => selectLayer("live-transcript")}
            >
              <strong>You</strong>
              <p>{liveTranscript}</p>
            </article>
          ) : null}
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
            <div
              className={layerClass("timeline", "timeline")}
              aria-label="Video progress"
              data-layer-id="timeline"
              data-layer-label="Video timeline"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                selectLayer("timeline");
              }}
              onFocus={() => selectLayer("timeline")}
            >
              <span
                data-layer-id="timeline-progress"
                data-layer-label="Timeline progress"
                style={{ width: `${progress}%` }}
              />
            </div>
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
        <button
          className={`${layerClass("vera-orb", "vera-orb")} ${
            !voiceEnabled ? "muted" : veraSessionActive ? "session-active" : voiceState
          }`}
          data-layer-id="vera-orb"
          data-layer-label="Vera wake word"
          title={
            !voiceEnabled
              ? "Vera is muted. Click to listen."
              : veraSessionActive
                ? "Vera is active. Say stop listening to return to standby."
                : "Vera is in standby. Say Hey Vera to activate. Click to mute."
          }
          aria-label={
            !voiceEnabled
              ? "Start Vera listening"
              : veraSessionActive
                ? "Vera active"
                : "Mute Vera listening"
          }
          aria-pressed={voiceEnabled}
          onClick={(event) => {
            event.stopPropagation();
            selectLayer("vera-orb");
            if (voiceEnabled) {
              stopVeraListening();
            } else {
              startVeraListening();
            }
          }}
          onFocus={() => selectLayer("vera-orb")}
        >
          <span />
          <span />
          <span />
        </button>
        <form
          className={layerClass("demo-input", "demo-input")}
          data-layer-id="demo-input"
          data-layer-label="Demo text input group"
          onSubmit={handleManualSubmit}
          onClick={(event) => {
            event.stopPropagation();
            selectLayer("demo-input");
          }}
        >
          <input
            className={layerClass("", "demo-text-input")}
            data-layer-id="demo-text-input"
            data-layer-label="Demo text input"
            aria-label="Demo voice text"
            list="prompt-samples"
            placeholder={voiceSupported ? "Demo override..." : "Say anything..."}
            value={manualText}
            onChange={(event) => setManualText(event.target.value)}
            onFocus={() => selectLayer("demo-text-input")}
          />
          <datalist id="prompt-samples">
            {promptSamples.map((sample) => (
              <option key={sample} value={sample} />
            ))}
          </datalist>
          <button
            className={layerClass("", "send-button")}
            data-layer-id="send-button"
            data-layer-label="Send button"
            type="submit"
            onClick={() => selectLayer("send-button")}
            onFocus={() => selectLayer("send-button")}
          >
            Send
          </button>
        </form>
      </footer>

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
          <p>CineVerse is built for horizontal viewing so the scene stays immersive.</p>
        </div>
      </section>

    </main>
  );
}

function Root() {
  const [inExperience, setInExperience] = useState(false);

  useEffect(() => {
    document.body.style.overflow = inExperience ? "hidden" : "auto";
    return () => { document.body.style.overflow = ""; };
  }, [inExperience]);

  if (!inExperience) {
    return <Landing onEnter={() => setInExperience(true)} />;
  }

  return <App />;
}

const rootElement = document.getElementById("root") as HTMLElement & {
  sceneVerseRoot?: Root;
};

rootElement.sceneVerseRoot ??= createRoot(rootElement);
rootElement.sceneVerseRoot.render(<Root />);
