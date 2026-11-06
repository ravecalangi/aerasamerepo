# Supabase Blog Setup Guide

This file is a **setup guide only** — it does not run automatically.
Run the SQL blocks once in the Supabase SQL Editor for your project before using any blog features.

## Frontend configuration

The static pages use the Supabase project URL already present in the site and expect the project's
public **anon** key wherever `SUPA_KEY` is marked `******` (or provide the same value through the
site's deployment configuration). Never place a `service_role` key in any HTML or JavaScript file.
The anon key is safe for browser use when the RLS policies below are enabled.

The blog UI is available at `blog.html`, article URLs use
`blog-post.html?slug=<published-slug>`, and administration is available from `admin.html`.

---

## Step 1 — Create the `blog_categories` table

```sql
CREATE TABLE IF NOT EXISTS blog_categories (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  slug       text        NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

---

## Step 2 — Create the `blogs` table

```sql
CREATE TABLE IF NOT EXISTS blogs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title              text        NOT NULL,
  slug               text        NOT NULL UNIQUE,
  excerpt            text,
  category           text,
  author             text,
  featured_image_url text,
  content            text,
  status             text        NOT NULL DEFAULT 'draft'
                                 CHECK (status IN ('draft', 'published', 'scheduled')),
  published_at       timestamptz,
  scheduled_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  tags               text[],
  featured           boolean     NOT NULL DEFAULT false
);
```

---

## Step 3 — Enable RLS, add policies, and add the `updated_at` trigger

### 3a. Enable Row Level Security

```sql
ALTER TABLE blogs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_categories ENABLE ROW LEVEL SECURITY;
```

### 3b. RLS policies

**Policy 1 — Anonymous users can read published blogs**

```sql
CREATE POLICY "anon_select_published_blogs"
  ON blogs
  FOR SELECT
  TO anon
  USING (status = 'published');
```

**Policy 2 — Anonymous users can read all categories**

```sql
CREATE POLICY "anon_select_blog_categories"
  ON blog_categories
  FOR SELECT
  TO anon
  USING (true);
```

**Policy 3 — Authenticated users have full access to blogs**

```sql
CREATE POLICY "auth_all_blogs"
  ON blogs
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
```

**Policy 4 — Authenticated users have full access to categories**

```sql
CREATE POLICY "auth_all_blog_categories"
  ON blog_categories
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
```

### 3c. `set_updated_at()` trigger function and trigger

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_blogs_set_updated_at
  BEFORE UPDATE ON blogs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
```

---

## Step 4 — Create the `blog-media` storage bucket

The fastest option is to run this once in **Supabase → SQL Editor**:

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('blog-media', 'blog-media', true)
ON CONFLICT (id) DO UPDATE SET public = true;
```

If the statement reports that the bucket already exists, that is fine; it also makes the
existing bucket public.

1. Open the [Supabase Dashboard](https://supabase.com/dashboard) and select your project.
2. In the left sidebar, click **Storage**.
3. Click **New bucket**.
4. Enter the bucket name: `blog-media`
5. Toggle **Public bucket** to **on** (this grants public read access for images/videos).
6. Click **Create bucket**.

---

## Step 5 — Set storage policies for `blog-media`

Public read is already granted by the public bucket flag set in Step 4.
Add the following policies so authenticated admins can upload, replace, and delete files.

Go to **Storage → Policies → blog-media** and click **New policy**, or run these SQL statements directly:

```sql
-- Allow authenticated users to upload (insert) files
CREATE POLICY "auth_insert_blog_media"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'blog-media');

-- Allow authenticated users to update (replace) files
CREATE POLICY "auth_update_blog_media"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'blog-media');

-- Allow authenticated users to delete files
CREATE POLICY "auth_delete_blog_media"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'blog-media');
```

If a policy with one of these names already exists, use this reset block instead of
running the policy statements individually:

```sql
DROP POLICY IF EXISTS "auth_insert_blog_media" ON storage.objects;
DROP POLICY IF EXISTS "auth_update_blog_media" ON storage.objects;
DROP POLICY IF EXISTS "auth_delete_blog_media" ON storage.objects;

CREATE POLICY "auth_insert_blog_media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'blog-media');
CREATE POLICY "auth_update_blog_media"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'blog-media')
  WITH CHECK (bucket_id = 'blog-media');
CREATE POLICY "auth_delete_blog_media"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'blog-media');
```

---

## Step 6 — Seed default categories

Run this once to populate the five default blog categories.
The `ON CONFLICT` clause makes it safe to re-run without creating duplicates.

```sql
INSERT INTO blog_categories (name, slug) VALUES
  ('Skincare',          'skincare'),
  ('Hair Care',         'hair-care'),
  ('Lifestyle',         'lifestyle'),
  ('Behind the Scenes', 'behind-the-scenes'),
  ('Tutorials',         'tutorials')
ON CONFLICT (slug) DO NOTHING;
```

---

## Quick reference — public URL pattern for uploaded media

After a file is uploaded to the `blog-media` bucket, its public URL follows this pattern:

```
https://vhyveinrqamzycixhjsu.supabase.co/storage/v1/object/public/blog-media/{path}
```

Replace `{path}` with the relative path used during upload (e.g. `images/my-post-hero.jpg`).
