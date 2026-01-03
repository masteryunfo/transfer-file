import { kv } from "@vercel/kv";
import { isValidRoomId } from "@/app/lib/room";
import type { PollResponse } from "@/app/lib/webrtc";

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

  const [offer, answer] = await Promise.all([
    kv.get<string>(`room:${roomId}:offer`),
    kv.get<string>(`room:${roomId}:answer`)
  ]);

  const response: PollResponse = {
    offer: offer ? JSON.parse(offer) : null,
    answer: answer ? JSON.parse(answer) : null
  };

  return Response.json(response);
}
