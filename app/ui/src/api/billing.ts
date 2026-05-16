import { api } from "./client";
import type {
  BillingGateStatus,
  Invoice,
  PagedResponse,
  PaymentArrangement,
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

export interface SetPlatformCostRequest {
  monthly_amount_usd: number;
  description?: string;
  reminder_days?: number[];
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

  setConfig: async (payload: SetPlatformCostRequest): Promise<PlatformCostConfig> => {
    const res = await api.put<PlatformCostConfig>("/billing/config", payload);
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
};
