import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2, Clock, AlertTriangle, CreditCard,
  Calendar, TrendingUp, DollarSign, Receipt,
  ChevronDown, ChevronUp, Tag,
} from "lucide-react";
import { billingApi } from "@/api/billing";
import { Skeleton } from "@/components/ui/skeleton";
import type { Invoice, InvoiceLineItem, PaymentArrangement } from "@/types";

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
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-mono text-stone-500">
          {arr.installments} instalments ·{" "}
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

      {/* Instalment progress bars */}
      <div className="space-y-1">
        {arr.amounts_usd.map((amt, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-stone-600 w-20 flex-shrink-0">
              Instalment {i + 1}
            </span>
            <div className="flex-1 h-1.5 bg-stone-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${arr.paid_flags[i] ? "bg-emerald-500" : "bg-stone-700"}`}
                style={{ width: arr.paid_flags[i] ? "100%" : "0%" }}
              />
            </div>
            <span className={`text-[10px] font-mono w-20 text-right flex-shrink-0 ${arr.paid_flags[i] ? "text-emerald-400" : "text-stone-500"}`}>
              {formatUSD(amt)}
              {arr.paid_flags[i] && arr.paid_at_list[i] && (
                <span className="text-stone-600 ml-1">✓</span>
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-stone-800/40">
        <span className="text-[10px] font-mono text-stone-600">Total arrangement</span>
        <span className="text-xs font-mono font-semibold text-stone-300">{formatUSD(arr.total_usd)}</span>
      </div>
    </div>
  );
}

// ── Line items table ──────────────────────────────────────────────────────────

function LineItemsTable({ items, total }: { items: InvoiceLineItem[]; total: number }) {
  if (!items.length) return null;

  const typeLabel: Record<string, string> = {
    monthly: "Monthly",
    one_time: "One-time",
    overage: "Overage",
    discount: "Discount",
    adjustment: "Adjustment",
  };

  return (
    <div className="space-y-1">
      {/* Column headers */}
      <div className="flex items-center gap-3 px-2 pb-1 border-b border-stone-800/60">
        <span className="text-[10px] font-mono text-stone-600 uppercase tracking-wider flex-1">Description</span>
        <span className="text-[10px] font-mono text-stone-600 uppercase tracking-wider w-20 text-right flex-shrink-0">Amount</span>
      </div>

      {/* Rows */}
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-stone-800/30 transition-colors">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Tag className="w-3 h-3 text-stone-700 flex-shrink-0" />
            <span className="text-xs font-mono text-stone-300 truncate">{item.description}</span>
            {item.type && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-stone-800 text-stone-600 border border-stone-700/60 flex-shrink-0">
                {typeLabel[item.type] ?? item.type}
              </span>
            )}
          </div>
          <span className={`text-xs font-mono w-20 text-right flex-shrink-0 ${item.amount_usd < 0 ? "text-emerald-400" : "text-stone-200"}`}>
            {formatUSD(item.amount_usd)}
          </span>
        </div>
      ))}

      {/* Total row */}
      <div className="flex items-center justify-between gap-3 px-2 pt-2 mt-1 border-t border-stone-700/60">
        <span className="text-xs font-mono font-semibold text-stone-400">Total</span>
        <span className="text-sm font-mono font-bold text-stone-100">{formatUSD(total)}</span>
      </div>
    </div>
  );
}

// ── Invoice row ───────────────────────────────────────────────────────────────

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const [expanded, setExpanded] = useState(false);
  const hasArrangement = invoice.status === "partial";
  const expandable = invoice.line_items.length > 0 || hasArrangement;

  return (
    <div className="rounded-xl border border-stone-800 bg-stone-900/40 overflow-hidden">
      {/* Header */}
      <button
        className={`w-full flex items-start justify-between gap-4 flex-wrap p-4 text-left transition-colors ${expandable ? "hover:bg-stone-900/70 cursor-pointer" : "cursor-default"}`}
        onClick={() => expandable && setExpanded((v) => !v)}
        disabled={!expandable}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
            invoice.status === "paid" ? "bg-emerald-500/10" :
            invoice.status === "overdue" || invoice.status === "suspended" ? "bg-red-500/10" :
            "bg-stone-800"
          }`}>
            <Receipt className={`w-4 h-4 ${
              invoice.status === "paid" ? "text-emerald-400" :
              invoice.status === "overdue" || invoice.status === "suspended" ? "text-red-400" :
              "text-stone-500"
            }`} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-mono font-semibold text-stone-200">{invoice.period_label}</p>
            <p className="text-xs font-mono text-stone-600 mt-0.5">
              Due {formatDate(invoice.due_date)}
              {invoice.days_overdue > 0 && (
                <span className="text-red-500 ml-1">· {invoice.days_overdue}d overdue</span>
              )}
              {invoice.status === "paid" && invoice.paid_at && (
                <span className="text-emerald-600 ml-1">· Paid {formatDate(invoice.paid_at)}</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right">
            <p className="text-sm font-mono font-bold text-stone-100">{formatUSD(invoice.amount_usd)}</p>
            {invoice.paid_amount_usd > 0 && invoice.status !== "paid" && (
              <p className="text-xs font-mono text-stone-500">
                {formatUSD(invoice.paid_amount_usd)} paid
                <span className="text-stone-600 mx-1">·</span>
                <span className="text-red-400">{formatUSD(invoice.balance_usd)} left</span>
              </p>
            )}
          </div>
          <StatusBadge status={invoice.status} />
          {expandable && (
            expanded
              ? <ChevronUp   className="w-4 h-4 text-stone-600 flex-shrink-0" />
              : <ChevronDown className="w-4 h-4 text-stone-600 flex-shrink-0" />
          )}
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-stone-800/60 px-4 pb-4 pt-3 space-y-4">
          {invoice.line_items.length > 0 && (
            <div>
              <p className="text-[10px] font-mono text-stone-600 uppercase tracking-wider mb-2">Line Items</p>
              <LineItemsTable items={invoice.line_items} total={invoice.amount_usd} />
            </div>
          )}

          {hasArrangement && (
            <div>
              <p className="text-[10px] font-mono text-stone-600 uppercase tracking-wider mb-2">Payment Arrangement</p>
              <ArrangementDetail invoiceId={invoice.id} />
            </div>
          )}
        </div>
      )}
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
