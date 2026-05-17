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
import type { AddInvoiceLineItemRequest, AddLineItemRequest, UpdateLineItemRequest } from "@/api/billing";
import { billingApi } from "@/api/billing";
import { toast } from "@/hooks/useToast";
import type { CostLineItem, CostLineType, Invoice, InvoiceLineItem, PaymentArrangement, PlatformCostConfig } from "@/types";

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

const TYPE_LABELS: Record<CostLineType, string> = {
  monthly: "Monthly",
  one_time: "One-time",
};

function LineItemRow({ item }: { item: CostLineItem }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState(item.description);
  const [amount, setAmount] = useState(item.amount_usd.toString());

  const { mutate: toggleActive, isPending: toggling } = useMutation({
    mutationFn: () => billingApi.updateLineItem(item.id, { is_active: !item.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["billing", "config"] }),
    onError: () => toast({ title: "Failed to update item", variant: "destructive" }),
  });

  const { mutate: saveEdit, isPending: saving } = useMutation({
    mutationFn: () => billingApi.updateLineItem(item.id, {
      description: desc,
      amount_usd: parseFloat(amount),
    } as UpdateLineItemRequest),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing", "config"] });
      toast({ title: "Item updated", variant: "success" });
      setEditing(false);
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const { mutate: remove, isPending: removing } = useMutation({
    mutationFn: () => billingApi.removeLineItem(item.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing", "config"] });
      toast({ title: "Item removed", variant: "success" });
    },
    onError: () => toast({ title: "Failed to remove item", variant: "destructive" }),
  });

  const isBilled = !!item.used_in_invoice_id;

  if (editing) {
    return (
      <div className="flex items-center gap-2 py-2 border-b border-stone-800/60">
        <Input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          className="h-8 text-xs flex-1"
          placeholder="Description"
        />
        <div className="relative w-28 flex-shrink-0">
          <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-stone-500" />
          <Input
            type="number" min="0.01" step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-8 pl-6 text-xs"
          />
        </div>
        <Button
          size="sm" variant="ghost"
          onClick={() => saveEdit()}
          disabled={saving || !desc || !amount || parseFloat(amount) <= 0}
          className="h-8 text-xs text-emerald-400 hover:text-emerald-300 px-2"
        >
          {saving ? "…" : "Save"}
        </Button>
        <Button
          size="sm" variant="ghost"
          onClick={() => { setDesc(item.description); setAmount(item.amount_usd.toString()); setEditing(false); }}
          className="h-8 text-xs text-stone-500 hover:text-stone-300 px-2"
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 py-2.5 border-b border-stone-800/40 last:border-0 ${!item.is_active ? "opacity-50" : ""}`}>
      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded flex-shrink-0 ${
        item.type === "monthly" ? "bg-violet-500/10 text-violet-400" : "bg-amber-500/10 text-amber-400"
      }`}>
        {TYPE_LABELS[item.type]}
      </span>
      <span className="flex-1 text-sm text-stone-300 truncate">{item.description}</span>
      {isBilled && (
        <span className="text-[10px] font-mono text-stone-600 flex-shrink-0">billed</span>
      )}
      <span className="text-sm font-mono font-semibold text-stone-200 flex-shrink-0">
        {formatUSD(item.amount_usd)}
      </span>
      <div className="flex items-center gap-1 flex-shrink-0">
        <Button
          size="sm" variant="ghost"
          onClick={() => setEditing(true)}
          disabled={isBilled}
          className="h-7 w-7 p-0 text-stone-500 hover:text-stone-300"
          title="Edit"
        >
          <Settings className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm" variant="ghost"
          onClick={() => toggleActive()}
          disabled={toggling}
          className={`h-7 w-7 p-0 ${item.is_active ? "text-emerald-500 hover:text-emerald-400" : "text-stone-600 hover:text-stone-400"}`}
          title={item.is_active ? "Deactivate" : "Activate"}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm" variant="ghost"
          onClick={() => remove()}
          disabled={removing || isBilled}
          className="h-7 w-7 p-0 text-stone-600 hover:text-red-400"
          title="Remove"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

function AddLineItemForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<CostLineType>("monthly");

  const { mutate, isPending } = useMutation({
    mutationFn: () => billingApi.addLineItem({ description: desc, amount_usd: parseFloat(amount), type } as AddLineItemRequest),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing", "config"] });
      toast({ title: "Line item added", variant: "success" });
      setDesc(""); setAmount(""); setType("monthly");
      onDone();
    },
    onError: () => toast({ title: "Failed to add item", variant: "destructive" }),
  });

  return (
    <div className="pt-3 border-t border-stone-800/60 space-y-3">
      <p className="text-[10px] font-mono uppercase tracking-wider text-stone-500">New Line Item</p>
      <div className="flex flex-wrap gap-2">
        <Input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          className="h-8 text-xs flex-1 min-w-40"
          placeholder="Description (e.g. Hosting, Balance b/f)"
        />
        <div className="relative w-28 flex-shrink-0">
          <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-stone-500" />
          <Input
            type="number" min="0.01" step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-8 pl-6 text-xs"
            placeholder="0.00"
          />
        </div>
        <Select value={type} onValueChange={(v) => setType(v as CostLineType)}>
          <SelectTrigger className="h-8 text-xs w-32 flex-shrink-0"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="one_time">One-time</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={() => mutate()}
          disabled={isPending || !desc || !amount || parseFloat(amount) <= 0}
          className="h-8 text-xs bg-violet-600 hover:bg-violet-500 text-white border-0 flex-shrink-0"
        >
          {isPending ? "Adding…" : "Add"}
        </Button>
        <Button
          size="sm" variant="ghost"
          onClick={onDone}
          className="h-8 text-xs text-stone-500 flex-shrink-0"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function CostConfigPanel({ config }: { config: PlatformCostConfig | null }) {
  const [open, setOpen] = useState(!config || config.line_items.length === 0);
  const [addingItem, setAddingItem] = useState(false);

  const items = config?.line_items ?? [];
  const monthlyTotal = config?.monthly_total_usd ?? 0;
  const oneTimeTotal = config?.one_time_total_usd ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-stone-500" />
            <CardTitle className="text-base">Platform Cost Configuration</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {config && !open && (
              <span className="text-xs font-mono text-stone-400">
                {formatUSD(monthlyTotal)}/mo
                {oneTimeTotal > 0 && ` + ${formatUSD(oneTimeTotal)} one-time`}
              </span>
            )}
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setOpen(!open)}>
              {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-0">
          {items.length === 0 ? (
            <p className="text-xs text-stone-600 font-body py-2">No cost items configured yet.</p>
          ) : (
            items.map((item) => <LineItemRow key={item.id} item={item} />)
          )}
          {items.length > 0 && (
            <div className="flex justify-between items-center pt-3 text-xs font-mono text-stone-500">
              <span>Recurring / month</span>
              <span className="text-stone-300 font-semibold">{formatUSD(monthlyTotal)}</span>
            </div>
          )}
          {oneTimeTotal > 0 && (
            <div className="flex justify-between items-center pt-1 text-xs font-mono text-stone-500">
              <span>One-time (pending)</span>
              <span className="text-amber-400 font-semibold">{formatUSD(oneTimeTotal)}</span>
            </div>
          )}
          {addingItem ? (
            <AddLineItemForm onDone={() => setAddingItem(false)} />
          ) : (
            <div className="pt-3 border-t border-stone-800/60 mt-3">
              <Button
                variant="ghost" size="sm"
                onClick={() => setAddingItem(true)}
                className="h-7 text-xs text-stone-400 hover:text-stone-200 gap-1 px-0"
              >
                <Plus className="w-3.5 h-3.5" /> Add line item
              </Button>
            </div>
          )}
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

// ── Invoice breakdown (editable line items + payment actions) ────────────────

function InvoiceBreakdown({ invoice, onCollapse }: { invoice: Invoice; onCollapse: () => void }) {
  const qc = useQueryClient();
  const [addingItem, setAddingItem] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newType, setNewType] = useState<"monthly" | "one_time">("monthly");

  const { mutate: addItem, isPending: adding } = useMutation({
    mutationFn: () => billingApi.addInvoiceLineItem(invoice.id, {
      description: newDesc,
      amount_usd: parseFloat(newAmount),
      type: newType,
    } as AddInvoiceLineItemRequest),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing"] });
      toast({ title: "Line item added", variant: "success" });
      setNewDesc(""); setNewAmount(""); setNewType("monthly"); setAddingItem(false);
    },
    onError: () => toast({ title: "Failed to add item", variant: "destructive" }),
  });

  const { mutate: removeItem } = useMutation({
    mutationFn: (itemId: string) => billingApi.removeInvoiceLineItem(invoice.id, itemId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing"] });
      toast({ title: "Line item removed", variant: "success" });
    },
    onError: () => toast({ title: "Failed to remove item", variant: "destructive" }),
  });

  const canEdit = invoice.status !== "paid" && invoice.status !== "deleted";

  return (
    <div className="px-5 pb-5 space-y-4 border-t border-stone-800/40 pt-4">
      {/* Line items breakdown */}
      <div className="bg-stone-900/60 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
          <p className="text-[10px] font-mono uppercase tracking-wider text-stone-600">
            Invoice breakdown
          </p>
          {canEdit && !addingItem && (
            <button
              onClick={() => setAddingItem(true)}
              className="flex items-center gap-1 text-[10px] font-mono text-stone-500 hover:text-violet-400 transition-colors"
            >
              <Plus className="w-3 h-3" /> Add item
            </button>
          )}
        </div>

        {invoice.line_items.length === 0 && !addingItem && (
          <p className="text-xs text-stone-700 px-3 pb-2.5">No line items.</p>
        )}

        {invoice.line_items.map((li: InvoiceLineItem) => (
          <div key={li.id} className="flex items-center gap-3 px-3 py-2 border-t border-stone-800/40 group">
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded flex-shrink-0 ${
              li.type === "monthly" ? "bg-violet-500/10 text-violet-400" : "bg-amber-500/10 text-amber-400"
            }`}>
              {li.type === "monthly" ? "Monthly" : "One-time"}
            </span>
            <span className="flex-1 text-xs text-stone-300">{li.description}</span>
            <span className="text-xs font-mono text-stone-200 flex-shrink-0">{formatUSD(li.amount_usd)}</span>
            {canEdit && (
              <button
                onClick={() => removeItem(li.id)}
                className="opacity-0 group-hover:opacity-100 text-stone-600 hover:text-red-400 transition-all flex-shrink-0"
                title="Remove"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}

        {addingItem && (
          <div className="px-3 py-2.5 border-t border-stone-700/60 space-y-2 bg-stone-800/20">
            <div className="flex flex-wrap gap-2">
              <Input
                autoFocus
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="h-8 text-xs flex-1 min-w-36"
                placeholder="Description"
              />
              <div className="relative w-28 flex-shrink-0">
                <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-stone-500" />
                <Input
                  type="number" min="0.01" step="0.01"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  className="h-8 pl-6 text-xs"
                  placeholder="0.00"
                />
              </div>
              <Select value={newType} onValueChange={(v) => setNewType(v as "monthly" | "one_time")}>
                <SelectTrigger className="h-8 text-xs w-28 flex-shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="one_time">One-time</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost" size="sm"
                onClick={() => { setAddingItem(false); setNewDesc(""); setNewAmount(""); }}
                className="h-7 text-xs text-stone-500"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => addItem()}
                disabled={adding || !newDesc || !newAmount || parseFloat(newAmount) <= 0}
                className="h-7 text-xs bg-violet-600 hover:bg-violet-500 text-white border-0"
              >
                {adding ? "Adding…" : "Add"}
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center px-3 py-2 border-t border-stone-700/60 bg-stone-800/30">
          <span className="text-xs font-mono text-stone-400">Total</span>
          <span className="text-sm font-mono font-semibold text-stone-100">{formatUSD(invoice.amount_usd)}</span>
        </div>
      </div>

      {/* Payment actions */}
      {canEdit && (
        <InvoiceActions invoice={invoice} onDone={onCollapse} />
      )}

      {/* Arrangement management */}
      <ArrangementPanel invoiceId={invoice.id} />
    </div>
  );
}


// ── Arrangement panel (superadmin view) ───────────────────────────────────────

function ArrangementPanel({ invoiceId }: { invoiceId: string }) {
  const qc = useQueryClient();

  const { data: arr, isLoading } = useQuery<PaymentArrangement | null>({
    queryKey: ["billing", "arrangement", invoiceId],
    queryFn: () => billingApi.getArrangement(invoiceId),
  });

  const { mutate: payInstallment, isPending: paying, variables: payingIdx } = useMutation({
    mutationFn: (index: number) => billingApi.markInstallmentPaid(arr!.id, index),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing"] });
      toast({ title: "Installment marked as paid", variant: "success" });
    },
    onError: () => toast({ title: "Failed to record installment payment", variant: "destructive" }),
  });

  const { mutate: clearBlock, isPending: clearing } = useMutation({
    mutationFn: () => billingApi.clearArrangementBlock(arr!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing"] });
      toast({ title: "Arrangement block cleared — user can request again", variant: "success" });
    },
    onError: () => toast({ title: "Failed to clear block", variant: "destructive" }),
  });

  if (isLoading || !arr) return null;

  const statusColor = arr.status === "active" ? "text-violet-400 bg-violet-500/10"
    : arr.status === "completed" ? "text-emerald-400 bg-emerald-500/10"
    : arr.status === "defaulted" ? "text-red-400 bg-red-500/10"
    : "text-stone-400 bg-stone-500/10";

  return (
    <div className="bg-stone-900/60 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
        <CreditCard className="w-3.5 h-3.5 text-stone-500" />
        <p className="text-[10px] font-mono uppercase tracking-wider text-stone-600 flex-1">
          Payment Arrangement
        </p>
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${statusColor}`}>
          {arr.status}
        </span>
      </div>
      {arr.amounts_usd.map((amt, i) => {
        const paid = arr.paid_flags[i];
        const paidAt = arr.paid_at_list[i];
        const isOverdue = !paid && new Date(arr.due_dates[i]) < new Date();
        return (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5 border-t border-stone-800/40">
            {paid
              ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              : isOverdue
              ? <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
              : <Clock className="w-4 h-4 text-amber-400 flex-shrink-0" />
            }
            <div className="flex-1 min-w-0">
              <p className="text-xs font-mono text-stone-300">
                Installment {i + 1} of {arr.installments} — {formatUSD(amt)}
              </p>
              <p className="text-[10px] text-stone-600">
                {paid && paidAt
                  ? `Paid ${new Date(paidAt).toLocaleDateString()}`
                  : `Due ${new Date(arr.due_dates[i]).toLocaleDateString()}${isOverdue ? " — OVERDUE" : ""}`}
              </p>
            </div>
            {!paid && arr.status === "active" && (
              <Button
                size="sm"
                onClick={() => payInstallment(i)}
                disabled={paying && payingIdx === i}
                className="h-7 text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white border-0 flex-shrink-0"
              >
                {paying && payingIdx === i ? "…" : "Mark Paid"}
              </Button>
            )}
          </div>
        );
      })}
      <div className="flex justify-between px-3 py-2 border-t border-stone-700/60 bg-stone-800/20 text-[10px] font-mono text-stone-500">
        <span>Total</span>
        <span className="text-stone-300">{formatUSD(arr.total_usd)}</span>
      </div>
      {arr.status === "defaulted" && (
        <div className="px-3 py-2.5 border-t border-red-900/40 bg-red-950/20 flex items-center gap-3">
          <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
          <p className="text-[10px] font-mono text-red-400 flex-1">
            User is blocked from future arrangement requests.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => clearBlock()}
            disabled={clearing}
            className="h-7 text-[10px] border-red-700/50 text-red-400 hover:bg-red-500/10 hover:border-red-500 flex-shrink-0"
          >
            {clearing ? "…" : "Clear Block"}
          </Button>
        </div>
      )}
    </div>
  );
}


// ── Invoice row ───────────────────────────────────────────────────────────────

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[invoice.status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  const canExpand = invoice.status !== "deleted";
  const hasLineItems = invoice.line_items.length > 0;

  const { mutate: remove, isPending: deleting } = useMutation({
    mutationFn: () => billingApi.deleteInvoice(invoice.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing"] });
      toast({ title: "Invoice deleted", variant: "success" });
    },
    onError: () => toast({ title: "Failed to delete invoice", variant: "destructive" }),
  });

  return (
    <div className="border border-stone-800/60 rounded-xl bg-stone-900/40 overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-4">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          invoice.status === "paid" ? "bg-emerald-500/10" : "bg-stone-800"
        }`}>
          <Icon className={`w-4 h-4 ${cfg.color}`} />
        </div>

        <button
          className="flex-1 min-w-0 text-left"
          onClick={() => canExpand && setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-display font-semibold text-stone-200">{invoice.period_label}</span>
            <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${cfg.color} bg-stone-800`}>
              {cfg.label}
            </span>
            {hasLineItems && (
              <span className="text-[10px] font-mono text-stone-600">{invoice.line_items.length} items</span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-0.5 text-xs font-mono text-stone-500">
            <span>Due {formatDate(invoice.due_date)}</span>
            {invoice.days_overdue > 0 && (
              <span className="text-amber-500">{invoice.days_overdue}d overdue</span>
            )}
          </div>
        </button>

        <div className="text-right flex-shrink-0">
          <p className="text-sm font-mono font-semibold text-stone-200">{formatUSD(invoice.amount_usd)}</p>
          {invoice.balance_usd > 0 && invoice.status !== "paid" && (
            <p className="text-xs font-mono text-red-400">{formatUSD(invoice.balance_usd)} due</p>
          )}
          {invoice.status === "paid" && (
            <p className="text-xs font-mono text-emerald-400">Paid {invoice.paid_at ? formatDate(invoice.paid_at) : ""}</p>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            size="sm" variant="ghost"
            onClick={() => {
              if (window.confirm(`Delete invoice for ${invoice.period_label}? This cannot be undone.`)) {
                remove();
              }
            }}
            disabled={deleting}
            className="h-7 w-7 p-0 text-stone-700 hover:text-red-400"
            title="Delete invoice"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
          {canExpand && (
            <Button
              size="sm" variant="ghost"
              onClick={() => setExpanded(!expanded)}
              className="h-7 w-7 p-0 text-stone-600"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <InvoiceBreakdown invoice={invoice} onCollapse={() => setExpanded(false)} />
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
