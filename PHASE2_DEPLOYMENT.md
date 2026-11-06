# Phase 2 deployment

This repository is a static GitHub Pages site. GitHub Pages cannot keep secrets or send trusted email, so the Phase 2 server work is implemented as a Supabase Edge Function.

## Deploy

1. Install and authenticate the Supabase CLI, then link it to the existing project.
2. Apply [`supabase/migrations/20261106_phase2_commerce.sql`](supabase/migrations/20261106_phase2_commerce.sql).
3. Make the `receipts` bucket private. Only the service-role Edge Function should upload receipts; admin access should use signed URLs.
4. Set Edge Function secrets from [`supabase/functions/aera-api/.env.example`](supabase/functions/aera-api/.env.example). Do not upload either `.env.example` file as a real secret file.
5. Deploy with `supabase functions deploy aera-api --no-verify-jwt`. The function checks JWTs itself only for reseller/admin actions; guest checkout, tracking, contact, and newsletter subscription are intentionally anonymous routes.
6. Brevo is optional for now. If `BREVO_API_KEY` and `BREVO_LIST_ID` are absent, orders still complete, newsletter subscribers are stored in Supabase, and contact submissions return a temporary email-disabled message.
7. Add or activate the admin profile for the existing AERA admin Auth user. Run this in the Supabase SQL Editor; it looks up the Auth UUID by email so no placeholder UUID is needed:
   ```sql
   update public.profiles
   set role = 'admin',
       is_active = true,
       full_name = 'AERA Admin'
   where id = (
     select id
     from auth.users
     where lower(email) = lower('contactaeraofficial@gmail.com')
   );
   ```
   If the update affects zero rows, create the profile first using the Auth user's UUID from the Supabase Authentication users page.

The admin login email must belong to that Auth user, and its `profiles` row must have `role = 'admin'` and `is_active = true`. If the dashboard says `Forbidden`, the login is valid but the account is not an active admin. If it says `Unauthorized`, sign out and sign in again; a stale browser session is cleared automatically.

If the dashboard shows `Backend is not deployed`, the function has not been deployed to the configured Supabase project. From the repository root, run:

```powershell
npx supabase login
npx supabase link --project-ref vhyveinrqamzycixhjsu
npx supabase db push --remote --yes
npx supabase functions deploy aera-api --no-verify-jwt --yes
```

## What is now server-side

- Guest order creation, order IDs, confirmation email, and receipt upload
- Guest tracking by order ID plus checkout email
- Newsletter subscriber creation in Brevo
- Contact-form delivery through Brevo
- Reseller profile/balance data protected by Supabase Auth and RLS
- Admin-only order-status update endpoint and immutable status history

## Dashboard and content controls

The admin dashboard now uses the protected Edge Function for order reads/status changes, reseller management, blog CRUD, newsletter campaigns, and homepage content/theme updates. Do not relax RLS or put a Brevo/service-role key into `admin.html` as a shortcut.

The homepage includes guest order tracking, Brevo-backed newsletter/contact forms, editable Swirl Mart ribbon copy, and a swipeable mobile “Find your ritual” category carousel. Apply the migration and deploy the Edge Function before testing these flows.
