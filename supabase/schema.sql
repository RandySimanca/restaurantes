-- ==============================================================================
-- RESTAURANT SAAS - DATABASE SCHEMA
-- ==============================================================================

-- 1. ENUMS (idempotentes: no fallan si ya existen)
DO $$ BEGIN CREATE TYPE role_type AS ENUM ('admin', 'waiter', 'kitchen', 'cashier'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE table_status AS ENUM ('available', 'occupied', 'waiting_payment', 'reserved'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE order_type AS ENUM ('dine_in', 'takeaway', 'delivery'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE order_status AS ENUM ('pending', 'active', 'completed', 'cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE order_item_status AS ENUM ('pending', 'sent_to_kitchen', 'delivered', 'voided'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE kitchen_order_status AS ENUM ('pending', 'preparing', 'ready', 'delivered', 'cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE void_request_status AS ENUM ('pending', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE payment_method AS ENUM ('cash', 'card', 'transfer', 'nequi', 'daviplata', 'other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. TABLES

-- Restaurants
CREATE TABLE IF NOT EXISTS restaurants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    identification TEXT,
    address TEXT,
    phone TEXT,
    logo_url TEXT,
    config JSONB DEFAULT '{"currency": "COP", "service_fee_pct": 10, "timezone": "America/Bogota"}'::jsonb,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Profiles
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE RESTRICT,
    full_name TEXT NOT NULL,
    phone TEXT,
    role role_type NOT NULL DEFAULT 'waiter',
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Tables (Physical tables in the restaurant)
CREATE TABLE IF NOT EXISTS tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
    table_number TEXT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 2,
    status table_status NOT NULL DEFAULT 'available',
    pos_x INTEGER,
    pos_y INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Table Sessions (History of visits)
CREATE TABLE IF NOT EXISTS table_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
    table_id UUID NOT NULL REFERENCES tables(id) ON DELETE RESTRICT,
    waiter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
    ended_at TIMESTAMP WITH TIME ZONE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed'))
);
-- CRITICAL CONCURRENCY SAFEGUARD
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_table_session ON table_sessions (table_id) WHERE status = 'active';

-- Categories
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Products
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    description TEXT,
    price DECIMAL(12, 2) NOT NULL DEFAULT 0,
    image_url TEXT,
    stock INTEGER DEFAULT NULL, -- NULL means unlimited
    is_active BOOLEAN DEFAULT true,
    is_available BOOLEAN DEFAULT true,
    prep_station TEXT DEFAULT 'kitchen',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
    table_session_id UUID REFERENCES table_sessions(id) ON DELETE RESTRICT,
    order_type order_type NOT NULL DEFAULT 'dine_in',
    waiter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    status order_status NOT NULL DEFAULT 'pending',
    subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0,
    tax DECIMAL(12, 2) NOT NULL DEFAULT 0,
    service_fee DECIMAL(12, 2) NOT NULL DEFAULT 0,
    discount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    total DECIMAL(12, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- Order Items
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    product_name TEXT NOT NULL,
    unit_price DECIMAL(12, 2) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    subtotal DECIMAL(12, 2) NOT NULL,
    notes TEXT,
    status order_item_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- Kitchen Orders
CREATE TABLE IF NOT EXISTS kitchen_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    station TEXT NOT NULL DEFAULT 'kitchen',
    status kitchen_order_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- Kitchen Order Items
CREATE TABLE IF NOT EXISTS kitchen_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kitchen_order_id UUID NOT NULL REFERENCES kitchen_orders(id) ON DELETE CASCADE,
    order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    status kitchen_order_status NOT NULL DEFAULT 'pending'
);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    amount DECIMAL(12, 2) NOT NULL,
    payment_method payment_method NOT NULL,
    received_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    reference TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- Void Requests
CREATE TABLE IF NOT EXISTS void_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
    order_item_id UUID REFERENCES order_items(id) ON DELETE CASCADE,
    requested_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL,
    status void_request_status NOT NULL DEFAULT 'pending',
    resolved_by UUID REFERENCES profiles(id) ON DELETE RESTRICT,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);


-- ==============================================================================
-- 3. RLS (Row Level Security)
-- ==============================================================================
-- Note: Assuming auth.jwt() will contain "restaurant_id" and "role" claims.

ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitchen_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitchen_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE void_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- NOTA: las políticas RLS, las funciones auxiliares y las funciones RPC
-- (take_table, send_order, request_bill, submit_handover, resolve_handover, ...)
-- viven en supabase/migrations/001_seguridad_y_flujo_de_caja.sql.
-- Ejecuta ese archivo DESPUÉS de este. Las versiones antiguas que estaban aquí
-- confiaban en ids enviados por el cliente y se eliminaron a propósito.


-- ==============================================================================
-- 5. REALTIME ENABLES (idempotentes)
-- ==============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'tables'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tables;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'table_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE table_sessions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'kitchen_orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE kitchen_orders;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'void_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE void_requests;
  END IF;
END $$;
