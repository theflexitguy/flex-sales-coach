import { create } from "zustand";
import { supabase } from "../lib/supabase";
import type { Session, User } from "@supabase/supabase-js";

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: {
    id: string;
    fullName: string;
    email: string;
    role: string;
    teamId: string | null;
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
        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", session.user.id)
          .single();

        set({
          session,
          user: session.user,
          profile: profile
            ? {
                id: profile.id,
                fullName: profile.full_name,
                email: profile.email,
                role: profile.role,
                teamId: profile.team_id,
              }
            : null,
          loading: false,
        });
      } else {
        set({ session: null, user: null, profile: null, loading: false });
      }
    } catch (error) {
      set({ session: null, user: null, profile: null, loading: false });
    }

    // Listen for auth changes
    supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", session.user.id)
          .single();

        set({
          session,
          user: session.user,
          profile: profile
            ? {
                id: profile.id,
                fullName: profile.full_name,
                email: profile.email,
                role: profile.role,
                teamId: profile.team_id,
              }
            : null,
        });
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
