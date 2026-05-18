import { useRef, useState } from "react";
import { Download, Upload, CheckCircle2, AlertTriangle, Loader2, FileSpreadsheet, Info } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  const [downloadDone, setDownloadDone] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function handleOpenChange(o: boolean) {
    if (!o) onClose();
  }

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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 bg-stone-950 border-stone-800">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-stone-800">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="w-4 h-4 text-violet-400 flex-shrink-0" />
            <DialogTitle className="text-base">Bulk Metadata Update</DialogTitle>
          </div>
          <DialogDescription>
            Download the full catalogue as CSV, fill in metadata, then re-upload.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="download" className="w-full">
          <div className="px-6 border-b border-stone-800">
            <TabsList className="bg-transparent p-0 h-auto gap-0 rounded-none">
              <TabsTrigger
                value="download"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-500 data-[state=active]:bg-transparent data-[state=active]:text-violet-400 px-0 mr-6 py-3 gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Download CSV
              </TabsTrigger>
              <TabsTrigger
                value="upload"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-500 data-[state=active]:bg-transparent data-[state=active]:text-violet-400 px-0 py-3 gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" /> Upload CSV
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ── Download tab ── */}
          <TabsContent value="download" className="px-6 py-5 space-y-4 mt-0">
            <div className="rounded-xl p-4 bg-violet-500/5 border border-violet-500/15 space-y-2">
              <p className="text-sm font-body text-stone-300">
                Downloads a CSV with every track in the catalogue.
              </p>
              <div className="space-y-1">
                {[
                  ["song_id", "Immutable — do not edit"],
                  ["folder", "R2 storage key (immutable)"],
                  ["title, artist_name, album…", "Edit freely"],
                  ["bpm, track_number, disc_number", "Numeric fields"],
                  ["explicit", "true / false"],
                  ["tags", "Comma-separated list"],
                ].map(([col, note]) => (
                  <div key={col} className="flex items-start gap-2 text-xs font-mono">
                    <span className="text-violet-400 flex-shrink-0">{col}</span>
                    <span className="text-stone-600">— {note}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-start gap-2 text-xs text-stone-500 font-body">
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-stone-600" />
              <span>Leave any cell blank to keep the existing value. Only non-empty cells are written on upload.</span>
            </div>

            {error && <p className="text-xs text-red-400 font-mono">{error}</p>}

            {downloadDone && (
              <div className="flex items-center gap-2 text-xs text-emerald-400 font-mono">
                <CheckCircle2 className="w-3.5 h-3.5" />
                CSV downloaded — fill it in, then switch to Upload CSV.
              </div>
            )}

            <Button
              onClick={handleDownload}
              disabled={downloading}
              className="w-full bg-violet-600 hover:bg-violet-500 text-white border-0 gap-2"
            >
              {downloading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Exporting…</>
                : <><Download className="w-4 h-4" /> Download tamasha_catalogue.csv</>}
            </Button>
          </TabsContent>

          {/* ── Upload tab ── */}
          <TabsContent value="upload" className="px-6 py-5 space-y-4 mt-0">
            {!result ? (
              <>
                {/* Drop zone */}
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files[0];
                    if (f?.name.endsWith(".csv")) { setUploadFile(f); setResult(null); setError(""); }
                  }}
                  className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
                    uploadFile
                      ? "border-violet-500/50 bg-violet-500/5"
                      : "border-stone-700 hover:border-stone-600"
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
                      <p className="text-sm font-mono text-stone-300">{uploadFile.name}</p>
                      <p className="text-xs text-stone-600">{(uploadFile.size / 1024).toFixed(1)} KB — click to change</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <Upload className="w-8 h-8 text-stone-600" />
                      <p className="text-sm font-mono text-stone-400">
                        Drop CSV here or <span className="text-violet-400 underline">browse</span>
                      </p>
                      <p className="text-xs text-stone-600">Only .csv files accepted</p>
                    </div>
                  )}
                </div>

                {uploading && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-mono text-stone-500">
                      <span>Uploading…</span><span>{uploadPct}%</span>
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
                  <div className="rounded-xl p-3 max-h-40 overflow-y-auto space-y-1 bg-red-500/5 border border-red-500/15">
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
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
