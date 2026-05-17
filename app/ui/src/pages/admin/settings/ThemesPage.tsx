import { useTheme } from "@/context/ThemeContext";
import { CheckCircle2 } from "lucide-react";

const THEMES = [
  {
    id: "default" as const,
    label: "Default",
    description: "Dark · Violet",
    preview: (
      <div className="w-full h-28 rounded-lg bg-[#07070e] border border-[#863bff]/20 flex flex-col overflow-hidden">
        <div className="h-1.5 bg-[#863bff]" />
        <div className="flex-1 flex items-center justify-center gap-2">
          <img src="/favicon.svg" alt="" className="w-8 h-8 opacity-90" />
          <span className="font-display text-sm font-bold text-white">Tamasha</span>
        </div>
        <div className="h-6 bg-[#111111] border-t border-[#863bff]/10 flex items-center px-3 gap-1">
          {[1,2,3].map(i => <div key={i} className="h-1 rounded-full bg-[#863bff]/40" style={{width: `${20+i*10}px`}} />)}
        </div>
      </div>
    ),
  },
  {
    id: "simple" as const,
    label: "Simple",
    description: "Light · Pan-African",
    preview: (
      <div className="w-full h-28 rounded-lg bg-[#faf9f7] border border-[#e7e5e4] flex flex-col overflow-hidden">
        <div className="h-1.5 bg-[#c41e2a]" />
        <div className="flex-1 flex items-center justify-center gap-2.5">
          <img src="/tamasha-logo.png" alt="" className="w-9 h-9" />
          <div>
            <p className="font-display text-sm font-bold text-[#1c1917] leading-tight">Tamasha</p>
            <p className="text-[10px] text-[#78716c] font-mono">Every recording, in order.</p>
          </div>
        </div>
        <div className="h-6 bg-white border-t border-[#e7e5e4] flex items-center px-3 gap-1">
          {[1,2,3].map(i => <div key={i} className="h-1 rounded-full bg-[#c41e2a]/30" style={{width: `${20+i*10}px`}} />)}
        </div>
      </div>
    ),
  },
] as const;

export function ThemesPage() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xs font-mono font-semibold text-stone-600 uppercase tracking-widest mb-4">
          Choose Theme
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-xl">
          {THEMES.map((t) => {
            const active = theme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`relative flex flex-col gap-2 p-2 rounded-xl border-2 text-left transition-all ${
                  active
                    ? "border-violet-500 shadow-[0_0_16px_rgba(134,59,255,0.2)]"
                    : "border-stone-800 hover:border-stone-600"
                }`}
              >
                {active && (
                  <span className="absolute top-2 right-2 z-10">
                    <CheckCircle2 className="w-4 h-4 text-violet-400" />
                  </span>
                )}
                {t.preview}
                <div className="px-1 pb-1">
                  <p className="text-xs font-mono font-semibold text-stone-200">{t.label}</p>
                  <p className="text-[11px] font-mono text-stone-600">{t.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
