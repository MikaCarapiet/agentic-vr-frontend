export type StereoRole = "primary" | "mirror" | null;

export type StereoEvent =
  | { type: "time"; t: number; playing: boolean }
  | { type: "video-control"; action: "play" | "pause" | "rewind" | "forward"; seconds?: number }
  | { type: "heard"; text: string }
  | { type: "speak"; speaker: string; text: string }
  | { type: "mode"; mode: "watching" | "generating" | "in-scene" }
  | { type: "scene-analysis"; analysis: unknown }
  | { type: "tool"; label: string; detail?: string }
  | { type: "commerce"; collectible: unknown };

const channelPrefix = "sceneverse:stereo";
const stereoFrameParam = "stereoFrame";

const channelsByVideoId = new Map<string, BroadcastChannel>();

function readStereoRole(): StereoRole {
  if (typeof window === "undefined") return null;

  const rawRole = new URLSearchParams(window.location.search).get(stereoFrameParam);
  if (rawRole === "primary" || rawRole === "mirror") return rawRole;
  if (rawRole === "left" || rawRole === "right") return "mirror";
  return null;
}

function canUseBroadcastChannel() {
  return typeof BroadcastChannel !== "undefined";
}

function channelNameForVideo(videoId: string) {
  return `${channelPrefix}:${encodeURIComponent(videoId)}`;
}

export const stereoRole: StereoRole = readStereoRole();

export function getStereoChannel(videoId: string): BroadcastChannel | null {
  if (!canUseBroadcastChannel()) return null;

  const existingChannel = channelsByVideoId.get(videoId);
  if (existingChannel) return existingChannel;

  const channel = new BroadcastChannel(channelNameForVideo(videoId));
  channelsByVideoId.set(videoId, channel);
  return channel;
}

export function publishStereoEvent(videoId: string, event: StereoEvent): void {
  if (stereoRole !== "primary") return;

  getStereoChannel(videoId)?.postMessage(event);
}

export function broadcastStereoEvent(videoId: string, event: StereoEvent): void {
  getStereoChannel(videoId)?.postMessage(event);
}

export function subscribeStereoEvents(videoId: string, handler: (event: StereoEvent) => void): () => void {
  if (stereoRole !== "mirror") return () => {};

  return subscribeStereoChannel(videoId, handler);
}

export function subscribeStereoChannel(videoId: string, handler: (event: StereoEvent) => void): () => void {
  const channel = getStereoChannel(videoId);
  if (!channel) return () => {};

  const onMessage = (event: MessageEvent<StereoEvent>) => {
    handler(event.data);
  };

  channel.addEventListener("message", onMessage);
  return () => {
    channel.removeEventListener("message", onMessage);
  };
}

export function closeStereoChannels(): void {
  channelsByVideoId.forEach((channel) => {
    channel.close();
  });
  channelsByVideoId.clear();
}
