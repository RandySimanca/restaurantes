-- SEED PARA SUPABASE CLOUD (sin insertar en auth.users directamente)
-- IMPORTANTE: Reemplaza 'UUID-DEL-USUARIO' por el UUID real del usuario
-- que creaste en el Dashboard de Supabase Auth > Users

-- 1. Restaurante
INSERT INTO public.restaurants (id, name, address, phone) 
VALUES ('c0000000-0000-0000-0000-000000000001', 'Restaurante Central', 'Calle 123', '555-0100')
ON CONFLICT (id) DO NOTHING;

-- 2. Perfil del usuario mesero
INSERT INTO public.profiles (id, restaurant_id, full_name, role)
VALUES ('91c2d62c-4378-4868-8a92-8124763007e9', 'c0000000-0000-0000-0000-000000000001', 'Mesero 1', 'waiter')
ON CONFLICT (id) DO NOTHING;

-- 3. Mesas
INSERT INTO public.tables (restaurant_id, table_number, capacity) VALUES 
  ('c0000000-0000-0000-0000-000000000001', '1', 4),
  ('c0000000-0000-0000-0000-000000000001', '2', 2),
  ('c0000000-0000-0000-0000-000000000001', '3', 6),
  ('c0000000-0000-0000-0000-000000000001', '4', 4),
  ('c0000000-0000-0000-0000-000000000001', 'Terraza 1', 2);

-- 4. Categorías
INSERT INTO public.categories (id, restaurant_id, name) VALUES 
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Principales'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'Bebidas')
ON CONFLICT (id) DO NOTHING;

-- 5. Productos
INSERT INTO public.products (restaurant_id, category_id, name, price, description) VALUES 
  ('c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Hamburguesa Doble', 25000, 'Doble carne con queso y tocineta'),
  ('c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Corte de Res (300g)', 45000, 'Acompañado de puré'),
  ('c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'Cerveza Artesanal', 12000, 'Cerveza rubia local'),
  ('c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'Limonada de Coco', 8000, 'Bebida refrescante');
