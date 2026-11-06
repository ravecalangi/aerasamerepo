-- AERA Phase 2 commerce schema. Apply with `supabase db push` or in the
-- Supabase SQL editor before deploying the Edge Function.
-- Do not expose service_role credentials in the website.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'reseller' check (role in ('admin', 'reseller')),
  full_name text not null default '',
  business_name text,
  contact_number text,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reseller_balances (
  reseller_id uuid primary key references public.profiles(id) on delete cascade,
  balance numeric(12,2) not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.reseller_balance_transactions (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references public.profiles(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('credit', 'debit', 'adjustment')),
  amount numeric(12,2) not null check (amount > 0),
  description text not null default '',
  balance_after numeric(12,2) not null check (balance_after >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Existing installations can retain their orders table. These additive columns
-- make guest tracking and status history safe without changing existing data.
alter table public.orders add column if not exists tracking_token_hash text;
alter table public.orders add column if not exists status_updated_at timestamptz not null default now();
alter table public.orders add column if not exists created_at timestamptz not null default now();
alter table public.orders add column if not exists updated_at timestamptz not null default now();
alter table public.orders add column if not exists status text not null default 'order_received';
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('order_received', 'processing', 'packed', 'shipped', 'delivered', 'cancelled', 'pending', 'confirmed'));
create unique index if not exists orders_order_number_unique on public.orders(order_number);

create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null check (status in ('order_received', 'processing', 'packed', 'shipped', 'delivered', 'cancelled', 'pending', 'confirmed')),
  note text,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  status text not null default 'subscribed' check (status in ('subscribed', 'unsubscribed')),
  brevo_contact_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email)
);

-- The homepage reads these through the existing public `site_content` table.
insert into public.site_content(key, value, updated_at) values
  ('swirl_mart_title', 'A little ritual, made for every day.'::text, now()),
  ('swirl_mart_supporting_text', 'Small moments of care, made beautifully simple.'::text, now()),
  ('swirl_mart_cta_text', 'Explore the collection'::text, now()),
  ('swirl_mart_cta_link', 'shop.html'::text, now()),
  ('theme_primary', '#384168'::text, now()),
  ('theme_deep', '#2a3152'::text, now()),
  ('theme_background', '#f0ede8'::text, now())
on conflict (key) do nothing;

insert into public.blogs (title, slug, excerpt, category, author, featured_image_url, content, status, published_at, featured) values
('The Five-Minute Morning Reset', 'five-minute-morning-reset', 'A soft, simple way to begin the day with scent, water, and a little room to breathe.', 'Self-care', 'AERA Editorial', 'https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=1400&q=80', '<p>A ritual does not need to be elaborate to matter. Start with a glass of water, a favorite scent, and five unhurried minutes before the day begins.</p><h2>Keep it close</h2><p>Place the things that help you reset where you can see them. The easier a ritual is to begin, the more likely it is to become yours.</p>', 'published', now() - interval '2 days', true),
('How to Layer Scent Without Overthinking It', 'how-to-layer-scent', 'A practical guide to building a fragrance ritual that feels like you.', 'Fragrance', 'AERA Editorial', 'https://images.unsplash.com/photo-1594035910387-fea47794261f?auto=format&fit=crop&w=1400&q=80', '<p>Think of fragrance as atmosphere, not a rulebook. Begin with clean skin, choose one note you love, then leave space for it to settle.</p><h2>Start light</h2><p>A body mist is an easy first layer: close to the skin, easy to refresh, and made for ordinary days.</p>', 'published', now() - interval '6 days', false),
('A Sunday Body-Care Ritual for Slower Evenings', 'sunday-body-care-ritual', 'Turn a familiar shower into a small end-of-week reset.', 'Body care', 'AERA Editorial', 'https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?auto=format&fit=crop&w=1400&q=80', '<p>Sunday evenings are a good reminder that care can be ordinary. Choose a soap you enjoy, take your time, and finish with a body serum while skin is still slightly damp.</p>', 'published', now() - interval '12 days', false),
('The Art of Leaving a Little Space', 'the-art-of-leaving-a-little-space', 'Why a calmer routine can make a day feel more intentional.', 'Lifestyle', 'AERA Editorial', 'https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?auto=format&fit=crop&w=1400&q=80', '<p>Not every moment needs to be filled. A quiet walk, a fresh shirt, or a familiar scent can create a useful pause between one part of the day and the next.</p>', 'published', now() - interval '18 days', false)
on conflict (slug) do nothing;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active);
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
drop trigger if exists newsletter_subscribers_set_updated_at on public.newsletter_subscribers;
create trigger newsletter_subscribers_set_updated_at before update on public.newsletter_subscribers for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.reseller_balances enable row level security;
alter table public.reseller_balance_transactions enable row level security;
alter table public.order_status_history enable row level security;
alter table public.newsletter_subscribers enable row level security;

drop policy if exists "reseller reads own profile" on public.profiles;
create policy "reseller reads own profile" on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists "admin manages profiles" on public.profiles;
create policy "admin manages profiles" on public.profiles for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "reseller reads own balance" on public.reseller_balances;
create policy "reseller reads own balance" on public.reseller_balances for select using (reseller_id = auth.uid() or public.is_admin());
drop policy if exists "admin manages balances" on public.reseller_balances;
create policy "admin manages balances" on public.reseller_balances for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "reseller reads own balance history" on public.reseller_balance_transactions;
create policy "reseller reads own balance history" on public.reseller_balance_transactions for select using (reseller_id = auth.uid() or public.is_admin());
drop policy if exists "admin manages balance history" on public.reseller_balance_transactions;
create policy "admin manages balance history" on public.reseller_balance_transactions for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin reads status history" on public.order_status_history;
create policy "admin reads status history" on public.order_status_history for select using (public.is_admin());
drop policy if exists "admin manages newsletter subscribers" on public.newsletter_subscribers;
create policy "admin manages newsletter subscribers" on public.newsletter_subscribers for all using (public.is_admin()) with check (public.is_admin());

-- Public clients must no longer read/write orders directly. The Edge Function
-- uses service_role and applies email+token verification for tracking.
alter table public.orders enable row level security;
drop policy if exists "public order insert" on public.orders;
drop policy if exists "public order select" on public.orders;
drop policy if exists "admin all orders" on public.orders;
create policy "admin all orders" on public.orders for all using (public.is_admin()) with check (public.is_admin());
