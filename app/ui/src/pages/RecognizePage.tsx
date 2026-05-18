import { useState, useRef, useEffect } from "react";
import { Mic, MicOff, Music2, Loader2, AlertCircle, RotateCcw, CheckCircle2 } from "lucide-react";

interface RecognizeResult {
  match: boolean;
  confidence: number;
  score: number;
  track_id: string | null;
  title: string | null;
  artist: string | null;
  artwork_url: string | null;
}

type PageState = "idle" | "listening" | "processing" | "matched" | "no_match" | "error";

const RECORD_SECONDS = 15;

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="w-full space-y-1">
      <div className="flex justify-between text-[10px] font-mono text-stone-500">
        <span>confidence</span>
        <span className={pct >= 70 ? "text-emerald-400" : pct >= 40 ? "text-yellow-400" : "text-red-400"}>
          {pct}%
        </span>
      </div>
      <div className="h-1 bg-stone-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function RecognizePage() {
  const [state, setState] = useState<PageState>("idle");
  const [result, setResult] = useState<RecognizeResult | null>(null);
  const [countdown, setCountdown] = useState(RECORD_SECONDS);
  const [errorMsg, setErrorMsg] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    recorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
  }, []);

  async function start() {
    setResult(null);
    setErrorMsg("");
    chunksRef.current = [];

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErrorMsg("Microphone permission denied.");
      setState("error");
      return;
    }

    const options: MediaRecorderOptions = { audioBitsPerSecond: 128000 };
    const mr = new MediaRecorder(stream, MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { ...options, mimeType: "audio/webm;codecs=opus" } : options);
    recorderRef.current = mr;

    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setState("processing");

      const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
      const form = new FormData();
      form.append("file", blob, "clip.webm");

      try {
        const res = await fetch("/api/v1/recognize", { method: "POST", body: form });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: RecognizeResult = await res.json();
        setResult(data);
        setState(data.match ? "matched" : "no_match");
      } catch (err) {
        setErrorMsg("Recognition failed. Please try again.");
        setState("error");
      }
    };

    mr.start(250); // collect data every 250ms
    setState("listening");
    setCountdown(RECORD_SECONDS);

    intervalRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(intervalRef.current!);
          mr.stop();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  function reset() {
    setState("idle");
    setResult(null);
    setErrorMsg("");
    setCountdown(RECORD_SECONDS);
  }

  const isListening = state === "listening";
  const isProcessing = state === "processing";

  return (
    <div className="min-h-screen bg-stone-950 flex flex-col items-center justify-center px-4">
      {/* Logo / title */}
      <div className="mb-12 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Music2 className="w-5 h-5 text-violet-400" />
          <span className="text-xs font-mono tracking-[0.2em] uppercase text-stone-500">Tamasha Identify</span>
        </div>
        <p className="text-[11px] font-mono text-stone-700">Powered by acoustic fingerprinting</p>
      </div>

      {/* Main mic button */}
      <div className="relative flex items-center justify-center mb-10">
        {/* Pulse rings — only while listening */}
        {isListening && (
          <>
            <div className="absolute w-48 h-48 rounded-full border border-violet-500/20 animate-ping" />
            <div className="absolute w-40 h-40 rounded-full border border-violet-500/30 animate-ping [animation-delay:0.3s]" />
          </>
        )}

        <button
          onClick={state === "idle" ? start : undefined}
          disabled={isListening || isProcessing}
          className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300 ${
            isListening
              ? "bg-violet-500 shadow-[0_0_60px_rgba(139,92,246,0.5)]"
              : isProcessing
              ? "bg-stone-800 cursor-wait"
              : state === "idle"
              ? "bg-stone-900 border border-stone-700 hover:border-violet-500/50 hover:bg-stone-800 cursor-pointer shadow-lg"
              : "bg-stone-900 border border-stone-800"
          }`}
        >
          {isProcessing ? (
            <Loader2 className="w-10 h-10 text-stone-400 animate-spin" />
          ) : isListening ? (
            <Mic className="w-10 h-10 text-white" />
          ) : (
            <Mic className="w-10 h-10 text-stone-400" />
          )}
        </button>
      </div>

      {/* Status text */}
      <div className="text-center mb-8 min-h-[48px]">
        {state === "idle" && (
          <p className="text-sm font-mono text-stone-500">Tap to identify a song</p>
        )}
        {isListening && (
          <>
            <p className="text-sm font-mono text-violet-400 mb-1">Listening…</p>
            <p className="text-2xl font-display font-bold text-stone-200">{countdown}</p>
          </>
        )}
        {isProcessing && (
          <p className="text-sm font-mono text-stone-400">Searching the archive…</p>
        )}
        {state === "no_match" && (
          <p className="text-sm font-mono text-stone-500">No match found in the archive</p>
        )}
        {state === "error" && (
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle className="w-4 h-4" />
            <p className="text-sm font-mono">{errorMsg}</p>
          </div>
        )}
      </div>

      {/* Result card */}
      {state === "matched" && result && (
        <div
          className="w-full max-w-sm rounded-2xl p-5 mb-8 border"
          style={{
            background: "rgba(10,8,20,0.85)",
            borderColor: "rgba(139,92,246,0.25)",
            backdropFilter: "blur(20px)",
          }}
        >
          <div className="flex items-start gap-4">
            {/* Artwork */}
            <div className="w-16 h-16 rounded-xl bg-stone-800 flex-shrink-0 overflow-hidden border border-stone-700">
              {result.artwork_url ? (
                <img src={result.artwork_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Music2 className="w-6 h-6 text-stone-600" />
                </div>
              )}
            </div>

            {/* Track info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <p className="text-[10px] font-mono text-emerald-500 uppercase tracking-wider">Match found</p>
              </div>
              <p className="text-base font-display font-bold text-stone-100 truncate">{result.title ?? "Unknown"}</p>
              {result.artist && (
                <p className="text-sm font-mono text-stone-400 truncate">{result.artist}</p>
              )}
            </div>
          </div>

          <div className="mt-4">
            <ConfidenceBar value={result.confidence} />
          </div>
        </div>
      )}

      {/* Try again button */}
      {(state === "matched" || state === "no_match" || state === "error") && (
        <button
          onClick={reset}
          className="flex items-center gap-2 px-5 py-2 rounded-full bg-stone-900 border border-stone-800 text-xs font-mono text-stone-400 hover:text-stone-200 hover:border-stone-600 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Try again
        </button>
      )}

      {/* Pan-African accent */}
      <div className="fixed bottom-6 flex gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-red-600/60" />
        <div className="w-1.5 h-1.5 rounded-full bg-green-600/60" />
        <div className="w-1.5 h-1.5 rounded-full bg-yellow-600/60" />
      </div>
    </div>
  );
}
