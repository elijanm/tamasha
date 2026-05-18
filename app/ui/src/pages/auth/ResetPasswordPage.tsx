import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, ArrowRight, CheckCircle2, AlertCircle } from "lucide-react";
import { authApi } from "@/api/auth";
import { useTheme } from "@/context/ThemeContext";
import { Input } from "@/components/ui/input";

function useResetForm() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!token) {
      setError("Missing reset token. Please use the link from the email.");
      return;
    }
    setIsLoading(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate("/login"), 2500);
    } catch {
      setError("This link is invalid or has expired. Request a new one.");
    } finally {
      setIsLoading(false);
    }
  };

  return { password, setPassword, confirm, setConfirm, isLoading, done, error, handleSubmit, token };
}

function SimpleForm() {
  const { password, setPassword, confirm, setConfirm, isLoading, done, error, handleSubmit, token } = useResetForm();
  const [focusedPw, setFocusedPw] = useState(false);
  const [focusedCf, setFocusedCf] = useState(false);

  if (!token) {
    return (
      <div className="text-center">
        <AlertCircle className="mx-auto mb-4 h-10 w-10" style={{ color: "#c41e2a" }} />
        <h2 className="font-display font-bold mb-2" style={{ color: "#0c0a08", fontSize: "22px" }}>
          Invalid link
        </h2>
        <p className="text-sm mb-6" style={{ color: "#9c9189", fontFamily: "'DM Sans', 'Inter', sans-serif" }}>
          This reset link is missing its token.
        </p>
        <Link to="/forgot-password" className="text-sm font-medium" style={{ color: "#1c1917", textDecoration: "underline", textUnderlineOffset: "3px" }}>
          Request a new link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="text-center">
        <CheckCircle2 className="mx-auto mb-4 h-10 w-10" style={{ color: "#1a7a1a" }} />
        <h2 className="font-display font-bold mb-2" style={{ color: "#0c0a08", fontSize: "22px" }}>
          Password updated
        </h2>
        <p className="text-sm" style={{ color: "#9c9189", fontFamily: "'DM Sans', 'Inter', sans-serif" }}>
          Redirecting you to sign in…
        </p>
      </div>
    );
  }

  const fieldStyle = (focused: boolean) => ({
    background: focused ? "#ffffff" : "#f8f6f3",
    border: `1.5px solid ${focused ? "#1c1917" : "#e5e2dc"}`,
    color: "#1c1917",
    fontFamily: "'DM Sans', 'Inter', sans-serif",
    boxShadow: focused ? "0 0 0 3px rgba(28,25,23,0.06)" : "none",
  });

  return (
    <div>
      <div className="mb-9">
        <h2 className="font-display font-bold mb-2" style={{ color: "#0c0a08", fontSize: "26px", letterSpacing: "-0.02em" }}>
          Set new password
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: "#9c9189", fontFamily: "'DM Sans', 'Inter', sans-serif" }}>
          Choose a strong password for your account
        </p>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl text-sm"
          style={{ background: "rgba(196,30,42,0.05)", border: "1.5px solid rgba(196,30,42,0.18)", color: "#c41e2a", fontFamily: "'DM Sans', 'Inter', sans-serif" }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-[11px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: focusedPw ? "#1c1917" : "#9c9189" }}>
            New password
          </label>
          <input id="password" type="password" placeholder="Min. 8 characters" value={password}
            onChange={(e) => setPassword(e.target.value)} autoFocus required minLength={8}
            autoComplete="new-password"
            className="w-full h-12 px-4 rounded-xl text-sm outline-none transition-all duration-150"
            style={fieldStyle(focusedPw)}
            onFocus={() => setFocusedPw(true)} onBlur={() => setFocusedPw(false)} />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="confirm" className="block text-[11px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: focusedCf ? "#1c1917" : "#9c9189" }}>
            Confirm password
          </label>
          <input id="confirm" type="password" placeholder="••••••••" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} required minLength={8}
            autoComplete="new-password"
            className="w-full h-12 px-4 rounded-xl text-sm outline-none transition-all duration-150"
            style={fieldStyle(focusedCf)}
            onFocus={() => setFocusedCf(true)} onBlur={() => setFocusedCf(false)} />
        </div>

        <div className="pt-1">
          <button type="submit" disabled={isLoading}
            className="w-full h-12 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "#0c0a08", color: "#ffffff", fontFamily: "'DM Sans', 'Inter', sans-serif", letterSpacing: "0.01em", boxShadow: "0 1px 2px rgba(0,0,0,0.18), 0 4px 16px rgba(12,10,8,0.12)" }}
            onMouseEnter={(e) => { if (!isLoading) (e.currentTarget as HTMLButtonElement).style.background = "#1c1917"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#0c0a08"; }}>
            {isLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <>Update password <ArrowRight className="h-4 w-4" /></>}
          </button>
        </div>
      </form>

      <div className="flex items-center gap-3 my-7">
        <div className="h-px flex-1" style={{ backgroundColor: "#ece9e4" }} />
        <div className="flex gap-1">
          <div className="w-1 h-1 rounded-full" style={{ backgroundColor: "#c41e2a" }} />
          <div className="w-1 h-1 rounded-full" style={{ backgroundColor: "#1a7a1a" }} />
          <div className="w-1 h-1 rounded-full" style={{ backgroundColor: "#ca8a04" }} />
        </div>
        <div className="h-px flex-1" style={{ backgroundColor: "#ece9e4" }} />
      </div>

      <p className="text-sm text-center" style={{ color: "#a8a29e", fontFamily: "'DM Sans', 'Inter', sans-serif" }}>
        <Link to="/login" className="font-medium transition-colors" style={{ color: "#1c1917", textDecoration: "underline", textUnderlineOffset: "3px" }}>
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

function DefaultForm() {
  const { password, setPassword, confirm, setConfirm, isLoading, done, error, handleSubmit, token } = useResetForm();

  const cardStyle = {
    background: "rgba(10,8,20,0.85)",
    border: "1px solid rgba(134,59,255,0.18)",
    backdropFilter: "blur(20px)" as const,
    boxShadow: "0 0 0 1px rgba(134,59,255,0.08), 0 32px 64px rgba(0,0,0,0.6), 0 0 80px rgba(134,59,255,0.05)",
  };

  if (!token) {
    return (
      <div className="rounded-2xl p-7 shadow-2xl text-center" style={cardStyle}>
        <AlertCircle className="mx-auto mb-4 h-10 w-10" style={{ color: "#fca5a5" }} />
        <h2 className="font-display text-lg font-semibold mb-2" style={{ color: "#ede6ff" }}>Invalid link</h2>
        <p className="text-sm font-body mb-5" style={{ color: "rgba(255,255,255,0.4)" }}>This reset link is missing its token.</p>
        <Link to="/forgot-password" className="text-sm font-mono" style={{ color: "rgba(134,59,255,0.8)" }}>Request a new link</Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="rounded-2xl p-7 shadow-2xl text-center" style={cardStyle}>
        <CheckCircle2 className="mx-auto mb-4 h-10 w-10" style={{ color: "#4ade80" }} />
        <h2 className="font-display text-lg font-semibold mb-2" style={{ color: "#ede6ff" }}>Password updated</h2>
        <p className="text-sm font-body" style={{ color: "rgba(255,255,255,0.4)" }}>Redirecting you to sign in…</p>
      </div>
    );
  }

  const inputStyle = { background: "rgba(134,59,255,0.05)", border: "1px solid rgba(134,59,255,0.2)", color: "#ede6ff" };

  return (
    <div className="rounded-2xl p-7 shadow-2xl" style={cardStyle}>
      <div className="mb-6">
        <h2 className="font-display text-lg font-semibold" style={{ color: "#ede6ff" }}>Set new password</h2>
        <p className="mt-1 text-sm font-body" style={{ color: "rgba(255,255,255,0.3)" }}>Choose a strong password for your account</p>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2.5 rounded-lg text-sm font-body"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#fca5a5" }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-xs font-mono tracking-wider uppercase" style={{ color: "rgba(255,255,255,0.35)" }}>
            New password
          </label>
          <Input type="password" placeholder="Min. 8 characters" value={password}
            onChange={(e) => setPassword(e.target.value)} required minLength={8} autoFocus
            autoComplete="new-password" className="h-10 text-sm font-body" style={inputStyle} />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-mono tracking-wider uppercase" style={{ color: "rgba(255,255,255,0.35)" }}>
            Confirm password
          </label>
          <Input type="password" placeholder="••••••••" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} required minLength={8}
            autoComplete="new-password" className="h-10 text-sm font-body" style={inputStyle} />
        </div>

        <button type="submit" disabled={isLoading}
          className="w-full mt-2 h-11 rounded-lg flex items-center justify-center gap-2 text-sm font-mono font-semibold tracking-wide transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: "linear-gradient(135deg, #863bff 0%, #6d28d9 100%)", color: "#fff", boxShadow: "0 0 32px rgba(134,59,255,0.35), 0 4px 12px rgba(0,0,0,0.4)" }}>
          {isLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <>Update password <ArrowRight className="h-4 w-4" /></>}
        </button>
      </form>

      <p className="mt-5 text-center text-sm font-body" style={{ color: "rgba(255,255,255,0.2)" }}>
        <Link to="/login" style={{ color: "rgba(134,59,255,0.8)" }}>Back to sign in</Link>
      </p>
    </div>
  );
}

export function ResetPasswordPage() {
  const { theme } = useTheme();
  return theme === "simple" ? <SimpleForm /> : <DefaultForm />;
}
