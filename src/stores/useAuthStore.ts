import { create } from 'zustand';
import { supabase } from '../config/supabase';
import type { User } from '@supabase/supabase-js';

export type Role = 'admin' | 'waiter' | 'kitchen' | 'cashier';

export interface Profile {
  id: string;
  restaurant_id: string | null;
  full_name: string;
  phone: string | null;
  role: Role;
  status: string;
}

interface AuthState {
  user: User | null;
  profile: Profile | null;
  /** true mientras se resuelve la sesión Y el perfil (evita parpadeos y redirecciones prematuras) */
  loading: boolean;
  profileError: string | null;
  /** Inicia la escucha de auth. Devuelve la función para cancelarla. */
  init: () => () => void;
  logout: () => Promise<void>;
}

let loadingFor: string | null = null;

export const useAuthStore = create<AuthState>((set, get) => {
  const sync = async (nextUser: User | null) => {
    if (!nextUser) {
      loadingFor = null;
      set({ user: null, profile: null, profileError: null, loading: false });
      return;
    }

    // Refresco de token o re-foco de pestaña: mismo usuario, no recargamos el perfil
    if (get().profile?.id === nextUser.id) {
      set({ user: nextUser });
      return;
    }
    // Ya hay una carga en curso para este usuario
    if (loadingFor === nextUser.id) return;

    loadingFor = nextUser.id;
    set({ user: nextUser, profile: null, profileError: null, loading: true });

    const { data, error } = await supabase
      .from('profiles')
      .select('id, restaurant_id, full_name, phone, role, status')
      .eq('id', nextUser.id)
      .maybeSingle();

    // Si mientras tanto cambió el usuario, descartamos este resultado
    if (loadingFor !== nextUser.id) return;
    loadingFor = null;

    if (error) {
      set({ profile: null, profileError: `No se pudo cargar tu perfil: ${error.message}`, loading: false });
    } else if (!data) {
      set({ profile: null, profileError: 'Tu usuario no tiene un perfil asignado. Pide al administrador que lo cree.', loading: false });
    } else if (data.status !== 'active') {
      set({ profile: null, profileError: 'Tu usuario está desactivado. Habla con el administrador.', loading: false });
    } else {
      set({ profile: data as Profile, profileError: null, loading: false });
    }
  };

  return {
    user: null,
    profile: null,
    loading: true,
    profileError: null,

    init: () => {
      // OJO: no hacer llamadas async a Supabase directamente dentro del callback
      // (puede bloquear el cliente). Se difiere con setTimeout.
      // INITIAL_SESSION se dispara al suscribirse, así que cubre la carga inicial.
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        setTimeout(() => {
          void sync(session?.user ?? null);
        }, 0);
      });
      return () => subscription.unsubscribe();
    },

    logout: async () => {
      await supabase.auth.signOut();
      loadingFor = null;
      set({ user: null, profile: null, profileError: null });
    },
  };
});
