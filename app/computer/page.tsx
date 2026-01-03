"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, CheckCircle2, RefreshCcw, ShieldCheck } from "lucide-react";
import {
  createPeerConnection,
  formatBytes,
  waitForIceGatheringComplete,
  type PollResponse,
  type SignalPostBody
} from "@/app/lib/webrtc";

const QRCode = dynamic(() => import("@/components/QRCode"), { ssr: false });

type Status =
  | "idle"
  | "starting"
  | "waiting"
  | "connecting"
  | "receiving"
  | "completed"
  | "error"
  | "expired";

interface FileMeta {
  name: string;
  size: number;
  mime: string;
}

const POLL_INTERVAL_MS = 800;
const POLL_TIMEOUT_MS = 60000;
const ROOM_TTL_SECONDS = 300;

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(resolve, ms);
    if (!signal) return;
    if (signal.aborted) {
      window.clearTimeout(timeoutId);
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timeoutId);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export default function ComputerPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<FileMeta | null>(null);
  const [bytesReceived, setBytesReceived] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(ROOM_TTL_SECONDS);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const countdownRef = useRef<number | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const writableRef = useRef<FileSystemWritableFileStream | null>(null);
  const startedRef = useRef(false);

  const progress = useMemo(() => {
    if (!fileMeta || fileMeta.size === 0) return 0;
    return Math.min(100, Math.round((bytesReceived / fileMeta.size) * 100));
  }, [bytesReceived, fileMeta]);

  const cleanup = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    channelRef.current?.close();
    channelRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    if (countdownRef.current) {
      window.clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    chunksRef.current = [];
    writableRef.current = null;
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
    }
    setDownloadUrl(null);
    setDownloadName(null);
    setBytesReceived(0);
    setFileMeta(null);
    setSaveWarning(null);
  }, [downloadUrl]);

  const reset = useCallback(() => {
    cleanup();
    setError(null);
    setRoomId(null);
    setSecondsLeft(ROOM_TTL_SECONDS);
    setStatus("idle");
  }, [cleanup]);

  const startCountdown = useCallback(() => {
    setSecondsLeft(ROOM_TTL_SECONDS);
    if (countdownRef.current) {
      window.clearInterval(countdownRef.current);
    }
    countdownRef.current = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(countdownRef.current ?? undefined);
          abortRef.current?.abort();
          channelRef.current?.close();
          pcRef.current?.close();
          setStatus("expired");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const handleReceiveDone = useCallback(async () => {
    if (writableRef.current) {
      await writableRef.current.close();
    }

    if (!writableRef.current && chunksRef.current.length > 0 && fileMeta) {
      const blob = new Blob(chunksRef.current, { type: fileMeta.mime });
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setDownloadName(fileMeta.name);
    }

    setStatus("completed");
  }, [fileMeta]);

  const handleDataMessage = useCallback(
    async (event: MessageEvent) => {
      if (typeof event.data === "string") {
        try {
          const message = JSON.parse(event.data) as
            | { type: "meta"; name: string; size: number; mime: string }
            | { type: "done" }
            | { type: "error"; message: string };

          if (message.type === "meta") {
            setFileMeta({
              name: message.name,
              size: message.size,
              mime: message.mime
            });
            setStatus("receiving");
            const showSaveFilePicker = window.showSaveFilePicker;
            if (!writableRef.current && showSaveFilePicker) {
              try {
                const extension = message.name.includes(".")
                  ? `.${message.name.split(".").pop()}`
                  : "";
                const handle = await showSaveFilePicker({
                  suggestedName: message.name,
                  types: [
                    {
                      description: message.mime,
                      accept: { [message.mime]: extension ? [extension] : [] }
                    }
                  ]
                });
                writableRef.current = await handle.createWritable();
              } catch {
                if (message.size > 500 * 1024 * 1024) {
                  setSaveWarning(
                    "Large file detected. Saving will complete after transfer finishes."
                  );
                }
              }
            }
          }

          if (message.type === "done") {
            await handleReceiveDone();
          }

          if (message.type === "error") {
            setError(message.message);
            setStatus("error");
          }
        } catch {
          setError("Unable to parse incoming message.");
          setStatus("error");
        }
        return;
      }

      const chunk = event.data as ArrayBuffer;
      if (writableRef.current) {
        await writableRef.current.write(chunk);
      } else {
        chunksRef.current.push(chunk);
      }

      setBytesReceived((prev) => prev + chunk.byteLength);
    },
    [handleReceiveDone]
  );

  const connect = useCallback(async () => {
    setStatus("starting");
    setError(null);

    try {
      const createResponse = await fetch("/api/signaling/create", {
        method: "POST"
      });

      if (!createResponse.ok) {
        throw new Error("Unable to create room.");
      }

      const { roomId: newRoomId } = (await createResponse.json()) as {
        roomId: string;
      };

      setRoomId(newRoomId);
      setStatus("waiting");
      startCountdown();

      const pc = createPeerConnection();
      pcRef.current = pc;
      pc.createDataChannel("bootstrap");

      pc.ondatachannel = (event) => {
        const channel = event.channel;
        channel.binaryType = "arraybuffer";
        channel.onmessage = (message) => {
          void handleDataMessage(message);
        };
        channelRef.current = channel;
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc, 2500);

      const payload: SignalPostBody = {
        type: "offer",
        data: pc.localDescription ?? offer
      };

      await fetch(`/api/signaling/${newRoomId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      setStatus("connecting");

      const controller = new AbortController();
      abortRef.current = controller;
      const deadline = Date.now() + POLL_TIMEOUT_MS;

      while (Date.now() < deadline) {
        if (controller.signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        const pollResponse = await fetch(`/api/signaling/poll/${newRoomId}`, {
          signal: controller.signal
        });

        if (pollResponse.status === 404) {
          setStatus("expired");
          return;
        }

        if (!pollResponse.ok) {
          throw new Error("Unable to check room status.");
        }

        const data = (await pollResponse.json()) as PollResponse;
        if (data.answer) {
          await pc.setRemoteDescription(data.answer);
          setStatus("waiting");
          return;
        }

        await sleep(POLL_INTERVAL_MS, controller.signal);
      }

      setError("Connection timed out. Please try again.");
      setStatus("error");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      setError(err instanceof Error ? err.message : "Unexpected error.");
      setStatus("error");
    }
  }, [handleDataMessage, startCountdown]);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    void connect();

    return () => {
      cleanup();
      startedRef.current = false;
    };
  }, [cleanup, connect]);

  const countdownLabel = useMemo(() => {
    const minutes = Math.floor(secondsLeft / 60);
    const seconds = secondsLeft % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }, [secondsLeft]);

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-slate-100">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-slate-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>

        <header className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold text-white">Receive a file</h1>
          <p className="text-sm text-slate-300">
            Leave this screen open on your computer. Your phone will connect using
            the code below.
          </p>
        </header>

        <section className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
          <div className="flex flex-col gap-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Room code
                </p>
                <p className="mt-2 text-2xl font-semibold text-white">
                  {roomId ?? "------"}
                </p>
              </div>
              <div className="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200">
                {countdownLabel}
              </div>
            </div>

            <div className="flex items-center justify-center rounded-xl border border-slate-800 bg-slate-950/80 p-4">
              {roomId ? (
                <QRCode value={`${typeof window === "undefined" ? "" : window.location.origin}/phone?room=${roomId}`} />
              ) : (
                <div className="h-40 w-40 animate-pulse rounded-lg bg-slate-800" />
              )}
            </div>

            <div className="flex flex-col gap-3 text-sm text-slate-300">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                Direct peer-to-peer transfer. No files touch the server.
              </div>
              <div>
                Status: <span className="text-slate-100">{status}</span>
              </div>
              {error && (
                <p className="text-sm text-rose-400">{error}</p>
              )}
              {status === "expired" && (
                <p className="text-sm text-amber-300">
                  This room expired. Create a new one to continue.
                </p>
              )}
              {saveWarning && (
                <p className="text-xs text-amber-200">{saveWarning}</p>
              )}
            </div>

            {(status === "error" || status === "expired") && (
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-slate-500"
              >
                <RefreshCcw className="h-4 w-4" />
                Start again
              </button>
            )}
          </div>

          <div className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h2 className="text-lg font-semibold text-white">Transfer progress</h2>
            {fileMeta ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-200">{fileMeta.name}</p>
                    <p className="text-xs text-slate-400">
                      {formatBytes(bytesReceived)} of {formatBytes(fileMeta.size)}
                    </p>
                  </div>
                  <p className="text-sm text-slate-200">{progress}%</p>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-800">
                  <div
                    className="h-2 rounded-full bg-emerald-400"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">
                Waiting for your phone to select a file.
              </p>
            )}

            {status === "completed" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-sm text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" />
                  Transfer complete.
                </div>
                {downloadUrl && downloadName && (
                  <a
                    href={downloadUrl}
                    download={downloadName}
                    className="inline-flex items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-100"
                  >
                    Download {downloadName}
                  </a>
                )}
                <button
                  type="button"
                  onClick={reset}
                  className="inline-flex items-center justify-center rounded-full border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100"
                >
                  Receive another file
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
