import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  analyzeScene,
  sendChat,
  type AgentTrace,
  type AppMode,
  type ChatResponse,
  type Intent,
} from "./sceneverseApi";
import "./styles.css";

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

const agents: Agent[] = [
  { id: "mentor", name: "Yoda", role: "mentor" },
  { id: "shadow", name: "Vader", role: "antagonist" },
  { id: "director", name: "Director", role: "story lens" },
];

const generationSteps: ToolEvent[] = [
  { label: "Frame captured", detail: "hero moment locked" },
  { label: "Scene Parser", detail: "reading tension" },
  { label: "Agents created", detail: "mentor, shadow, director" },
  { label: "Memory initialized", detail: "scene state ready" },
];

const promptSamples = [
  "step into this scene",
  "pause",
  "rewind 10 seconds",
  "fast forward 20 seconds",
  "ask Yoda why the blade matters",
  "director, what does this duel mean?",
  "collect this moment",
];

const controlPrompts = [
  "pause the video",
  "rewind 10 seconds",
  "fast forward 20 seconds",
  "step into this scene",
  "ask Yoda about the duel",
  "collect this moment",
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
    aliases: ["focus yoda", "yoda focus", "talk yoda", "ask yoda"],
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
    label: "Return to cinematic controls",
    aliases: ["return", "exit", "back to timeline", "leave scene", "cinematic controls"],
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
  const generationTimerRef = useRef<number | null>(null);
  const responseTimerRef = useRef<number | null>(null);

  const [mode, setMode] = useState<AppMode>("watching");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [caption, setCaption] = useState("Say “step into this scene”");
  const [heardText, setHeardText] = useState("");
  const [latestTool, setLatestTool] = useState<ToolEvent | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([
    { speaker: "You", text: "Vader, why are you here?" },
    { speaker: "Vader", text: "The duel is not a question. It is a warning." },
    { speaker: "You", text: "What do you want from Yoda?" },
    { speaker: "Vader", text: "Surrender, or proof that his patience can break." },
  ]);
  const [activeAgentId, setActiveAgentId] = useState("shadow");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [generationStep, setGenerationStep] = useState(-1);
  const [debugOpen, setDebugOpen] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [manualText, setManualText] = useState("");
  const [lastIntent, setLastIntent] = useState<Intent | "none">("none");
  const [selectedLayer, setSelectedLayer] = useState("scene-video");
  const [savedMoment, setSavedMoment] = useState(false);
  const [sceneId, setSceneId] = useState<string | null>(null);
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
    [activeAgentId],
  );
  const visibleHistory = history.slice(-4);
  const centerCaption =
    caption && caption !== "Say “step into this scene”" ? caption : "";

  function layerClass(baseClass: string, layerId: string) {
    return `${baseClass} layer-target ${selectedLayer === layerId ? "layer-selected" : ""}`;
  }

  function selectLayer(layerId: string) {
    setSelectedLayer(layerId);
  }

  useEffect(() => {
    return () => {
      if (generationTimerRef.current) window.clearInterval(generationTimerRef.current);
      if (responseTimerRef.current) window.clearTimeout(responseTimerRef.current);
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
    recognition.onstart = () => setVoiceState("listening");
    recognition.onerror = () => setVoiceState("error");
    recognition.onend = () => {
      if (recognitionRef.current) {
        try {
          recognition.start();
        } catch {
          setVoiceState("idle");
        }
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
      if (heard) {
        setHeardText(heard);
        setCaption(heard);
      }
      if (final.trim()) {
        handleUtterance(final.trim());
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
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
    setMemorySummary(analysis.memorySummary);
    setAgentTrace(analysis.agentTrace);
    setMode("in-scene");
    setGenerationStep(-1);
    setActiveAgentId("mentor");
    showTool({ label: "CineVerse ready", detail: "voice routed to agents" });
    speakResponse("The duel has opened. Speak, and the scene will answer.", "Director");
  }

  function handleVideoControl(action: ChatResponse["action"]) {
    const video = videoRef.current;
    if (!video) return;

    if (action === "pause") {
      video.pause();
      setIsPlaying(false);
      showTool({ label: "Tool: pause video" });
    }
    if (action === "play") {
      void video.play();
      setIsPlaying(true);
      showTool({ label: "Tool: play video" });
    }
    if (action === "rewind") {
      video.currentTime = Math.max(0, video.currentTime - 10);
      showTool({ label: "Tool: rewind", detail: "-10 seconds" });
    }
    if (action === "forward") {
      video.currentTime = Math.min(
        duration || video.duration || video.currentTime + 20,
        video.currentTime + 20,
      );
      showTool({ label: "Tool: fast forward", detail: "+20 seconds" });
    }
  }

  async function handleUtterance(utterance: string) {
    setVoiceState("thinking");
    setHeardText(utterance);
    pushHistory({ speaker: "You", text: utterance });

    if (mode === "in-scene") {
      const inSceneNavigation = matchInSceneNavigationCommand(utterance);
      if (inSceneNavigation) {
        if (inSceneNavigation.targetAgentId) {
          setActiveAgentId(inSceneNavigation.targetAgentId);
        }
        if (inSceneNavigation.exitMode) {
          setMode(inSceneNavigation.exitMode);
        }
        showTool({ label: "Navigation control", detail: inSceneNavigation.detail });
        speakResponse(inSceneNavigation.response, "Director");
        return;
      }
    }

    const routed = await sendChat({
      sceneId,
      message: utterance,
      targetAgentId: activeAgentId,
      playback: {
        currentTime,
        isPlaying,
        mode,
      },
    });

    setLastIntent(routed.intent);
    setMemorySummary(routed.updatedMemorySummary);
    setAgentTrace(routed.agentTrace);
    showTool({
      label:
        routed.intent === "video_control"
          ? "Router: video command"
          : routed.intent === "scene_generation"
            ? "Router: scene command"
            : routed.intent === "commerce_collect"
              ? "Router: collect intent"
              : routed.intent === "director_question"
                ? "Router: director question"
                : routed.intent === "character_chat"
                  ? "Router: character question"
                  : "Router: clarify",
    });

    if (routed.targetAgentId) setActiveAgentId(routed.targetAgentId);

    if (routed.intent === "video_control") {
      handleVideoControl(routed.action);
      speakResponse(routed.response ?? "Done.", "CineVerse");
      return;
    }

    if (routed.intent === "scene_generation") {
      runGeneration();
      return;
    }

    if (routed.intent === "commerce_collect") {
      setSavedMoment(true);
    }

    window.setTimeout(() => {
      const speaker = routed.respondingAgent;
      showTool({ label: "Memory updated", detail: routed.intent.replace("_", " ") });
      speakResponse(routed.response, speaker);
    }, 650);
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
      void handleUtterance(prompt);
      return;
    }
    setManualText(prompt);
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }

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

      <header
        className={layerClass("top-bar", "top-bar")}
        data-layer-id="top-bar"
        data-layer-label="Top status bar"
        title="Top status bar"
        tabIndex={0}
        onClick={() => selectLayer("top-bar")}
        onFocus={() => selectLayer("top-bar")}
      >
        <div
          className={layerClass("brand-lockup", "brand-lockup")}
          data-layer-id="brand-lockup"
          data-layer-label="Product state"
          title="Product state"
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation();
            selectLayer("brand-lockup");
          }}
          onFocus={() => selectLayer("brand-lockup")}
        >
          <strong>CineVerse</strong>
          <span>{mode === "in-scene" ? "in scene" : "voice companion"}</span>
        </div>
        <div
          className={layerClass("top-prompt", "top-prompt")}
          data-layer-id="top-prompt"
          data-layer-label="Voice prompt"
          title="Voice prompt"
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation();
            selectLayer("top-prompt");
          }}
          onFocus={() => selectLayer("top-prompt")}
        >
          <span>{mode === "in-scene" ? "Scene Voice" : "Voice command"}</span>
          <strong>
            {mode === "generating"
              ? "Generating CineVerse..."
              : mode === "in-scene"
                ? `Speak to ${activeAgent.name} or say “Director...”`
                : "Say “step into this scene”"}
          </strong>
        </div>
        <button
          className={layerClass("ghost-button", "trace-button")}
          data-layer-id="trace-button"
          data-layer-label="Trace toggle"
          onClick={(event) => {
            event.stopPropagation();
            selectLayer("trace-button");
            setDebugOpen((open) => !open);
          }}
          onFocus={() => selectLayer("trace-button")}
        >
          Trace
        </button>
      </header>

      <aside
        className={layerClass("agent-stack", "agent-stack")}
        aria-label="Active agents"
        data-layer-id="agent-stack"
        data-layer-label="Character agent stack"
        title="Character agents"
        tabIndex={0}
        onClick={() => selectLayer("agent-stack")}
        onFocus={() => selectLayer("agent-stack")}
      >
        {agents.map((agent) => (
          <button
            className={`${layerClass("agent-chip", `agent-${agent.id}`)} ${
              agent.id === activeAgentId ? "active" : ""
            } ${
              voiceState === "speaking" && agent.id === activeAgentId ? "speaking" : ""
            }`}
            key={agent.id}
            data-layer-id={`agent-${agent.id}`}
            data-layer-label={`${agent.name} agent chip`}
            title={`${agent.name} agent: ${agent.role}`}
            onClick={(event) => {
              event.stopPropagation();
              selectLayer(`agent-${agent.id}`);
              setActiveAgentId(agent.id);
            }}
            onFocus={() => selectLayer(`agent-${agent.id}`)}
          >
            <span>{agent.name.slice(0, 1)}</span>
            <strong>{agent.name}</strong>
            <em>{agent.role}</em>
          </button>
        ))}
      </aside>

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
        <strong>{mode === "in-scene" ? "Navigation" : "Controls"}</strong>
        <ul>
          {(mode === "in-scene" ? inSceneNavigationPrompts : controlPrompts).map((prompt) => {
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
                aria-label={`Use command: ${label}`}
              >
                “{label}”
              </li>
            );
          })}
        </ul>
      </aside>

      {centerCaption ? (
        <section
          className={layerClass("caption-layer", "caption-layer")}
          aria-live="polite"
          data-layer-id="caption-layer"
          data-layer-label="Caption layer"
          tabIndex={0}
          onClick={() => selectLayer("caption-layer")}
          onFocus={() => selectLayer("caption-layer")}
        >
          <p
            className={layerClass(
              voiceState === "listening" ? "caption listening" : "caption",
              "live-caption",
            )}
            data-layer-id="live-caption"
            data-layer-label="Live caption"
            title="Live caption"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              selectLayer("live-caption");
            }}
            onFocus={() => selectLayer("live-caption")}
          >
            {centerCaption}
          </p>
        </section>
      ) : null}

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
        {visibleHistory.map((item, index) => (
          <article
            className={layerClass("history-item", `history-item-${index}`)}
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
        ))}
      </aside>

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

      {savedMoment ? (
        <aside
          className={layerClass("saved-moment-card", "saved-moment-card")}
          data-layer-id="saved-moment-card"
          data-layer-label="Saved moment card"
          aria-label="Saved moment card"
          title="Saved moment card"
          tabIndex={0}
          onClick={() => selectLayer("saved-moment-card")}
          onFocus={() => selectLayer("saved-moment-card")}
        >
          <span>Collected</span>
          <strong>Duel in the mist</strong>
          <p>Scene card, replica hilt, and poster saved for checkout.</p>
        </aside>
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
            In-scene navigation mode
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
          className={`${layerClass("voice-orb", "voice-orb")} ${voiceState}`}
          data-layer-id="voice-orb"
          data-layer-label="Voice orb"
          title={`Voice status: ${voiceState}. Click to focus demo input.`}
          aria-label={`Voice status: ${voiceState}`}
          onClick={(event) => {
            event.stopPropagation();
            selectLayer("voice-orb");
            const input = document.querySelector<HTMLInputElement>(".demo-input input");
            const inputVisible =
              input && window.getComputedStyle(input).display !== "none" && input.offsetParent;
            if (inputVisible) {
              input.focus();
            } else {
              showTool({ label: "Voice control", detail: voiceState });
            }
          }}
          onFocus={() => selectLayer("voice-orb")}
        >
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

    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
