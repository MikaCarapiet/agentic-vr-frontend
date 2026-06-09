import type { RealtimeTranscriptionToken } from "./sceneverseApi";

const realtimeCallsUrl = "https://api.openai.com/v1/realtime/calls";

type RealtimeEvent = {
  type?: string;
  delta?: string;
  transcript?: string;
  error?: {
    message?: string;
    type?: string;
  };
};

export type RealtimeTranscriptionCallbacks = {
  getToken: () => Promise<RealtimeTranscriptionToken | null>;
  onReady: (token: RealtimeTranscriptionToken) => void;
  onSpeechStarted: () => void;
  onSpeechStopped: () => void;
  onTranscriptDelta: (text: string) => void;
  onTranscriptCompleted: (text: string) => void;
  onError: (message: string) => void;
};

export type VoiceInputController = {
  provider: "openai-realtime";
  start: () => void | Promise<void>;
  stop: () => void;
  abort?: () => void;
};

export function isOpenAIRealtimeTranscriptionSupported() {
  return (
    typeof RTCPeerConnection !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

function waitForIceGatheringComplete(peerConnection: RTCPeerConnection) {
  if (peerConnection.iceGatheringState === "complete") return Promise.resolve();

  return new Promise<void>((resolve) => {
    const timeoutId = window.setTimeout(() => {
      peerConnection.removeEventListener("icegatheringstatechange", handleStateChange);
      resolve();
    }, 1200);

    function handleStateChange() {
      if (peerConnection.iceGatheringState !== "complete") return;
      window.clearTimeout(timeoutId);
      peerConnection.removeEventListener("icegatheringstatechange", handleStateChange);
      resolve();
    }

    peerConnection.addEventListener("icegatheringstatechange", handleStateChange);
  });
}

export class OpenAIRealtimeTranscriptionInput implements VoiceInputController {
  provider = "openai-realtime" as const;

  private callbacks: RealtimeTranscriptionCallbacks;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private mediaStream: MediaStream | null = null;
  private started = false;
  private latestDelta = "";

  constructor(callbacks: RealtimeTranscriptionCallbacks) {
    this.callbacks = callbacks;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.latestDelta = "";

    try {
      const token = await this.callbacks.getToken();
      if (!token?.value) {
        throw new Error("Realtime transcription token is unavailable.");
      }

      const peerConnection = new RTCPeerConnection();
      const dataChannel = peerConnection.createDataChannel("oai-events");
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStream.getAudioTracks().forEach((track) => {
        peerConnection.addTrack(track, mediaStream);
      });

      dataChannel.addEventListener("open", () => this.callbacks.onReady(token));
      dataChannel.addEventListener("message", (event) => this.handleMessage(event));
      dataChannel.addEventListener("error", () => {
        if (!this.started) return;
        this.callbacks.onError("OpenAI realtime data channel error.");
      });
      peerConnection.addEventListener("connectionstatechange", () => {
        if (!this.started) return;
        if (["failed", "disconnected", "closed"].includes(peerConnection.connectionState)) {
          this.callbacks.onError(`OpenAI realtime connection ${peerConnection.connectionState}.`);
        }
      });

      this.peerConnection = peerConnection;
      this.dataChannel = dataChannel;
      this.mediaStream = mediaStream;

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await waitForIceGatheringComplete(peerConnection);

      const sdp = peerConnection.localDescription?.sdp;
      if (!sdp) {
        throw new Error("WebRTC offer SDP was not created.");
      }

      const response = await fetch(realtimeCallsUrl, {
        method: "POST",
        body: sdp,
        headers: {
          Authorization: `Bearer ${token.value}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!response.ok) {
        throw new Error(`OpenAI realtime SDP exchange failed with HTTP ${response.status}.`);
      }

      await peerConnection.setRemoteDescription({
        type: "answer",
        sdp: await response.text(),
      });
    } catch (error) {
      this.close();
      this.callbacks.onError(error instanceof Error ? error.message : "OpenAI realtime setup failed.");
      throw error;
    }
  }

  stop() {
    this.close();
  }

  abort() {
    this.close();
  }

  private handleMessage(message: MessageEvent<string>) {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(message.data) as RealtimeEvent;
    } catch {
      return;
    }

    if (event.type === "input_audio_buffer.speech_started") {
      this.latestDelta = "";
      this.callbacks.onSpeechStarted();
      return;
    }

    if (event.type === "input_audio_buffer.speech_stopped") {
      this.callbacks.onSpeechStopped();
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.delta" && event.delta) {
      this.latestDelta += event.delta;
      this.callbacks.onTranscriptDelta(this.latestDelta);
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.completed" && event.transcript) {
      const transcript = event.transcript.trim();
      this.latestDelta = "";
      if (transcript) this.callbacks.onTranscriptCompleted(transcript);
      return;
    }

    if (event.type === "error") {
      this.callbacks.onError(event.error?.message ?? "OpenAI realtime server error.");
    }
  }

  private close() {
    this.started = false;
    this.latestDelta = "";
    this.dataChannel?.close();
    this.peerConnection?.close();
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.dataChannel = null;
    this.peerConnection = null;
    this.mediaStream = null;
  }
}
