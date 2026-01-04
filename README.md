# Transfer File

Peer-to-peer file transfer between your phone and computer using WebRTC. Signaling uses Vercel KV only (no file bytes ever hit the server).

## Requirements

- Node.js 18+
- Vercel KV database

## Local development

1. Install dependencies:

```bash
npm install
```

2. Create a `.env.local` file using `.env.example` and fill in your Vercel KV credentials:

```bash
cp .env.example .env.local
```

3. Run the dev server:

```bash
npm run dev
```

Open http://localhost:3000.

## Signaling API

- `POST /api/signaling/create` creates a room and returns `{ roomId }`.
- `POST /api/signaling/[roomId]` stores an offer or answer payload.
- `GET /api/signaling/poll/[roomId]` polls for `{ offer, answer }`.

All keys are stored with a 300 second TTL and validated against a 6-character uppercase room ID.

## Deployment

Deploy to Vercel and set the KV environment variables in the project settings. The app is compatible with the Vercel Hobby plan.
