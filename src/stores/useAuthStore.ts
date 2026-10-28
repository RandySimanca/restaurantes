import { create } from 'zustand';
import { supabase } from '../config/supabase';
import type { User } from '@supabase/supabase-js';

export type Role = 'superadmin' | 'admin' | 'waiter' | 'kitchen' | 'cashier';

export interface Profile {
  id: string;
  /** null solo para el superadmin de plataforma */
  restaurant_id: string | null;
  full_name: string;
  phone: string | null;
  role: Role;
  status: string;
}

export interface Restaurant {
  id: string;
  name: string;
}

interface AuthState {
  user: User | null;
  profile: Profile | null;
  restaurant: Restaurant | null;
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
      set({ user: null, profile: null, restaurant: null, profileError: null, loading: false });
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
    set({ user: nextUser, profile: null, restaurant: null, profileError: null, loading: true });

    const fail = (message: string) => {
      loadingFor = null;
      set({ profile: null, restaurant: null, profileError: message, loading: false });
    };

    const { data, error } = await supabase
      .from('profiles')
      .select('id, restaurant_id, full_name, phone, role, status')
      .eq('id', nextUser.id)
      .maybeSingle();

    // Si mientras tanto cambió el usuario, descartamos este resultado
    if (loadingFor !== nextUser.id) return;

    if (error) return fail(`No se pudo cargar tu perfil: ${error.message}`);
    if (!data) return fail('Tu usuario no tiene un perfil asignado. Pide al administrador que lo cree.');
    if (data.status !== 'active') return fail('Tu usuario está desactivado. Habla con el administrador.');

    // Todos menos el superadmin pertenecen a un restaurante, y ese restaurante debe estar activo.
    // Si está suspendido, la RLS no devuelve la fila y lo tratamos como no disponible.
    let restaurant: Restaurant | null = null;
    if (data.role !== 'superadmin') {
      if (!data.restaurant_id) return fail('Tu usuario no está asociado a ningún restaurante.');

      const res = await supabase
        .from('restaurants')
        .select('id, name')
        .eq('id', data.restaurant_id)
        .maybeSingle();

      if (loadingFor !== nextUser.id) return;
      if (res.error || !res.data) {
        return fail('El restaurante de tu usuario está suspendido o no está disponible. Contacta a soporte.');
      }
      restaurant = res.data as Restaurant;
    }

    loadingFor = null;
    set({ profile: data as Profile, restaurant, profileError: null, loading: false });
  };

  return {
    user: null,
    profile: null,
    restaurant: null,
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
      set({ user: null, profile: null, restaurant: null, profileError: null });
    },
  };
});
