import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Clock, Download, Trash2, RefreshCw, CreditCard, LogOut, CheckCircle2, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBillingStatus } from "@/hooks/useBillingStatus";
import { useAuth } from "@/hooks/useAuth";
import { billingApi } from "@/api/billing";
import { toast } from "@/hooks/useToast";
import type { BillingGateStatus, BillingPhase, PaymentArrangement } from "@/types";

function formatUSD(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function formatDate(s: string) {
  return new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}
function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

const PHASE_CONFIG: Record<BillingPhase, {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  title: string;
}> = {
  none:           { icon: CreditCard,    color: "text-stone-400",  bg: "bg-stone-800",     title: "Payment Required" },
  overdue:        { icon: AlertTriangle, color: "text-red-400",    bg: "bg-red-500/10",    title: "Invoice Overdue" },
  grace:          { icon: Clock,         color: "text-amber-400",  bg: "bg-amber-500/10",  title: "Services Suspended" },
  warning:        { icon: AlertTriangle, color: "text-orange-400", bg: "bg-orange-500/10", title: "Deletion Warning" },
  data_available: { icon: Download,      color: "text-blue-400",   bg: "bg-blue-500/10",   title: "Download Your Data" },
  deleted:        { icon: Trash2,        color: "text-red-400",    bg: "bg-red-500/10",    title: "Account Deleted" },
  arrangement:    { icon: CreditCard,    color: "text-violet-400", bg: "bg-violet-500/10", title: "Services Restored" },
};

// ── Arrangement request form ───────────────────────────────────────────────────

function ArrangementForm({
  invoiceId,
  balance,
  onSuccess,
}: {
  invoiceId: string;
  balance: number;
  onSuccess: () => void;
}) {
  const qc = useQueryClient();
  const today = new Date();
  const maxDate = new Date(today);
  maxDate.setDate(today.getDate() + 7);
  const minDateStr = isoDate(new Date(today.getTime() + 86400000)); // tomorrow
  const maxDateStr = isoDate(maxDate);

  const [installments, setInstallments] = useState<"2" | "3">("2");
  const n = parseInt(installments);

  const [dates, setDates] = useState<string[]>(["", ""]);

  const setDate = (i: number, v: string) => {
    setDates((prev) => { const next = [...prev]; next[i] = v; return next; });
  };

  const handleInstallmentsChange = (v: "2" | "3") => {
    const count = parseInt(v);
    setDates((prev) => {
      const next = [...prev];
      while (next.length < count) next.push("");
      return next.slice(0, count);
    });
    setInstallments(v);
  };

  // Always in sync with dates state — no memo needed
  const adjustedDates = dates.slice(0, n);

  const perInstallment = (idx: number) => {
    const base = Math.floor((balance / n) * 100) / 100;
    if (idx === n - 1) return Math.round((balance - base * (n - 1)) * 100) / 100;
    return base;
  };

  const { mutate, isPending } = useMutation({
    mutationFn: () => billingApi.requestArrangement(invoiceId, n, adjustedDates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing"] });
      toast({ title: "Payment arrangement requested", variant: "success" });
      onSuccess();
    },
    onError: (e: any) => toast({
      title: e?.response?.data?.detail ?? "Failed to submit arrangement",
      variant: "destructive",
    }),
  });

  const valid = adjustedDates.every((d) => d >= minDateStr && d <= maxDateStr) &&
    adjustedDates.every((d, i) => i === 0 || d > adjustedDates[i - 1]);

  return (
    <div className="bg-stone-900/70 border border-stone-700/50 rounded-xl p-5 space-y-4 text-left max-w-sm mx-auto">
      <div className="flex items-center gap-2">
        <CalendarDays className="w-4 h-4 text-violet-400" />
        <p className="text-sm font-display font-semibold text-stone-200">Request Payment Arrangement</p>
      </div>
      <p className="text-xs font-body text-stone-500">
        Split your balance of <strong className="text-stone-300">{formatUSD(balance)}</strong> into installments.
        Each due date must be within 7 days from today.
      </p>

      <div className="space-y-1">
        <label className="text-[10px] font-mono uppercase tracking-wider text-stone-500">Installments</label>
        <Select value={installments} onValueChange={(v) => handleInstallmentsChange(v as "2" | "3")}>
          <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="2">2 payments</SelectItem>
            <SelectItem value="3">3 payments</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="space-y-1">
          <label className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
            Installment {i + 1} — {formatUSD(perInstallment(i))} — due date
          </label>
          <Input
            type="date"
            value={adjustedDates[i] ?? ""}
            min={i === 0 ? minDateStr : (adjustedDates[i - 1] || minDateStr)}
            max={maxDateStr}
            onChange={(e) => setDate(i, e.target.value)}
            className="h-9 text-sm"
          />
        </div>
      ))}

      <Button
        className="w-full h-9 text-sm bg-violet-600 hover:bg-violet-500 text-white border-0"
        onClick={() => mutate()}
        disabled={isPending || !valid}
      >
        {isPending ? "Submitting…" : "Submit Arrangement Request"}
      </Button>
    </div>
  );
}

// ── Active arrangement status ─────────────────────────────────────────────────

function ArrangementStatus({ arr }: { arr: PaymentArrangement }) {
  return (
    <div className="bg-stone-900/70 border border-stone-700/50 rounded-xl p-5 space-y-3 text-left max-w-sm mx-auto">
      <div className="flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-violet-400" />
        <p className="text-sm font-display font-semibold text-stone-200">Payment Arrangement</p>
        <span className={`ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded ${
          arr.status === "active" ? "text-violet-400 bg-violet-500/10" :
          arr.status === "completed" ? "text-emerald-400 bg-emerald-500/10" :
          "text-red-400 bg-red-500/10"
        }`}>{arr.status}</span>
      </div>
      {arr.amounts_usd.map((amt, i) => {
        const paid = arr.paid_flags[i];
        const paidAt = arr.paid_at_list[i];
        return (
          <div key={i} className={`flex items-center gap-3 py-2 border-t border-stone-800/40 ${paid ? "opacity-60" : ""}`}>
            {paid
              ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              : <Clock className="w-4 h-4 text-amber-400 flex-shrink-0" />
            }
            <div className="flex-1 min-w-0">
              <p className="text-xs font-mono text-stone-300">
                Installment {i + 1} — {formatUSD(amt)}
              </p>
              <p className="text-[10px] text-stone-600">
                {paid && paidAt ? `Paid ${formatDate(paidAt)}` : `Due ${formatDate(arr.due_dates[i])}`}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Phase card ────────────────────────────────────────────────────────────────

function PhaseCard({ status }: { status: BillingGateStatus }) {
  const [showForm, setShowForm] = useState(false);
  const phase = status.phase as BillingPhase;
  const cfg = PHASE_CONFIG[phase] ?? PHASE_CONFIG.grace;
  const Icon = cfg.icon;
  const inv = status.current_invoice;
  const arr = status.active_arrangement;

  const isBlocked = status.arrangement_blocked;
  // Can request arrangement: gated, has invoice, not blocked, no active arrangement
  const canRequestArrangement =
    status.is_gated &&
    inv &&
    phase !== "deleted" &&
    phase !== "data_available" &&
    !isBlocked &&
    (!arr || arr.status === "completed");

  return (
    <div className={`rounded-2xl border border-stone-700/50 p-8 ${cfg.bg} space-y-6 text-center`}>
      <div className="flex justify-center">
        <div className="w-16 h-16 rounded-full bg-stone-900 flex items-center justify-center">
          <Icon className={`w-8 h-8 ${cfg.color}`} />
        </div>
      </div>

      <div>
        <h2 className={`text-2xl font-display font-bold ${cfg.color}`}>{cfg.title}</h2>
        <p className="mt-2 text-sm font-body text-stone-400 max-w-md mx-auto">{status.gate_message}</p>
      </div>

      {/* Invoice details */}
      {inv && (
        <div className="bg-stone-900/60 rounded-xl border border-stone-700/50 p-5 text-left space-y-3 max-w-sm mx-auto">
          <p className="text-xs font-mono text-stone-500 uppercase tracking-wider">Invoice</p>
          <div className="flex justify-between text-sm">
            <span className="text-stone-400">Period</span>
            <span className="text-stone-200 font-mono">{inv.period_label}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-stone-400">Amount</span>
            <span className="text-stone-200 font-mono">{formatUSD(inv.amount_usd)}</span>
          </div>
          {inv.paid_amount_usd > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-stone-400">Paid</span>
              <span className="text-emerald-400 font-mono">{formatUSD(inv.paid_amount_usd)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm border-t border-stone-700 pt-3">
            <span className="text-stone-300 font-semibold">Balance Due</span>
            <span className={`font-mono font-bold ${cfg.color}`}>{formatUSD(inv.balance_usd)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-stone-400">Due Date</span>
            <span className="text-stone-300 font-mono">{formatDate(inv.due_date)}</span>
          </div>
          {inv.days_overdue > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-stone-400">Days Overdue</span>
              <span className="text-red-400 font-mono">{inv.days_overdue}</span>
            </div>
          )}
        </div>
      )}

      {/* Phase-specific indicators */}
      {phase === "grace" && status.grace_days_remaining != null && (
        <div className="flex items-center justify-center gap-2 text-amber-400">
          <Clock className="w-4 h-4" />
          <span className="text-sm font-mono">
            {status.grace_days_remaining} day{status.grace_days_remaining !== 1 ? "s" : ""} remaining in grace period
          </span>
        </div>
      )}

      {phase === "warning" && status.deletion_days_remaining != null && (
        <div className="flex items-center justify-center gap-2 text-orange-400 bg-orange-500/10 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-mono">
            ⚠ Data will be permanently deleted in{" "}
            <strong>{status.deletion_days_remaining}</strong> day{status.deletion_days_remaining !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {phase === "data_available" && (
        <div className="space-y-4">
          {status.download_days_remaining != null && (
            <p className="text-sm font-mono text-blue-400">
              Download link valid for <strong>{status.download_days_remaining}</strong> more day{status.download_days_remaining !== 1 ? "s" : ""}
            </p>
          )}
          {status.data_export_url ? (
            <a
              href={status.data_export_url}
              download
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Download className="w-4 h-4" />
              Download My Data
            </a>
          ) : (
            <div className="flex items-center justify-center gap-2 text-stone-500 text-sm">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Preparing your data export…
            </div>
          )}
        </div>
      )}

      {phase === "deleted" && (
        <p className="text-sm font-body text-stone-500">
          Your account data has been deleted. Contact support if you believe this is an error.
        </p>
      )}

      {/* Active arrangement status (when services restored) */}
      {phase === "arrangement" && arr && (
        <ArrangementStatus arr={arr} />
      )}

      {/* Arrangement controls on gate pages */}
      {arr && arr.status !== "completed" && phase !== "arrangement" && (
        <ArrangementStatus arr={arr} />
      )}

      {isBlocked && (
        <div className="text-xs font-mono text-red-400 bg-red-500/10 rounded-lg px-4 py-2">
          Payment arrangements are disabled for this account due to a previous default. Contact support to have this reviewed.
        </div>
      )}

      {canRequestArrangement && (
        showForm ? (
          <ArrangementForm
            invoiceId={inv!.id}
            balance={inv!.balance_usd}
            onSuccess={() => setShowForm(false)}
          />
        ) : (
          <Button
            variant="outline"
            className="border-violet-500/50 text-violet-400 hover:bg-violet-500/10 hover:border-violet-400"
            onClick={() => setShowForm(true)}
          >
            <CalendarDays className="w-4 h-4 mr-2" />
            Request Payment Arrangement
          </Button>
        )
      )}
    </div>
  );
}

export function BillingGatePage() {
  const { gateStatus } = useBillingStatus();
  const { logout } = useAuth();
  const [showContact, setShowContact] = useState(false);

  return (
    <div className="min-h-screen bg-stone-950 flex flex-col items-center justify-center p-6">
      {/* Logo */}
      <div className="mb-8 flex items-center gap-3">
        <div className="relative">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "radial-gradient(ellipse, rgba(134,59,255,0.35) 0%, transparent 70%)",
              filter: "blur(16px)",
              transform: "scale(2.4)",
            }}
          />
          <img
            src="https://tamasharecordings.com/img/tamasha-logo.png"
            alt="Tamasha"
            className="relative h-10 w-auto object-contain"
            style={{ filter: "invert(1) drop-shadow(0 0 18px rgba(134,59,255,0.8))" }}
          />
        </div>
        <span className="font-display font-bold text-xl text-violet-200" style={{ letterSpacing: "-0.02em" }}>
          Tamasha
        </span>
      </div>

      <div className="w-full max-w-lg space-y-6">
        {gateStatus ? (
          <PhaseCard status={gateStatus} />
        ) : (
          <Card className="p-8 text-center">
            <RefreshCw className="w-6 h-6 animate-spin text-stone-500 mx-auto mb-3" />
            <p className="text-sm text-stone-500">Loading billing status…</p>
          </Card>
        )}

        <div className="text-center space-y-3">
          {gateStatus?.phase !== "deleted" && gateStatus?.phase !== "arrangement" && (
            <p className="text-xs font-body text-stone-600">
              To restore access, contact your platform administrator to process the outstanding invoice.
            </p>
          )}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setShowContact(!showContact)}
              className="text-xs font-mono text-stone-600 hover:text-stone-400 transition-colors"
            >
              Contact support
            </button>
            <span className="text-stone-800">·</span>
            <button
              onClick={logout}
              className="flex items-center gap-1 text-xs font-mono text-stone-600 hover:text-red-400 transition-colors"
            >
              <LogOut className="w-3 h-3" />
              Sign out
            </button>
          </div>
          {showContact && (
            <div className="text-xs font-mono text-stone-500 bg-stone-900 rounded-lg p-3">
              billing@tamasha.com
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
