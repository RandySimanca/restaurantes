import { supabase } from '../config/supabase';

/** Llama a una edge function con la sesión actual y devuelve el mensaje de error del servidor. */
export async function callFunction<T = unknown>(
  name: string,
  body: unknown
): Promise<{ data?: T; error?: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  try {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { error: json.error || 'Error inesperado del servidor' };
    return { data: json as T };
  } catch {
    return { error: 'Error de conexión. Intenta nuevamente.' };
  }
}
