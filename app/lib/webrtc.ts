export const RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

export type SignalType = "offer" | "answer";

export interface SignalPostBody {
  type: SignalType;
  data: RTCSessionDescriptionInit;
}

export interface PollResponse {
  offer: RTCSessionDescriptionInit | null;
  answer: RTCSessionDescriptionInit | null;
}

export const ROOM_ID_REGEX = /^[A-Z0-9]{6}$/;

export function isValidRoomId(roomId: string): boolean {
  return ROOM_ID_REGEX.test(roomId);
}

export function createPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection(RTC_CONFIGURATION);
}

export function waitForIceGatheringComplete(
  pc: RTCPeerConnection,
  timeoutMs = 2500
): Promise<void> {
  if (pc.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    }, timeoutMs);

    const onStateChange = () => {
      if (pc.iceGatheringState === "complete") {
        window.clearTimeout(timeoutId);
        pc.removeEventListener("icegatheringstatechange", onStateChange);
        resolve();
      }
    };

    pc.addEventListener("icegatheringstatechange", onStateChange);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${sizes[i]}`;
}

export function createAbortError(message: string): DOMException {
  return new DOMException(message, "AbortError");
}
