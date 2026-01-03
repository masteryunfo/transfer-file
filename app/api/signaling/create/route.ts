import { kv } from "@vercel/kv";
import { generateRoomId } from "@/app/lib/room";

const ROOM_TTL_SECONDS = 300;

export async function POST() {
  let roomId = generateRoomId();
  const existsKey = `room:${roomId}:exists`;
  let attempt = 0;

  while ((await kv.get(existsKey)) && attempt < 5) {
    roomId = generateRoomId();
    attempt += 1;
  }

  await kv.set(`room:${roomId}:exists`, "1", { ex: ROOM_TTL_SECONDS });

  return Response.json({ roomId });
}
