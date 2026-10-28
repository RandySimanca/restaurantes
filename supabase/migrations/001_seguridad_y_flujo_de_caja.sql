-- ==============================================================================
-- MIGRACIÓN 001: Seguridad (RLS + RPC con auth.uid()) y flujo de caja
-- Ejecutar en: Supabase Dashboard → SQL Editor, DESPUÉS de schema.sql.
-- Es idempotente: se puede correr más de una vez.
--
-- Principios:
--   1. El cliente NUNCA manda su propio user id, restaurant_id ni precios.
--      Todo se deduce de auth.uid() y de la base de datos.
--   2. Las tablas operativas (pedidos, cocina, pagos, caja) solo se LEEN desde
--      el cliente; toda escritura pasa por las funciones RPC de abajo.
--   3. Una sola orden abierta por sesión de mesa; cada envío a cocina es una "ronda".
--   4. El dinero que cobra el mesero solo se registra (payments) cuando
--      caja/admin aprueba la entrega (cash_handovers).
-- ==============================================================================


-- ==============================================================================
-- A. ESQUEMA: tipos, columnas, tablas e índices nuevos
-- ==============================================================================

DO $$ BEGIN CREATE TYPE handover_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sesiones de mesa: se agrega 'waiting_payment' (cuenta pedida) y 'cancelled'
ALTER TABLE table_sessions DROP CONSTRAINT IF EXISTS table_sessions_status_check;
ALTER TABLE table_sessions ADD CONSTRAINT table_sessions_status_check
    CHECK (status IN ('active', 'waiting_payment', 'closed', 'cancelled'));
ALTER TABLE table_sessions ADD COLUMN IF NOT EXISTS bill_requested_at TIMESTAMPTZ;
ALTER TABLE table_sessions ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES profiles(id) ON DELETE RESTRICT;

-- Una mesa no puede tener dos sesiones abiertas (activa o esperando pago)
DROP INDEX IF EXISTS unique_active_table_session;
CREATE UNIQUE INDEX IF NOT EXISTS unique_open_table_session
    ON table_sessions (table_id) WHERE status IN ('active', 'waiting_payment');

-- Una sola orden abierta por sesión de mesa
CREATE UNIQUE INDEX IF NOT EXISTS one_open_order_per_session
    ON orders (table_session_id) WHERE status IN ('pending', 'active');

-- Cada envío a cocina de una misma orden es una ronda
ALTER TABLE kitchen_orders ADD COLUMN IF NOT EXISTS round_number INTEGER NOT NULL DEFAULT 1;

-- Entregas de dinero: el mesero declara lo cobrado, caja aprueba o rechaza
CREATE TABLE IF NOT EXISTS cash_handovers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
    table_session_id UUID NOT NULL REFERENCES table_sessions(id) ON DELETE RESTRICT,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    waiter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    expected_amount DECIMAL(12, 2) NOT NULL,
    declared_amount DECIMAL(12, 2) NOT NULL CHECK (declared_amount > 0),
    difference DECIMAL(12, 2) GENERATED ALWAYS AS (declared_amount - expected_amount) STORED,
    payments JSONB NOT NULL,                 -- [{method, amount, reference}]
    notes TEXT,
    status handover_status NOT NULL DEFAULT 'pending',
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    resolved_by UUID REFERENCES profiles(id) ON DELETE RESTRICT,
    resolved_at TIMESTAMPTZ,
    resolution_note TEXT
);
-- Solo una entrega pendiente o aprobada por sesión (una rechazada permite reintentar)
CREATE UNIQUE INDEX IF NOT EXISTS one_live_handover_per_session
    ON cash_handovers (table_session_id) WHERE status IN ('pending', 'approved');
CREATE INDEX IF NOT EXISTS idx_cash_handovers_queue ON cash_handovers (restaurant_id, status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_queue ON kitchen_orders (restaurant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);

-- Pagos: quién cobró, quién recibió en caja y de qué entrega vienen
ALTER TABLE payments ADD COLUMN IF NOT EXISTS collected_by UUID REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS handover_id UUID REFERENCES cash_handovers(id) ON DELETE RESTRICT;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_amount_positive;
ALTER TABLE payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);

ALTER TABLE cash_handovers ENABLE ROW LEVEL SECURITY;


-- ==============================================================================
-- B. FUNCIONES AUXILIARES
-- ==============================================================================

-- Restaurante del usuario actual. Devuelve NULL si el perfil está inactivo o borrado,
-- así un usuario desactivado pierde acceso a todo vía RLS.
CREATE OR REPLACE FUNCTION get_current_user_restaurant()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT restaurant_id FROM profiles
    WHERE id = auth.uid() AND status = 'active' AND deleted_at IS NULL;
$$;

-- Rol del usuario actual. SECURITY DEFINER para evitar recursión de RLS sobre profiles.
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS role_type LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT role FROM profiles
    WHERE id = auth.uid() AND status = 'active' AND deleted_at IS NULL;
$$;

-- Identifica al llamador y valida que tenga uno de los roles permitidos.
CREATE OR REPLACE FUNCTION _auth_context(
    p_roles role_type[],
    OUT o_user UUID, OUT o_restaurant UUID, OUT o_role role_type
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    SELECT id, restaurant_id, role INTO o_user, o_restaurant, o_role
    FROM profiles
    WHERE id = auth.uid() AND status = 'active' AND deleted_at IS NULL;

    IF o_user IS NULL OR o_restaurant IS NULL OR NOT (o_role = ANY (p_roles)) THEN
        RAISE EXCEPTION 'No autorizado para esta acción' USING ERRCODE = '42501';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION _log_audit(
    p_restaurant UUID, p_user UUID, p_action TEXT, p_entity TEXT, p_entity_id UUID, p_payload JSONB DEFAULT NULL
) RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    INSERT INTO audit_logs (restaurant_id, user_id, action, entity_type, entity_id, payload)
    VALUES (p_restaurant, p_user, p_action, p_entity, p_entity_id, p_payload);
$$;

-- Recalcula subtotal, servicio y total de una orden (ignora items anulados).
-- El % de servicio sale de restaurants.config.service_fee_pct (poner 0 para desactivarlo).
CREATE OR REPLACE FUNCTION _recalc_order(p_order_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_pct NUMERIC;
    v_sub NUMERIC;
    v_fee NUMERIC;
BEGIN
    SELECT COALESCE((r.config->>'service_fee_pct')::NUMERIC, 0) INTO v_pct
    FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
    WHERE o.id = p_order_id;
    v_pct := COALESCE(v_pct, 0);

    SELECT COALESCE(SUM(subtotal), 0) INTO v_sub
    FROM order_items WHERE order_id = p_order_id AND status <> 'voided';

    v_fee := ROUND(v_sub * v_pct / 100.0, 0);

    UPDATE orders
    SET subtotal = v_sub, service_fee = v_fee, total = v_sub + tax + v_fee - discount, updated_at = now()
    WHERE id = p_order_id;
END;
$$;


-- ==============================================================================
-- C. POLÍTICAS RLS
--    Lectura por restaurante. Escritura directa solo para el admin sobre el
--    catálogo (mesas, categorías, productos) y perfiles. Todo lo demás: RPC.
-- ==============================================================================

-- restaurants
DROP POLICY IF EXISTS "Users can view their own restaurant" ON restaurants;
DROP POLICY IF EXISTS restaurants_select ON restaurants;
DROP POLICY IF EXISTS restaurants_admin_update ON restaurants;
CREATE POLICY restaurants_select ON restaurants FOR SELECT
    USING (id = get_current_user_restaurant());
CREATE POLICY restaurants_admin_update ON restaurants FOR UPDATE
    USING (id = get_current_user_restaurant() AND current_user_role() = 'admin')
    WITH CHECK (id = get_current_user_restaurant() AND current_user_role() = 'admin');

-- profiles (siempre puedes leer el tuyo, aunque estés inactivo, para mostrar el aviso)
DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can insert profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can update profiles" ON profiles;
DROP POLICY IF EXISTS profiles_select ON profiles;
DROP POLICY IF EXISTS profiles_admin_update ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT
    USING (id = auth.uid() OR restaurant_id = get_current_user_restaurant());
CREATE POLICY profiles_admin_update ON profiles FOR UPDATE
    USING (restaurant_id = get_current_user_restaurant() AND current_user_role() = 'admin')
    WITH CHECK (restaurant_id = get_current_user_restaurant() AND current_user_role() = 'admin');
-- (Crear usuarios se hace con la edge function create-user, que usa service_role.)

-- Catálogo: tables, categories, products
DROP POLICY IF EXISTS "Users can view tables of their restaurant" ON tables;
DROP POLICY IF EXISTS tables_select ON tables;
DROP POLICY IF EXISTS tables_admin_all ON tables;
CREATE POLICY tables_select ON tables FOR SELECT
    USING (restaurant_id = get_current_user_restaurant());
CREATE POLICY tables_admin_all ON tables FOR ALL
    USING (restaurant_id = get_current_user_restaurant() AND current_user_role() = 'admin')
    WITH CHECK (restaurant_id = get_current_user_restaurant() AND current_user_role() = 'admin');

DROP POLICY IF EXISTS categories_select ON categories;
DROP POLICY IF EXISTS categories_admin_all ON categories;
CREATE POLICY categories_select ON categories FOR SELECT
    USING (restaurant_id = get_current_user_restaurant());
CREATE POLICY categories_admin_all ON categories FOR ALL
    USING (restaurant_id = get_current_user_restaurant() AND current_user_role() = 'admin')
    WITH CHECK (restaurant_id = get_current_user_restaurant() AND current_user_role() = 'admin');

DROP POLICY IF EXISTS "Users can view products of their restaurant" ON products;
DROP POLICY IF EXISTS products_select ON products;
DROP POLICY IF EXISTS products_admin_all ON products;
CREATE POLICY products_select ON products FOR SELECT
    USING (restaurant_id = get_current_user_restaurant());
CREATE POLICY products_admin_all ON products FOR ALL
    USING (restaurant_id = get_current_user_restaurant() AND current_user_role() = 'admin')
    WITH CHECK (restaurant_id = get_current_user_restaurant() AND current_user_role() = 'admin');

-- Operación: solo lectura desde el cliente
DROP POLICY IF EXISTS "Users can view and edit orders of their restaurant" ON orders; -- permitía editar totales
DROP POLICY IF EXISTS orders_select ON orders;
CREATE POLICY orders_select ON orders FOR SELECT
    USING (restaurant_id = get_current_user_restaurant());

DROP POLICY IF EXISTS table_sessions_select ON table_sessions;
CREATE POLICY table_sessions_select ON table_sessions FOR SELECT
    USING (restaurant_id = get_current_user_restaurant());

DROP POLICY IF EXISTS kitchen_orders_select ON kitchen_orders;
CREATE POLICY kitchen_orders_select ON kitchen_orders FOR SELECT
    USING (restaurant_id = get_current_user_restaurant());

DROP POLICY IF EXISTS void_requests_select ON void_requests;
CREATE POLICY void_requests_select ON void_requests FOR SELECT
    USING (restaurant_id = get_current_user_restaurant());

DROP POLICY IF EXISTS order_items_select ON order_items;
CREATE POLICY order_items_select ON order_items FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM orders o
        WHERE o.id = order_items.order_id AND o.restaurant_id = get_current_user_restaurant()
    ));

DROP POLICY IF EXISTS kitchen_order_items_select ON kitchen_order_items;
CREATE POLICY kitchen_order_items_select ON kitchen_order_items FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM kitchen_orders ko
        WHERE ko.id = kitchen_order_items.kitchen_order_id AND ko.restaurant_id = get_current_user_restaurant()
    ));

-- Dinero: pagos solo caja/admin; entregas: caja/admin ven todas, el mesero solo las suyas
DROP POLICY IF EXISTS payments_select ON payments;
CREATE POLICY payments_select ON payments FOR SELECT
    USING (restaurant_id = get_current_user_restaurant() AND current_user_role() IN ('cashier', 'admin'));

DROP POLICY IF EXISTS cash_handovers_select ON cash_handovers;
CREATE POLICY cash_handovers_select ON cash_handovers FOR SELECT
    USING (
        restaurant_id = get_current_user_restaurant()
        AND (current_user_role() IN ('cashier', 'admin') OR waiter_id = auth.uid())
    );

-- Auditoría: solo admin
DROP POLICY IF EXISTS audit_logs_select ON audit_logs;
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT
    USING (restaurant_id = get_current_user_restaurant() AND current_user_role() = 'admin');


-- ==============================================================================
-- D. FUNCIONES RPC (todas usan auth.uid(); ninguna acepta ids de usuario del cliente)
-- ==============================================================================

-- Se eliminan las versiones anteriores, que confiaban en parámetros del cliente
DROP FUNCTION IF EXISTS take_table(UUID, UUID);
DROP FUNCTION IF EXISTS close_table(UUID, UUID);
DROP FUNCTION IF EXISTS send_order(UUID, UUID, UUID, JSONB);
DROP FUNCTION IF EXISTS request_void(UUID, UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS approve_void(UUID, UUID);

-- 1) Mesero toma una mesa libre --------------------------------------------------
CREATE OR REPLACE FUNCTION take_table(p_table_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_ctx RECORD;
    v_table tables%ROWTYPE;
    v_session_id UUID;
BEGIN
    SELECT * INTO v_ctx FROM _auth_context(ARRAY['waiter', 'admin']::role_type[]);

    SELECT * INTO v_table FROM tables
    WHERE id = p_table_id AND restaurant_id = v_ctx.o_restaurant AND deleted_at IS NULL
    FOR UPDATE NOWAIT;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Mesa no encontrada';
    END IF;
    IF v_table.status <> 'available' THEN
        RAISE EXCEPTION 'La mesa ya no está disponible (estado actual: %)', v_table.status;
    END IF;

    UPDATE tables SET status = 'occupied', updated_at = now() WHERE id = p_table_id;

    INSERT INTO table_sessions (restaurant_id, table_id, waiter_id, status)
    VALUES (v_ctx.o_restaurant, p_table_id, v_ctx.o_user, 'active')
    RETURNING id INTO v_session_id;

    RETURN json_build_object('success', true, 'session_id', v_session_id);
EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'La mesa acaba de ser asignada a otro mesero.';
END;
$$;

-- 2) Mesero envía una ronda a cocina ------------------------------------------------
-- p_items: [{ product_id, quantity, notes? }]. El precio y el nombre se leen de products.
CREATE OR REPLACE FUNCTION send_order(p_session_id UUID, p_items JSONB)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_ctx RECORD;
    v_session table_sessions%ROWTYPE;
    v_product products%ROWTYPE;
    v_order_id UUID;
    v_kitchen_id UUID;
    v_item_id UUID;
    v_item JSONB;
    v_qty INTEGER;
    v_round INTEGER;
BEGIN
    SELECT * INTO v_ctx FROM _auth_context(ARRAY['waiter', 'admin']::role_type[]);

    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'El pedido no tiene productos';
    END IF;

    SELECT * INTO v_session FROM table_sessions
    WHERE id = p_session_id AND restaurant_id = v_ctx.o_restaurant
    FOR UPDATE;  -- serializa envíos concurrentes de la misma mesa

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sesión de mesa no encontrada';
    END IF;
    IF v_session.status <> 'active' THEN
        RAISE EXCEPTION 'La mesa ya no acepta pedidos (estado: %)', v_session.status;
    END IF;
    IF v_ctx.o_role <> 'admin' AND v_session.waiter_id <> v_ctx.o_user THEN
        RAISE EXCEPTION 'Esta mesa la atiende otro mesero';
    END IF;

    -- Una sola orden abierta por sesión
    SELECT id INTO v_order_id FROM orders
    WHERE table_session_id = p_session_id AND status IN ('pending', 'active');

    IF v_order_id IS NULL THEN
        INSERT INTO orders (restaurant_id, table_session_id, waiter_id, status)
        VALUES (v_ctx.o_restaurant, p_session_id, v_session.waiter_id, 'active')
        RETURNING id INTO v_order_id;
    END IF;

    SELECT COALESCE(MAX(round_number), 0) + 1 INTO v_round
    FROM kitchen_orders WHERE order_id = v_order_id;

    INSERT INTO kitchen_orders (restaurant_id, order_id, station, round_number)
    VALUES (v_ctx.o_restaurant, v_order_id, 'kitchen', v_round)
    RETURNING id INTO v_kitchen_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_qty := (v_item->>'quantity')::INTEGER;
        IF v_qty IS NULL OR v_qty < 1 OR v_qty > 99 THEN
            RAISE EXCEPTION 'Cantidad inválida';
        END IF;

        SELECT * INTO v_product FROM products
        WHERE id = (v_item->>'product_id')::UUID
          AND restaurant_id = v_ctx.o_restaurant
          AND deleted_at IS NULL AND is_active AND is_available;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Producto no disponible: %', COALESCE(v_item->>'product_name', 'desconocido');
        END IF;

        -- Descuento de stock atómico (sin NOWAIT: dos meseros pueden pedir a la vez)
        IF v_product.stock IS NOT NULL THEN
            UPDATE products SET stock = stock - v_qty, updated_at = now()
            WHERE id = v_product.id AND stock >= v_qty;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Stock insuficiente para %', v_product.name;
            END IF;
        END IF;

        INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, notes, status)
        VALUES (
            v_order_id, v_product.id, v_product.name, v_product.price, v_qty,
            v_product.price * v_qty, NULLIF(trim(v_item->>'notes'), ''), 'sent_to_kitchen'
        )
        RETURNING id INTO v_item_id;

        INSERT INTO kitchen_order_items (kitchen_order_id, order_item_id) VALUES (v_kitchen_id, v_item_id);
    END LOOP;

    PERFORM _recalc_order(v_order_id);

    RETURN json_build_object('success', true, 'order_id', v_order_id, 'kitchen_order_id', v_kitchen_id, 'round', v_round);
END;
$$;

-- 3) Cocina avanza el estado; el mesero marca entregado --------------------------------
CREATE OR REPLACE FUNCTION set_kitchen_status(p_kitchen_order_id UUID, p_status kitchen_order_status)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_ctx RECORD;
    v_ko kitchen_orders%ROWTYPE;
BEGIN
    SELECT * INTO v_ctx FROM _auth_context(ARRAY['kitchen', 'waiter', 'admin']::role_type[]);

    SELECT * INTO v_ko FROM kitchen_orders
    WHERE id = p_kitchen_order_id AND restaurant_id = v_ctx.o_restaurant
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Comanda no encontrada';
    END IF;

    IF p_status IN ('preparing', 'ready') AND v_ctx.o_role NOT IN ('kitchen', 'admin') THEN
        RAISE EXCEPTION 'Solo cocina puede cambiar a este estado' USING ERRCODE = '42501';
    END IF;
    IF p_status = 'delivered' AND v_ctx.o_role NOT IN ('waiter', 'admin') THEN
        RAISE EXCEPTION 'Solo el mesero puede marcar como entregado' USING ERRCODE = '42501';
    END IF;

    IF NOT (
        (v_ko.status = 'pending'   AND p_status = 'preparing') OR
        (v_ko.status = 'preparing' AND p_status = 'ready') OR
        (v_ko.status = 'ready'     AND p_status = 'delivered')
    ) THEN
        RAISE EXCEPTION 'Transición inválida: % → %', v_ko.status, p_status;
    END IF;

    UPDATE kitchen_orders SET status = p_status, updated_at = now() WHERE id = v_ko.id;
    UPDATE kitchen_order_items SET status = p_status WHERE kitchen_order_id = v_ko.id;

    IF p_status = 'delivered' THEN
        UPDATE order_items SET status = 'delivered', updated_at = now()
        WHERE status = 'sent_to_kitchen'
          AND id IN (SELECT order_item_id FROM kitchen_order_items WHERE kitchen_order_id = v_ko.id);
    END IF;

    RETURN json_build_object('success', true, 'status', p_status);
END;
$$;

-- 4) Mesero pide la cuenta (mesa pasa a waiting_payment) ---------------------------------
CREATE OR REPLACE FUNCTION request_bill(p_session_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_ctx RECORD;
    v_session table_sessions%ROWTYPE;
    v_order orders%ROWTYPE;
BEGIN
    SELECT * INTO v_ctx FROM _auth_context(ARRAY['waiter', 'admin']::role_type[]);

    SELECT * INTO v_session FROM table_sessions
    WHERE id = p_session_id AND restaurant_id = v_ctx.o_restaurant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sesión de mesa no encontrada'; END IF;
    IF v_session.status <> 'active' THEN
        RAISE EXCEPTION 'La cuenta ya fue pedida o la mesa está cerrada (estado: %)', v_session.status;
    END IF;
    IF v_ctx.o_role <> 'admin' AND v_session.waiter_id <> v_ctx.o_user THEN
        RAISE EXCEPTION 'Esta mesa la atiende otro mesero';
    END IF;

    SELECT * INTO v_order FROM orders
    WHERE table_session_id = p_session_id AND status IN ('pending', 'active');
    IF NOT FOUND OR v_order.total <= 0 THEN
        RAISE EXCEPTION 'La mesa no tiene consumos para cobrar';
    END IF;

    UPDATE table_sessions SET status = 'waiting_payment', bill_requested_at = now() WHERE id = p_session_id;
    UPDATE tables SET status = 'waiting_payment', updated_at = now() WHERE id = v_session.table_id;

    RETURN json_build_object('success', true, 'order_id', v_order.id, 'total', v_order.total);
END;
$$;

-- 4b) Reabrir mesa si pidieron la cuenta por error (solo si no hay entrega pendiente)
CREATE OR REPLACE FUNCTION reopen_table(p_session_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_ctx RECORD;
    v_session table_sessions%ROWTYPE;
BEGIN
    SELECT * INTO v_ctx FROM _auth_context(ARRAY['waiter', 'admin']::role_type[]);

    SELECT * INTO v_session FROM table_sessions
    WHERE id = p_session_id AND restaurant_id = v_ctx.o_restaurant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sesión de mesa no encontrada'; END IF;
    IF v_session.status <> 'waiting_payment' THEN
        RAISE EXCEPTION 'La mesa no está esperando pago';
    END IF;
    IF v_ctx.o_role <> 'admin' AND v_session.waiter_id <> v_ctx.o_user THEN
        RAISE EXCEPTION 'Esta mesa la atiende otro mesero';
    END IF;
    IF EXISTS (SELECT 1 FROM cash_handovers WHERE table_session_id = p_session_id AND status = 'pending') THEN
        RAISE EXCEPTION 'Hay una entrega de dinero pendiente en caja para esta mesa';
    END IF;

    UPDATE table_sessions SET status = 'active', bill_requested_at = NULL WHERE id = p_session_id;
    UPDATE tables SET status = 'occupied', updated_at = now() WHERE id = v_session.table_id;

    RETURN json_build_object('success', true);
END;
$$;

-- 5) Mesero declara el dinero cobrado y lo entrega a caja ----------------------------------
-- p_payments: [{ method: 'cash'|'card'|'transfer'|'nequi'|'daviplata'|'other', amount, reference? }]
CREATE OR REPLACE FUNCTION submit_handover(p_session_id UUID, p_payments JSONB, p_notes TEXT DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_ctx RECORD;
    v_session table_sessions%ROWTYPE;
    v_order orders%ROWTYPE;
    v_methods TEXT[] := ARRAY(SELECT unnest(enum_range(NULL::payment_method))::TEXT);
    v_p JSONB;
    v_method TEXT;
    v_amount NUMERIC;
    v_clean JSONB := '[]'::JSONB;
    v_declared NUMERIC := 0;
    v_handover_id UUID;
BEGIN
    SELECT * INTO v_ctx FROM _auth_context(ARRAY['waiter', 'admin']::role_type[]);

    SELECT * INTO v_session FROM table_sessions
    WHERE id = p_session_id AND restaurant_id = v_ctx.o_restaurant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sesión de mesa no encontrada'; END IF;
    IF v_session.status <> 'waiting_payment' THEN
        RAISE EXCEPTION 'Primero debes pedir la cuenta de la mesa';
    END IF;
    IF v_ctx.o_role <> 'admin' AND v_session.waiter_id <> v_ctx.o_user THEN
        RAISE EXCEPTION 'Esta mesa la atiende otro mesero';
    END IF;

    SELECT * INTO v_order FROM orders
    WHERE table_session_id = p_session_id AND status IN ('pending', 'active');
    IF NOT FOUND THEN RAISE EXCEPTION 'La mesa no tiene orden abierta'; END IF;

    IF EXISTS (SELECT 1 FROM cash_handovers WHERE table_session_id = p_session_id AND status IN ('pending', 'approved')) THEN
        RAISE EXCEPTION 'Esta mesa ya tiene una entrega pendiente o aprobada';
    END IF;

    IF p_payments IS NULL OR jsonb_typeof(p_payments) <> 'array' OR jsonb_array_length(p_payments) = 0 THEN
        RAISE EXCEPTION 'Debes indicar al menos un pago';
    END IF;

    FOR v_p IN SELECT * FROM jsonb_array_elements(p_payments)
    LOOP
        v_method := v_p->>'method';
        v_amount := (v_p->>'amount')::NUMERIC;
        IF v_method IS NULL OR NOT (v_method = ANY (v_methods)) THEN
            RAISE EXCEPTION 'Método de pago inválido: %', COALESCE(v_method, 'vacío');
        END IF;
        IF v_amount IS NULL OR v_amount <= 0 THEN
            RAISE EXCEPTION 'Monto inválido';
        END IF;
        v_declared := v_declared + v_amount;
        v_clean := v_clean || jsonb_build_array(jsonb_build_object(
            'method', v_method, 'amount', v_amount, 'reference', NULLIF(trim(v_p->>'reference'), '')
        ));
    END LOOP;

    INSERT INTO cash_handovers (
        restaurant_id, table_session_id, order_id, waiter_id,
        expected_amount, declared_amount, payments, notes
    ) VALUES (
        v_ctx.o_restaurant, p_session_id, v_order.id, v_session.waiter_id,
        v_order.total, v_declared, v_clean, NULLIF(trim(p_notes), '')
    ) RETURNING id INTO v_handover_id;

    PERFORM _log_audit(v_ctx.o_restaurant, v_ctx.o_user, 'handover_submitted', 'cash_handover', v_handover_id,
        jsonb_build_object('expected', v_order.total, 'declared', v_declared));

    RETURN json_build_object(
        'success', true, 'handover_id', v_handover_id,
        'expected', v_order.total, 'declared', v_declared, 'difference', v_declared - v_order.total
    );
END;
$$;

-- 6) Caja aprueba o rechaza la entrega --------------------------------------------------
-- Aprobar: crea los payments, completa la orden, cierra la sesión y libera la mesa (todo atómico).
-- Control interno: no se puede aprobar la propia entrega, y si hay diferencia el motivo es obligatorio.
CREATE OR REPLACE FUNCTION resolve_handover(p_handover_id UUID, p_approve BOOLEAN, p_note TEXT DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_ctx RECORD;
    v_h cash_handovers%ROWTYPE;
    v_session table_sessions%ROWTYPE;
    v_note TEXT := NULLIF(trim(p_note), '');
BEGIN
    SELECT * INTO v_ctx FROM _auth_context(ARRAY['cashier', 'admin']::role_type[]);

    SELECT * INTO v_h FROM cash_handovers
    WHERE id = p_handover_id AND restaurant_id = v_ctx.o_restaurant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Entrega no encontrada'; END IF;
    IF v_h.status <> 'pending' THEN RAISE EXCEPTION 'Esta entrega ya fue procesada'; END IF;
    IF v_h.waiter_id = v_ctx.o_user THEN
        RAISE EXCEPTION 'No puedes aprobar o rechazar una entrega que tú mismo hiciste';
    END IF;

    IF NOT p_approve THEN
        IF v_note IS NULL THEN RAISE EXCEPTION 'Indica el motivo del rechazo'; END IF;

        UPDATE cash_handovers
        SET status = 'rejected', resolved_by = v_ctx.o_user, resolved_at = now(), resolution_note = v_note
        WHERE id = v_h.id;

        PERFORM _log_audit(v_ctx.o_restaurant, v_ctx.o_user, 'handover_rejected', 'cash_handover', v_h.id,
            jsonb_build_object('reason', v_note, 'expected', v_h.expected_amount, 'declared', v_h.declared_amount));

        RETURN json_build_object('success', true, 'status', 'rejected');
    END IF;

    IF v_h.difference <> 0 AND v_note IS NULL THEN
        RAISE EXCEPTION 'Hay una diferencia de % entre lo esperado y lo entregado; indica el motivo', v_h.difference;
    END IF;

    INSERT INTO payments (restaurant_id, order_id, amount, payment_method, received_by, collected_by, handover_id, reference)
    SELECT v_h.restaurant_id, v_h.order_id, x.amount, x.method::payment_method,
           v_ctx.o_user, v_h.waiter_id, v_h.id, x.reference
    FROM jsonb_to_recordset(v_h.payments) AS x(method TEXT, amount NUMERIC, reference TEXT);

    SELECT * INTO v_session FROM table_sessions WHERE id = v_h.table_session_id FOR UPDATE;

    UPDATE orders SET status = 'completed', updated_at = now() WHERE id = v_h.order_id;
    UPDATE order_items SET status = 'delivered', updated_at = now()
    WHERE order_id = v_h.order_id AND status = 'sent_to_kitchen';

    UPDATE table_sessions SET status = 'closed', ended_at = now(), closed_by = v_ctx.o_user WHERE id = v_session.id;
    UPDATE tables SET status = 'available', updated_at = now() WHERE id = v_session.table_id;

    UPDATE cash_handovers
    SET status = 'approved', resolved_by = v_ctx.o_user, resolved_at = now(), resolution_note = v_note
    WHERE id = v_h.id;

    PERFORM _log_audit(v_ctx.o_restaurant, v_ctx.o_user, 'handover_approved', 'cash_handover', v_h.id,
        jsonb_build_object('expected', v_h.expected_amount, 'declared', v_h.declared_amount,
                           'difference', v_h.difference, 'note', v_note));

    RETURN json_build_object('success', true, 'status', 'approved', 'difference', v_h.difference);
END;
$$;

-- 7) Anulaciones: mesero solicita, caja/admin resuelve -----------------------------------
CREATE OR REPLACE FUNCTION request_void(p_order_item_id UUID, p_reason TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_ctx RECORD;
    v_item order_items%ROWTYPE;
    v_order orders%ROWTYPE;
BEGIN
    SELECT * INTO v_ctx FROM _auth_context(ARRAY['waiter', 'admin']::role_type[]);

    IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Indica el motivo de la anulación'; END IF;

    SELECT * INTO v_item FROM order_items WHERE id = p_order_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item no encontrado'; END IF;

    SELECT * INTO v_order FROM orders WHERE id = v_item.order_id AND restaurant_id = v_ctx.o_restaurant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item no encontrado'; END IF;
    IF v_order.status <> 'active' THEN RAISE EXCEPTION 'La orden ya no está abierta'; END IF;
    IF v_item.status = 'voided' THEN RAISE EXCEPTION 'El item ya está anulado'; END IF;
    IF EXISTS (SELECT 1 FROM void_requests WHERE order_item_id = p_order_item_id AND status = 'pending') THEN
        RAISE EXCEPTION 'Ya hay una solicitud de anulación pendiente para este item';
    END IF;

    INSERT INTO void_requests (restaurant_id, order_item_id, requested_by, reason)
    VALUES (v_ctx.o_restaurant, p_order_item_id, v_ctx.o_user, trim(p_reason));

    RETURN json_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION resolve_void(p_void_request_id UUID, p_approve BOOLEAN)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_ctx RECORD;
    v_req void_requests%ROWTYPE;
    v_item order_items%ROWTYPE;
BEGIN
    SELECT * INTO v_ctx FROM _auth_context(ARRAY['cashier', 'admin']::role_type[]);

    SELECT * INTO v_req FROM void_requests
    WHERE id = p_void_request_id AND restaurant_id = v_ctx.o_restaurant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
    IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'La solicitud ya fue procesada'; END IF;

    UPDATE void_requests
    SET status = CASE WHEN p_approve THEN 'approved'::void_request_status ELSE 'rejected'::void_request_status END,
        resolved_by = v_ctx.o_user, resolved_at = now()
    WHERE id = v_req.id;

    IF p_approve THEN
        SELECT * INTO v_item FROM order_items WHERE id = v_req.order_item_id FOR UPDATE;
        IF v_item.status <> 'voided' THEN
            UPDATE order_items SET status = 'voided', updated_at = now() WHERE id = v_item.id;
            UPDATE kitchen_order_items SET status = 'cancelled' WHERE order_item_id = v_item.id;
            UPDATE products SET stock = stock + v_item.quantity, updated_at = now()
            WHERE id = v_item.product_id AND stock IS NOT NULL;
            PERFORM _recalc_order(v_item.order_id);
        END IF;
    END IF;

    PERFORM _log_audit(v_ctx.o_restaurant, v_ctx.o_user,
        CASE WHEN p_approve THEN 'void_approved' ELSE 'void_rejected' END,
        'void_request', v_req.id, jsonb_build_object('order_item_id', v_req.order_item_id, 'reason', v_req.reason));

    RETURN json_build_object('success', true);
END;
$$;

-- 8) Admin: cancelar/forzar cierre de una mesa (reemplaza al antiguo close_table, que cualquiera podía llamar)
CREATE OR REPLACE FUNCTION force_close_table(p_session_id UUID, p_reason TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_ctx RECORD;
    v_session table_sessions%ROWTYPE;
    v_reason TEXT := NULLIF(trim(p_reason), '');
BEGIN
    SELECT * INTO v_ctx FROM _auth_context(ARRAY['admin']::role_type[]);
    IF v_reason IS NULL THEN RAISE EXCEPTION 'Indica el motivo'; END IF;

    SELECT * INTO v_session FROM table_sessions
    WHERE id = p_session_id AND restaurant_id = v_ctx.o_restaurant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sesión de mesa no encontrada'; END IF;
    IF v_session.status IN ('closed', 'cancelled') THEN RAISE EXCEPTION 'La sesión ya está cerrada'; END IF;

    UPDATE cash_handovers
    SET status = 'rejected', resolved_by = v_ctx.o_user, resolved_at = now(),
        resolution_note = 'Mesa cancelada por admin: ' || v_reason
    WHERE table_session_id = p_session_id AND status = 'pending';

    UPDATE orders SET status = 'cancelled', updated_at = now()
    WHERE table_session_id = p_session_id AND status IN ('pending', 'active');

    UPDATE table_sessions SET status = 'cancelled', ended_at = now(), closed_by = v_ctx.o_user WHERE id = p_session_id;
    UPDATE tables SET status = 'available', updated_at = now() WHERE id = v_session.table_id;

    PERFORM _log_audit(v_ctx.o_restaurant, v_ctx.o_user, 'table_force_closed', 'table_session', p_session_id,
        jsonb_build_object('reason', v_reason));

    RETURN json_build_object('success', true);
END;
$$;


-- ==============================================================================
-- E. PERMISOS DE EJECUCIÓN
--    Supabase da EXECUTE a anon por defecto: se revoca. Solo usuarios autenticados.
-- ==============================================================================
DO $$
DECLARE f RECORD;
BEGIN
    FOR f IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname IN (
            'take_table', 'send_order', 'set_kitchen_status', 'request_bill', 'reopen_table',
            'submit_handover', 'resolve_handover', 'request_void', 'resolve_void', 'force_close_table',
            'get_current_user_restaurant', 'current_user_role'
        )
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    END LOOP;

    -- Auxiliares internas: nadie del cliente las llama (las usan las RPC como owner)
    FOR f IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname IN ('_auth_context', '_log_audit', '_recalc_order')
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    END LOOP;
END $$;


-- ==============================================================================
-- F. REALTIME
-- ==============================================================================
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['orders', 'cash_handovers', 'kitchen_orders', 'void_requests', 'tables', 'table_sessions']
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;
