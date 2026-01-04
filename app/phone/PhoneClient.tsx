"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  RefreshCcw,
  Send
} from "lucide-react";
import {
  createPeerConnection,
  formatBytes,
  isValidRoomId,
  waitForIceGatheringComplete,
  type PollResponse,
  type SignalPostBody
} from "@/app/lib/webrtc";

const POLL_INTERVAL_MS = 800;
const POLL_TIMEOUT_MS = 60000;
const CHUNK_SIZE = 256 * 1024;
const BUFFERED_HIGH_WATER_MARK = 16 * 1024 * 1024;
const BUFFERED_LOW_WATER_MARK = 4 * 1024 * 1024;
const DEBUG = false;

type Status =
  | "idle"
  | "waiting"
  | "connecting"
  | "ready"
  | "sending"
  | "completed"
  | "error"
  | "expired";

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

export default function PhoneClient({ initialRoom }: { initialRoom: string }) {
  const [roomInput, setRoomInput] = useState(initialRoom.toUpperCase());
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [bytesSent, setBytesSent] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);

  const progress = useMemo(() => {
    if (!selectedFile || selectedFile.size === 0) return 0;
    return Math.min(100, Math.round((bytesSent / selectedFile.size) * 100));
  }, [bytesSent, selectedFile]);

  const cleanup = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    channelRef.current?.close();
    channelRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    setBytesSent(0);
  }, []);

  const reset = useCallback(() => {
    cleanup();
    setError(null);
    setStatus("idle");
    setSelectedFile(null);
  }, [cleanup]);

  const connect = useCallback(async () => {
    if (!isValidRoomId(roomInput)) {
      setError("Enter a valid 6 character room code.");
      setStatus("error");
      return;
    }

    setStatus("connecting");
    setError(null);

    try {
      const pc = createPeerConnection();
      pcRef.current = pc;
      pc.onconnectionstatechange = () => {
        if (DEBUG) {
          console.debug("[phone] pc connection state", pc.connectionState);
        }
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          setError("Connection lost. Please try again.");
          setStatus("error");
          abortRef.current?.abort();
        }
      };
      pc.ondatachannel = (event) => {
        const channel = event.channel;
        channel.binaryType = "arraybuffer";
        channel.bufferedAmountLowThreshold = BUFFERED_LOW_WATER_MARK;
        channelRef.current = channel;
        channel.onopen = () => {
          if (DEBUG) {
            console.debug("[phone] channel open", channel.readyState);
          }
          setStatus("ready");
        };
        channel.onerror = () => {
          setError("Channel error. Please reconnect.");
          setStatus("error");
        };
        channel.onclose = () => {
          setError("Channel closed. Please reconnect.");
          setStatus("error");
        };
      };

      const controller = new AbortController();
      abortRef.current = controller;
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      let offerReceived = false;

      while (Date.now() < deadline) {
        if (controller.signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        const pollResponse = await fetch(
          `/api/signaling/poll/${roomInput}`,
          { signal: controller.signal }
        );

        if (pollResponse.status === 404) {
          setStatus("expired");
          return;
        }

        if (!pollResponse.ok) {
          throw new Error("Unable to check room.");
        }

        const data = (await pollResponse.json()) as PollResponse;
        if (data.offer) {
          await pc.setRemoteDescription(data.offer);
          offerReceived = true;
          break;
        }

        await sleep(POLL_INTERVAL_MS, controller.signal);
      }

      if (!offerReceived) {
        setError("Room did not respond in time. Try again.");
        setStatus("error");
        return;
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGatheringComplete(pc, 2500);

      const payload: SignalPostBody = {
        type: "answer",
        data: pc.localDescription ?? answer
      };

      await fetch(`/api/signaling/${roomInput}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      setError(err instanceof Error ? err.message : "Unexpected error.");
      setStatus("error");
    }
  }, [roomInput]);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    if (initialRoom) {
      void connect();
    }

    return () => {
      cleanup();
      startedRef.current = false;
    };
  }, [cleanup, connect, initialRoom]);

  const waitForBufferedLow = useCallback(async (channel: RTCDataChannel) => {
    if (channel.bufferedAmount <= BUFFERED_HIGH_WATER_MARK) {
      return;
    }

    await new Promise<void>((resolve) => {
      let resolved = false;
      const onLow = () => {
        channel.removeEventListener("bufferedamountlow", onLow);
        resolved = true;
        resolve();
      };
      const timeoutId = window.setTimeout(() => {
        channel.removeEventListener("bufferedamountlow", onLow);
        if (!resolved) {
          const intervalId = window.setInterval(() => {
            if (channel.bufferedAmount <= BUFFERED_LOW_WATER_MARK) {
              window.clearInterval(intervalId);
              resolve();
            }
          }, 200);
        }
      }, 2000);
      channel.addEventListener("bufferedamountlow", onLow, { once: true });
      channel.addEventListener(
        "bufferedamountlow",
        () => window.clearTimeout(timeoutId),
        { once: true }
      );
    });
  }, []);

  const sendFile = useCallback(async () => {
    try {
      if (!selectedFile || !channelRef.current) {
        setError("Choose a file before sending.");
        setStatus("error");
        return;
      }

      if (channelRef.current.readyState !== "open") {
        setError("Connection not ready yet. Please try again.");
        setStatus("error");
        return;
      }

      setStatus("sending");
      setBytesSent(0);

      const channel = channelRef.current;
      if (DEBUG) {
        console.debug("[phone] sending meta", selectedFile.name);
      }
      channel.send(
        JSON.stringify({
          type: "meta",
          name: selectedFile.name,
          size: selectedFile.size,
          mime: selectedFile.type || "application/octet-stream"
        })
      );

      let offset = 0;
      let chunkCount = 0;
      while (offset < selectedFile.size) {
        await waitForBufferedLow(channel);
        const slice = selectedFile.slice(offset, offset + CHUNK_SIZE);
        const buffer = await slice.arrayBuffer();
        channel.send(buffer);
        offset += buffer.byteLength;
        setBytesSent(offset);
        chunkCount += 1;
        if (chunkCount % 8 === 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
      }

      if (DEBUG) {
        console.debug("[phone] sending done");
      }
      channel.send(JSON.stringify({ type: "done" }));
      setStatus("completed");
      channel.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed.");
      setStatus("error");
    }
  }, [selectedFile, waitForBufferedLow]);

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-slate-100">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-slate-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <header className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold text-white">Send a file</h1>
          <p className="text-sm text-slate-300">
            Enter the room code from your computer, connect, then choose a file
            to send.
          </p>
        </header>

        <section className="flex flex-col gap-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="roomCode"
              className="text-xs uppercase tracking-[0.2em] text-slate-400"
            >
              Room code
            </label>
            <input
              id="roomCode"
              value={roomInput}
              onChange={(event) =>
                setRoomInput(event.target.value.toUpperCase())
              }
              placeholder="ABC123"
              className="rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-lg font-semibold tracking-[0.3em] text-white outline-none focus:border-slate-500"
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={connect}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-700 bg-slate-800 px-5 py-2 text-sm font-medium text-slate-100"
            >
              Connect
            </button>
            {(status === "error" || status === "expired") && (
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-700 bg-transparent px-5 py-2 text-sm font-medium text-slate-100"
              >
                <RefreshCcw className="h-4 w-4" />
                Start over
              </button>
            )}
          </div>

          {status === "expired" && (
            <p className="text-sm text-amber-300">
              This room has expired. Ask your computer for a new code.
            </p>
          )}
          {error && (
            <div className="flex items-center gap-2 text-sm text-rose-400">
              <CircleAlert className="h-4 w-4" />
              {error}
            </div>
          )}

          <div className="border-t border-slate-800 pt-6">
            <div className="flex flex-col gap-4">
              <input
                type="file"
                onChange={(event) =>
                  setSelectedFile(event.target.files?.[0] ?? null)
                }
                className="text-sm text-slate-300 file:mr-4 file:rounded-full file:border-0 file:bg-slate-800 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-100"
              />

              {selectedFile && (
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>{selectedFile.name}</span>
                  <span>{formatBytes(selectedFile.size)}</span>
                </div>
              )}

              <button
                type="button"
                onClick={sendFile}
                disabled={status !== "ready"}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-5 py-2 text-sm font-semibold text-emerald-100 disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
                Send file
              </button>

              {selectedFile && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>{progress}%</span>
                    <span>
                      {formatBytes(bytesSent)} of {formatBytes(selectedFile.size)}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-800">
                    <div
                      className="h-2 rounded-full bg-emerald-400"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              {status === "completed" && (
                <div className="flex items-center gap-2 text-sm text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" />
                  File sent successfully.
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
