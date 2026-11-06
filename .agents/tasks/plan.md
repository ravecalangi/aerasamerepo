# Implementation Plan — AERA Blog Management System

> This plan is consumed by the FEAT-based workflow tail. The authoritative implementation
> instructions live in the FEAT JSON files under `.agents/tasks/task-blog-management/`.
> The plan below mirrors those FEATs in prose form for reference.

---

## FEAT-001 — Supabase schema, storage bucket, and setup doc

### What to do
Run the SQL DDL in the Supabase SQL editor to create the `blogs` and `blog_categories` tables,
enable RLS, and add the four required policies. Create the `blog-media` storage bucket with public
read access. Write `SUPABASE_BLOG_SETUP.md` with complete step-by-step instructions.

### Files to create or modify
- `c:\Users\martq\Documents\area-new-main\SUPABASE_BLOG_SETUP.md` (new)

### SQL DDL (include verbatim in SUPABASE_BLOG_SETUP.md)

```sql
-- blog_categories
create table if not exists blog_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now()
);

-- blogs
create table if not exists blogs (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  slug               text not null unique,
  excerpt            text,
  category           text,
  author             text,
  featured_image_url text,
  content            text,
  status             text not null default 'draft' check (status in ('draft','published','scheduled')),
  published_at       timestamptz,
  scheduled_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  tags               text[],
  featured           boolean not null default false
);

-- RLS
alter table blog_categories enable row level security;
alter table blogs enable row level security;

-- public reads for published posts
create policy "Public reads published blogs"
  on blogs for select
  using (status = 'published');

-- public reads for categories
create policy "Public reads blog categories"
  on blog_categories for select
  using (true);

-- authenticated full access on blogs
create policy "Auth full access blogs"
  on blogs for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- authenticated full access on categories
create policy "Auth full access categories"
  on blog_categories for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- auto-update updated_at
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger blogs_updated_at
  before update on blogs
  for each row execute procedure set_updated_at();

-- seed default categories
insert into blog_categories (name, slug) values
  ('Skincare',           'skincare'),
  ('Hair Care',          'hair-care'),
  ('Lifestyle',          'lifestyle'),
  ('Behind the Scenes',  'behind-the-scenes'),
  ('Tutorials',          'tutorials')
on conflict (slug) do nothing;
```

### Storage bucket (UI, document in SUPABASE_BLOG_SETUP.md)
1. Supabase Dashboard → Storage → New bucket → name: `blog-media` → toggle Public → Create.
2. Go to bucket Policies → Add policy → "Allow public SELECT" for all users on `blog-media`.
3. Add policy → "Allow authenticated INSERT/UPDATE/DELETE" on `blog-media` for role `authenticated`.

### Verify
No automated test. Verify by running `SELECT * FROM blogs LIMIT 1;` and confirming no error.

---

## FEAT-002 — Nav update (all pages)

### What to do
Add `<a href="blog.html">Blog</a>` between the About Us and AERA Circle items in the desktop
`.nav-links-center` of every public HTML file. Add `<a class="m-link" href="blog.html">Blog</a>`
after the About Us `.m-link` in each page's mobile menu JS string or static HTML.

### Files to modify
- `index.html`
- `shop.html`
- `about.html`
- `circle.html`
- `checkout.html`
- `product.html`

### Desktop nav insertion point (same in every file)
```html
<!-- BEFORE -->
<div class="nav-dropdown"><a href="circle.html" class="dd">AERA Circle</a>…</div>

<!-- AFTER -->
<a href="blog.html">Blog</a>
<div class="nav-dropdown"><a href="circle.html" class="dd">AERA Circle</a>…</div>
```

### Mobile menu insertion point
In the JS string that builds `mm.innerHTML`, after:
```
<a class="m-link" href="about.html">About Us</a>
```
add:
```
<a class="m-link" href="blog.html">Blog</a>
```

### Verify
Open each HTML file in a browser; confirm "Blog" appears between "About Us" and "AERA Circle"
in both desktop nav and mobile menu overlay.

---

## FEAT-003 — blog.html (public listing page)

### What to do
Create `blog.html` from scratch, following the shop.html page structure exactly (same nav,
footer, newsletter section, cart drawer, search overlay, mobile menu JS). The page-specific
content is: a hero section for the featured post, category filter tabs, search input,
9-per-page blog grid with Load More, and empty-state message.

### Files to create
- `c:\Users\martq\Documents\area-new-main\blog.html`

### HTML structure sketch

```
<!DOCTYPE html>
<html lang="en">
<head>
  <!-- same font/meta pattern as shop.html -->
  <title>Blog | AERA</title>
  <!-- page-level <style> block with all CSS -->
</head>
<body>

<!-- announcement topbar (copy from shop.html) -->
<div class="topbar" id="topbar">…</div>

<!-- nav (copy from shop.html, add Blog link) -->
<header class="nav" id="mainNav">…</header>

<main>
  <!-- HERO FEATURED POST -->
  <section class="blog-hero" id="blogHero" style="display:none">
    <div class="wrap">
      <a class="blog-hero-card" id="heroCard" href="#">
        <div class="blog-hero-img" id="heroImg" style="background-image:url('')"></div>
        <div class="blog-hero-body">
          <span class="blog-cat-badge" id="heroCat"></span>
          <h1 class="blog-hero-title" id="heroTitle"></h1>
          <p class="blog-hero-excerpt" id="heroExcerpt"></p>
          <div class="blog-hero-meta">
            <span id="heroAuthor"></span>
            <span id="heroDate"></span>
          </div>
        </div>
      </a>
    </div>
  </section>

  <div class="wrap">
    <!-- FILTER + SEARCH TOOLBAR -->
    <div class="blog-toolbar">
      <div class="blog-cats" id="blogCats">
        <button class="tab on" data-cat="all">All</button>
        <!-- dynamic category buttons injected by JS -->
      </div>
      <input class="blog-search" type="search" id="blogSearch" placeholder="Search posts…">
    </div>

    <!-- GRID -->
    <div class="blog-grid" id="blogGrid"></div>

    <!-- LOAD MORE -->
    <div class="blog-load-wrap" id="blogLoadWrap" style="display:none">
      <button class="btn ghost" id="blogLoadMore">Load more</button>
    </div>

    <!-- EMPTY STATE -->
    <div class="blog-empty" id="blogEmpty" style="display:none">
      <p>No posts published yet. Check back soon.</p>
    </div>
  </div>
</main>

<!-- newsletter + footer (copy from shop.html) -->
…

<!-- cart drawer, search overlay, mobile menu JS (copy from shop.html) -->
<script>
/* ─── Supabase config ─── */
var SUPA_URL = 'https://vhyveinrqamzycixhjsu.supabase.co';
var SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…';

/* public fetch (no auth header beyond apikey) */
function supaGet(path){
  return fetch(SUPA_URL + path, {
    headers:{ 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY }
  }).then(function(r){ return r.json(); });
}

var PAGE_SIZE = 9;
var currentOffset = 0;
var activeCat = 'all';
var searchQ = '';
var allLoaded = false;

function loadCategories(){
  supaGet('/rest/v1/blog_categories?select=id,name,slug&order=name.asc')
    .then(function(cats){
      var wrap = document.getElementById('blogCats');
      cats.forEach(function(c){
        var b = document.createElement('button');
        b.className = 'tab'; b.dataset.cat = c.slug;
        b.textContent = c.name;
        b.addEventListener('click', function(){ setCat(c.slug); });
        wrap.appendChild(b);
      });
    });
}

function setCat(cat){
  activeCat = cat;
  currentOffset = 0; allLoaded = false;
  document.querySelectorAll('.blog-cats .tab').forEach(function(b){
    b.classList.toggle('on', b.dataset.cat === cat);
  });
  document.getElementById('blogGrid').innerHTML = '';
  loadPosts(true);
}

function buildQuery(forCount){
  var q = '/rest/v1/blogs?select=id,title,slug,excerpt,category,author,featured_image_url,published_at,featured'
    + '&status=eq.published&order=published_at.desc';
  if(activeCat !== 'all') q += '&category=eq.' + encodeURIComponent(activeCat);
  if(searchQ) q += '&or=(title.ilike.*' + encodeURIComponent(searchQ) + '*,excerpt.ilike.*' + encodeURIComponent(searchQ) + '*)';
  if(!forCount) q += '&limit=' + PAGE_SIZE + '&offset=' + currentOffset;
  return q;
}

function loadPosts(reset){
  if(reset){ currentOffset = 0; allLoaded = false; document.getElementById('blogGrid').innerHTML = ''; }
  supaGet(buildQuery(false)).then(function(posts){
    if(!Array.isArray(posts)){ showEmpty(); return; }
    if(reset && !posts.length && currentOffset === 0){ showEmpty(); return; }
    posts.forEach(renderCard);
    currentOffset += posts.length;
    allLoaded = posts.length < PAGE_SIZE;
    document.getElementById('blogLoadWrap').style.display = allLoaded ? 'none' : '';
    document.getElementById('blogEmpty').style.display = '';
    /* hide empty state if we have posts */
    if(posts.length > 0) document.getElementById('blogEmpty').style.display = 'none';
  });
}

function showEmpty(){
  document.getElementById('blogGrid').innerHTML = '';
  document.getElementById('blogEmpty').style.display = '';
  document.getElementById('blogLoadWrap').style.display = 'none';
}

function renderCard(p){
  var d = document.createElement('a');
  d.className = 'blog-card'; d.href = 'blog-post.html?slug=' + encodeURIComponent(p.slug);
  var date = p.published_at ? new Date(p.published_at).toLocaleDateString('en-PH',{month:'long',day:'numeric',year:'numeric'}) : '';
  var excerpt = (p.excerpt||'').slice(0,120) + ((p.excerpt||'').length > 120 ? '…' : '');
  d.innerHTML =
    '<div class="blog-card-img"'+(p.featured_image_url?' style="background-image:url('+esc(p.featured_image_url)+')"':'')+' role="img" aria-label="'+esc(p.title)+'"></div>'
    +'<div class="blog-card-body">'
      +'<span class="blog-cat-badge">'+esc(p.category||'')+'</span>'
      +'<h3 class="blog-card-title">'+esc(p.title)+'</h3>'
      +'<p class="blog-card-excerpt">'+esc(excerpt)+'</p>'
      +'<div class="blog-card-meta">'
        +'<span>'+esc(p.author||'')+'</span>'
        +'<span>'+date+'</span>'
      +'</div>'
    +'</div>';
  document.getElementById('blogGrid').appendChild(d);
}

function esc(s){ var d=document.createElement('div'); d.textContent=s==null?'':String(s); return d.innerHTML; }

function loadFeaturedPost(){
  supaGet('/rest/v1/blogs?select=id,title,slug,excerpt,category,author,featured_image_url,published_at&status=eq.published&or=(featured.eq.true)&order=published_at.desc&limit=1')
    .then(function(rows){
      /* fallback: if no featured flag, grab most recent */
      if(!rows || !rows.length) return supaGet('/rest/v1/blogs?select=id,title,slug,excerpt,category,author,featured_image_url,published_at&status=eq.published&order=published_at.desc&limit=1');
      return rows;
    })
    .then(function(rows){
      if(!rows||!rows.length) return;
      var p = rows[0];
      var heroCard = document.getElementById('heroCard');
      heroCard.href = 'blog-post.html?slug=' + encodeURIComponent(p.slug);
      document.getElementById('heroImg').style.backgroundImage = 'url(' + (p.featured_image_url||'') + ')';
      document.getElementById('heroCat').textContent = p.category||'';
      document.getElementById('heroTitle').textContent = p.title||'';
      document.getElementById('heroExcerpt').textContent = p.excerpt||'';
      document.getElementById('heroAuthor').textContent = p.author||'';
      document.getElementById('heroDate').textContent = p.published_at ? new Date(p.published_at).toLocaleDateString('en-PH',{month:'long',day:'numeric',year:'numeric'}) : '';
      document.getElementById('blogHero').style.display = '';
    })
    .catch(function(){});
}

document.getElementById('blogSearch').addEventListener('input', function(){
  searchQ = this.value.trim();
  loadPosts(true);
});
document.getElementById('blogLoadMore').addEventListener('click', function(){
  loadPosts(false);
});
document.querySelectorAll('.blog-cats .tab').forEach(function(b){
  b.addEventListener('click', function(){ setCat(b.dataset.cat); });
});

loadCategories();
loadFeaturedPost();
loadPosts(true);
</script>
</body>
</html>
```

### CSS classes to add to the page-level `<style>` block
```css
/* ── BLOG PAGE ── */
.blog-hero{padding:3rem 0 2rem}
.blog-hero-card{display:grid;border-radius:20px;overflow:hidden;background:#fff;border:1px solid rgba(56,65,104,.12);text-decoration:none;color:var(--brown);transition:transform .3s}
.blog-hero-card:hover{transform:translateY(-3px)}
@media(min-width:768px){.blog-hero-card{grid-template-columns:1.4fr 1fr}}
.blog-hero-img{min-height:280px;background:#f0ede8 center/cover no-repeat}
@media(min-width:768px){.blog-hero-img{min-height:420px}}
.blog-hero-body{padding:2rem;display:flex;flex-direction:column;justify-content:center;gap:.75rem}
.blog-hero-title{font-family:Urbanist,Arial,sans-serif;font-size:clamp(1.5rem,4vw,2.25rem);font-weight:500;line-height:1.2;margin:0}
.blog-hero-excerpt{margin:0;line-height:1.7;color:rgba(56,65,104,.7)}
.blog-hero-meta{display:flex;gap:1rem;font-size:.8rem;color:rgba(56,65,104,.55);flex-wrap:wrap}
.blog-cat-badge{display:inline-block;padding:.25rem .75rem;border-radius:9999px;background:rgba(56,65,104,.08);font-size:.7rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--brown)}
.blog-toolbar{display:flex;gap:1rem;align-items:center;flex-wrap:wrap;margin:2rem 0 1.5rem;justify-content:space-between}
.blog-cats{display:flex;gap:.4rem;flex-wrap:wrap}
.blog-search{height:40px;padding:0 1rem;border:1px solid rgba(56,65,104,.2);border-radius:9999px;font:inherit;font-size:.875rem;background:#fff;color:var(--brown);min-width:180px}
.blog-search:focus{outline:2px solid var(--brown);outline-offset:1px}
.blog-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:1.25rem;padding-bottom:2rem}
@media(min-width:640px){.blog-grid{grid-template-columns:repeat(3,1fr)}}
@media(min-width:1024px){.blog-grid{grid-template-columns:repeat(4,1fr);gap:1.5rem}}
.blog-card{display:flex;flex-direction:column;border-radius:16px;overflow:hidden;background:#fff;border:1px solid rgba(56,65,104,.12);text-decoration:none;color:var(--brown);transition:transform .3s}
.blog-card:hover{transform:translateY(-4px)}
.blog-card-img{aspect-ratio:3/2;background:#f0ede8 center/cover no-repeat}
.blog-card-body{padding:1rem;display:flex;flex-direction:column;gap:.5rem;flex:1}
.blog-card-title{font-family:Urbanist,Arial,sans-serif;font-size:1rem;font-weight:500;margin:0;line-height:1.3}
.blog-card-excerpt{font-size:.8125rem;line-height:1.6;color:rgba(56,65,104,.65);margin:0;flex:1}
.blog-card-meta{display:flex;gap:.75rem;font-size:.75rem;color:rgba(56,65,104,.5);flex-wrap:wrap;margin-top:auto;padding-top:.5rem}
.blog-load-wrap{text-align:center;padding:2rem 0 4rem}
.blog-empty{text-align:center;padding:4rem 1rem;color:rgba(56,65,104,.5)}
```

### Verify
Open `blog.html` in a browser. Grid loads published posts from Supabase; category tabs filter;
search filters visible cards; Load More fetches next 9; empty state shows when no posts exist.

---

## FEAT-004 — blog-post.html (single article page)

### What to do
Create `blog-post.html`. On load it reads `?slug=` from `location.search`, fetches the blog
record from Supabase, renders the full article, and sets all meta tags dynamically. It also
fetches related posts (same category, 3 max) and renders a sharing section.

### Files to create
- `c:\Users\martq\Documents\area-new-main\blog-post.html`

### HTML structure sketch

```
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <!-- These meta tags are filled by JS after fetch: -->
  <title>Blog | AERA</title>
  <meta name="description" content="">
  <link rel="canonical" href="">
  <!-- Open Graph -->
  <meta property="og:type"        content="article">
  <meta property="og:site_name"   content="AERA">
  <meta property="og:title"       content="">
  <meta property="og:description" content="">
  <meta property="og:image"       content="">
  <meta property="og:url"         content="">
  <!-- Twitter Card -->
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:title"       content="">
  <meta name="twitter:description" content="">
  <meta name="twitter:image"       content="">
  <!-- fonts + Quill snow CSS (read-only, for article styling) -->
  <link href="https://cdn.quilljs.com/1.3.7/quill.snow.css" rel="stylesheet">
  <style>
    /* same :root variables as other pages */
    /* article body styles (ql-editor scoped) */
    /* sharing, related posts, page-level layout */
  </style>
</head>
<body>

<!-- topbar + nav (same as shop.html, Blog link active) -->

<main id="postMain">

  <!-- LOADING STATE (shown until fetch resolves) -->
  <div id="postLoading" class="wrap" style="padding:6rem 0;text-align:center;color:rgba(56,65,104,.5)">Loading…</div>

  <!-- 404 STATE -->
  <div id="postNotFound" style="display:none" class="wrap post-notfound">
    <p>This article was not found.</p>
    <a href="blog.html" class="btn">← Back to Blog</a>
  </div>

  <!-- ARTICLE (hidden until loaded) -->
  <article id="postArticle" style="display:none">

    <!-- featured image full-width -->
    <div class="post-hero-img" id="postHeroImg"></div>

    <div class="wrap post-wrap">
      <!-- back link -->
      <a href="blog.html" class="post-back">← Back to Blog</a>

      <header class="post-header">
        <span class="blog-cat-badge" id="postCat"></span>
        <h1 id="postTitle"></h1>
        <div class="post-meta">
          <span id="postAuthor"></span>
          <span id="postDate"></span>
        </div>
      </header>

      <!-- Quill HTML rendered read-only (NOT a Quill instance, just innerHTML) -->
      <div class="ql-editor post-content" id="postContent"></div>

      <!-- SHARING -->
      <div class="post-share">
        <p class="post-share-label">Share this article</p>
        <div class="post-share-btns">
          <a class="btn ghost sm" id="shareFb" target="_blank" rel="noopener">Facebook</a>
          <a class="btn ghost sm" id="shareX"  target="_blank" rel="noopener">X / Twitter</a>
          <button class="btn ghost sm" id="shareCopy">Copy Link</button>
        </div>
      </div>
    </div>

    <!-- RELATED POSTS -->
    <section id="relatedSection" style="display:none" class="related-section">
      <div class="wrap">
        <h2 class="related-title">You might also like</h2>
        <div class="blog-grid" id="relatedGrid"></div>
      </div>
    </section>

  </article>

</main>

<!-- newsletter + footer (copy from shop.html) -->
<!-- toast for copy-link feedback -->
<div class="toast" id="toast"></div>

<script>
var SUPA_URL = 'https://vhyveinrqamzycixhjsu.supabase.co';
var SUPA_KEY = '…';

function supaGet(path){
  return fetch(SUPA_URL+path,{headers:{'apikey':SUPA_KEY,'Authorization':'Bearer '+SUPA_KEY}}).then(function(r){return r.json();});
}

function setMeta(name,val){
  var el=document.querySelector('meta[name="'+name+'"]')||document.querySelector('meta[property="'+name+'"]');
  if(el)el.setAttribute('content',val);
}

function toast(msg){
  var el=document.getElementById('toast');
  el.textContent=msg; el.classList.add('show');
  clearTimeout(toast._t);
  toast._t=setTimeout(function(){el.classList.remove('show');},2200);
}

var slug = new URLSearchParams(location.search).get('slug');
if(!slug){
  document.getElementById('postLoading').style.display='none';
  document.getElementById('postNotFound').style.display='';
} else {
  supaGet('/rest/v1/blogs?select=*&slug=eq.'+encodeURIComponent(slug)+'&status=eq.published&limit=1')
    .then(function(rows){
      document.getElementById('postLoading').style.display='none';
      if(!rows||!rows.length){ document.getElementById('postNotFound').style.display=''; return; }
      var p=rows[0];

      /* meta tags */
      document.title = (p.title||'Blog') + ' | AERA';
      setMeta('description', p.excerpt||'');
      document.querySelector('link[rel=canonical]').href = location.href;
      setMeta('og:title',        p.title||'');
      setMeta('og:description',  p.excerpt||'');
      setMeta('og:image',        p.featured_image_url||'');
      setMeta('og:url',          location.href);
      setMeta('twitter:title',       p.title||'');
      setMeta('twitter:description', p.excerpt||'');
      setMeta('twitter:image',       p.featured_image_url||'');

      /* hero image */
      if(p.featured_image_url) document.getElementById('postHeroImg').style.backgroundImage='url('+p.featured_image_url+')';
      document.getElementById('postCat').textContent    = p.category||'';
      document.getElementById('postTitle').textContent  = p.title||'';
      document.getElementById('postAuthor').textContent = p.author||'';
      var date = p.published_at ? new Date(p.published_at).toLocaleDateString('en-PH',{dateStyle:'long'}) : '';
      document.getElementById('postDate').textContent   = date;

      /* article body — raw Quill HTML */
      document.getElementById('postContent').innerHTML  = p.content||'';

      /* sharing */
      var url=encodeURIComponent(location.href), title=encodeURIComponent(p.title||'');
      document.getElementById('shareFb').href='https://www.facebook.com/sharer/sharer.php?u='+url;
      document.getElementById('shareX').href ='https://twitter.com/intent/tweet?url='+url+'&text='+title;
      document.getElementById('shareCopy').addEventListener('click',function(){
        navigator.clipboard.writeText(location.href).then(function(){toast('Link copied!');}).catch(function(){toast('Could not copy link.');});
      });

      document.getElementById('postArticle').style.display='';

      /* related posts */
      if(p.category){
        supaGet('/rest/v1/blogs?select=id,title,slug,excerpt,category,author,featured_image_url,published_at&status=eq.published&category=eq.'+encodeURIComponent(p.category)+'&id=neq.'+p.id+'&order=published_at.desc&limit=3')
          .then(function(related){
            if(!related||!related.length) return;
            var grid=document.getElementById('relatedGrid');
            related.forEach(function(r){
              var a=document.createElement('a');
              a.className='blog-card'; a.href='blog-post.html?slug='+encodeURIComponent(r.slug);
              var date2=r.published_at?new Date(r.published_at).toLocaleDateString('en-PH',{month:'long',day:'numeric',year:'numeric'}):'';
              a.innerHTML='<div class="blog-card-img"'+(r.featured_image_url?' style="background-image:url('+r.featured_image_url+')"':'')+' role="img" aria-label="'+r.title+'"></div>'
                +'<div class="blog-card-body"><span class="blog-cat-badge">'+r.category+'</span><h3 class="blog-card-title">'+r.title+'</h3><p class="blog-card-excerpt">'+(r.excerpt||'').slice(0,100)+'</p><div class="blog-card-meta"><span>'+r.author+'</span><span>'+date2+'</span></div></div>';
              grid.appendChild(a);
            });
            document.getElementById('relatedSection').style.display='';
          });
      }
    });
}
</script>

</body>
</html>
```

### Article CSS additions
```css
.post-hero-img{width:100%;aspect-ratio:16/7;background:#f0ede8 center/cover no-repeat;min-height:220px}
.post-wrap{max-width:720px;margin:0 auto;padding:2rem 1rem 4rem}
.post-back{display:inline-block;margin-bottom:1.5rem;font-size:.875rem;color:rgba(56,65,104,.6);text-decoration:none}
.post-back:hover{color:var(--brown)}
.post-header{margin-bottom:2rem}
.post-header h1{font-family:Urbanist,Arial,sans-serif;font-size:clamp(1.75rem,5vw,3rem);font-weight:500;margin:.75rem 0 1rem;line-height:1.15}
.post-meta{display:flex;gap:1rem;font-size:.875rem;color:rgba(56,65,104,.55)}
.post-content{font-size:1.0625rem;line-height:1.8;color:rgba(56,65,104,.85)}
.post-content h2{font-family:Urbanist,Arial,sans-serif;font-size:1.5rem;margin:2rem 0 .75rem}
.post-content h3{font-family:Urbanist,Arial,sans-serif;font-size:1.2rem;margin:1.5rem 0 .5rem}
.post-content img{max-width:100%;border-radius:12px;margin:1rem 0;display:block}
.post-content blockquote{border-left:3px solid rgba(56,65,104,.2);margin:1.5rem 0;padding:.75rem 1.25rem;font-style:italic;color:rgba(56,65,104,.7)}
.post-content a{color:var(--brown);text-decoration:underline}
.post-content ul,.post-content ol{padding-left:1.5rem;line-height:2}
.post-share{border-top:1px solid rgba(56,65,104,.1);margin-top:3rem;padding-top:2rem}
.post-share-label{font-size:.75rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:rgba(56,65,104,.5);margin-bottom:.75rem}
.post-share-btns{display:flex;gap:.5rem;flex-wrap:wrap}
.post-notfound{padding:6rem 0;text-align:center}
.post-notfound p{font-size:1.25rem;color:rgba(56,65,104,.5);margin-bottom:1.5rem}
.related-section{background:#faf9f7;padding:4rem 0}
.related-title{font-family:Urbanist,Arial,sans-serif;font-size:1.5rem;font-weight:500;margin-bottom:2rem}
.toast{position:fixed;left:50%;bottom:1.5rem;transform:translateX(-50%) translateY(20px);background:var(--deep);color:#fff;padding:.7rem 1.25rem;border-radius:9999px;font-size:.85rem;opacity:0;pointer-events:none;transition:.25s;z-index:200}
.toast.show{opacity:1;transform:translateX(-50%)}
```

### Verify
Navigate to `blog-post.html?slug=<existing-published-slug>`. Article renders with title, image,
content HTML. Page title updates. Sharing buttons open correct URLs. Invalid slug shows 404 state.

---

## FEAT-005 — admin.html Blogs tab + full-screen editor

### What to do
Add the Blogs tab button, `panel-blogs` div, and full-screen blog editor div to `admin.html`.
Add corresponding JS inside the existing `(function(){ … })()` IIFE: blog list CRUD, stat cards,
Quill init with image-upload handler, auto-save, and all form logic.

### Files to modify
- `c:\Users\martq\Documents\area-new-main\admin.html`

### HTML additions (after the Products tab button, inside `.admin-tabs`)
```html
<button class="admin-tab" data-tab="blogs">Blogs</button>
```

### Tab panel (after `<!-- end content panel -->`)
```html
<!-- ── BLOGS TAB ── -->
<div class="tab-panel" id="panel-blogs">

  <!-- stat cards -->
  <div class="stats" id="blogStats">
    <div class="stat"><div class="stat-val" id="bsTot">—</div><div class="stat-lbl">Total blogs</div></div>
    <div class="stat"><div class="stat-val" id="bsPub">—</div><div class="stat-lbl">Published</div></div>
    <div class="stat"><div class="stat-val" id="bsDraft">—</div><div class="stat-lbl">Draft</div></div>
    <div class="stat"><div class="stat-val" id="bsSched">—</div><div class="stat-lbl">Scheduled</div></div>
  </div>

  <!-- toolbar -->
  <div class="toolbar">
    <input type="search" id="blogSearch" placeholder="Search blogs…">
    <button class="btn sm" id="createBlogBtn">+ Create Blog</button>
  </div>

  <!-- table -->
  <div class="tbl-wrap">
    <table style="table-layout:fixed">
      <colgroup>
        <col style="width:56px"><!-- thumb -->
        <col><!-- title -->
        <col style="width:110px"><!-- category -->
        <col style="width:100px"><!-- author -->
        <col style="width:90px"><!-- date -->
        <col style="width:90px"><!-- status -->
        <col style="width:180px"><!-- actions -->
      </colgroup>
      <thead>
        <tr>
          <th></th>
          <th>Title</th>
          <th class="hide-mob">Category</th>
          <th class="hide-mob">Author</th>
          <th>Date</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="blogTbody"></tbody>
    </table>
  </div>

</div><!-- end blogs panel -->
```

### Full-screen editor overlay (append just before `</div><!-- end app -->`)
```html
<!-- ── BLOG EDITOR ── -->
<div class="blog-editor-overlay" id="blogEditorOverlay" style="display:none">
  <div class="blog-editor-wrap">

    <div class="blog-editor-header">
      <h2 id="blogEditorTitle">New Blog Post</h2>
      <div style="display:flex;gap:.6rem">
        <button class="btn sm ghost" id="blogPreviewBtn">Preview</button>
        <button class="btn sm ghost" id="blogEditorCancel">Cancel</button>
        <button class="btn sm" id="blogSaveDraft">Save Draft</button>
        <button class="btn sm" id="blogPublishNow" style="background:var(--ok)">Publish Now</button>
      </div>
    </div>

    <div class="blog-editor-body">

      <!-- left: fields -->
      <div class="blog-editor-fields">

        <div class="fld">
          <label>Title <em style="color:var(--danger)">*</em></label>
          <input id="beTitle" type="text" placeholder="Post title">
        </div>

        <div class="fld">
          <label>URL Slug</label>
          <input id="beSlug" type="text" placeholder="auto-generated-from-title">
        </div>

        <div class="fld">
          <label>Excerpt / Short Description <span id="excerptCount" style="font-weight:400;color:var(--muted)">0/200</span></label>
          <textarea id="beExcerpt" rows="3" maxlength="200" placeholder="Brief summary (shown in listing)"></textarea>
        </div>

        <div style="display:grid;grid-template-columns:1fr auto;gap:.5rem;align-items:end">
          <div class="fld" style="margin:0">
            <label>Category</label>
            <select id="beCategory">
              <option value="">Select category</option>
            </select>
          </div>
          <button class="btn sm ghost" id="beNewCatBtn" style="margin-bottom:0;height:42px">+ New</button>
        </div>

        <div class="fld">
          <label>Author</label>
          <input id="beAuthor" type="text" placeholder="Author name">
        </div>

        <div class="fld">
          <label>Featured Image</label>
          <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
            <input id="beFeatImgFile" type="file" accept="image/jpeg,image/png,image/webp" style="font-size:.8rem;flex:1">
            <img id="beFeatImgPreview" src="" alt="" style="width:80px;height:60px;border-radius:8px;object-fit:cover;border:1px solid var(--line);display:none">
          </div>
          <input id="beFeatImgUrl" type="hidden">
          <button id="beFeatImgRemove" class="btn sm ghost" style="display:none;margin-top:.4rem">Remove image</button>
        </div>

        <div class="fld">
          <label>Publication Status</label>
          <select id="beStatus">
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="scheduled">Scheduled</option>
          </select>
        </div>

        <div class="fld" id="beScheduledWrap" style="display:none">
          <label>Scheduled Date &amp; Time</label>
          <input id="beScheduledAt" type="datetime-local">
        </div>

        <div class="fld" style="flex-direction:row;align-items:center;gap:.6rem;display:flex">
          <input id="beFeatured" type="checkbox" style="width:16px;height:16px;accent-color:var(--brown)">
          <label for="beFeatured" style="font-size:.875rem;letter-spacing:0;text-transform:none;color:var(--brown);font-weight:500">Show in featured section</label>
        </div>

        <p id="beErr" style="color:var(--danger);font-size:.8rem;min-height:1rem"></p>
      </div>

      <!-- right: Quill editor -->
      <div class="blog-editor-quill">
        <p style="font-size:.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.5rem">Article Content</p>
        <div id="beQuill"></div>
      </div>

    </div>

  </div>
</div>
```

### CSS to add to admin.html `<style>` block (after existing styles)
```css
/* ── BLOG STATUS BADGES ── */
.badge.published{background:var(--ok-bg);color:var(--ok)}
.badge.draft{background:rgba(56,65,104,.08);color:rgba(56,65,104,.6)}
.badge.scheduled{background:var(--ship-bg);color:var(--ship)}

/* ── BLOG EDITOR OVERLAY ── */
.blog-editor-overlay{position:fixed;inset:0;z-index:300;background:#f5f3ef;overflow-y:auto}
.blog-editor-wrap{display:flex;flex-direction:column;min-height:100vh}
.blog-editor-header{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;padding:1rem clamp(1rem,3vw,2rem);background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:10}
.blog-editor-header h2{font-size:1.1rem}
.blog-editor-body{flex:1;display:grid;gap:1.5rem;padding:1.5rem clamp(1rem,3vw,2rem);align-items:start}
@media(min-width:900px){.blog-editor-body{grid-template-columns:380px 1fr}}
.blog-editor-fields{display:grid;gap:1rem;background:#fff;border-radius:16px;padding:1.5rem;border:1px solid var(--line)}
.blog-editor-quill{background:#fff;border-radius:16px;border:1px solid var(--line);padding:1rem}
#beQuill{min-height:400px}
.ql-container{font-family:"Instrument Sans",sans-serif;font-size:.9375rem}
```

### JS additions (inside the existing IIFE, after the tabs section)
Add these functions in the admin JS (after the tab-switching code):

```javascript
/* ══════════════════════════════
   BLOGS
   ══════════════════════════════ */

/* Quill CDN: loaded lazily when editor opens for the first time */
var quillLoaded = false;
var quillEditor = null;
var editingBlogId = null;
var allBlogs = [];
var blogSearchQ = '';
var autoSaveTimer = null;

function loadQuill(cb){
  if(quillLoaded){ if(cb) cb(); return; }
  var css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'https://cdn.quilljs.com/1.3.7/quill.snow.css';
  document.head.appendChild(css);
  var js = document.createElement('script');
  js.src = 'https://cdn.quilljs.com/1.3.7/quill.min.js';
  js.onload = function(){
    quillLoaded = true;
    if(cb) cb();
  };
  document.head.appendChild(js);
}

function initQuill(){
  if(quillEditor) return;
  quillEditor = new Quill('#beQuill', {
    theme: 'snow',
    modules: {
      toolbar: {
        container: [
          [{ 'header': [1,2,3,false] }],
          ['bold','italic','underline'],
          [{ 'list': 'ordered' },{ 'list': 'bullet' }],
          ['blockquote','link','image','video'],
          ['clean']
        ],
        handlers: {
          image: function(){
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/jpeg,image/png,image/webp';
            input.click();
            input.onchange = function(){
              var file = input.files[0]; if(!file) return;
              uploadBlogMedia(file, 'blog-images').then(function(url){
                var range = quillEditor.getSelection(true);
                quillEditor.insertEmbed(range.index, 'image', url);
              }).catch(function(e){ toast('Image upload failed: '+e.message); });
            };
          }
        }
      }
    }
  });
}

function uploadBlogMedia(file, folder){
  var ext = file.name.split('.').pop().toLowerCase();
  var fname = Date.now() + '-' + Math.random().toString(36).slice(2) + '.' + ext;
  var path = folder + '/' + fname;
  return fetch(SUPA_URL + '/storage/v1/object/blog-media/' + path, {
    method: 'POST',
    headers:{
      'apikey': SUPA_KEY,
      'Authorization': 'Bearer ' + (authToken || getToken()),
      'Content-Type': file.type,
      'x-upsert': 'true'
    },
    body: file
  }).then(function(r){
    if(!r.ok) throw new Error('Upload failed');
    return SUPA_URL + '/storage/v1/object/public/blog-media/' + path;
  });
}

function loadBlogs(){
  supaFetch('/rest/v1/blogs?select=id,title,slug,category,author,created_at,status,featured_image_url&order=created_at.desc')
    .then(function(r){ return r.json(); })
    .then(function(data){
      allBlogs = Array.isArray(data) ? data : [];
      renderBlogStats();
      renderBlogTable();
    })
    .catch(function(){ toast('Failed to load blogs.'); });
}

function loadBlogCategories(selectedSlug){
  supaFetch('/rest/v1/blog_categories?select=id,name,slug&order=name.asc')
    .then(function(r){ return r.json(); })
    .then(function(cats){
      var sel = $('beCategory');
      sel.innerHTML = '<option value="">Select category</option>';
      (Array.isArray(cats)?cats:[]).forEach(function(c){
        var opt = document.createElement('option');
        opt.value = c.slug; opt.textContent = c.name;
        if(c.slug === selectedSlug) opt.selected = true;
        sel.appendChild(opt);
      });
    });
}

function renderBlogStats(){
  var pub   = allBlogs.filter(function(b){ return b.status==='published'; }).length;
  var draft = allBlogs.filter(function(b){ return b.status==='draft'; }).length;
  var sched = allBlogs.filter(function(b){ return b.status==='scheduled'; }).length;
  $('bsTot').textContent   = allBlogs.length;
  $('bsPub').textContent   = pub;
  $('bsDraft').textContent = draft;
  $('bsSched').textContent = sched;
}

function renderBlogTable(){
  var rows = allBlogs.filter(function(b){
    var q = blogSearchQ.toLowerCase();
    return !q || (b.title||'').toLowerCase().includes(q);
  });
  var tb = $('blogTbody');
  if(!rows.length){
    tb.innerHTML = '<tr><td colspan="7"><div class="tbl-empty">No blog posts yet.</div></td></tr>';
    return;
  }
  tb.innerHTML = rows.map(function(b){
    var date = b.created_at ? new Date(b.created_at).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '—';
    var thumb = b.featured_image_url
      ? '<img src="'+esc(b.featured_image_url)+'" style="width:44px;height:44px;object-fit:cover;border-radius:8px;display:block">'
      : '<div style="width:44px;height:44px;border-radius:8px;background:var(--cream)"></div>';
    var badge = '<span class="badge '+esc(b.status||'draft')+'">'+esc(b.status||'draft')+'</span>';
    var isPub = b.status === 'published';
    return '<tr>'
      +'<td>'+thumb+'</td>'
      +'<td style="font-weight:500">'+esc(b.title||'Untitled')+'</td>'
      +'<td class="hide-mob">'+esc(b.category||'—')+'</td>'
      +'<td class="hide-mob">'+esc(b.author||'—')+'</td>'
      +'<td style="font-size:.8rem;color:var(--muted)">'+date+'</td>'
      +'<td>'+badge+'</td>'
      +'<td style="white-space:nowrap">'
        +'<button class="btn sm ghost blog-edit-btn" data-id="'+b.id+'" style="margin-right:.25rem">Edit</button>'
        +'<button class="btn sm ghost blog-preview-btn" data-slug="'+esc(b.slug||'')+'" style="margin-right:.25rem">Preview</button>'
        +'<button class="btn sm '+(isPub?'ghost':'')+ ' blog-toggle-btn" data-id="'+b.id+'" data-status="'+esc(b.status)+'" style="margin-right:.25rem">'+(isPub?'Unpublish':'Publish')+'</button>'
        +'<button class="btn sm danger blog-del-btn" data-id="'+b.id+'">Delete</button>'
      +'</td>'
    +'</tr>';
  }).join('');

  tb.querySelectorAll('.blog-edit-btn').forEach(function(btn){
    btn.addEventListener('click', function(){ openBlogEditor(btn.dataset.id); });
  });
  tb.querySelectorAll('.blog-preview-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      if(btn.dataset.slug) window.open('blog-post.html?slug='+encodeURIComponent(btn.dataset.slug),'_blank');
    });
  });
  tb.querySelectorAll('.blog-toggle-btn').forEach(function(btn){
    btn.addEventListener('click', function(){ toggleBlogStatus(btn.dataset.id, btn.dataset.status); });
  });
  tb.querySelectorAll('.blog-del-btn').forEach(function(btn){
    btn.addEventListener('click', function(){ deleteBlog(btn.dataset.id); });
  });
}

function openBlogEditor(id){
  editingBlogId = id || null;
  var b = id ? allBlogs.find(function(x){ return x.id===id; }) : null;
  $('blogEditorTitle').textContent = b ? 'Edit Blog Post' : 'New Blog Post';

  loadQuill(function(){
    initQuill();

    /* populate fields */
    $('beTitle').value    = '';
    $('beSlug').value     = '';
    $('beExcerpt').value  = '';
    $('beAuthor').value   = '';
    $('beStatus').value   = 'draft';
    $('beScheduledAt').value = '';
    $('beScheduledWrap').style.display = 'none';
    $('beFeatured').checked = false;
    $('beFeatImgUrl').value = '';
    $('beFeatImgPreview').style.display='none';
    $('beFeatImgRemove').style.display='none';
    $('beErr').textContent = '';
    $('excerptCount').textContent = '0/200';

    if(b){
      /* fetch full record for content */
      supaFetch('/rest/v1/blogs?select=*&id=eq.'+b.id)
        .then(function(r){ return r.json(); })
        .then(function(rows){
          var full = rows[0]||b;
          $('beTitle').value    = full.title||'';
          $('beSlug').value     = full.slug||'';
          $('beExcerpt').value  = full.excerpt||'';
          $('beAuthor').value   = full.author||'';
          $('beStatus').value   = full.status||'draft';
          $('beFeatured').checked = !!full.featured;
          $('beScheduledWrap').style.display = full.status==='scheduled'?'':'none';
          if(full.scheduled_at) $('beScheduledAt').value = full.scheduled_at.slice(0,16);
          if(full.featured_image_url){
            $('beFeatImgUrl').value = full.featured_image_url;
            $('beFeatImgPreview').src = full.featured_image_url;
            $('beFeatImgPreview').style.display='block';
            $('beFeatImgRemove').style.display='';
          }
          $('excerptCount').textContent = ($('beExcerpt').value.length)+'/200';
          /* restore draft from localStorage if newer */
          var lsKey='aera-blog-draft-'+(full.id||'new');
          try{
            var saved=JSON.parse(localStorage.getItem(lsKey)||'null');
            if(saved && saved.content) quillEditor.root.innerHTML=saved.content;
            else quillEditor.root.innerHTML=full.content||'';
          }catch(e){ quillEditor.root.innerHTML=full.content||''; }
          loadBlogCategories(full.category||'');
        });
    } else {
      /* restore new-post draft */
      var lsKey='aera-blog-draft-new';
      try{
        var saved=JSON.parse(localStorage.getItem(lsKey)||'null');
        if(saved&&saved.content) quillEditor.root.innerHTML=saved.content;
        else quillEditor.root.innerHTML='';
      }catch(e){ quillEditor.root.innerHTML=''; }
      loadBlogCategories('');
    }

    $('blogEditorOverlay').style.display='';
    startAutoSave();
  });
}

function closeBlogEditor(){
  $('blogEditorOverlay').style.display='none';
  stopAutoSave();
  editingBlogId=null;
}

function slugify(s){
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-').replace(/-+/g,'-');
}

$('beTitle').addEventListener('input', function(){
  if(!editingBlogId) $('beSlug').value = slugify(this.value);
});
$('beExcerpt').addEventListener('input', function(){
  $('excerptCount').textContent = this.value.length+'/200';
});
$('beStatus').addEventListener('change', function(){
  $('beScheduledWrap').style.display = this.value==='scheduled'?'':'none';
});

$('beFeatImgFile').addEventListener('change', function(){
  var file=this.files[0]; if(!file) return;
  var prev=$('beFeatImgPreview');
  prev.src=URL.createObjectURL(file); prev.style.display='block';
  $('beFeatImgRemove').style.display='';
});

$('beFeatImgRemove').addEventListener('click', function(){
  $('beFeatImgUrl').value='';
  $('beFeatImgPreview').src='';
  $('beFeatImgPreview').style.display='none';
  $('beFeatImgFile').value='';
  this.style.display='none';
});

$('beNewCatBtn').addEventListener('click', function(){
  var name = prompt('New category name:');
  if(!name||!name.trim()) return;
  var slug = slugify(name.trim());
  supaFetch('/rest/v1/blog_categories', {
    method:'POST',
    headers:{'Content-Type':'application/json','Prefer':'return=representation'},
    body: JSON.stringify({name:name.trim(), slug:slug})
  }).then(function(r){ return r.json(); })
  .then(function(){ loadBlogCategories(slug); toast('Category added.'); })
  .catch(function(){ toast('Failed to add category.'); });
});

$('blogPreviewBtn').addEventListener('click', function(){
  var slug=$('beSlug').value;
  if(slug) window.open('blog-post.html?slug='+encodeURIComponent(slug),'_blank');
});
$('blogEditorCancel').addEventListener('click', closeBlogEditor);

function startAutoSave(){
  stopAutoSave();
  autoSaveTimer = setInterval(function(){
    if(!quillEditor) return;
    var lsKey='aera-blog-draft-'+(editingBlogId||'new');
    try{ localStorage.setItem(lsKey, JSON.stringify({content:quillEditor.root.innerHTML, ts:Date.now()})); }catch(e){}
  }, 30000);
}
function stopAutoSave(){ clearInterval(autoSaveTimer); }

function collectBlogPayload(){
  return {
    title:     $('beTitle').value.trim(),
    slug:      $('beSlug').value.trim() || slugify($('beTitle').value.trim()),
    excerpt:   $('beExcerpt').value.trim(),
    category:  $('beCategory').value,
    author:    $('beAuthor').value.trim(),
    featured_image_url: $('beFeatImgUrl').value || null,
    content:   quillEditor ? quillEditor.root.innerHTML : '',
    status:    $('beStatus').value,
    featured:  $('beFeatured').checked,
    scheduled_at: $('beStatus').value==='scheduled' ? ($('beScheduledAt').value?new Date($('beScheduledAt').value).toISOString():null) : null,
    published_at:  $('beStatus').value==='published' ? new Date().toISOString() : null,
    updated_at:    new Date().toISOString()
  };
}

function saveBlog(statusOverride){
  var btn = statusOverride==='published' ? $('blogPublishNow') : $('blogSaveDraft');
  btn.disabled=true; btn.textContent='Saving…';
  $('beErr').textContent='';

  var payload = collectBlogPayload();
  if(statusOverride) payload.status = statusOverride;
  if(!payload.title){ $('beErr').textContent='Title is required.'; btn.disabled=false; btn.textContent=statusOverride==='published'?'Publish Now':'Save Draft'; return; }

  var doSave = function(imgUrl){
    if(imgUrl) payload.featured_image_url = imgUrl;

    var method = editingBlogId ? 'PATCH' : 'POST';
    var url = editingBlogId
      ? '/rest/v1/blogs?id=eq.'+editingBlogId
      : '/rest/v1/blogs';

    supaFetch(url, {
      method: method,
      headers:{'Content-Type':'application/json','Prefer':'return=representation'},
      body: JSON.stringify(payload)
    })
    .then(function(r){ return r.json(); })
    .then(function(rows){
      var saved = Array.isArray(rows)?rows[0]:rows;
      if(saved && saved.id && !editingBlogId) editingBlogId=saved.id;
      /* clear localStorage draft */
      try{ localStorage.removeItem('aera-blog-draft-'+(editingBlogId||'new')); }catch(e){}
      closeBlogEditor();
      loadBlogs();
      toast(statusOverride==='published'?'Blog published!':'Draft saved.');
    })
    .catch(function(e){
      $('beErr').textContent='Save failed: '+e.message;
    })
    .finally(function(){ btn.disabled=false; btn.textContent=statusOverride==='published'?'Publish Now':'Save Draft'; });
  };

  var file=$('beFeatImgFile').files[0];
  if(file){
    uploadBlogMedia(file,'blog-images').then(function(url){
      $('beFeatImgUrl').value=url;
      doSave(url);
    }).catch(function(e){ $('beErr').textContent='Image upload failed: '+e.message; btn.disabled=false; });
  } else {
    doSave(null);
  }
}

$('blogSaveDraft').addEventListener('click', function(){ saveBlog('draft'); });
$('blogPublishNow').addEventListener('click', function(){ saveBlog('published'); });

function toggleBlogStatus(id, currentStatus){
  var newStatus = currentStatus==='published' ? 'draft' : 'published';
  var payload = { status: newStatus };
  if(newStatus==='published') payload.published_at = new Date().toISOString();
  supaFetch('/rest/v1/blogs?id=eq.'+id, {
    method:'PATCH',
    headers:{'Content-Type':'application/json','Prefer':'return=minimal'},
    body: JSON.stringify(payload)
  }).then(function(r){
    if(!r.ok) throw new Error('Update failed');
    var b=allBlogs.find(function(x){return x.id===id;});
    if(b) b.status=newStatus;
    renderBlogStats(); renderBlogTable();
    toast(newStatus==='published'?'Blog published.':'Blog unpublished.');
  }).catch(function(){ toast('Failed to update status.'); });
}

function deleteBlog(id){
  var b=allBlogs.find(function(x){return x.id===id;});
  if(!confirm('Delete "'+(b?b.title:id)+'"? This cannot be undone.')) return;
  supaFetch('/rest/v1/blogs?id=eq.'+id,{
    method:'DELETE',
    headers:{'Prefer':'return=minimal'}
  }).then(function(r){
    if(!r.ok) throw new Error('Delete failed');
    allBlogs=allBlogs.filter(function(x){return x.id!==id;});
    renderBlogStats(); renderBlogTable();
    toast('Blog deleted.');
  }).catch(function(){ toast('Failed to delete blog.'); });
}

$('createBlogBtn').addEventListener('click', function(){ openBlogEditor(null); });
$('blogSearch').addEventListener('input', function(){ blogSearchQ=this.value; renderBlogTable(); });
```

Also, in the tab-switching handler already in admin.html, add this case:
```javascript
if(tab.dataset.tab === 'blogs') loadBlogs();
```

### Verify
- Sign in to admin.
- Click "Blogs" tab → stats cards and empty table appear.
- Click "+ Create Blog" → full-screen editor opens with Quill toolbar.
- Fill in title → slug auto-generates.
- Upload a featured image → preview shows.
- Click "Save Draft" → blog appears in table with "draft" badge.
- Click "Publish" → badge turns green.
- Click "Delete" → confirmation dialog → blog removed from table.

---

## Summary of files created / modified

| File | Action |
|---|---|
| `SUPABASE_BLOG_SETUP.md` | Create |
| `blog.html` | Create |
| `blog-post.html` | Create |
| `admin.html` | Modify (add tab, panel, editor, JS) |
| `index.html` | Modify (add Blog nav link) |
| `shop.html` | Modify (add Blog nav link) |
| `about.html` | Modify (add Blog nav link) |
| `circle.html` | Modify (add Blog nav link) |
| `checkout.html` | Modify (add Blog nav link) |
| `product.html` | Modify (add Blog nav link) |
