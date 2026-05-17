import { api } from "./client";
import type { AuthTokens, LoginRequest, RegisterRequest, User } from "@/types";

export const authApi = {
  login: async (data: LoginRequest): Promise<AuthTokens> => {
    // FastAPI OAuth2 expects form-urlencoded for /token but our backend uses JSON
    const res = await api.post<AuthTokens>("/auth/login", data);
    return res.data;
  },

  register: async (data: RegisterRequest): Promise<User> => {
    const res = await api.post<User>("/auth/register", data);
    return res.data;
  },

  refresh: async (refreshToken: string): Promise<AuthTokens> => {
    const res = await api.post<AuthTokens>("/auth/refresh", {
      refresh_token: refreshToken,
    });
    return res.data;
  },

  logout: async (): Promise<void> => {
    await api.post("/auth/logout");
  },

  me: async (): Promise<User> => {
    const res = await api.get<User>("/auth/me");
    return res.data;
  },
};
