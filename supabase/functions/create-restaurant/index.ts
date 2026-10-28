// Edge Function: create-restaurant  (solo superadmin)
// 1) crea el usuario admin en Auth  2) provision_restaurant() crea restaurante + perfil admin
//    + mesas y categorías iniciales en UNA transacción  3) si falla el paso 2, borra el usuario.

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
      .select('role, status')
      .eq('id', caller.id)
      .single();
    if (!callerProfile || callerProfile.status !== 'active' || callerProfile.role !== 'superadmin') {
      return json({ error: 'Solo el superadmin puede crear restaurantes' }, 403);
    }

    const b = await req.json();
    const name = String(b.name ?? '').trim();
    const adminName = String(b.admin_name ?? '').trim();
    const adminEmail = String(b.admin_email ?? '').trim().toLowerCase();
    const adminPassword = b.admin_password;
    const tablesCount = b.tables_count === undefined || b.tables_count === '' ? 5 : Number(b.tables_count);
    const serviceFee = b.service_fee_pct === undefined || b.service_fee_pct === '' ? 10 : Number(b.service_fee_pct);

    if (name.length < 2) return json({ error: 'El nombre del restaurante es obligatorio' }, 400);
    if (adminName.length < 2) return json({ error: 'El nombre del administrador es obligatorio' }, 400);
    if (!EMAIL_RE.test(adminEmail)) return json({ error: 'Correo del administrador inválido' }, 400);
    if (typeof adminPassword !== 'string' || adminPassword.length < 8) {
      return json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400);
    }
    if (!Number.isInteger(tablesCount) || tablesCount < 0 || tablesCount > 100) {
      return json({ error: 'El número de mesas debe ser un entero entre 0 y 100' }, 400);
    }
    if (!Number.isFinite(serviceFee) || serviceFee < 0 || serviceFee > 30) {
      return json({ error: 'El porcentaje de servicio debe estar entre 0 y 30' }, 400);
    }

    const supabaseAdmin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    if (createError) return json({ error: createError.message }, 400);

    const { data: restaurantId, error: rpcError } = await supabaseAdmin.rpc('provision_restaurant', {
      p_admin_user_id: newUser.user!.id,
      p_admin_name: adminName,
      p_name: name,
      p_identification: b.identification ?? null,
      p_address: b.address ?? null,
      p_phone: b.phone ?? null,
      p_service_fee_pct: serviceFee,
      p_tables_count: tablesCount,
      p_created_by: caller.id,
    });

    if (rpcError) {
      await supabaseAdmin.auth.admin.deleteUser(newUser.user!.id); // rollback
      return json({ error: `No se pudo crear el restaurante: ${rpcError.message}` }, 500);
    }

    return json({ success: true, restaurant_id: restaurantId, admin: { id: newUser.user!.id, email: adminEmail } });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
