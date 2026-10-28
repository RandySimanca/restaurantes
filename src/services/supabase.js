import { createClient } from '@supabase/supabase-js';
import { supabaseConfig, validateSupabaseConfig } from '../config/supabase.config';

// Validar configuración antes de crear el cliente
if (!validateSupabaseConfig()) {
  throw new Error('Configuración de Supabase inválida. Revisa las variables de entorno.');
}

// Crear cliente de Supabase
export const supabase = createClient(
  supabaseConfig.url,
  supabaseConfig.anonKey,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  }
);

// Helper para obtener el usuario actual
export const getCurrentUser = async () => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  return user;
};

// Helper para obtener el perfil del usuario actual
export const getCurrentProfile = async () => {
  const user = await getCurrentUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('auth_user_id', user.id)
    .single();

  if (error) throw error;
  return profile;
};

// Helper para verificar si el usuario tiene un rol específico
export const hasRole = (profile, roles) => {
  if (!profile) return false;
  if (Array.isArray(roles)) {
    return roles.includes(profile.role);
  }
  return profile.role === roles;
};

export default supabase;