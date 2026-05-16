import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DollarSign, Plus, CheckCircle2, Clock, AlertTriangle,
  Trash2, Settings, Download, Calendar, CreditCard, ChevronDown, ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { billingApi } from "@/api/billing";
import { toast } from "@/hooks/useToast";
import type { Invoice, PlatformCostConfig } from "@/types";

function formatUSD(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(s: string) {
  return new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<{className?: string}> }> = {
  pending:        { label: "Pending",       color: "text-stone-400",  icon: Clock },
  overdue:        { label: "Overdue",       color: "text-amber-400",  icon: AlertTriangle },
  suspended:      { label: "Suspended",     color: "text-orange-400", icon: AlertTriangle },
  data_available: { label: "Data Ready",    color: "text-blue-400",   icon: Download },
  deleted:        { label: "Deleted",       color: "text-red-500",    icon: Trash2 },
  paid:           { label: "Paid",          color: "text-emerald-400",icon: CheckCircle2 },
  partial:        { label: "Arrangement",   color: "text-violet-400", icon: CreditCard },
};

// ── Platform cost config panel ────────────────────────────────────────────────

function CostConfigPanel({ config }: { config: PlatformCostConfig | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(!config);
  const [amount, setAmount] = useState(config?.monthly_amount_usd?.toString() ?? "");
  const [desc, setDesc] = useState(config?.description ?? "Monthly platform operating costs");

  const { mutate, isPending } = useMutation({
    mutationFn: () => billingApi.setConfig({
      monthly_amount_usd: parseFloat(amount),
      description: desc,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing"] });
      toast({ title: "Platform cost updated", variant: "success" });
      setOpen(false);
    },
    onError: () => toast({ title: "Failed to update config", variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-stone-500" />
            <CardTitle className="text-base">Platform Cost Configuration</CardTitle>
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setOpen(!open)}>
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
        {config && !open && (
          <p className="text-sm text-stone-400 font-mono">
            {formatUSD(config.monthly_amount_usd)}/month — {config.description}
          </p>
        )}
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-[10px] font-mono uppercase tracking-wider text-stone-500">
                Monthly Amount (USD)
              </label>
              <div className="relative">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-500" />
                <Input
                  type="number" min="0" step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-9 pl-8 text-sm"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] font-mono uppercase tracking-wider text-stone-500">Description</label>
              <Input
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => mutate()}
              disabled={isPending || !amount || parseFloat(amount) <= 0}
              className="h-8 text-xs bg-violet-600 hover:bg-violet-500 text-white border-0"
            >
              {isPending ? "Saving…" : config ? "Update Config" : "Save Config"}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ── Create invoice panel ──────────────────────────────────────────────────────

function CreateInvoicePanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const { mutate, isPending } = useMutation({
    mutationFn: () => billingApi.createInvoice({
      month: parseInt(month),
      year: parseInt(year),
      amount_usd: amount ? parseFloat(amount) : undefined,
      notes: notes || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing"] });
      toast({ title: "Invoice created", variant: "success" });
      onClose();
    },
    onError: (e: any) => toast({
      title: e?.response?.data?.detail ?? "Failed to create invoice",
      variant: "destructive",
    }),
  });

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  return (
    <div className="border border-stone-700/60 rounded-xl bg-stone-900/60 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-display font-semibold text-stone-200">Create Invoice</h3>
        <button onClick={onClose} className="text-stone-500 hover:text-stone-300 text-lg leading-none">×</button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="space-y-1">
          <label className="block text-[10px] font-mono uppercase tracking-wider text-stone-500">Month</label>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="block text-[10px] font-mono uppercase tracking-wider text-stone-500">Year</label>
          <Input value={year} onChange={(e) => setYear(e.target.value)} className="h-9 text-sm" />
        </div>
        <div className="space-y-1 col-span-2">
          <label className="block text-[10px] font-mono uppercase tracking-wider text-stone-500">
            Amount USD <span className="normal-case text-stone-600">(leave blank to use config)</span>
          </label>
          <div className="relative">
            <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-500" />
            <Input
              type="number" min="0" step="0.01" value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-9 pl-8 text-sm" placeholder="from config"
            />
          </div>
        </div>
      </div>
      <div className="space-y-1">
        <label className="block text-[10px] font-mono uppercase tracking-wider text-stone-500">Notes</label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-9 text-sm" placeholder="Optional" />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} className="h-8 text-xs">Cancel</Button>
        <Button
          size="sm" onClick={() => mutate()} disabled={isPending}
          className="h-8 text-xs bg-violet-600 hover:bg-violet-500 text-white border-0"
        >
          {isPending ? "Creating…" : "Create Invoice"}
        </Button>
      </div>
    </div>
  );
}

// ── Record payment / arrangement modal ───────────────────────────────────────

function InvoiceActions({ invoice, onDone }: { invoice: Invoice; onDone: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"pay" | "arrangement">("pay");
  const [amount, setAmount] = useState(invoice.balance_usd.toFixed(2));
  const [notes, setNotes] = useState("");
  const [installments, setInstallments] = useState<"2" | "3">("2");

  const { mutate: payMutate, isPending: paying } = useMutation({
    mutationFn: () => billingApi.recordPayment(invoice.id, {
      amount_usd: parseFloat(amount),
      notes: notes || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing"] });
      toast({ title: "Payment recorded", variant: "success" });
      onDone();
    },
    onError: () => toast({ title: "Failed to record payment", variant: "destructive" }),
  });

  const { mutate: arrMutate, isPending: arranging } = useMutation({
    mutationFn: () => billingApi.createArrangement(invoice.id, {
      installments: parseInt(installments) as 2 | 3,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing"] });
      toast({ title: "Payment arrangement created", variant: "success" });
      onDone();
    },
    onError: () => toast({ title: "Failed to create arrangement", variant: "destructive" }),
  });

  return (
    <div className="border border-stone-700/60 rounded-xl bg-stone-900/60 p-5 space-y-4 mt-3">
      <div className="flex gap-1 border border-stone-700 rounded-lg p-0.5 text-xs font-mono">
        {(["pay", "arrangement"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded-md transition-colors capitalize ${
              tab === t ? "bg-violet-600 text-white" : "text-stone-400 hover:text-stone-200"
            }`}
          >
            {t === "pay" ? "Record Payment" : "Payment Arrangement"}
          </button>
        ))}
      </div>

      {tab === "pay" ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="block text-[10px] font-mono uppercase tracking-wider text-stone-500">
              Amount (USD) — Balance: {formatUSD(invoice.balance_usd)}
            </label>
            <div className="relative">
              <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-500" />
              <Input
                type="number" min="0.01" step="0.01"
                value={amount} onChange={(e) => setAmount(e.target.value)}
                className="h-9 pl-8 text-sm"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] font-mono uppercase tracking-wider text-stone-500">Notes</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-9 text-sm" placeholder="Payment reference, method…" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onDone} className="h-8 text-xs">Cancel</Button>
            <Button
              size="sm" onClick={() => payMutate()} disabled={paying || !amount}
              className="h-8 text-xs bg-emerald-600 hover:bg-emerald-500 text-white border-0"
            >
              {paying ? "Recording…" : "Record Payment"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-body text-stone-400">
            Split the total (balance + next month) into installments due within the following month.
            Total: <strong className="text-stone-200">{formatUSD(invoice.balance_usd)}</strong> + next month recurring.
          </p>
          <div className="space-y-1">
            <label className="block text-[10px] font-mono uppercase tracking-wider text-stone-500">Installments</label>
            <Select value={installments} onValueChange={(v) => setInstallments(v as "2" | "3")}>
              <SelectTrigger className="h-9 text-sm w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="2">2 payments</SelectItem>
                <SelectItem value="3">3 payments</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onDone} className="h-8 text-xs">Cancel</Button>
            <Button
              size="sm" onClick={() => arrMutate()} disabled={arranging}
              className="h-8 text-xs bg-violet-600 hover:bg-violet-500 text-white border-0"
            >
              {arranging ? "Creating…" : "Create Arrangement"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Invoice row ───────────────────────────────────────────────────────────────

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[invoice.status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;

  return (
    <div className="border border-stone-800/60 rounded-xl bg-stone-900/40 overflow-hidden">
      <button
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-stone-800/20 transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          invoice.status === "paid" ? "bg-emerald-500/10" : "bg-stone-800"
        }`}>
          <Icon className={`w-4 h-4 ${cfg.color}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-display font-semibold text-stone-200">{invoice.period_label}</span>
            <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${cfg.color} bg-stone-800`}>
              {cfg.label}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-0.5 text-xs font-mono text-stone-500">
            <span>Due {formatDate(invoice.due_date)}</span>
            {invoice.days_overdue > 0 && (
              <span className="text-amber-500">{invoice.days_overdue}d overdue</span>
            )}
          </div>
        </div>

        <div className="text-right flex-shrink-0">
          <p className="text-sm font-mono font-semibold text-stone-200">{formatUSD(invoice.amount_usd)}</p>
          {invoice.balance_usd > 0 && invoice.status !== "paid" && (
            <p className="text-xs font-mono text-red-400">{formatUSD(invoice.balance_usd)} due</p>
          )}
          {invoice.status === "paid" && (
            <p className="text-xs font-mono text-emerald-400">Paid {invoice.paid_at ? formatDate(invoice.paid_at) : ""}</p>
          )}
        </div>

        {invoice.status !== "paid" && invoice.status !== "deleted" && (
          <ChevronDown className={`w-4 h-4 text-stone-600 flex-shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
        )}
      </button>

      {expanded && invoice.status !== "paid" && invoice.status !== "deleted" && (
        <div className="px-5 pb-5">
          <InvoiceActions invoice={invoice} onDone={() => setExpanded(false)} />
        </div>
      )}
    </div>
  );
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function SummaryCards({ invoices }: { invoices: Invoice[] }) {
  const paid = invoices.filter((i) => i.status === "paid");
  const unpaid = invoices.filter((i) => i.status !== "paid" && i.status !== "deleted");
  const totalOutstanding = unpaid.reduce((s, i) => s + i.balance_usd, 0);
  const totalPaidYTD = paid
    .filter((i) => i.period_year === new Date().getFullYear())
    .reduce((s, i) => s + i.amount_usd, 0);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { label: "Outstanding", value: formatUSD(totalOutstanding), color: totalOutstanding > 0 ? "text-red-400" : "text-stone-400" },
        { label: "Paid YTD", value: formatUSD(totalPaidYTD), color: "text-emerald-400" },
        { label: "Unpaid Invoices", value: String(unpaid.length), color: unpaid.length > 0 ? "text-amber-400" : "text-stone-400" },
        { label: "Total Invoices", value: String(invoices.length), color: "text-stone-300" },
      ].map(({ label, value, color }) => (
        <Card key={label} className="p-4">
          <p className="text-[10px] font-mono uppercase tracking-wider text-stone-500">{label}</p>
          <p className={`text-xl font-display font-bold mt-1 ${color}`}>{value}</p>
        </Card>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function BillingDashboard() {
  const [showCreate, setShowCreate] = useState(false);

  const { data: configData, isLoading: configLoading } = useQuery({
    queryKey: ["billing", "config"],
    queryFn: billingApi.getConfig,
  });

  const { data: invoicesData, isLoading: invLoading } = useQuery({
    queryKey: ["billing", "invoices"],
    queryFn: () => billingApi.listInvoices({ limit: 50 }),
  });

  const invoices: Invoice[] = invoicesData?.items ?? [];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-stone-100">Billing</h1>
          <p className="mt-1 text-sm font-body text-stone-500">Platform cost management and invoice tracking</p>
        </div>
        <Button
          onClick={() => setShowCreate(!showCreate)}
          className="flex-shrink-0 h-9 text-xs bg-violet-600 hover:bg-violet-500 text-white border-0 gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          New Invoice
        </Button>
      </div>

      {/* Config */}
      {configLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <CostConfigPanel config={configData ?? null} />
      )}

      {showCreate && <CreateInvoicePanel onClose={() => setShowCreate(false)} />}

      {/* Summary */}
      {invoices.length > 0 && <SummaryCards invoices={invoices} />}

      {/* Invoice list */}
      <div className="space-y-3">
        <h2 className="text-sm font-mono font-semibold text-stone-400 uppercase tracking-wider">Invoices</h2>
        {invLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
        ) : invoices.length === 0 ? (
          <Card className="py-12 text-center">
            <Calendar className="w-8 h-8 text-stone-700 mx-auto mb-3" />
            <p className="text-sm font-body text-stone-500">No invoices yet</p>
          </Card>
        ) : (
          invoices.map((inv) => <InvoiceRow key={inv.id} invoice={inv} />)
        )}
      </div>
    </div>
  );
}
