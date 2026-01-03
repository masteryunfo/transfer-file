import { kv } from "@vercel/kv";
import { isValidRoomId } from "@/app/lib/room";
import type { SignalPostBody } from "@/app/lib/webrtc";

const ROOM_TTL_SECONDS = 300;

export async function POST(
  request: Request,
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

  const body = (await request.json()) as SignalPostBody;

  if (body.type !== "offer" && body.type !== "answer") {
    return new Response("Invalid payload", { status: 400 });
  }

  if (!body.data || typeof body.data !== "object") {
    return new Response("Invalid payload", { status: 400 });
  }

  const key = `room:${roomId}:${body.type}`;
  await kv.set(key, JSON.stringify(body.data), { ex: ROOM_TTL_SECONDS });
  await kv.set(existsKey, "1", { ex: ROOM_TTL_SECONDS });

  return Response.json({ ok: true });
}
