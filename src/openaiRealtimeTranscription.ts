import type { RealtimeTranscriptionToken } from "./sceneverseApi";
import { logVeraDebug } from "./veraDebug";

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

function describeRealtimeError(error: unknown) {
  if (!(error instanceof Error)) return "OpenAI realtime setup failed.";

  if (error.name === "NotFoundError" || /device not found|requested device not found/i.test(error.message)) {
    return "No microphone input device was found. Check Chrome and macOS microphone input settings.";
  }

  if (error.name === "NotAllowedError" || /permission/i.test(error.message)) {
    return "Microphone permission was blocked. Allow microphone access in Chrome.";
  }

  return error.message;
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
  private micLevelContext: AudioContext | null = null;
  private micLevelSource: MediaStreamAudioSourceNode | null = null;
  private micLevelTimer: number | null = null;
  private started = false;
  private latestDelta = "";

  constructor(callbacks: RealtimeTranscriptionCallbacks) {
    this.callbacks = callbacks;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.latestDelta = "";
    logVeraDebug("realtime start requested");

    try {
      const peerConnection = new RTCPeerConnection();
      const dataChannel = peerConnection.createDataChannel("oai-events");
      logVeraDebug("realtime peer created", {
        signalingState: peerConnection.signalingState,
        iceGatheringState: peerConnection.iceGatheringState,
      });
      logVeraDebug("microphone permission request");
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      logVeraDebug("microphone stream acquired", {
        audioTracks: mediaStream.getAudioTracks().map((track) => ({
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
          label: track.label,
        })),
      });
      this.startMicLevelDebug(mediaStream);

      this.peerConnection = peerConnection;
      this.dataChannel = dataChannel;
      this.mediaStream = mediaStream;

      const token = await this.callbacks.getToken();
      logVeraDebug("realtime token received", {
        hasToken: Boolean(token?.value),
        model: token?.model,
        expiresAt: token?.expiresAt,
        turnDetection: token?.turnDetection,
      });
      if (!token?.value) {
        throw new Error("Realtime transcription token is unavailable.");
      }

      mediaStream.getAudioTracks().forEach((track) => {
        peerConnection.addTrack(track, mediaStream);
      });

      dataChannel.addEventListener("open", () => {
        logVeraDebug("realtime data channel open", {
          readyState: dataChannel.readyState,
          connectionState: peerConnection.connectionState,
        });
        this.callbacks.onReady(token);
      });
      dataChannel.addEventListener("message", (event) => this.handleMessage(event));
      dataChannel.addEventListener("error", () => {
        if (!this.started) return;
        logVeraDebug("realtime data channel error");
        this.callbacks.onError("OpenAI realtime data channel error.");
      });
      peerConnection.addEventListener("connectionstatechange", () => {
        if (!this.started) return;
        logVeraDebug("realtime connection state", {
          connectionState: peerConnection.connectionState,
          iceConnectionState: peerConnection.iceConnectionState,
        });
        if (["failed", "disconnected", "closed"].includes(peerConnection.connectionState)) {
          this.callbacks.onError(`OpenAI realtime connection ${peerConnection.connectionState}.`);
        }
      });
      peerConnection.addEventListener("icegatheringstatechange", () => {
        logVeraDebug("realtime ice gathering state", {
          iceGatheringState: peerConnection.iceGatheringState,
        });
      });

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await waitForIceGatheringComplete(peerConnection);
      logVeraDebug("realtime local description ready", {
        iceGatheringState: peerConnection.iceGatheringState,
      });

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
      logVeraDebug("realtime sdp exchange response", { status: response.status });

      await peerConnection.setRemoteDescription({
        type: "answer",
        sdp: await response.text(),
      });
      logVeraDebug("realtime remote description set", {
        signalingState: peerConnection.signalingState,
        connectionState: peerConnection.connectionState,
      });
    } catch (error) {
      logVeraDebug("realtime start failed", {
        name: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : String(error),
      });
      this.close();
      this.callbacks.onError(describeRealtimeError(error));
      throw error;
    }
  }

  stop() {
    this.close();
  }

  abort() {
    this.close();
  }

  private startMicLevelDebug(mediaStream: MediaStream) {
    const AudioContextConstructor =
      window.AudioContext ??
      (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) {
      logVeraDebug("microphone level unavailable", { reason: "AudioContext unsupported" });
      return;
    }

    try {
      const audioContext = new AudioContextConstructor();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      const samples = new Uint8Array(analyser.fftSize);
      const source = audioContext.createMediaStreamSource(mediaStream);
      source.connect(analyser);

      this.micLevelContext = audioContext;
      this.micLevelSource = source;
      this.micLevelTimer = window.setInterval(() => {
        analyser.getByteTimeDomainData(samples);

        let sumSquares = 0;
        let peak = 0;
        for (const sample of samples) {
          const normalized = (sample - 128) / 128;
          sumSquares += normalized * normalized;
          peak = Math.max(peak, Math.abs(normalized));
        }

        const rms = Math.sqrt(sumSquares / samples.length);
        logVeraDebug("microphone level", {
          rms: Number(rms.toFixed(4)),
          peak: Number(peak.toFixed(4)),
          contextState: audioContext.state,
        });
      }, 1000);
    } catch (error) {
      logVeraDebug("microphone level failed", {
        name: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private handleMessage(message: MessageEvent<string>) {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(message.data) as RealtimeEvent;
    } catch {
      logVeraDebug("realtime message parse failed");
      return;
    }
    logVeraDebug("realtime event", {
      type: event.type,
      delta: event.delta,
      transcript: event.transcript,
      error: event.error?.message,
    });

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
    if (this.micLevelTimer) window.clearInterval(this.micLevelTimer);
    void this.micLevelContext?.close();
    this.dataChannel?.close();
    this.peerConnection?.close();
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.dataChannel = null;
    this.peerConnection = null;
    this.mediaStream = null;
    this.micLevelContext = null;
    this.micLevelSource = null;
    this.micLevelTimer = null;
  }
}
