-- ==============================================================================
-- SETUP INICIAL: Crear el primer Administrador
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Requisito: Ya debes haber creado el usuario en Authentication → Users
-- ==============================================================================

-- PASO 1: Crear el restaurante (si no existe)
INSERT INTO public.restaurants (id, name, address, phone)
VALUES (
    'c0000000-0000-0000-0000-000000000001',
    'Mi Restaurante',   -- ← Cambia el nombre
    'Dirección',
    '555-0000'
)
ON CONFLICT (id) DO NOTHING;


-- PASO 2: Crear el perfil del administrador
-- Reemplaza el email con el que usaste al crear el usuario en Supabase Auth
INSERT INTO public.profiles (id, restaurant_id, full_name, role, status)
SELECT 
    id,
    'c0000000-0000-0000-0000-000000000001',
    'Administrador',    -- ← Cambia el nombre
    'admin',
    'active'
FROM auth.users
WHERE email = 'admin@mirestaurante.com'  -- ← Cambia el email
ON CONFLICT (id) DO UPDATE SET role = 'admin', status = 'active';


-- ==============================================================================
-- POLÍTICAS RLS ADICIONALES PARA EL ADMIN
-- (Necesarias para que el admin pueda leer y modificar todos los perfiles)
-- ==============================================================================

-- Admins pueden ver todos los perfiles de su restaurante
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
CREATE POLICY "Admins can view all profiles" ON profiles
    FOR SELECT USING (
        restaurant_id = get_current_user_restaurant()
    );

-- Admins pueden insertar perfiles en su restaurante
DROP POLICY IF EXISTS "Admins can insert profiles" ON profiles;
CREATE POLICY "Admins can insert profiles" ON profiles
    FOR INSERT WITH CHECK (
        restaurant_id = get_current_user_restaurant()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- Admins pueden actualizar perfiles de su restaurante
DROP POLICY IF EXISTS "Admins can update profiles" ON profiles;
CREATE POLICY "Admins can update profiles" ON profiles
    FOR UPDATE USING (
        restaurant_id = get_current_user_restaurant()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );
