import { useRef, useState } from "react";
import {
  Download, Upload, X, CheckCircle2, AlertTriangle,
  Loader2, FileSpreadsheet, Info,
} from "lucide-react";
import { tracksApi } from "@/api/tracks";

interface Props {
  onClose: () => void;
  onImported?: () => void;
}

type Tab = "download" | "upload";

interface ImportResult {
  updated: number;
  skipped: number;
  errors: Array<{ row: number; song_id: string; error: string }>;
}

export function BulkMetadataModal({ onClose, onImported }: Props) {
  const [tab, setTab] = useState<Tab>("download");
  const [downloading, setDownloading] = useState(false);
  const [downloadDone, setDownloadDone] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleDownload() {
    setDownloading(true);
    setError("");
    try {
      await tracksApi.exportCsv();
      setDownloadDone(true);
    } catch {
      setError("Export failed. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  async function handleUpload() {
    if (!uploadFile) return;
    setUploading(true);
    setResult(null);
    setError("");
    try {
      const res = await tracksApi.importCsv(uploadFile, setUploadPct);
      setResult(res);
      onImported?.();
    } catch {
      setError("Upload failed. Check your CSV format and try again.");
    } finally {
      setUploading(false);
      setUploadPct(0);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl shadow-2xl"
        style={{
          background: "#0f0e14",
          border: "1px solid rgba(139,92,246,0.2)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-stone-800">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="w-4 h-4 text-violet-400" />
            <h2 className="font-display font-semibold text-stone-100 text-base">
              Bulk Metadata Update
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-stone-500 hover:text-stone-200 hover:bg-stone-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-stone-800 px-6">
          {(["download", "upload"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-1 py-3 mr-6 text-xs font-mono border-b-2 -mb-px transition-colors capitalize ${
                tab === t
                  ? "border-violet-500 text-violet-400"
                  : "border-transparent text-stone-500 hover:text-stone-300"
              }`}
            >
              {t === "download" ? <Download className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />}
              {t === "download" ? "Download CSV" : "Upload CSV"}
            </button>
          ))}
        </div>

        <div className="px-6 py-5">
          {/* ── Download tab ── */}
          {tab === "download" && (
            <div className="space-y-4">
              <div
                className="rounded-xl p-4 text-sm"
                style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)" }}
              >
                <p className="font-body text-stone-300 leading-relaxed">
                  Downloads a CSV with every track in the catalogue. Fixed columns:
                </p>
                <ul className="mt-2 space-y-0.5">
                  {[
                    ["song_id", "Immutable — do not edit"],
                    ["folder", "R2 key (immutable)"],
                    ["title, artist_name, album…", "Edit freely"],
                    ["bpm, track_number, disc_number", "Numeric fields"],
                    ["explicit", "true / false"],
                    ["tags", "Comma-separated list"],
                  ].map(([col, note]) => (
                    <li key={col} className="flex items-start gap-2 text-xs font-mono">
                      <span className="text-violet-400 flex-shrink-0">{col}</span>
                      <span className="text-stone-600">— {note}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex items-start gap-2 text-xs text-stone-500 font-body">
                <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-stone-600" />
                <span>
                  Leave any cell blank to skip updating that field. Only non-empty cells
                  are written back on upload.
                </span>
              </div>

              {error && (
                <p className="text-xs text-red-400 font-mono">{error}</p>
              )}

              {downloadDone && (
                <div className="flex items-center gap-2 text-xs text-emerald-400 font-mono">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  CSV downloaded — fill it in, then switch to Upload CSV.
                </div>
              )}

              <button
                onClick={handleDownload}
                disabled={downloading}
                className="w-full h-10 rounded-xl flex items-center justify-center gap-2 text-sm font-mono font-semibold transition-all duration-200 disabled:opacity-50"
                style={{
                  background: "linear-gradient(135deg, #863bff 0%, #6d28d9 100%)",
                  color: "#fff",
                  boxShadow: "0 0 24px rgba(134,59,255,0.3)",
                }}
              >
                {downloading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Exporting…</>
                  : <><Download className="w-4 h-4" /> Download tamasha_catalogue.csv</>}
              </button>
            </div>
          )}

          {/* ── Upload tab ── */}
          {tab === "upload" && (
            <div className="space-y-4">
              {!result && (
                <>
                  {/* Drop zone */}
                  <div
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files[0];
                      if (f?.name.endsWith(".csv")) setUploadFile(f);
                    }}
                    className="relative cursor-pointer rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors"
                    style={{
                      borderColor: uploadFile ? "rgba(139,92,246,0.5)" : "rgba(255,255,255,0.1)",
                      background: uploadFile ? "rgba(139,92,246,0.05)" : "transparent",
                    }}
                  >
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) { setUploadFile(f); setResult(null); setError(""); }
                      }}
                    />
                    {uploadFile ? (
                      <div className="flex flex-col items-center gap-2">
                        <FileSpreadsheet className="w-8 h-8 text-violet-400" />
                        <p className="text-sm font-mono text-stone-300">{uploadFile.name}</p>
                        <p className="text-xs text-stone-600">
                          {(uploadFile.size / 1024).toFixed(1)} KB — click to change
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <Upload className="w-8 h-8 text-stone-600" />
                        <p className="text-sm font-mono text-stone-400">
                          Drop CSV here or <span className="text-violet-400 underline">browse</span>
                        </p>
                        <p className="text-xs text-stone-600">Only .csv files</p>
                      </div>
                    )}
                  </div>

                  {uploading && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs font-mono text-stone-500">
                        <span>Uploading…</span>
                        <span>{uploadPct}%</span>
                      </div>
                      <div className="h-1 rounded-full bg-stone-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-violet-500 transition-all duration-200"
                          style={{ width: `${uploadPct}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {error && (
                    <div className="flex items-center gap-2 text-xs text-red-400 font-mono">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                      {error}
                    </div>
                  )}

                  <button
                    onClick={handleUpload}
                    disabled={!uploadFile || uploading}
                    className="w-full h-10 rounded-xl flex items-center justify-center gap-2 text-sm font-mono font-semibold transition-all duration-200 disabled:opacity-40"
                    style={{
                      background: "linear-gradient(135deg, #863bff 0%, #6d28d9 100%)",
                      color: "#fff",
                      boxShadow: "0 0 24px rgba(134,59,255,0.3)",
                    }}
                  >
                    {uploading
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
                      : <><Upload className="w-4 h-4" /> Apply Updates</>}
                  </button>
                </>
              )}

              {/* Result summary */}
              {result && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Updated", value: result.updated, color: "text-emerald-400" },
                      { label: "Skipped", value: result.skipped, color: "text-stone-400" },
                      { label: "Errors", value: result.errors.length, color: result.errors.length > 0 ? "text-red-400" : "text-stone-600" },
                    ].map((s) => (
                      <div
                        key={s.label}
                        className="rounded-xl px-4 py-3 text-center"
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
                      >
                        <p className={`text-2xl font-display font-bold ${s.color}`}>{s.value}</p>
                        <p className="text-xs font-mono text-stone-600 mt-0.5">{s.label}</p>
                      </div>
                    ))}
                  </div>

                  {result.errors.length > 0 && (
                    <div
                      className="rounded-xl p-3 max-h-40 overflow-y-auto space-y-1"
                      style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}
                    >
                      {result.errors.map((e, i) => (
                        <div key={i} className="text-xs font-mono text-red-400">
                          Row {e.row} ({e.song_id || "—"}): {e.error}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => { setResult(null); setUploadFile(null); setError(""); }}
                      className="flex-1 h-9 rounded-lg border border-stone-700 text-xs font-mono text-stone-400 hover:text-stone-200 hover:border-stone-600 transition-colors"
                    >
                      Upload another
                    </button>
                    <button
                      onClick={onClose}
                      className="flex-1 h-9 rounded-lg text-xs font-mono font-semibold transition-colors"
                      style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa" }}
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
