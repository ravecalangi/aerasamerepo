-- AERA Reseller Applications & Identity Verification Documents
-- Safe, additive migration. Can be run in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.reseller_applications (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null unique,
  -- Section A: Applicant Information
  full_name text not null,
  mobile_number text not null,
  email text not null,
  current_address text not null,
  delivery_address text not null,
  contact_channels text[] not null default '{}',
  contact_channel_other text,
  contact_channel_details text,
  -- Section B: Selling Plans
  currently_selling boolean not null default false,
  existing_shop_name text,
  current_products_sold text,
  selling_channels text[] not null default '{}',
  selling_channel_other text,
  applying_for text not null default 'self' check (applying_for in ('self', 'business')),
  registered_business_name text,
  business_role text,
  business_authorized boolean not null default false,
  -- Section C: Preferred Reseller Tier
  preferred_tier text not null check (preferred_tier in ('tier1', 'tier2', 'tier3', 'assist')),
  initial_order_timing text not null,
  preferred_order_date text,
  interested_products text[] not null default '{}',
  -- Section D: Delivery and Support
  delivery_expectation text not null,
  assistance_needed text[] not null default '{}',
  assistance_other text,
  needs_auth_letter text not null default 'no' check (needs_auth_letter in ('yes', 'no', 'not_sure')),
  auth_letter_platform text,
  additional_notes text,
  -- Section E: Identity Verification, Profile Photo & Consents
  id_submit_later boolean not null default false,
  id_doc_paths jsonb not null default '{}'::jsonb,
  profile_photo_path text,
  consents jsonb not null default '{}'::jsonb,
  printed_name text not null,
  signature_name text not null,
  signed_date text not null,
  electronic_signature_consent boolean not null default false,
  -- Admin Workflow
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_notes text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reseller_applications_status_idx on public.reseller_applications(status);
create index if not exists reseller_applications_created_at_idx on public.reseller_applications(created_at desc);
create index if not exists reseller_applications_email_idx on public.reseller_applications(lower(email));

drop trigger if exists reseller_applications_set_updated_at on public.reseller_applications;
create trigger reseller_applications_set_updated_at
  before update on public.reseller_applications
  for each row execute procedure public.set_updated_at();

alter table public.reseller_applications enable row level security;

drop policy if exists "admin manages reseller applications" on public.reseller_applications;
create policy "admin manages reseller applications" on public.reseller_applications
  for all using (public.is_admin()) with check (public.is_admin());

-- Private Storage Bucket for Reseller IDs & 2x2 Profile Photos (accessed via service role / signed URLs only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reseller-documents',
  'reseller-documents',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

