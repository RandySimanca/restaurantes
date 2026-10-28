-- ==============================================================================
-- RECUPERACIÓN (uso excepcional): volver a dar rol admin a un usuario existente
-- de un restaurante existente. Para crear restaurantes y sus administradores usa
-- el panel de superadmin (edge function create-restaurant).
-- Las políticas RLS ya NO viven aquí: están en migrations/001 y 002.
-- ==============================================================================
INSERT INTO public.profiles (id, restaurant_id, full_name, role, status)
SELECT u.id, r.id, 'Administrador', 'admin', 'active'      -- ← cambia el nombre
FROM auth.users u, public.restaurants r
WHERE u.email = 'admin@mirestaurante.com'                  -- ← correo del usuario
  AND r.name = 'Mi Restaurante'                            -- ← nombre exacto del restaurante
ON CONFLICT (id) DO UPDATE SET role = 'admin', status = 'active';
