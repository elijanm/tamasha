import { api } from "./client";
import type {
  BillingGateStatus,
  CostLineType,
  Invoice,
  PagedResponse,
  PaymentArrangement,
  PaymentProof,
  PlatformCostConfig,
} from "@/types";

export interface RecordPaymentRequest {
  amount_usd: number;
  notes?: string;
}

export interface CreateArrangementRequest {
  installments: 2 | 3;
  notes?: string;
}

export interface AddLineItemRequest {
  description: string;
  amount_usd: number;
  type: CostLineType;
}

export interface AddInvoiceLineItemRequest {
  description: string;
  amount_usd: number;
  type: CostLineType;
}

export interface UpdateLineItemRequest {
  description?: string;
  amount_usd?: number;
  is_active?: boolean;
}

export interface GenerateInvoiceRequest {
  month: number;
  year: number;
  amount_usd?: number;
  notes?: string;
}

export const billingApi = {
  getGateStatus: async (): Promise<BillingGateStatus> => {
    const res = await api.get<BillingGateStatus>("/billing/gate-status");
    return res.data;
  },

  getConfig: async (): Promise<PlatformCostConfig | null> => {
    const res = await api.get<PlatformCostConfig | null>("/billing/config");
    return res.data;
  },

  addLineItem: async (payload: AddLineItemRequest): Promise<PlatformCostConfig> => {
    const res = await api.post<PlatformCostConfig>("/billing/config/items", payload);
    return res.data;
  },

  updateLineItem: async (itemId: string, payload: UpdateLineItemRequest): Promise<PlatformCostConfig> => {
    const res = await api.patch<PlatformCostConfig>(`/billing/config/items/${itemId}`, payload);
    return res.data;
  },

  removeLineItem: async (itemId: string): Promise<PlatformCostConfig> => {
    const res = await api.delete<PlatformCostConfig>(`/billing/config/items/${itemId}`);
    return res.data;
  },

  setReminderDays: async (reminder_days: number[]): Promise<PlatformCostConfig> => {
    const res = await api.patch<PlatformCostConfig>("/billing/config/reminders", { reminder_days });
    return res.data;
  },

  addInvoiceLineItem: async (invoiceId: string, payload: AddInvoiceLineItemRequest): Promise<Invoice> => {
    const res = await api.post<Invoice>(`/billing/invoices/${invoiceId}/items`, payload);
    return res.data;
  },

  removeInvoiceLineItem: async (invoiceId: string, itemId: string): Promise<Invoice> => {
    const res = await api.delete<Invoice>(`/billing/invoices/${invoiceId}/items/${itemId}`);
    return res.data;
  },

  deleteInvoice: async (id: string): Promise<void> => {
    await api.delete(`/billing/invoices/${id}`);
  },

  sendInvoiceEmail: async (id: string): Promise<void> => {
    await api.post(`/billing/invoices/${id}/send-email`);
  },

  submitProof: async (invoiceId: string, formData: FormData): Promise<PaymentProof> => {
    const res = await api.post<PaymentProof>(`/billing/invoices/${invoiceId}/proof`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return res.data;
  },

  listProofs: async (invoiceId: string): Promise<PaymentProof[]> => {
    const res = await api.get<PaymentProof[]>(`/billing/invoices/${invoiceId}/proofs`);
    return res.data;
  },

  listInvoices: async (params: { skip?: number; limit?: number } = {}): Promise<PagedResponse<Invoice>> => {
    const res = await api.get<PagedResponse<Invoice>>("/billing/invoices", { params });
    return res.data;
  },

  createInvoice: async (payload: GenerateInvoiceRequest): Promise<Invoice> => {
    const res = await api.post<Invoice>("/billing/invoices", payload);
    return res.data;
  },

  getInvoice: async (id: string): Promise<Invoice> => {
    const res = await api.get<Invoice>(`/billing/invoices/${id}`);
    return res.data;
  },

  recordPayment: async (invoiceId: string, payload: RecordPaymentRequest): Promise<Invoice> => {
    const res = await api.post<Invoice>(`/billing/invoices/${invoiceId}/pay`, payload);
    return res.data;
  },

  createArrangement: async (invoiceId: string, payload: CreateArrangementRequest): Promise<PaymentArrangement> => {
    const res = await api.post<PaymentArrangement>(`/billing/invoices/${invoiceId}/arrangement`, payload);
    return res.data;
  },

  getArrangement: async (invoiceId: string): Promise<PaymentArrangement | null> => {
    const res = await api.get<PaymentArrangement | null>(`/billing/invoices/${invoiceId}/arrangement`);
    return res.data;
  },

  requestArrangement: async (invoiceId: string, installments: number, due_dates: string[]): Promise<PaymentArrangement> => {
    const res = await api.post<PaymentArrangement>(`/billing/invoices/${invoiceId}/arrangement/request`, { installments, due_dates });
    return res.data;
  },

  markInstallmentPaid: async (arrangementId: string, index: number): Promise<PaymentArrangement> => {
    const res = await api.post<PaymentArrangement>(`/billing/arrangements/${arrangementId}/installments/${index}/pay`, {});
    return res.data;
  },

  clearArrangementBlock: async (arrangementId: string): Promise<void> => {
    await api.post(`/billing/arrangements/${arrangementId}/clear-block`);
  },
};
