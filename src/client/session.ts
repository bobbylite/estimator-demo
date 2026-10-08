import { useQuery } from "@tanstack/react-query";
import { api, setCsrf } from "./api";

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  email: string;
}

export interface SessionPayload {
  user: SessionUser | null;
  csrfToken: string | null;
  mock: boolean;
}

export const sessionQueryOptions = {
  queryKey: ["session"] as const,
  queryFn: async (): Promise<SessionPayload> => {
    const session = await api<SessionPayload>("/api/auth/session");
    setCsrf(session.csrfToken);
    return session;
  },
  retry: false,
  staleTime: 15_000,
};

export function useSession() {
  return useQuery(sessionQueryOptions);
}
