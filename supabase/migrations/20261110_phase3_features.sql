-- AERA Phase 3: Reviews, Multi-Image Gallery, GGX Shipping Zones, 12% VAT, Newsletter Image & Contact Inquiries
-- Safe, additive migration. Can be run in Supabase SQL Editor.

create extension if not exists pgcrypto;

-- 1. REVIEWS TABLE
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id text, -- product id or slug if linked to a product
  product_name text,
  customer_name text not null,
  customer_email text not null,
  rating integer not null check (rating >= 1 and rating <= 5),
  review_title text,
  review_content text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create index if not exists reviews_product_id_idx on public.reviews(product_id);
create index if not exists reviews_status_idx on public.reviews(status);
create index if not exists reviews_is_visible_idx on public.reviews(is_visible);
create index if not exists reviews_created_at_idx on public.reviews(created_at desc);

drop trigger if exists reviews_set_updated_at on public.reviews;
create trigger reviews_set_updated_at before update on public.reviews for each row execute procedure public.set_updated_at();

alter table public.reviews enable row level security;

-- Public can view approved and visible reviews
drop policy if exists "public reads approved reviews" on public.reviews;
create policy "public reads approved reviews" on public.reviews
  for select using (status = 'approved' and is_visible = true);

-- Public visitors can submit reviews (defaults to pending moderation)
drop policy if exists "public submits reviews" on public.reviews;
create policy "public submits reviews" on public.reviews
  for insert with check (status = 'pending' and is_visible = true);

-- Admin has full access to all reviews
drop policy if exists "admin manages reviews" on public.reviews;
create policy "admin manages reviews" on public.reviews
  for all using (public.is_admin()) with check (public.is_admin());

-- Seed sample initial customer reviews if table is empty
insert into public.reviews (customer_name, customer_email, product_name, rating, review_title, review_content, status, is_visible, created_at)
select 'Maria Santos', 'maria.santos@example.com', 'No Fixed Plans Hair & Body Mist', 5, 'Everyday Scent', 'No Fixed Plans is my new everyday scent. It''s soft, clean and it actually lasts through the whole day. I spray it on my hair before heading out and keep getting compliments.', 'approved', true, now() - interval '14 days'
where not exists (select 1 from public.reviews limit 1);

insert into public.reviews (customer_name, customer_email, product_name, rating, review_title, review_content, status, is_visible, created_at)
select 'Kyla Reyes', 'kyla.reyes@example.com', 'Second Skin Body Serum', 5, 'Lightweight & Nourishing', 'The Second Skin Body Serum is so lightweight. It sinks in within seconds, no sticky feeling, and my skin stays soft the whole day even in this humid weather.', 'approved', true, now() - interval '9 days'
where not exists (select 1 from public.reviews offset 1 limit 1);

insert into public.reviews (customer_name, customer_email, product_name, rating, review_title, review_content, status, is_visible, created_at)
select 'Jasmine Cruz', 'jasmine.cruz@example.com', 'White Shirt Hair & Body Mist', 5, 'Fresh & Calming', 'White Shirt smells like fresh laundry and a clean morning. Super comforting and not overpowering. I also tried the Tea Tree Soap and it''s gentle on my skin.', 'approved', true, now() - interval '4 days'
where not exists (select 1 from public.reviews offset 2 limit 1);

-- 2. PRODUCTS EXTENSIONS (Multi-images, discounts)
alter table public.products add column if not exists images text[] default '{}';
alter table public.products add column if not exists discount numeric(5,2) default 0;
alter table public.products add column if not exists discount_type text default 'percentage' check (discount_type in ('percentage', 'fixed'));
alter table public.products add column if not exists discount_start timestamptz;
alter table public.products add column if not exists discount_end timestamptz;

-- 3. ORDERS EXTENSIONS (VAT)
alter table public.orders add column if not exists vat_rate numeric(5,2) not null default 12;
alter table public.orders add column if not exists vat_amount numeric(12,2) not null default 0;

-- 4. SHIPPING ZONES TABLE
create table if not exists public.shipping_zones (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  rate numeric(10,2) not null check (rate >= 0),
  cities text[] not null default '{}',
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists shipping_zones_set_updated_at on public.shipping_zones;
create trigger shipping_zones_set_updated_at before update on public.shipping_zones for each row execute procedure public.set_updated_at();

alter table public.shipping_zones enable row level security;

drop policy if exists "public reads active shipping zones" on public.shipping_zones;
create policy "public reads active shipping zones" on public.shipping_zones
  for select using (is_active = true);

drop policy if exists "admin manages shipping zones" on public.shipping_zones;
create policy "admin manages shipping zones" on public.shipping_zones
  for all using (public.is_admin()) with check (public.is_admin());

-- Seed GGX LuzViMin Zones
insert into public.shipping_zones (code, name, rate, cities, description, sort_order) values
('mm', 'Metro Manila', 80.00,
  array['Caloocan', 'Las Piñas', 'Makati', 'Malabon', 'Mandaluyong', 'Manila', 'Marikina', 'Muntinlupa', 'Navotas', 'Parañaque', 'Pasay', 'Pasig', 'Quezon City', 'San Juan', 'Taguig', 'Valenzuela', 'Pateros'],
  'All Metro Manila cities', 10),
('cavite', 'Cavite (GMM)', 150.00,
  array['Bacoor City', 'Dasmariñas City', 'General Trias City', 'Imus City', 'Tanza', 'Trece Martires City'],
  'Covered GMM Cavite cities & municipalities', 20),
('rizal', 'Rizal (GMM)', 150.00,
  array['Antipolo City', 'Cainta', 'San Mateo', 'Taytay', 'Taytay City', 'Binangonan', 'Rodriguez'],
  'Covered GMM Rizal cities & municipalities', 30),
('bulacan', 'Bulacan (GMM)', 150.00,
  array['Balagtas', 'Baliuag City', 'Bulacan', 'Guiguinto', 'Malolos City', 'Plaridel', 'Pulilan'],
  'Covered GMM Bulacan cities & municipalities', 40),
('luzon', 'Luzon (Outside GMM)', 150.00,
  array[]::text[],
  'All other provinces and cities in Luzon', 50),
('visayas', 'Visayas', 180.00,
  array[]::text[],
  'All provinces and island groups in Visayas', 60),
('mindanao', 'Mindanao', 200.00,
  array[]::text[],
  'All provinces and island groups in Mindanao', 70)
on conflict (code) do update set
  rate = excluded.rate,
  cities = excluded.cities,
  name = excluded.name,
  description = excluded.description;

-- 5. CONTACT INQUIRIES TABLE
create table if not exists public.contact_inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  subject text not null default 'General Inquiry',
  message text not null,
  email_sent boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.contact_inquiries enable row level security;

drop policy if exists "public inserts contact inquiries" on public.contact_inquiries;
create policy "public inserts contact inquiries" on public.contact_inquiries
  for insert with check (true);

drop policy if exists "admin manages contact inquiries" on public.contact_inquiries;
create policy "admin manages contact inquiries" on public.contact_inquiries
  for all using (public.is_admin()) with check (public.is_admin());

-- 6. NEWSLETTER CAMPAIGNS TABLE
create table if not exists public.newsletter_campaigns (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  preheader text,
  title text,
  message text,
  image_url text,
  image_caption text,
  cta_label text,
  cta_url text,
  recipients_count integer not null default 0,
  sent_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz not null default now()
);

alter table public.newsletter_campaigns enable row level security;

drop policy if exists "admin manages newsletter campaigns" on public.newsletter_campaigns;
create policy "admin manages newsletter campaigns" on public.newsletter_campaigns
  for all using (public.is_admin()) with check (public.is_admin());

-- 7. SETTINGS IN SITE_CONTENT
insert into public.site_content(key, value, updated_at) values
  ('reviews_enabled', 'true', now()),
  ('vat_enabled', 'true', now()),
  ('vat_rate', '12', now()),
  ('vat_mode', 'inclusive', now()),
  ('shipping_origin', 'Greater Metro Manila', now()),
  ('shipping_free_over', '0', now())
on conflict (key) do nothing;

