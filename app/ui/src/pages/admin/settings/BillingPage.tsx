import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, Clock, AlertTriangle, CreditCard,
  Calendar, TrendingUp, DollarSign, Receipt,
  ChevronDown, ChevronUp, Tag, Plus, Paperclip,
  FileText, ExternalLink,
} from "lucide-react";
import { billingApi } from "@/api/billing";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import type { Invoice, InvoiceLineItem, PaymentArrangement, PaymentProof } from "@/types";

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
    { label: "Paid invoices",     value: String(paid),         icon: CheckCircle2, color: "text-emerald-400" },
    { label: "Outstanding",       value: String(unpaid),       icon: AlertTriangle, color: "text-amber-400"  },
    { label: "Arrangements",      value: String(arranged),     icon: CreditCard,   color: "text-violet-400" },
    { label: "Total paid",        value: formatUSD(totalPaid), icon: DollarSign,   color: "text-emerald-400" },
    { label: "Balance owed",      value: formatUSD(totalOwed), icon: TrendingUp,   color: totalOwed > 0 ? "text-red-400" : "text-stone-500" },
    { label: "Next billing date", value: nextDate,             icon: Calendar,     color: "text-stone-300"  },
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
      <div className="flex items-center gap-3 px-2 pb-1 border-b border-stone-800/60">
        <span className="text-[10px] font-mono text-stone-600 uppercase tracking-wider flex-1">Description</span>
        <span className="text-[10px] font-mono text-stone-600 uppercase tracking-wider w-24 text-right flex-shrink-0">Amount</span>
      </div>
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
          <span className={`text-xs font-mono w-24 text-right flex-shrink-0 ${item.amount_usd < 0 ? "text-emerald-400" : "text-stone-200"}`}>
            {formatUSD(item.amount_usd)}
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 px-2 pt-2 mt-1 border-t border-stone-700/60">
        <span className="text-xs font-mono font-semibold text-stone-400">Total</span>
        <span className="text-sm font-mono font-bold text-stone-100">{formatUSD(total)}</span>
      </div>
    </div>
  );
}

// ── Payment proof uploader ────────────────────────────────────────────────────

function PaymentProofUploader({
  invoiceId,
  installmentIndex = null,
}: {
  invoiceId: string;
  installmentIndex?: number | null;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: proofs = [] } = useQuery<PaymentProof[]>({
    queryKey: ["billing", "proofs", invoiceId],
    queryFn: () => billingApi.listProofs(invoiceId),
    staleTime: 60_000,
  });

  const filtered = proofs.filter((p) => p.installment_index === installmentIndex);

  const { mutate: submit, isPending: submitting } = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      if (notes.trim()) fd.append("notes", notes.trim());
      if (installmentIndex !== null) fd.append("installment_index", String(installmentIndex));
      if (file) fd.append("file", file);
      return billingApi.submitProof(invoiceId, fd);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing", "proofs", invoiceId] });
      toast({ title: "Proof submitted", variant: "success" });
      setNotes(""); setFile(null); setOpen(false);
    },
    onError: () => toast({ title: "Failed to submit proof", variant: "destructive" }),
  });

  const title = installmentIndex !== null
    ? `Installment ${installmentIndex + 1} Proof`
    : "Payment Proof";

  return (
    <div className="space-y-2">
      {filtered.map((p) => (
        <div key={p.id} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-stone-800/40 border border-stone-700/40">
          <FileText className="w-3.5 h-3.5 text-stone-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            {p.notes && <p className="text-xs text-stone-300 leading-snug">{p.notes}</p>}
            <p className="text-[10px] font-mono text-stone-600 mt-0.5">
              {p.submitted_by_name ?? p.submitted_by} · {new Date(p.submitted_at).toLocaleDateString()}
            </p>
          </div>
          {p.file_url && p.filename && (
            <a
              href={p.file_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] font-mono text-violet-400 hover:text-violet-300 flex-shrink-0"
              title={p.filename}
            >
              <Paperclip className="w-3 h-3" />
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      ))}

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-[10px] font-mono text-stone-500 hover:text-violet-400 transition-colors"
        >
          <Plus className="w-3 h-3" />
          {filtered.length > 0 ? `Add another ${title}` : `Upload ${title}`}
        </button>
      ) : (
        <div className="border border-stone-700/60 rounded-lg bg-stone-800/30 p-3 space-y-2.5">
          <p className="text-[10px] font-mono uppercase tracking-wider text-stone-500">{title}</p>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Transaction reference, payment method, bank, notes…"
            className="h-20 text-xs resize-none"
          />
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 text-[10px] font-mono text-stone-500 hover:text-stone-300 transition-colors"
            >
              <Paperclip className="w-3 h-3" />
              {file ? file.name : "Attach receipt or bank confirmation (image / PDF, max 10 MB)"}
            </button>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => { setOpen(false); setNotes(""); setFile(null); }}
              className="px-3 py-1 text-xs font-mono text-stone-500 hover:text-stone-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => submit()}
              disabled={submitting || (!notes.trim() && !file)}
              className="px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-mono text-white font-semibold transition-colors"
            >
              {submitting ? "Submitting…" : "Submit Proof"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Request arrangement form ──────────────────────────────────────────────────

function RequestArrangementForm({
  invoice,
  onDone,
}: {
  invoice: Invoice;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const today = new Date();

  function defaultDates(n: number) {
    return Array.from({ length: n }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() + Math.round(((i + 1) / n) * 30));
      return d.toISOString().slice(0, 10);
    });
  }

  const [installments, setInstallments] = useState<2 | 3>(2);
  const [dates, setDates] = useState<string[]>(defaultDates(2));

  function handleInstallmentsChange(n: 2 | 3) {
    setInstallments(n);
    setDates(defaultDates(n));
  }

  const { mutate, isPending } = useMutation({
    mutationFn: () => billingApi.requestArrangement(invoice.id, installments, dates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing", "invoices", "settings"] });
      qc.invalidateQueries({ queryKey: ["billing", "arrangement", invoice.id] });
      toast({
        title: "Arrangement request submitted",
        description: "The platform admin will review and approve your proposed schedule.",
        variant: "success",
      });
      onDone();
    },
    onError: (e: any) => toast({
      title: e?.response?.data?.detail ?? "Failed to submit request",
      variant: "destructive",
    }),
  });

  const perInstallment = invoice.balance_usd / installments;

  return (
    <div className="border border-violet-500/20 rounded-lg bg-violet-500/5 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <CreditCard className="w-3.5 h-3.5 text-violet-400" />
        <p className="text-xs font-mono font-semibold text-stone-200">Request Payment Arrangement</p>
      </div>
      <p className="text-[11px] font-body text-stone-500">
        Split the outstanding balance of{" "}
        <strong className="text-stone-300">{formatUSD(invoice.balance_usd)}</strong>{" "}
        into instalments. The platform admin will review your proposed schedule.
      </p>

      {/* Instalment count */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-stone-500 flex-shrink-0">Instalments</span>
        <div className="flex gap-1">
          {([2, 3] as const).map((n) => (
            <button
              key={n}
              onClick={() => handleInstallmentsChange(n)}
              className={`px-3 py-1 rounded-md text-xs font-mono border transition-colors ${
                installments === n
                  ? "bg-violet-500/20 border-violet-500/40 text-violet-300"
                  : "bg-stone-900 border-stone-700 text-stone-500 hover:text-stone-300"
              }`}
            >
              {n} payments
            </button>
          ))}
        </div>
        <span className="text-xs font-mono text-stone-600 ml-auto">
          ≈ {formatUSD(perInstallment)} each
        </span>
      </div>

      {/* Proposed due dates */}
      <div className="space-y-2">
        <p className="text-[10px] font-mono uppercase tracking-wider text-stone-600">Proposed Due Dates</p>
        {dates.map((d, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="text-[11px] font-mono text-stone-500 w-28 flex-shrink-0">
              Instalment {i + 1}
              <span className="text-stone-700 ml-1.5">{formatUSD(perInstallment)}</span>
            </span>
            <input
              type="date"
              value={d}
              min={today.toISOString().slice(0, 10)}
              onChange={(e) =>
                setDates((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
              }
              className="h-8 px-2 rounded-md bg-stone-900 border border-stone-700 text-xs font-mono text-stone-300 flex-1"
            />
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onDone}
          className="px-3 py-1 text-xs font-mono text-stone-500 hover:text-stone-300 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => mutate()}
          disabled={isPending || dates.some((d) => !d)}
          className="px-4 py-1.5 rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-mono text-white font-semibold transition-colors"
        >
          {isPending ? "Submitting…" : "Submit Request"}
        </button>
      </div>
    </div>
  );
}

// ── Arrangement detail (with per-instalment proof upload) ─────────────────────

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

  const statusColor =
    arr.status === "active"    ? "text-violet-400" :
    arr.status === "completed" ? "text-emerald-400" :
                                 "text-red-400";

  return (
    <div className="space-y-3">
      {/* Summary line */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-mono text-stone-500">
          {arr.installments} instalments ·{" "}
          <span className={statusColor}>{arr.status}</span>
        </span>
        {nextDue && nextAmt != null && (
          <span className="text-xs font-mono text-stone-400">
            Next: <strong className="text-violet-300">{formatUSD(nextAmt)}</strong> due {formatDate(nextDue)}
          </span>
        )}
      </div>

      {/* Per-instalment rows */}
      <div className="space-y-2">
        {arr.amounts_usd.map((amt, i) => {
          const paid = arr.paid_flags[i];
          const isOverdue = !paid && new Date(arr.due_dates[i]) < new Date();
          return (
            <div key={i} className={`rounded-lg border p-3 space-y-2 ${
              paid ? "border-emerald-500/20 bg-emerald-500/5" :
              isOverdue ? "border-red-500/20 bg-red-500/5" :
              "border-stone-800 bg-stone-900/40"
            }`}>
              <div className="flex items-center gap-3">
                {paid
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  : isOverdue
                  ? <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                  : <Clock className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-stone-300">
                    Instalment {i + 1} of {arr.installments} — {formatUSD(amt)}
                  </p>
                  <p className="text-[10px] font-mono text-stone-600">
                    {paid && arr.paid_at_list[i]
                      ? `Paid ${new Date(arr.paid_at_list[i]!).toLocaleDateString()}`
                      : `Due ${new Date(arr.due_dates[i]).toLocaleDateString()}${isOverdue ? " — overdue" : ""}`}
                  </p>
                </div>
              </div>
              {!paid && <PaymentProofUploader invoiceId={invoiceId} installmentIndex={i} />}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-stone-800/40">
        <span className="text-[10px] font-mono text-stone-600">Total arrangement</span>
        <span className="text-xs font-mono font-semibold text-stone-300">{formatUSD(arr.total_usd)}</span>
      </div>
    </div>
  );
}

// ── Invoice row ───────────────────────────────────────────────────────────────

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const [expanded, setExpanded] = useState(false);
  const [requestingArrangement, setRequestingArrangement] = useState(false);

  const hasArrangement = invoice.status === "partial";
  const canRequestArrangement =
    ["pending", "overdue", "suspended"].includes(invoice.status) && !hasArrangement;
  const canUploadProof = !["deleted"].includes(invoice.status);
  const expandable = invoice.line_items.length > 0 || hasArrangement || canRequestArrangement || canUploadProof;

  return (
    <div className="rounded-xl border border-stone-800 bg-stone-900/40 overflow-hidden">
      {/* Header */}
      <button
        className={`w-full flex items-start justify-between gap-4 flex-wrap p-4 text-left transition-colors ${
          expandable ? "hover:bg-stone-900/70 cursor-pointer" : "cursor-default"
        }`}
        onClick={() => expandable && setExpanded((v) => !v)}
        disabled={!expandable}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
            invoice.status === "paid"    ? "bg-emerald-500/10" :
            invoice.status === "overdue" || invoice.status === "suspended" ? "bg-red-500/10" :
            invoice.status === "partial" ? "bg-blue-500/10" :
            "bg-stone-800"
          }`}>
            <Receipt className={`w-4 h-4 ${
              invoice.status === "paid"    ? "text-emerald-400" :
              invoice.status === "overdue" || invoice.status === "suspended" ? "text-red-400" :
              invoice.status === "partial" ? "text-blue-400" :
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
        <div className="border-t border-stone-800/60 px-4 pb-4 pt-3 space-y-5">
          {/* Line items */}
          {invoice.line_items.length > 0 && (
            <div>
              <p className="text-[10px] font-mono text-stone-600 uppercase tracking-wider mb-2">Line Items</p>
              <LineItemsTable items={invoice.line_items} total={invoice.amount_usd} />
            </div>
          )}

          {/* Request arrangement (only when no arrangement exists and invoice is actionable) */}
          {canRequestArrangement && (
            requestingArrangement ? (
              <RequestArrangementForm
                invoice={invoice}
                onDone={() => setRequestingArrangement(false)}
              />
            ) : (
              <button
                onClick={() => setRequestingArrangement(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-violet-500/30 text-xs font-mono text-stone-500 hover:text-violet-400 hover:border-violet-500/50 transition-colors w-full"
              >
                <CreditCard className="w-3.5 h-3.5 flex-shrink-0" />
                Request payment arrangement — split into 2 or 3 instalments
              </button>
            )
          )}

          {/* Existing arrangement with per-instalment proof upload */}
          {hasArrangement && (
            <div>
              <p className="text-[10px] font-mono text-stone-600 uppercase tracking-wider mb-2">Payment Arrangement</p>
              <ArrangementDetail invoiceId={invoice.id} />
            </div>
          )}

          {/* Whole-invoice payment proof */}
          {canUploadProof && (
            <div>
              <p className="text-[10px] font-mono text-stone-600 uppercase tracking-wider mb-2">Payment Proof</p>
              <PaymentProofUploader invoiceId={invoice.id} installmentIndex={null} />
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
        <p className="text-xs font-body text-stone-600">Invoice history, payment proof, and arrangement requests.</p>
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
