import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2, Clock, AlertTriangle, CreditCard,
  Calendar, TrendingUp, DollarSign, Receipt,
} from "lucide-react";
import { billingApi } from "@/api/billing";
import { Skeleton } from "@/components/ui/skeleton";
import type { Invoice, PaymentArrangement } from "@/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatUSD(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function nextBillingDate(invoices: Invoice[]): string {
  if (!invoices.length) return "—";
  const sorted = [...invoices].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const last = new Date(sorted[0].created_at);
  const next = new Date(last);
  // last day of following month
  next.setMonth(next.getMonth() + 2, 0);
  return next.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<Invoice["status"], string> = {
  paid:           "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  pending:        "bg-amber-500/10  text-amber-400  border-amber-500/20",
  partial:        "bg-blue-500/10   text-blue-400   border-blue-500/20",
  overdue:        "bg-red-500/10    text-red-400    border-red-500/20",
  suspended:      "bg-red-900/20    text-red-500    border-red-900/30",
  data_available: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  deleted:        "bg-stone-800     text-stone-600  border-stone-700",
};

function StatusBadge({ status }: { status: Invoice["status"] }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border ${STATUS_STYLES[status]}`}>
      {status.replace("_", " ")}
    </span>
  );
}

// ── Summary metrics ───────────────────────────────────────────────────────────

function MetricsBar({ invoices, nextDate }: { invoices: Invoice[]; nextDate: string }) {
  const paid     = invoices.filter((i) => i.status === "paid").length;
  const unpaid   = invoices.filter((i) => ["pending", "overdue", "partial"].includes(i.status)).length;
  const arranged = invoices.filter((i) => i.status === "partial").length;
  const totalPaid = invoices.reduce((s, i) => s + i.paid_amount_usd, 0);
  const totalOwed = invoices.reduce((s, i) => s + i.balance_usd, 0);

  const metrics = [
    { label: "Paid invoices",      value: String(paid),       icon: CheckCircle2, color: "text-emerald-400" },
    { label: "Outstanding",        value: String(unpaid),     icon: AlertTriangle, color: "text-amber-400"  },
    { label: "Arrangements",       value: String(arranged),   icon: CreditCard,   color: "text-violet-400" },
    { label: "Total paid",         value: formatUSD(totalPaid), icon: DollarSign,  color: "text-emerald-400" },
    { label: "Balance owed",       value: formatUSD(totalOwed), icon: TrendingUp,  color: totalOwed > 0 ? "text-red-400" : "text-stone-500" },
    { label: "Next billing date",  value: nextDate,           icon: Calendar,     color: "text-stone-300"  },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {metrics.map(({ label, value, icon: Icon, color }) => (
        <div key={label} className="rounded-lg border border-stone-800 bg-stone-900/50 p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Icon className={`w-3.5 h-3.5 ${color}`} />
            <span className="text-xs font-mono text-stone-500">{label}</span>
          </div>
          <p className={`text-sm font-mono font-semibold ${color}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Arrangement detail ────────────────────────────────────────────────────────

function ArrangementDetail({ invoiceId }: { invoiceId: string }) {
  const { data: arr } = useQuery<PaymentArrangement | null>({
    queryKey: ["billing", "arrangement", invoiceId],
    queryFn: () => billingApi.getArrangement(invoiceId),
    staleTime: 60_000,
  });

  if (!arr) return null;

  const nextIdx = arr.paid_flags.findIndex((p) => !p);
  const nextDue = nextIdx >= 0 ? arr.due_dates[nextIdx] : null;
  const nextAmt = nextIdx >= 0 ? arr.amounts_usd[nextIdx] : null;

  return (
    <div className="mt-2 pt-2 border-t border-stone-800/60">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-mono text-stone-500">
          Arrangement · {arr.installments} instalments ·{" "}
          <span className={arr.status === "active" ? "text-violet-400" : arr.status === "completed" ? "text-emerald-400" : "text-red-400"}>
            {arr.status}
          </span>
        </span>
        {nextDue && nextAmt != null && (
          <span className="text-xs font-mono text-stone-400">
            Next: <strong className="text-violet-300">{formatUSD(nextAmt)}</strong> due {formatDate(nextDue)}
          </span>
        )}
      </div>
      <div className="flex gap-1 mt-1.5">
        {arr.paid_flags.map((paid, i) => (
          <div
            key={i}
            title={`Instalment ${i + 1}: ${paid ? "paid" : "unpaid"} — ${formatUSD(arr.amounts_usd[i])}`}
            className={`h-1.5 flex-1 rounded-full ${paid ? "bg-emerald-500" : "bg-stone-700"}`}
          />
        ))}
      </div>
    </div>
  );
}

// ── Invoice row ───────────────────────────────────────────────────────────────

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const hasArrangement = invoice.status === "partial";

  return (
    <div className="rounded-lg border border-stone-800 bg-stone-900/40 p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        {/* Left: period + status */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-stone-800 flex items-center justify-center flex-shrink-0">
            <Receipt className="w-3.5 h-3.5 text-stone-500" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-mono font-semibold text-stone-200">{invoice.period_label}</p>
            <p className="text-xs font-mono text-stone-600 mt-0.5">
              Due {formatDate(invoice.due_date)}
              {invoice.days_overdue > 0 && (
                <span className="text-red-500 ml-1">· {invoice.days_overdue}d overdue</span>
              )}
            </p>
          </div>
        </div>

        {/* Right: amounts + status */}
        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="text-right">
            <p className="text-sm font-mono font-semibold text-stone-200">{formatUSD(invoice.amount_usd)}</p>
            {invoice.paid_amount_usd > 0 && invoice.status !== "paid" && (
              <p className="text-xs font-mono text-stone-500">
                {formatUSD(invoice.paid_amount_usd)} paid · {formatUSD(invoice.balance_usd)} left
              </p>
            )}
            {invoice.status === "paid" && invoice.paid_at && (
              <p className="text-xs font-mono text-stone-500">Paid {formatDate(invoice.paid_at)}</p>
            )}
          </div>
          <StatusBadge status={invoice.status} />
        </div>
      </div>

      {/* Line items (collapsed summary) */}
      {invoice.line_items.length > 0 && (
        <div className="mt-3 pt-3 border-t border-stone-800/60 flex flex-wrap gap-2">
          {invoice.line_items.map((item) => (
            <span key={item.id} className="text-xs font-mono text-stone-500 bg-stone-800/60 px-2 py-0.5 rounded">
              {item.description} — {formatUSD(item.amount_usd)}
            </span>
          ))}
        </div>
      )}

      {hasArrangement && <ArrangementDetail invoiceId={invoice.id} />}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function BillingPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["billing", "invoices", "settings"],
    queryFn: () => billingApi.listInvoices({ limit: 100 }),
    staleTime: 60_000,
  });

  const invoices: Invoice[] = data?.items ?? [];
  const sorted = [...invoices].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const nextDate = nextBillingDate(invoices);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-mono font-semibold text-stone-400 uppercase tracking-wider mb-1">Billing</h2>
        <p className="text-xs font-body text-stone-600">Invoice history and payment status for this installation.</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <>
          <MetricsBar invoices={invoices} nextDate={nextDate} />

          {sorted.length === 0 ? (
            <div className="rounded-lg border border-stone-800 bg-stone-900/40 py-12 text-center">
              <Clock className="w-8 h-8 text-stone-700 mx-auto mb-3" />
              <p className="text-sm font-body text-stone-500">No invoices yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sorted.map((inv) => <InvoiceRow key={inv.id} invoice={inv} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
