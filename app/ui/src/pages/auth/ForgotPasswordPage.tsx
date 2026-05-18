import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Loader2, ArrowLeft, CheckCircle2 } from "lucide-react";
import { authApi } from "@/api/auth";
import { useTheme } from "@/context/ThemeContext";
import { Input } from "@/components/ui/input";

function useForgotForm() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return { email, setEmail, isLoading, sent, error, handleSubmit };
}

function SimpleForm() {
  const { email, setEmail, isLoading, sent, error, handleSubmit } = useForgotForm();
  const [focused, setFocused] = useState(false);

  if (sent) {
    return (
      <div className="text-center">
        <CheckCircle2 className="mx-auto mb-4 h-10 w-10" style={{ color: "#1a7a1a" }} />
        <h2 className="font-display font-bold mb-2" style={{ color: "#0c0a08", fontSize: "22px" }}>
          Check your email
        </h2>
        <p className="text-sm mb-8" style={{ color: "#9c9189", fontFamily: "'DM Sans', 'Inter', sans-serif" }}>
          If <strong>{email}</strong> has an account, a reset link has been sent.
        </p>
        <Link
          to="/login"
          className="text-sm font-medium transition-colors"
          style={{ color: "#1c1917", textDecoration: "underline", textUnderlineOffset: "3px" }}
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-9">
        <h2
          className="font-display font-bold mb-2"
          style={{ color: "#0c0a08", fontSize: "26px", letterSpacing: "-0.02em" }}
        >
          Reset your password
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: "#9c9189", fontFamily: "'DM Sans', 'Inter', sans-serif" }}>
          Enter your email and we'll send a reset link
        </p>
      </div>

      {error && (
        <div
          className="mb-6 px-4 py-3 rounded-xl text-sm"
          style={{
            background: "rgba(196,30,42,0.05)",
            border: "1.5px solid rgba(196,30,42,0.18)",
            color: "#c41e2a",
            fontFamily: "'DM Sans', 'Inter', sans-serif",
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <label
            htmlFor="email"
            className="block text-[11px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: focused ? "#1c1917" : "#9c9189" }}
          >
            Email address
          </label>
          <input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            autoComplete="email"
            required
            className="w-full h-12 px-4 rounded-xl text-sm outline-none transition-all duration-150"
            style={{
              background: focused ? "#ffffff" : "#f8f6f3",
              border: `1.5px solid ${focused ? "#1c1917" : "#e5e2dc"}`,
              color: "#1c1917",
              fontFamily: "'DM Sans', 'Inter', sans-serif",
              boxShadow: focused ? "0 0 0 3px rgba(28,25,23,0.06)" : "none",
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
        </div>

        <div className="pt-1">
          <button
            type="submit"
            disabled={isLoading}
            className="w-full h-12 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: "#0c0a08",
              color: "#ffffff",
              fontFamily: "'DM Sans', 'Inter', sans-serif",
              letterSpacing: "0.01em",
              boxShadow: "0 1px 2px rgba(0,0,0,0.18), 0 4px 16px rgba(12,10,8,0.12)",
            }}
            onMouseEnter={(e) => { if (!isLoading) (e.currentTarget as HTMLButtonElement).style.background = "#1c1917"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#0c0a08"; }}
          >
            {isLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : "Send reset link"}
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
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 font-medium transition-colors"
          style={{ color: "#1c1917", textDecoration: "underline", textUnderlineOffset: "3px" }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

function DefaultForm() {
  const { email, setEmail, isLoading, sent, error, handleSubmit } = useForgotForm();

  if (sent) {
    return (
      <div
        className="rounded-2xl p-7 shadow-2xl text-center"
        style={{
          background: "rgba(10,8,20,0.85)",
          border: "1px solid rgba(134,59,255,0.18)",
          backdropFilter: "blur(20px)",
        }}
      >
        <CheckCircle2 className="mx-auto mb-4 h-10 w-10" style={{ color: "#4ade80" }} />
        <h2 className="font-display text-lg font-semibold mb-2" style={{ color: "#ede6ff" }}>
          Check your email
        </h2>
        <p className="text-sm font-body mb-6" style={{ color: "rgba(255,255,255,0.4)" }}>
          If <strong style={{ color: "rgba(255,255,255,0.6)" }}>{email}</strong> has an account, a reset link has been sent.
        </p>
        <Link to="/login" className="text-sm font-mono" style={{ color: "rgba(134,59,255,0.8)" }}>
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl p-7 shadow-2xl"
      style={{
        background: "rgba(10,8,20,0.85)",
        border: "1px solid rgba(134,59,255,0.18)",
        backdropFilter: "blur(20px)",
        boxShadow: "0 0 0 1px rgba(134,59,255,0.08), 0 32px 64px rgba(0,0,0,0.6), 0 0 80px rgba(134,59,255,0.05)",
      }}
    >
      <div className="mb-6">
        <h2 className="font-display text-lg font-semibold" style={{ color: "#ede6ff" }}>
          Reset your password
        </h2>
        <p className="mt-1 text-sm font-body" style={{ color: "rgba(255,255,255,0.3)" }}>
          Enter your email and we'll send a reset link
        </p>
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
            Email
          </label>
          <Input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="email"
            className="h-10 text-sm font-body"
            style={{ background: "rgba(134,59,255,0.05)", border: "1px solid rgba(134,59,255,0.2)", color: "#ede6ff" }}
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full mt-2 h-11 rounded-lg flex items-center justify-center gap-2 text-sm font-mono font-semibold tracking-wide transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: "linear-gradient(135deg, #863bff 0%, #6d28d9 100%)",
            color: "#fff",
            boxShadow: "0 0 32px rgba(134,59,255,0.35), 0 4px 12px rgba(0,0,0,0.4)",
          }}
        >
          {isLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : "Send reset link"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm font-body" style={{ color: "rgba(255,255,255,0.2)" }}>
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5"
          style={{ color: "rgba(134,59,255,0.8)" }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

export function ForgotPasswordPage() {
  const { theme } = useTheme();
  return theme === "simple" ? <SimpleForm /> : <DefaultForm />;
}
