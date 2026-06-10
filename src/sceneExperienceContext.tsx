import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { AgentTrace, SceneAnalysisResponse } from "./sceneverseApi";

export type SceneAgent = {
  id: string;
  name: string;
  role: string;
  emotionalState?: string;
  personality?: string;
  goals?: string[];
  knowledgeBoundaries?: string[];
  speakingStyle?: string;
  /** Normalized [left, top, right, bottom] box (0-1) from AI scene analysis. */
  box?: [number, number, number, number] | null;
};

type SceneExperienceContextValue = {
  sceneId: string | null;
  sceneSummary: string;
  sceneObjects: string[];
  memorySummary: string;
  agentTrace: AgentTrace[];
  agents: SceneAgent[];
  activeAgentId: string;
  activeAgent: SceneAgent;
  applySceneAnalysis: (analysis: SceneAnalysisResponse) => void;
  setActiveAgentId: (agentId: string) => void;
  setAgentTrace: (trace: AgentTrace[]) => void;
  setMemorySummary: (summary: string) => void;
};

const directorAgent: SceneAgent = {
  id: "director",
  name: "Director",
  role: "story lens",
  emotionalState: "observant",
  personality: "analytical, cinematic, continuity-focused",
  goals: ["explain scene meaning", "maintain story consistency"],
  knowledgeBoundaries: ["Can use scene metadata and public context when routed by the orchestrator."],
  speakingStyle: "clear, interpretive, concise",
};

const defaultAgents: SceneAgent[] = [
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
  directorAgent,
];

const initialAgentTrace: AgentTrace[] = [
  { agent: "Vercel Frontend", step: "video player mounted", status: "done" },
  { agent: "MVP Memory", step: "cached fallback loaded", status: "fallback" },
];

const initialMemorySummary = "Preview memory: Vader has challenged Yoda's restraint.";

const SceneExperienceContext = createContext<SceneExperienceContextValue | null>(null);

function withDirectorAgent(sceneAgents: SceneAgent[]): SceneAgent[] {
  return sceneAgents.some((agent) => agent.id === "director") ? sceneAgents : [...sceneAgents, directorAgent];
}

export function SceneExperienceProvider({ children }: { children: ReactNode }) {
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [sceneSummary, setSceneSummary] = useState("");
  const [sceneObjects, setSceneObjects] = useState<string[]>([]);
  const [memorySummary, setMemorySummary] = useState(initialMemorySummary);
  const [agentTrace, setAgentTrace] = useState<AgentTrace[]>(initialAgentTrace);
  const [agents, setAgents] = useState<SceneAgent[]>(defaultAgents);
  const [activeAgentId, setActiveAgentId] = useState("shadow");

  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) ?? agents[0],
    [activeAgentId, agents],
  );

  const value = useMemo<SceneExperienceContextValue>(
    () => ({
      sceneId,
      sceneSummary,
      sceneObjects,
      memorySummary,
      agentTrace,
      agents,
      activeAgentId,
      activeAgent,
      applySceneAnalysis: (analysis) => {
        const nextAgents = withDirectorAgent(analysis.characters);
        setSceneId(analysis.sceneId);
        setSceneSummary(analysis.sceneSummary);
        setSceneObjects(analysis.objects);
        setAgents(nextAgents);
        setMemorySummary(analysis.memorySummary);
        setAgentTrace(analysis.agentTrace);
        setActiveAgentId(nextAgents.find((agent) => agent.id !== "director")?.id ?? "director");
      },
      setActiveAgentId,
      setAgentTrace,
      setMemorySummary,
    }),
    [activeAgent, activeAgentId, agentTrace, agents, memorySummary, sceneId, sceneObjects, sceneSummary],
  );

  return <SceneExperienceContext.Provider value={value}>{children}</SceneExperienceContext.Provider>;
}

export function useSceneExperience() {
  const value = useContext(SceneExperienceContext);
  if (!value) {
    throw new Error("useSceneExperience must be used inside SceneExperienceProvider");
  }
  return value;
}
