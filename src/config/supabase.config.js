// Configuración de Supabase
// IMPORTANTE: Reemplazar con tus credenciales reales de Supabase
export const supabaseConfig = {
  url: import.meta.env.VITE_SUPABASE_URL || 'YOUR_SUPABASE_URL',
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY',
};

// Validar que las credenciales estén configuradas
export const validateSupabaseConfig = () => {
  if (!supabaseConfig.url || supabaseConfig.url === 'YOUR_SUPABASE_URL') {
    console.error('❌ Supabase URL no configurada. Por favor configura VITE_SUPABASE_URL en .env');
    return false;
  }
  if (!supabaseConfig.anonKey || supabaseConfig.anonKey === 'YOUR_SUPABASE_ANON_KEY') {
    console.error('❌ Supabase Anon Key no configurada. Por favor configura VITE_SUPABASE_ANON_KEY en .env');
    return false;
  }
  return true;
};