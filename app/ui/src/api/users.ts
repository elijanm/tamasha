import { api } from "./client";
import type { User, Role, PagedResponse } from "@/types";

export interface UpdateProfilePayload {
  display_name?: string;
  bio?: string;
  phone?: string;
  email?: string;
}

export interface CreateUserPayload {
  email: string;
  username: string;
  password: string;
  role: Role;
  send_invite: boolean;
}

export interface UsersListParams {
  limit?: number;
  skip?: number;
  role?: string;
  search?: string;
}

export const usersApi = {
  list: async (params: UsersListParams = {}): Promise<PagedResponse<User>> => {
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

  sendInviteLink: async (email: string, role: Role): Promise<void> => {
    await api.post("/users/invite-link", { email, role });
  },

  updateMe: async (payload: UpdateProfilePayload): Promise<User> => {
    const res = await api.patch<User>("/users/me", payload);
    return res.data;
  },

  uploadAvatar: async (file: File): Promise<User> => {
    const form = new FormData();
    form.append("file", file);
    const res = await api.post<User>("/users/me/avatar", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return res.data;
  },
};
