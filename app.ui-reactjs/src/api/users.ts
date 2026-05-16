import { api } from "./client";
import type { User, Role, ListParams, PagedResponse } from "@/types";

export interface CreateUserPayload {
  email: string;
  username: string;
  password: string;
  role: Role;
  send_invite: boolean;
}

export const usersApi = {
  list: async (params: ListParams = {}): Promise<PagedResponse<User>> => {
    const res = await api.get<PagedResponse<User>>("/users/", { params });
    return res.data;
  },

  create: async (payload: CreateUserPayload): Promise<User> => {
    const res = await api.post<User>("/users/", payload);
    return res.data;
  },

  updateRole: async (id: string, role: Role): Promise<User> => {
    const res = await api.patch<User>(`/users/${id}/role`, { role });
    return res.data;
  },

  activate: async (id: string): Promise<User> => {
    const res = await api.patch<User>(`/users/${id}/activate`);
    return res.data;
  },

  deactivate: async (id: string): Promise<void> => {
    await api.delete(`/users/${id}`);
  },

  sendInvite: async (id: string): Promise<void> => {
    await api.post(`/users/${id}/invite`);
  },
};
