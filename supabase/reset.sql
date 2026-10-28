-- ==============================================================================
-- RESET COMPLETO DE LA BASE DE DATOS
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ⚠️  ESTO BORRA TODOS LOS DATOS. NO SE PUEDE DESHACER.
-- ==============================================================================

-- 1. Borrar datos de tablas públicas (en orden para respetar FK)
TRUNCATE TABLE
    public.audit_logs,
    public.void_requests,
    public.payments,
    public.cash_handovers,
    public.kitchen_order_items,
    public.kitchen_orders,
    public.order_items,
    public.orders,
    public.table_sessions,
    public.tables,
    public.products,
    public.categories,
    public.profiles,
    public.restaurants
CASCADE;

-- 2. Borrar todos los usuarios de autenticación
-- ⚠️  Esto elimina TODOS los usuarios (incluyendo el admin)
-- Comenta esta línea si quieres conservar algún usuario
DELETE FROM auth.users;

-- ==============================================================================
-- VERIFICACIÓN (opcional): Confirma que todo está vacío
-- Descomenta para ejecutar después del reset
-- ==============================================================================
-- SELECT 'restaurants' as tabla, COUNT(*) FROM public.restaurants
-- UNION ALL SELECT 'profiles',   COUNT(*) FROM public.profiles
-- UNION ALL SELECT 'tables',     COUNT(*) FROM public.tables
-- UNION ALL SELECT 'orders',     COUNT(*) FROM public.orders
-- UNION ALL SELECT 'payments',   COUNT(*) FROM public.payments
-- UNION ALL SELECT 'auth.users', COUNT(*) FROM auth.users;
