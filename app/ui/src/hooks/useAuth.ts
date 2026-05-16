import { useAuthStore } from "@/store/auth";

export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);
  const clearError = useAuthStore((s) => s.clearError);
  const fetchMe = useAuthStore((s) => s.fetchMe);

  const isAuthenticated = !!accessToken && !!user;
  const role = user?.role ?? null;

  const isSuperAdmin = role === "superadmin";
  const isAdmin = role === "admin" || role === "superadmin";
  const isStaff = role === "staff" || role === "admin" || role === "superadmin";
  const isArtist = role === "artist";
  const isListener = role === "listener";

  return {
    user,
    accessToken,
    isLoading,
    error,
    login,
    logout,
    clearError,
    fetchMe,
    isAuthenticated,
    role,
    isSuperAdmin,
    isAdmin,
    isStaff,
    isArtist,
    isListener,
  };
}
