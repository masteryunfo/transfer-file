import { kv } from "@vercel/kv";
import { isValidRoomId } from "@/app/lib/room";
import type { PollResponse } from "@/app/lib/webrtc";

type LegacyRoomRecord = {
  offer?: RTCSessionDescriptionInit | null;
  answer?: RTCSessionDescriptionInit | null;
};

function safeParse<T>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") {
    return value as T;
  }
  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: { roomId: string } }
) {
  const roomId = params.roomId;

  if (!isValidRoomId(roomId)) {
    return new Response("Invalid room", { status: 400 });
  }

  const existsKey = `room:${roomId}:exists`;
  const exists = await kv.get(existsKey);

  if (!exists) {
    return new Response("Room not found", { status: 404 });
  }

  const [offerValue, answerValue, legacyRoom] = await Promise.all([
    kv.get<unknown>(`room:${roomId}:offer`),
    kv.get<unknown>(`room:${roomId}:answer`),
    kv.get<unknown>(`room:${roomId}`)
  ]);

  const legacy = safeParse<LegacyRoomRecord>(legacyRoom);
  const offer =
    safeParse<RTCSessionDescriptionInit>(offerValue) ?? legacy?.offer ?? null;
  const answer =
    safeParse<RTCSessionDescriptionInit>(answerValue) ?? legacy?.answer ?? null;

  const response: PollResponse = {
    offer,
    answer
  };

  return Response.json(response);
}
