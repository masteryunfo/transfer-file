export const ROOM_ID_REGEX = /^[A-Z0-9]{6}$/;

export function isValidRoomId(roomId: string): boolean {
  return ROOM_ID_REGEX.test(roomId);
}

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";

export function generateRoomId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let result = "";
  for (let i = 0; i < bytes.length; i += 1) {
    result += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
  }
  return result;
}
