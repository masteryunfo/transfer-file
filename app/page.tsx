import Link from "next/link";
import { ArrowRight, Laptop, Smartphone } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
        <header className="flex flex-col gap-3">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            WebRTC file transfer
          </p>
          <h1 className="text-3xl font-semibold leading-tight text-white">
            Send files between your phone and computer
          </h1>
          <p className="max-w-2xl text-sm text-slate-300">
            Keep your files private with direct peer-to-peer transfer over your
            local WiFi. No uploads. No accounts.
          </p>
        </header>
        <section className="grid gap-4 md:grid-cols-2">
          <Link
            href="/computer"
            className="group flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 transition hover:border-slate-600"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-slate-200">
              <Laptop className="h-5 w-5" />
            </div>
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-white">I am on a computer</h2>
              <p className="text-sm text-slate-300">
                Generate a QR code and receive a file from your phone.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 text-sm text-slate-200">
              Receive file <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
          <Link
            href="/phone"
            className="group flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 transition hover:border-slate-600"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-slate-200">
              <Smartphone className="h-5 w-5" />
            </div>
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-white">I am on a phone</h2>
              <p className="text-sm text-slate-300">
                Join a room and send a file to your computer.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 text-sm text-slate-200">
              Send file <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        </section>
      </div>
    </main>
  );
}
