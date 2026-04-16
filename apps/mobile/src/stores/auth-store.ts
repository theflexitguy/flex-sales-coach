import { create } from "zustand";
import { supabase } from "../lib/supabase";
import type { Session, User } from "@supabase/supabase-js";

async function fetchProfile(userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (!profile) return null;

  // Fetch manager assignments for this user
  const { data: assignments } = await supabase
    .from("manager_rep_assignments")
    .select("manager_id")
    .eq("rep_id", userId);

  return {
    id: profile.id,
    fullName: profile.full_name,
    email: profile.email,
    role: profile.role,
    teamId: profile.team_id,
    managerIds: (assignments ?? []).map((a: { manager_id: string }) => a.manager_id),
  };
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: {
    id: string;
    fullName: string;
    email: string;
    role: string;
    teamId: string | null;
    managerIds: string[];
  } | null;
  loading: boolean;
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  profile: null,
  loading: true,

  initialize: async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user) {
        const mapped = await fetchProfile(session.user.id);
        set({ session, user: session.user, profile: mapped, loading: false });
      } else {
        set({ session: null, user: null, profile: null, loading: false });
      }
    } catch {
      set({ session: null, user: null, profile: null, loading: false });
    }

    supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const mapped = await fetchProfile(session.user.id);
        set({ session, user: session.user, profile: mapped });
      } else {
        set({ session: null, user: null, profile: null });
      }
    });
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return error?.message ?? null;
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, profile: null });
  },
}));
