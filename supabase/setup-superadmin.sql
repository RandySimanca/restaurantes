-- ==============================================================================
-- SETUP: crear el SUPERADMIN de la plataforma (una sola vez)
-- Ejecutar en: Supabase Dashboard → SQL Editor, DESPUÉS de la migración 002.
-- Requisito: crear antes el usuario en Authentication → Users (con "Auto Confirm User").
-- El superadmin no pertenece a ningún restaurante.
-- ==============================================================================
INSERT INTO public.profiles (id, restaurant_id, full_name, role, status)
SELECT id, NULL, 'Superadmin', 'superadmin', 'active'      -- ← cambia el nombre
FROM auth.users
WHERE email = 'tu-correo@dominio.com'                       -- ← cambia el correo
ON CONFLICT (id) DO UPDATE
    SET role = 'superadmin', restaurant_id = NULL, status = 'active';
