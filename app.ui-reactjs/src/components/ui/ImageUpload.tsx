import { useRef, useState } from "react";
import { Upload, X, Loader2, ImageIcon } from "lucide-react";

interface Props {
  currentUrl?: string | null;
  onFile: (file: File) => Promise<void>;
  label?: string;
  size?: "sm" | "md" | "lg";
  shape?: "square" | "circle";
}

const SIZES = {
  sm: "w-16 h-16",
  md: "w-24 h-24",
  lg: "w-32 h-32",
};

export function ImageUpload({ currentUrl, onFile, label = "Upload image", size = "md", shape = "square" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const displayUrl = preview ?? currentUrl ?? null;
  const shapeClass = shape === "circle" ? "rounded-full" : "rounded-lg";

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Not an image file");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Image must be under 10 MB");
      return;
    }
    setError(null);
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setUploading(true);
    try {
      await onFile(file);
    } catch {
      setError("Upload failed");
      setPreview(null);
    } finally {
      setUploading(false);
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <div
        className={`relative ${SIZES[size]} ${shapeClass} bg-stone-800 border-2 ${
          dragging ? "border-violet-500" : "border-stone-700"
        } overflow-hidden cursor-pointer group transition-colors hover:border-stone-600`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {displayUrl ? (
          <img src={displayUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-1/3 h-1/3 text-stone-600" />
          </div>
        )}

        {/* Hover overlay */}
        <div className={`absolute inset-0 ${shapeClass} flex flex-col items-center justify-center gap-1 bg-black/60 transition-opacity ${uploading ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
          {uploading
            ? <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
            : <>
                <Upload className="w-4 h-4 text-stone-300" />
                <span className="text-[10px] font-mono text-stone-400">change</span>
              </>
          }
        </div>

        {/* Clear button (only when there's an image and not uploading) */}
        {displayUrl && !uploading && (
          <button
            onClick={(e) => { e.stopPropagation(); setPreview(null); }}
            className={`absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80`}
          >
            <X className="w-3 h-3 text-white" />
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={onInputChange}
      />

      <div>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="text-xs font-mono text-violet-500 hover:text-violet-400 disabled:opacity-40 transition-colors"
        >
          {uploading ? "Uploading…" : label}
        </button>
        {error && <p className="text-[10px] font-mono text-red-400 mt-0.5">{error}</p>}
        <p className="text-[10px] font-mono text-stone-700 mt-0.5">JPEG · PNG · WebP · GIF · max 10 MB</p>
      </div>
    </div>
  );
}
