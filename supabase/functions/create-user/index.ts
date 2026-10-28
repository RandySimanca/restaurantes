// Edge Function: create-user
// - admin de un restaurante  -> crea usuarios (waiter/kitchen/cashier/admin) EN SU restaurante
// - superadmin               -> crea un admin para el restaurante indicado en restaurant_id
// Nunca permite crear un superadmin: ese se crea solo con supabase/setup-superadmin.sql.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json, EMAIL_RE } from '../_shared/http.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'No autorizado' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const supabaseUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: caller }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !caller) return json({ error: 'No autorizado' }, 401);

    const { data: callerProfile } = await supabaseUser
      .from('profiles')
      .select('role, restaurant_id, status')
      .eq('id', caller.id)
      .single();

    if (!callerProfile || callerProfile.status !== 'active' || !['admin', 'superadmin'].includes(callerProfile.role)) {
      return json({ error: 'Solo los administradores pueden crear usuarios' }, 403);
    }

    const body = await req.json();
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = body.password;
    const full_name = String(body.full_name ?? '').trim();
    const role = body.role;

    if (!email || !password || !full_name || !role) {
      return json({ error: 'Faltan campos requeridos: email, password, full_name, role' }, 400);
    }
    if (typeof password !== 'string' || password.length < 8) {
      return json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400);
    }
    if (!EMAIL_RE.test(email)) return json({ error: 'Correo electrónico inválido' }, 400);
    if (full_name.length < 2) return json({ error: 'El nombre es demasiado corto' }, 400);

    let restaurantId: string | null;
    let allowedRoles: string[];
    if (callerProfile.role === 'superadmin') {
      restaurantId = body.restaurant_id ?? null;
      allowedRoles = ['admin'];
      if (!restaurantId) return json({ error: 'Falta restaurant_id' }, 400);
    } else {
      restaurantId = callerProfile.restaurant_id;
      allowedRoles = ['waiter', 'kitchen', 'cashier', 'admin'];
    }
    if (!allowedRoles.includes(role)) {
      return json({ error: `Rol inválido. Debe ser uno de: ${allowedRoles.join(', ')}` }, 400);
    }

    const supabaseAdmin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // El restaurante debe existir y estar activo
    const { data: restaurant } = await supabaseAdmin
      .from('restaurants')
      .select('id, status')
      .eq('id', restaurantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!restaurant) return json({ error: 'Restaurante no encontrado' }, 404);
    if (restaurant.status !== 'active') return json({ error: 'El restaurante está suspendido' }, 403);

    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError) return json({ error: createError.message }, 400);

    const { error: insertError } = await supabaseAdmin.from('profiles').insert({
      id: newUser.user!.id,
      restaurant_id: restaurantId,
      full_name,
      role,
      status: 'active',
    });

    if (insertError) {
      await supabaseAdmin.auth.admin.deleteUser(newUser.user!.id); // rollback
      return json({ error: `Error creando perfil: ${insertError.message}` }, 500);
    }

    return json({ success: true, user: { id: newUser.user!.id, email, full_name, role } });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
