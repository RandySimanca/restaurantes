-- ==============================================================================
-- MIGRACIÓN 002: Superadmin de plataforma y alta de restaurantes (SaaS)
-- Ejecutar DESPUÉS de 001. Es idempotente.
--
-- Modelo:
--   superadmin  -> perfil SIN restaurante. Crea/suspende restaurantes y su primer admin.
--                  NO ve pedidos, pagos ni caja de ningún restaurante.
--   admin       -> pertenece a UN restaurante; crea los usuarios de ese restaurante.
--   waiter / kitchen / cashier -> operan dentro de su restaurante.
--
-- NOTA: si el editor SQL se queja de "unsafe use of new value" con 'superadmin',
-- ejecuta primero SOLO la línea ALTER TYPE (la 1.ª sentencia) y luego el resto.
-- ==============================================================================

ALTER TYPE role_type ADD VALUE IF NOT EXISTS 'superadmin';

-- Estado del restaurante: activo o suspendido (falta de pago, baja, etc.)
ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_status_check;
ALTER TABLE restaurants ADD CONSTRAINT restaurants_status_check CHECK (status IN ('active', 'suspended'));

-- Solo el superadmin carece de restaurante; todos los demás deben tenerlo.
-- (NOT VALID: no revisa filas antiguas, pero sí exige la regla desde ahora.)
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_restaurant_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_restaurant_check
    CHECK ((role::text = 'superadmin') = (restaurant_id IS NULL)) NOT VALID;


-- ==============================================================================
-- A. Funciones auxiliares: un restaurante suspendido deja sin acceso a su gente
-- ==============================================================================

CREATE OR REPLACE FUNCTION get_current_user_restaurant()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT p.restaurant_id
    FROM profiles p JOIN restaurants r ON r.id = p.restaurant_id
    WHERE p.id = auth.uid() AND p.status = 'active' AND p.deleted_at IS NULL
      AND r.status = 'active' AND r.deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION current_user_role()
RETURNS role_type LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT p.role
    FROM profiles p LEFT JOIN restaurants r ON r.id = p.restaurant_id
    WHERE p.id = auth.uid() AND p.status = 'active' AND p.deleted_at IS NULL
      AND (p.restaurant_id IS NULL OR (r.status = 'active' AND r.deleted_at IS NULL));
$$;

-- Contexto para las RPC operativas: exige restaurante activo (el superadmin queda fuera a propósito)
CREATE OR REPLACE FUNCTION _auth_context(
    p_roles role_type[],
    OUT o_user UUID, OUT o_restaurant UUID, OUT o_role role_type
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    SELECT p.id, p.restaurant_id, p.role INTO o_user, o_restaurant, o_role
    FROM profiles p JOIN restaurants r ON r.id = p.restaurant_id
    WHERE p.id = auth.uid() AND p.status = 'active' AND p.deleted_at IS NULL
      AND r.status = 'active' AND r.deleted_at IS NULL;

    IF o_user IS NULL OR NOT (o_role = ANY (p_roles)) THEN
        RAISE EXCEPTION 'No autorizado para esta acción' USING ERRCODE = '42501';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION _require_superadmin()
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
    SELECT id INTO v_id FROM profiles
    WHERE id = auth.uid() AND role::text = 'superadmin' AND status = 'active' AND deleted_at IS NULL;
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'No autorizado para esta acción' USING ERRCODE = '42501';
    END IF;
    RETURN v_id;
END;
$$;


-- ==============================================================================
-- B. Anti-escalada de privilegios (el admin tiene UPDATE sobre profiles de su restaurante)
--    Las llamadas con service_role / SQL editor (auth.uid() IS NULL) no se restringen.
-- ==============================================================================

CREATE OR REPLACE FUNCTION _profiles_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN RETURN NEW; END IF;

    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id THEN
        RAISE EXCEPTION 'No se puede cambiar el restaurante de un usuario';
    END IF;
    IF NEW.role::text = 'superadmin' AND OLD.role::text <> 'superadmin' THEN
        RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
    END IF;
    IF OLD.id = auth.uid() AND (NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status) THEN
        RAISE EXCEPTION 'No puedes cambiar tu propio rol ni desactivarte';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_guard ON profiles;
CREATE TRIGGER profiles_guard BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION _profiles_guard();

-- Un admin de restaurante no puede (re)activar ni suspender su propio restaurante
CREATE OR REPLACE FUNCTION _restaurants_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN RETURN NEW; END IF;
    IF (NEW.status IS DISTINCT FROM OLD.status OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)
       AND current_user_role()::text <> 'superadmin' THEN
        RAISE EXCEPTION 'Solo el superadmin puede cambiar el estado del restaurante' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS restaurants_guard ON restaurants;
CREATE TRIGGER restaurants_guard BEFORE UPDATE ON restaurants
    FOR EACH ROW EXECUTE FUNCTION _restaurants_guard();


-- ==============================================================================
-- C. RLS del superadmin: puede LISTAR restaurantes y perfiles (para gestionarlos),
--    pero no tiene política sobre pedidos, pagos, caja ni auditoría.
-- ==============================================================================

DROP POLICY IF EXISTS restaurants_superadmin_select ON restaurants;
CREATE POLICY restaurants_superadmin_select ON restaurants FOR SELECT
    USING (current_user_role()::text = 'superadmin');

DROP POLICY IF EXISTS profiles_superadmin_select ON profiles;
CREATE POLICY profiles_superadmin_select ON profiles FOR SELECT
    USING (current_user_role()::text = 'superadmin');


-- ==============================================================================
-- D. RPC
-- ==============================================================================

-- Alta atómica de un restaurante + su primer admin + datos iniciales.
-- Solo la llama la edge function create-restaurant (service_role), que antes crea el usuario en Auth.
CREATE OR REPLACE FUNCTION provision_restaurant(
    p_admin_user_id UUID,
    p_admin_name TEXT,
    p_name TEXT,
    p_identification TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_service_fee_pct NUMERIC DEFAULT 10,
    p_tables_count INTEGER DEFAULT 5,
    p_created_by UUID DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id UUID;
BEGIN
    IF NULLIF(trim(p_name), '') IS NULL THEN RAISE EXCEPTION 'El nombre del restaurante es obligatorio'; END IF;
    IF NULLIF(trim(p_admin_name), '') IS NULL THEN RAISE EXCEPTION 'El nombre del administrador es obligatorio'; END IF;
    IF p_service_fee_pct IS NULL OR p_service_fee_pct < 0 OR p_service_fee_pct > 30 THEN
        RAISE EXCEPTION 'El porcentaje de servicio debe estar entre 0 y 30';
    END IF;
    IF p_tables_count IS NULL OR p_tables_count < 0 OR p_tables_count > 100 THEN
        RAISE EXCEPTION 'El número de mesas debe estar entre 0 y 100';
    END IF;

    INSERT INTO restaurants (name, identification, address, phone, config)
    VALUES (
        trim(p_name), NULLIF(trim(p_identification), ''), NULLIF(trim(p_address), ''), NULLIF(trim(p_phone), ''),
        jsonb_build_object('currency', 'COP', 'service_fee_pct', p_service_fee_pct, 'timezone', 'America/Bogota')
    ) RETURNING id INTO v_id;

    INSERT INTO profiles (id, restaurant_id, full_name, role, status)
    VALUES (p_admin_user_id, v_id, trim(p_admin_name), 'admin', 'active');

    INSERT INTO tables (restaurant_id, table_number, capacity)
    SELECT v_id, g::TEXT, 4 FROM generate_series(1, p_tables_count) AS g;

    INSERT INTO categories (restaurant_id, name, order_index)
    VALUES (v_id, 'Comidas', 1), (v_id, 'Bebidas', 2);

    IF p_created_by IS NOT NULL THEN
        PERFORM _log_audit(v_id, p_created_by, 'restaurant_created', 'restaurant', v_id,
            jsonb_build_object('name', trim(p_name), 'admin_user_id', p_admin_user_id));
    END IF;

    RETURN v_id;
END;
$$;

-- Suspender / reactivar un restaurante (sus usuarios pierden o recuperan el acceso al instante)
CREATE OR REPLACE FUNCTION set_restaurant_status(p_restaurant_id UUID, p_status TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_user UUID;
BEGIN
    v_user := _require_superadmin();
    IF p_status NOT IN ('active', 'suspended') THEN RAISE EXCEPTION 'Estado inválido'; END IF;

    UPDATE restaurants SET status = p_status, updated_at = now()
    WHERE id = p_restaurant_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Restaurante no encontrado'; END IF;

    PERFORM _log_audit(p_restaurant_id, v_user,
        CASE WHEN p_status = 'suspended' THEN 'restaurant_suspended' ELSE 'restaurant_reactivated' END,
        'restaurant', p_restaurant_id, NULL);

    RETURN json_build_object('success', true, 'status', p_status);
END;
$$;


-- ==============================================================================
-- E. PERMISOS DE EJECUCIÓN
-- ==============================================================================
REVOKE ALL ON FUNCTION provision_restaurant(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, INTEGER, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION provision_restaurant(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, INTEGER, UUID)
    TO service_role;

REVOKE ALL ON FUNCTION set_restaurant_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_restaurant_status(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION _require_superadmin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _auth_context(role_type[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_current_user_restaurant() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_current_user_restaurant() TO authenticated;
GRANT EXECUTE ON FUNCTION current_user_role() TO authenticated;
