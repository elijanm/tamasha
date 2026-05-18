import { useRef, useState } from "react";
import { Download, Upload, CheckCircle2, AlertTriangle, Loader2, FileSpreadsheet } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { tracksApi } from "@/api/tracks";

interface Props {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
}

interface ImportResult {
  updated: number;
  skipped: number;
  errors: Array<{ row: number; song_id: string; error: string }>;
}

export function BulkMetadataModal({ open, onClose, onImported }: Props) {
  const [downloading, setDownloading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function handleOpenChange(o: boolean) {
    if (!o) {
      setResult(null);
      setUploadFile(null);
      setError("");
      onClose();
    }
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      await tracksApi.exportCsv();
    } catch {
      // silently ignore — browser may still download
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 bg-stone-950 border-stone-800">

        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-stone-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <FileSpreadsheet className="w-4 h-4 text-violet-400 flex-shrink-0" />
              <DialogTitle className="text-base">Bulk Metadata Update</DialogTitle>
            </div>
            {/* Download template — secondary, top-right */}
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex items-center gap-1.5 text-xs font-mono text-stone-500 hover:text-stone-300 disabled:opacity-50 transition-colors"
            >
              {downloading
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Download className="w-3 h-3" />}
              {downloading ? "Downloading…" : "Download template"}
            </button>
          </div>
          <DialogDescription>
            Upload a filled-in CSV to update track metadata in bulk. Need the template?{" "}
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="text-violet-400 hover:text-violet-300 underline underline-offset-2 disabled:opacity-50"
            >
              Download it here.
            </button>
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          {!result ? (
            <>
              {/* Drop zone — always visible, primary action */}
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f?.name.endsWith(".csv")) { setUploadFile(f); setResult(null); setError(""); }
                }}
                className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
                  uploadFile
                    ? "border-violet-500/50 bg-violet-500/5"
                    : "border-stone-700 hover:border-stone-600 hover:bg-stone-900/40"
                }`}
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
                    <p className="text-sm font-mono text-stone-200">{uploadFile.name}</p>
                    <p className="text-xs text-stone-500">{(uploadFile.size / 1024).toFixed(1)} KB — click to change</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="w-8 h-8 text-stone-600" />
                    <p className="text-sm font-mono text-stone-300">
                      Drop filled CSV here or <span className="text-violet-400 underline underline-offset-2">browse</span>
                    </p>
                    <p className="text-xs text-stone-600">Only .csv files — use the template above</p>
                  </div>
                )}
              </div>

              {/* Progress bar */}
              {uploading && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-mono text-stone-500">
                    <span>Applying updates…</span><span>{uploadPct}%</span>
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
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{error}
                </div>
              )}

              <Button
                onClick={handleUpload}
                disabled={!uploadFile || uploading}
                className="w-full bg-violet-600 hover:bg-violet-500 text-white border-0 gap-2"
              >
                {uploading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
                  : <><Upload className="w-4 h-4" /> Apply Updates</>}
              </Button>
            </>
          ) : (
            /* Result summary */
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Updated", value: result.updated, cls: "text-emerald-400" },
                  { label: "Skipped", value: result.skipped, cls: "text-stone-400" },
                  { label: "Errors", value: result.errors.length, cls: result.errors.length > 0 ? "text-red-400" : "text-stone-600" },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl px-4 py-3 text-center bg-stone-900 border border-stone-800">
                    <p className={`text-2xl font-display font-bold ${s.cls}`}>{s.value}</p>
                    <p className="text-xs font-mono text-stone-600 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>

              {result.errors.length > 0 && (
                <div className="rounded-xl p-3 max-h-36 overflow-y-auto space-y-1 bg-red-500/5 border border-red-500/15">
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs font-mono text-red-400">
                      Row {e.row} ({e.song_id || "—"}): {e.error}
                    </p>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => { setResult(null); setUploadFile(null); setError(""); }}
                >
                  Upload another
                </Button>
                <Button
                  className="flex-1 bg-violet-600 hover:bg-violet-500 text-white border-0"
                  onClick={onClose}
                >
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>

      </DialogContent>
    </Dialog>
  );
}
