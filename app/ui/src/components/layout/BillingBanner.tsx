import { useState } from "react";
import { X, AlertTriangle, CreditCard, Receipt } from "lucide-react";
import { useBillingStatus } from "@/hooks/useBillingStatus";
import { useAuth } from "@/hooks/useAuth";

function formatUSD(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function daysUntil(iso: string): number {
  const diff = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}

export function BillingBanner() {
  const { gateStatus } = useBillingStatus();
  const { isSuperAdmin } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  // Only superadmin and accounting admins (when enabled via BILLING_BANNER_ACCOUNTING) see the banner
  if (!isSuperAdmin && !gateStatus?.show_accounting_banner) return null;
  if (dismissed || !gateStatus) return null;

  const { phase, current_invoice: inv, active_arrangement: arr, next_installment_due, next_installment_amount } = gateStatus;

  // Arrangement active — remind about upcoming installment
  if (phase === "arrangement" && next_installment_due && next_installment_amount != null) {
    const days = daysUntil(next_installment_due);
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 bg-violet-900/40 border-b border-violet-700/40 text-sm">
        <CreditCard className="w-4 h-4 text-violet-400 flex-shrink-0" />
        <span className="flex-1 font-body text-violet-200">
          Payment arrangement active —{" "}
          <strong>{formatUSD(next_installment_amount)}</strong> installment due
          {days === 0 ? " today" : ` in ${days} day${days !== 1 ? "s" : ""}`}.
        </span>
        <button onClick={() => setDismissed(true)} className="text-violet-500 hover:text-violet-300 flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // Invoice overdue — 3-day soft warning window (services not yet suspended)
  if (phase === "overdue" && inv) {
    const overdueDays = inv.days_overdue;
    const daysUntilGate = Math.max(0, 3 - overdueDays);
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 bg-red-900/40 border-b border-red-700/40 text-sm">
        <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
        <span className="flex-1 font-body text-red-200">
          Invoice for <strong>{inv.period_label}</strong> is overdue by{" "}
          <strong>{overdueDays} day{overdueDays !== 1 ? "s" : ""}</strong> — {formatUSD(inv.balance_usd)} outstanding.
          {daysUntilGate > 0
            ? ` Services will be suspended in ${daysUntilGate} day${daysUntilGate !== 1 ? "s" : ""}.`
            : " Services will be suspended soon."}
        </span>
        <button onClick={() => setDismissed(true)} className="text-red-500 hover:text-red-300 flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // Pending invoice — show always when invoice exists (urgent styling within 7 days)
  if (phase === "none" && inv && (inv.status === "pending" || inv.status === "partial")) {
    const days = daysUntil(inv.due_date);
    const isUrgent = days <= 7;
    const isPastDue = days === 0;
    return (
      <div className={`flex items-center gap-3 px-4 py-2.5 border-b text-sm ${
        isUrgent ? "bg-red-900/30 border-red-700/40" : "bg-amber-900/30 border-amber-700/40"
      }`}>
        {isUrgent ? (
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
        ) : (
          <Receipt className="w-4 h-4 text-amber-400 flex-shrink-0" />
        )}
        <span className={`flex-1 font-body ${isUrgent ? "text-red-200" : "text-amber-200"}`}>
          Invoice for <strong>{inv.period_label}</strong> —{" "}
          {inv.status === "partial"
            ? <><strong>{formatUSD(inv.balance_usd)}</strong> balance remaining</>
            : <><strong>{formatUSD(inv.balance_usd)}</strong> due</>
          }
          {isPastDue ? " — payment due today." : ` in ${days} day${days !== 1 ? "s" : ""}.`}
        </span>
        <button onClick={() => setDismissed(true)} className="text-stone-500 hover:text-stone-300 flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // Active arrangement on a non-arrangement phase (e.g. pending invoice with arrangement)
  if (arr && arr.status === "active" && phase !== "arrangement" && next_installment_due && next_installment_amount != null) {
    const days = daysUntil(next_installment_due);
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 bg-violet-900/40 border-b border-violet-700/40 text-sm">
        <CreditCard className="w-4 h-4 text-violet-400 flex-shrink-0" />
        <span className="flex-1 font-body text-violet-200">
          Payment arrangement active —{" "}
          <strong>{formatUSD(next_installment_amount)}</strong> installment due
          {days === 0 ? " today" : ` in ${days} day${days !== 1 ? "s" : ""}`}.
        </span>
        <button onClick={() => setDismissed(true)} className="text-violet-500 hover:text-violet-300 flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return null;
}
