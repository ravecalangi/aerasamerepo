import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const baseHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
function corsHeaders(req?: Request) {
  const origin = req?.headers.get("Origin") ?? "";
  const configured = (Deno.env.get("ALLOWED_ORIGIN") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const allowed = configured.concat([
    "https://ravecalangi.github.io",
    "http://localhost:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
  ]);
  return { ...baseHeaders, "Access-Control-Allow-Origin": req ? (origin || allowed[0] || "*") : "*", "Vary": "Origin" };
}
const json = (body: unknown, status = 200, req?: Request) => new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });
const emailOk = (value: unknown) => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
const clean = (value: unknown, limit = 500) => String(value ?? "").trim().slice(0, limit);
const orderStatuses = new Set(["order_received", "processing", "packed", "shipped", "delivered", "cancelled", "pending", "confirmed"]);

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}
async function currentUser(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = adminClient();
  const { data } = await client.auth.getUser(token);
  return data.user ?? null;
}
async function requireAdmin(req: Request) {
  const user = await currentUser(req);
  if (!user) throw new Error("Unauthorized");
  const { data } = await adminClient().from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  if (!data || data.role !== "admin" || !data.is_active) throw new Error("Admin access is not enabled for this account. Set this user's profiles.role to admin and profiles.is_active to true.");
  return user;
}
async function sendBrevo(payload: unknown) {
  const key = Deno.env.get("BREVO_API_KEY");
  if (!key) return false;
  const response = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error("Email delivery failed.");
  return true;
}
function sender() { return { email: Deno.env.get("BREVO_SENDER_EMAIL")!, name: Deno.env.get("BREVO_SENDER_NAME") ?? "AERA" }; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, req);
  try {
    const { action, ...body } = await req.json();
    const db = adminClient();

    if (action === "create-order") {
      const customer = body.customer ?? {}, delivery = body.delivery ?? {}, items = Array.isArray(body.items) ? body.items : [];
      if (!emailOk(customer.email) || clean(customer.name, 120).length < 2 || !items.length) return json({ error: "Please provide a valid customer email, name, and order items." }, 400);
      const normalizedItems = items.slice(0, 30).map((item: any) => ({ name: clean(item.name, 150), qty: Math.max(1, Math.min(99, Number(item.qty) || 1)), price: Math.max(0, Number(item.price) || 0), meta: clean(item.meta, 150), img: clean(item.img, 1000) }));
      if (normalizedItems.some((item: any) => !item.name || !Number.isFinite(item.price))) return json({ error: "Invalid order items." }, 400);
      const subtotal = normalizedItems.reduce((sum: number, item: any) => sum + item.price * item.qty, 0);
      const shipping = Math.max(0, Number(body.shipping) || 0), total = subtotal + shipping;
      const orderNumber = `AERA-${new Date().getUTCFullYear()}-${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
      const trackingToken = crypto.randomUUID() + crypto.randomUUID();
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(trackingToken));
      const tokenHash = Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
      let receiptPath: string | null = null;
      if (body.receipt) {
        const mime = clean(body.receipt.mime, 80);
        const encoded = clean(body.receipt.base64, 14_000_000);
        if (!/^image\/(jpeg|png|webp)$/.test(mime) || !encoded || encoded.length > 13_981_016) return json({ error: "Receipt must be a JPEG, PNG, or WebP under 10 MB." }, 400);
        const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
        if (bytes.byteLength > 10 * 1024 * 1024) return json({ error: "Receipt must be under 10 MB." }, 400);
        const extension = mime === "image/jpeg" ? "jpg" : mime.split("/")[1];
        receiptPath = `${orderNumber}.${extension}`;
        const { error: receiptError } = await db.storage.from("receipts").upload(receiptPath, bytes, { contentType: mime, upsert: false });
        if (receiptError) throw new Error("Receipt upload failed.");
      }
      const { data: order, error } = await db.from("orders").insert({ order_number: orderNumber, customer_name: clean(customer.name, 120), customer_email: clean(customer.email, 254).toLowerCase(), customer_phone: clean(customer.phone, 30), street: clean(delivery.street, 200), barangay: clean(delivery.barangay, 120), city: clean(delivery.city, 120), province: clean(delivery.area, 60), zip: clean(delivery.zip, 20), delivery_notes: clean(delivery.note, 500), items: normalizedItems, subtotal, shipping, total, payment_method: clean(body.paymentMethod, 50), receipt_url: receiptPath, status: "order_received", tracking_token_hash: tokenHash, status_updated_at: new Date().toISOString() }).select("id,order_number,created_at,total,status").single();
      if (error) throw error;
      await db.from("order_status_history").insert({ order_id: order.id, status: "order_received", note: "Order received" });
      const trackUrl = `${Deno.env.get("PUBLIC_SITE_URL") ?? "https://ravecalangi.github.io/area-new"}/track-order.html`;
      const emailSent = await sendBrevo({ sender: sender(), to: [{ email: clean(customer.email, 254) }], subject: `AERA — Order Received ${orderNumber}`, htmlContent: `<h1>Thank you for your order.</h1><p>Your order has been received and is awaiting verification.</p><p><strong>Order ID:</strong> ${orderNumber}</p><p><strong>Total:</strong> ₱${total.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</p><p>Track it anytime at <a href="${trackUrl}">${trackUrl}</a> using this email address.</p>` });
      return json({ orderNumber, trackingToken, orderDate: order.created_at, total, status: "order_received", emailSent }, 201);
    }

    if (action === "track-order") {
      if (!emailOk(body.email) || !/^[A-Z0-9-]{10,40}$/i.test(clean(body.orderNumber, 40))) return json({ error: "Enter your order ID and the email used at checkout." }, 400);
      const { data: order } = await db.from("orders").select("id,order_number,created_at,status,status_updated_at,items,total,shipping").eq("order_number", clean(body.orderNumber, 40).toUpperCase()).eq("customer_email", clean(body.email, 254).toLowerCase()).maybeSingle();
      if (!order) return json({ error: "We could not find an order matching those details." }, 404);
      const { data: history } = await db.from("order_status_history").select("status,note,created_at").eq("order_id", order.id).order("created_at", { ascending: true });
      return json({ order: { ...order, history: history ?? [] } });
    }

    if (action === "admin-list-orders") {
      await requireAdmin(req);
      const { data, error } = await db.from("orders").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return json({ orders: data ?? [] });
    }

    if (action === "admin-list-blogs") {
      await requireAdmin(req);
      const { data, error } = await db.from("blogs").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return json({ blogs: data ?? [] });
    }

    if (action === "admin-save-blog") {
      await requireAdmin(req);
      const title = clean(body.title, 180);
      const slug = clean(body.slug, 180).toLowerCase();
      if (!title || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return json({ error: "Provide a title and valid slug." }, 400);
      const payload = {
        title,
        slug,
        excerpt: clean(body.excerpt, 500),
        category: clean(body.category, 80),
        featured_image_url: clean(body.featuredImageUrl, 1200),
        content: clean(body.content, 50_000),
        status: ["draft", "published", "scheduled"].includes(body.status) ? body.status : "draft",
        featured: body.featured === true,
        scheduled_at: body.scheduledAt || null,
        published_at: body.status === "published" ? (body.publishedAt || new Date().toISOString()) : null,
      };
      const query = body.blogId ? db.from("blogs").update(payload).eq("id", clean(body.blogId, 80)) : db.from("blogs").insert(payload);
      const { data, error } = await query.select("*").single();
      if (error) throw error;
      return json({ blog: data });
    }

    if (action === "admin-delete-blog") {
      await requireAdmin(req);
      const { error } = await db.from("blogs").delete().eq("id", clean(body.blogId, 80));
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "admin-update-content") {
      await requireAdmin(req);
      const updates = Array.isArray(body.content) ? body.content.slice(0, 100) : [];
      for (const row of updates) {
        const key = clean(row?.key, 100);
        if (!/^[a-z0-9_]+$/.test(key)) return json({ error: "Invalid content key." }, 400);
        const { error } = await db.from("site_content").upsert({ key, value: clean(row?.value, 20_000), updated_at: new Date().toISOString() }, { onConflict: "key" });
        if (error) throw error;
      }
      return json({ ok: true });
    }

    if (action === "subscribe") {
      const email = clean(body.email, 254).toLowerCase(); if (!emailOk(email)) return json({ error: "Enter a valid email address." }, 400);
      await db.from("newsletter_subscribers").upsert({ email, status: "subscribed" }, { onConflict: "email" });
      const listId = Number(Deno.env.get("BREVO_LIST_ID"));
      let brevoSynced = false;
      if (Deno.env.get("BREVO_API_KEY") && listId) {
        const brevo = await fetch("https://api.brevo.com/v3/contacts", { method: "POST", headers: { "api-key": Deno.env.get("BREVO_API_KEY")!, "Content-Type": "application/json" }, body: JSON.stringify({ email, listIds: [listId], updateEnabled: true }) });
        if (!brevo.ok && brevo.status !== 204) throw new Error("Could not subscribe email.");
        brevoSynced = true;
      }
      return json({ message: "You’re on the list.", brevoSynced });
    }

    if (action === "contact") {
      if (!emailOk(body.email) || clean(body.name, 120).length < 2 || clean(body.subject, 160).length < 2 || clean(body.message, 4000).length < 5) return json({ error: "Complete all contact fields with valid details." }, 400);
      const emailSent = await sendBrevo({ sender: sender(), replyTo: { email: clean(body.email, 254), name: clean(body.name, 120) }, to: [{ email: Deno.env.get("CONTACT_RECIPIENT_EMAIL")! }], subject: `AERA Website Contact Inquiry — ${clean(body.subject, 160)}`, textContent: `From: ${clean(body.name, 120)} <${clean(body.email, 254)}>\nSubmitted: ${new Date().toISOString()}\n\n${clean(body.message, 4000)}` });
      return json({ message: emailSent ? "Your message has been sent successfully. We'll get back to you soon." : "Your message was received. Email notifications are temporarily disabled." });
    }

    if (action === "reseller-me") {
      const user = await currentUser(req); if (!user) return json({ error: "Unauthorized" }, 401);
      const { data: profile } = await db.from("profiles").select("id,role,full_name,business_name,contact_number,address,is_active,created_at").eq("id", user.id).maybeSingle();
      if (!profile || profile.role !== "reseller" || !profile.is_active) return json({ error: "This reseller account is unavailable." }, 403);
      const { data: balance } = await db.from("reseller_balances").select("balance,updated_at").eq("reseller_id", user.id).maybeSingle();
      const { data: transactions } = await db.from("reseller_balance_transactions").select("transaction_type,amount,description,balance_after,created_at").eq("reseller_id", user.id).order("created_at", { ascending: false }).limit(20);
      return json({ profile, email: user.email, balance: balance?.balance ?? 0, transactions: transactions ?? [] });
    }

    if (action === "admin-update-order-status") {
      const admin = await requireAdmin(req); const status = clean(body.status, 30); if (!orderStatuses.has(status)) return json({ error: "Invalid order status." }, 400);
      const { data: order, error } = await db.from("orders").update({ status, status_updated_at: new Date().toISOString() }).eq("id", clean(body.orderId, 80)).select("id,order_number,customer_email").single(); if (error) throw error;
      await db.from("order_status_history").insert({ order_id: order.id, status, note: clean(body.note, 500), changed_by: admin.id });
      return json({ ok: true });
    }

    if (action === "admin-delete-order") {
      await requireAdmin(req);
      const { error } = await db.from("orders").delete().eq("id", clean(body.orderId, 80));
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "admin-list-resellers") {
      await requireAdmin(req);
      const { data, error } = await db.from("profiles").select("id,full_name,business_name,contact_number,address,is_active,created_at,reseller_balances(balance,updated_at)").eq("role", "reseller").order("created_at", { ascending: false });
      if (error) throw error;
      return json({ resellers: data ?? [] });
    }

    if (action === "admin-create-reseller") {
      await requireAdmin(req);
      const email = clean(body.email, 254).toLowerCase(), password = String(body.password ?? "");
      if (!emailOk(email) || clean(body.fullName, 120).length < 2 || password.length < 12) return json({ error: "Provide a name, valid email, and a password of at least 12 characters." }, 400);
      const { data: created, error: createError } = await db.auth.admin.createUser({ email, password, email_confirm: true });
      if (createError) return json({ error: createError.message }, 400);
      const initialBalance = Math.max(0, Number(body.initialBalance) || 0);
      const { error: profileError } = await db.from("profiles").insert({ id: created.user.id, role: "reseller", full_name: clean(body.fullName, 120), business_name: clean(body.businessName, 160), contact_number: clean(body.contactNumber, 30), address: clean(body.address, 500), is_active: body.isActive !== false });
      if (profileError) { await db.auth.admin.deleteUser(created.user.id); throw profileError; }
      await db.from("reseller_balances").insert({ reseller_id: created.user.id, balance: initialBalance });
      if (initialBalance) await db.from("reseller_balance_transactions").insert({ reseller_id: created.user.id, transaction_type: "credit", amount: initialBalance, description: "Initial balance", balance_after: initialBalance });
      return json({ id: created.user.id }, 201);
    }

    if (action === "admin-update-reseller") {
      await requireAdmin(req);
      const id = clean(body.resellerId, 80);
      const payload = { full_name: clean(body.fullName, 120), business_name: clean(body.businessName, 160), contact_number: clean(body.contactNumber, 30), address: clean(body.address, 500), is_active: body.isActive !== false };
      const { error } = await db.from("profiles").update(payload).eq("id", id).eq("role", "reseller"); if (error) throw error;
      return json({ ok: true });
    }

    if (action === "admin-adjust-balance") {
      const admin = await requireAdmin(req); const id = clean(body.resellerId, 80), amount = Number(body.amount), type = clean(body.transactionType, 20);
      if (!Number.isFinite(amount) || amount <= 0 || !["credit", "debit", "adjustment"].includes(type)) return json({ error: "Enter a valid positive balance amount." }, 400);
      const { data: current, error: balanceError } = await db.from("reseller_balances").select("balance").eq("reseller_id", id).single(); if (balanceError) throw balanceError;
      const next = type === "debit" ? Number(current.balance) - amount : Number(current.balance) + amount;
      if (next < 0) return json({ error: "This debit would make the balance negative." }, 400);
      const { error: updateError } = await db.from("reseller_balances").update({ balance: next, updated_at: new Date().toISOString() }).eq("reseller_id", id); if (updateError) throw updateError;
      await db.from("reseller_balance_transactions").insert({ reseller_id: id, transaction_type: type, amount, description: clean(body.description, 300), balance_after: next, created_by: admin.id });
      return json({ balance: next });
    }

    if (action === "admin-send-newsletter") {
      await requireAdmin(req);
      const subject = clean(body.subject, 180), htmlContent = clean(body.htmlContent, 20000), listId = Number(Deno.env.get("BREVO_LIST_ID"));
      if (!subject || !htmlContent || !listId) return json({ error: "Subject, content, and BREVO_LIST_ID are required." }, 400);
      const response = await fetch("https://api.brevo.com/v3/emailCampaigns", { method: "POST", headers: { "api-key": Deno.env.get("BREVO_API_KEY")!, "Content-Type": "application/json" }, body: JSON.stringify({ name: `AERA ${new Date().toISOString()}`, subject, sender: sender(), htmlContent, recipients: { listIds: [listId] }, scheduledAt: new Date(Date.now() + 60_000).toISOString() }) });
      if (!response.ok) throw new Error("Brevo campaign could not be created.");
      return json({ ok: true });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error); return json({ error: error instanceof Error ? error.message : "Request failed." }, 500);
  }
});
