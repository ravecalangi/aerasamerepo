import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const baseHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function corsHeaders(req) {
  const origin = req?.headers?.get("Origin") || "";
  const configured = (Deno.env.get("ALLOWED_ORIGIN") || "").split(",").map((value) => value.trim()).filter(Boolean);
  const allowed = configured.concat([
    "https://ravecalangi.github.io",
    "http://localhost:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:5501",
    "http://127.0.0.1:5501",
  ]);
  return { ...baseHeaders, "Access-Control-Allow-Origin": req ? (origin || allowed[0] || "*") : "*", "Vary": "Origin" };
}

const json = (body, status = 200, req) => new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });
const emailOk = (value) => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
const clean = (value, limit = 500) => String(value || "").trim().slice(0, limit);
const orderStatuses = new Set(["order_received", "processing", "packed", "shipped", "delivered", "cancelled", "pending", "confirmed"]);

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
}

async function currentUser(req) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = adminClient();
  const { data } = await client.auth.getUser(token);
  return data.user || null;
}

async function requireAdmin(req) {
  const user = await currentUser(req);
  if (!user) throw new Error("Unauthorized");
  const { data } = await adminClient().from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  if (!data || data.role !== "admin" || !data.is_active) throw new Error("Admin access is not enabled for this account. Set this user's profiles.role to admin and profiles.is_active to true.");
  return user;
}

async function sendBrevo(payload) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (resendKey) {
    const from = Deno.env.get("RESEND_FROM") || "AERA Official <onboarding@resend.dev>";
    const toList = (payload.to || []).map(r => typeof r === "string" ? r : r.email).filter(Boolean);
    if (!toList.length) return false;
    const replyTo = payload.replyTo?.email || Deno.env.get("CONTACT_RECIPIENT_EMAIL") || "contactaeraofficial@gmail.com";
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + resendKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        reply_to: replyTo,
        to: toList,
        subject: payload.subject,
        html: payload.htmlContent
      })
    });
    if (!response.ok) {
      const err = await response.text();
      console.error("Resend error:", err);
      throw new Error("Email delivery failed via Resend.");
    }
    return true;
  }

  const key = Deno.env.get("BREVO_API_KEY");
  if (!key) return false;
  const response = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error("Email delivery failed.");
  return true;
}

function sender() {
  return { email: Deno.env.get("BREVO_SENDER_EMAIL") || "contactaeraofficial@gmail.com", name: Deno.env.get("BREVO_SENDER_NAME") || "AERA" };
}

function getLogoUrl() {
  return Deno.env.get("PUBLIC_LOGO_URL") || "https://ravecalangi.github.io/area-new/images/aera-logo-black.png";
}
function getSiteUrl() {
  return Deno.env.get("PUBLIC_SITE_URL") || "https://ravecalangi.github.io/area-new/";
}

function renderOrderConfirmationEmail({ customerName, orderNumber, orderDate, items, subtotal, shipping, vatAmount, vatRate, total, deliveryArea, trackUrl }) {
  const itemsRows = items.map((item) => `
    <tr>
      <td style="padding: 16px 0; vertical-align: top;">
        <div class="text-title" style="font-weight: 600; font-size: 15px; color: #242b4b; line-height: 1.35;">${escapeHtml(item.name)}</div>
        ${item.meta ? `<div class="text-muted" style="font-size: 12px; color: #7882a5; margin-top: 3px;">${escapeHtml(item.meta)}</div>` : ""}
        ${item.discount > 0 ? `<div style="font-size: 11px; color: #c2410c; margin-top: 2px;">Sale: -${item.discount}% off regular SRP</div>` : ""}
      </td>
      <td style="padding: 16px 12px; text-align: center; vertical-align: top; white-space: nowrap;">
        <span class="text-muted" style="font-size: 13px; color: #7882a5;">× ${item.qty}</span>
      </td>
      <td style="padding: 16px 0; text-align: right; vertical-align: top; white-space: nowrap;">
        <span class="text-title" style="font-weight: 600; font-size: 15px; color: #242b4b;">₱${(item.price * item.qty).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</span>
      </td>
    </tr>
    <tr>
      <td colspan="3" class="divider" style="border-bottom: 1px solid rgba(56, 65, 104, 0.06); font-size: 0; line-height: 0; height: 1px;">&nbsp;</td>
    </tr>`).join("");

  const netSubtotal = Math.max(0, subtotal - (vatAmount || 0));

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>Your AERA Order ${orderNumber}</title>
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0 !important; padding: 0 !important; width: 100% !important; min-width: 100%; background-color: #f7f4ee; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #384168; }
    .brand-logo { display: block; width: 96px; height: auto; margin: 0 auto; }
    @media (prefers-color-scheme: dark) {
      body, .email-bg { background-color: #121520 !important; }
      .card-surface { background-color: #1c2133 !important; border-color: rgba(255, 255, 255, 0.08) !important; }
      .text-title { color: #fdfaf6 !important; }
      .text-body { color: #d2d6e4 !important; }
      .text-muted { color: #8e96b3 !important; }
      .divider { border-color: rgba(255, 255, 255, 0.08) !important; }
      .btn-primary { background-color: #f7f4ee !important; }
      .btn-primary-text { color: #1c2133 !important; }
      .tag-chip { background-color: rgba(255, 255, 255, 0.08) !important; color: #d2d6e4 !important; }
      .footer-text { color: #6e7694 !important; }
      .brand-logo { filter: brightness(0) invert(1) !important; -webkit-filter: brightness(0) invert(1) !important; }
    }
    [data-ogsc] body, [data-ogsc] .email-bg { background-color: #121520 !important; }
    [data-ogsc] .card-surface { background-color: #1c2133 !important; border-color: rgba(255, 255, 255, 0.08) !important; }
    [data-ogsc] .text-title { color: #fdfaf6 !important; }
    [data-ogsc] .text-body { color: #d2d6e4 !important; }
    [data-ogsc] .text-muted { color: #8e96b3 !important; }
    [data-ogsc] .btn-primary { background-color: #f7f4ee !important; }
    [data-ogsc] .btn-primary-text { color: #1c2133 !important; }
    [data-ogsc] .brand-logo { filter: brightness(0) invert(1) !important; }
  </style>
</head>
<body class="email-bg" style="margin: 0; padding: 0; background-color: #f7f4ee; -webkit-font-smoothing: antialiased;">
  <div style="display: none; font-size: 1px; color: #f7f4ee; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    Thank you for your order, ${escapeHtml(customerName)}. We are preparing your AERA items. Order ${orderNumber}.
  </div>
  <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" class="email-bg" style="background-color: #f7f4ee; table-layout: fixed;">
    <tr>
      <td align="center" style="padding: 40px 16px 50px;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px;" role="presentation">
          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <a href="${getSiteUrl()}" target="_blank" style="text-decoration: none; display: inline-block;">
                <img src="${getLogoUrl()}" alt="AERA" width="96" height="58" class="brand-logo" style="display:block;width:96px;height:auto;margin:0 auto;border:0;outline:none;" />
              </a>
              <div class="text-muted" style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.22em; color: #6a7499; margin-top: 8px; font-weight: 600;">Stay a little longer</div>
            </td>
          </tr>
          <tr>
            <td class="card-surface" style="background-color: #ffffff; border-radius: 24px; border: 1px solid rgba(56, 65, 104, 0.1); padding: 44px 36px; box-shadow: 0 12px 36px rgba(36, 43, 75, 0.04);">
              <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
                <tr>
                  <td>
                    <span class="tag-chip" style="display: inline-block; padding: 6px 14px; background-color: #f1ede4; color: #384168; border-radius: 9999px; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;">
                      Order Received
                    </span>
                    <h1 class="text-title" style="margin: 20px 0 8px; font-size: 26px; line-height: 1.25; font-weight: 600; color: #242b4b; letter-spacing: -0.02em;">
                      Thank you, ${escapeHtml(customerName)}.
                    </h1>
                    <p class="text-body" style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #434c74;">
                      We’ve received your order and payment details. Our team is now verifying your receipt and packing your items with care.
                    </p>
                  </td>
                </tr>
              </table>
              <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="background-color: #faf9f7; border-radius: 16px; border: 1px solid rgba(56, 65, 104, 0.08); margin-bottom: 28px;">
                <tr>
                  <td style="padding: 18px 22px;">
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
                      <tr>
                        <td class="text-muted" style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: #7882a5; font-weight: 600; padding-bottom: 4px;">Order Number</td>
                        <td align="right" class="text-muted" style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: #7882a5; font-weight: 600; padding-bottom: 4px;">Date</td>
                      </tr>
                      <tr>
                        <td class="text-title" style="font-size: 14px; font-weight: 700; color: #242b4b; font-family: monospace;">${orderNumber}</td>
                        <td align="right" class="text-title" style="font-size: 13px; font-weight: 600; color: #242b4b;">${orderDate}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
                <tr>
                  <td colspan="3" class="text-muted" style="padding-bottom: 12px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.14em; color: #7882a5; font-weight: 700;">
                    Your Items
                  </td>
                </tr>
                <tr>
                  <td colspan="3" class="divider" style="border-bottom: 1px solid rgba(56, 65, 104, 0.1); font-size: 0; line-height: 0; height: 1px;">&nbsp;</td>
                </tr>
                ${itemsRows}
                <tr>
                  <td colspan="2" class="text-muted" style="padding: 14px 0 4px; font-size: 14px; color: #6a7499;">Subtotal (Net of VAT)</td>
                  <td style="padding: 14px 0 4px; text-align: right; font-size: 14px; color: #242b4b; font-weight: 500;">₱${netSubtotal.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</td>
                </tr>
                ${vatAmount > 0 ? `
                <tr>
                  <td colspan="2" class="text-muted" style="padding: 4px 0; font-size: 14px; color: #6a7499;">12% VAT</td>
                  <td style="padding: 4px 0; text-align: right; font-size: 14px; color: #242b4b; font-weight: 500;">₱${Number(vatAmount).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</td>
                </tr>` : ""}
                <tr>
                  <td colspan="2" class="text-muted" style="padding: 4px 0; font-size: 14px; color: #6a7499;">Shipping (${escapeHtml(deliveryArea || "Standard")})</td>
                  <td style="padding: 4px 0; text-align: right; font-size: 14px; color: #242b4b; font-weight: 500;">₱${shipping.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</td>
                </tr>
                <tr>
                  <td colspan="3" class="divider" style="border-bottom: 1px solid rgba(56, 65, 104, 0.14); padding-top: 10px; font-size: 0; line-height: 0; height: 1px;">&nbsp;</td>
                </tr>
                <tr>
                  <td colspan="2" class="text-title" style="padding: 16px 0; font-size: 17px; font-weight: 700; color: #242b4b;">Total Amount</td>
                  <td style="padding: 16px 0; text-align: right; font-size: 20px; font-weight: 700; color: #242b4b;">₱${total.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</td>
                </tr>
              </table>
              <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="margin-top: 24px;">
                <tr>
                  <td align="center">
                    <a href="${trackUrl}" target="_blank" class="btn-primary" style="display: inline-block; background-color: #242b4b; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 600; padding: 16px 38px; border-radius: 9999px; letter-spacing: 0.02em; text-align: center; box-shadow: 0 6px 18px rgba(36, 43, 75, 0.15);">
                      <span class="btn-primary-text" style="color: #ffffff;">Track Order Status &rarr;</span>
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 14px;">
                    <span class="text-muted" style="font-size: 12px; color: #7882a5; line-height: 1.5; display: inline-block;">No account needed &bull; Just enter your Order ID anytime on our website</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 36px 20px 0;">
              <table border="0" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td align="center" style="padding-bottom: 12px;">
                    <a href="https://www.instagram.com/aeraclucofficial" target="_blank" class="footer-text" style="color: #727b9e; font-size: 12px; text-decoration: none; margin: 0 8px;">Instagram</a>
                    <span class="footer-text" style="color: #c4c7d5;">&bull;</span>
                    <a href="https://www.tiktok.com/@aeraclucofficial" target="_blank" class="footer-text" style="color: #727b9e; font-size: 12px; text-decoration: none; margin: 0 8px;">TikTok</a>
                    <span class="footer-text" style="color: #c4c7d5;">&bull;</span>
                    <a href="https://www.facebook.com/thisisaera" target="_blank" class="footer-text" style="color: #727b9e; font-size: 12px; text-decoration: none; margin: 0 8px;">Facebook</a>
                  </td>
                </tr>
                <tr>
                  <td align="center" class="footer-text" style="font-size: 12px; color: #7882a5; line-height: 1.6;">
                    Have questions about your order? Email us at <a href="mailto:contactaeraofficial@gmail.com" style="color: #242b4b; text-decoration: underline;">contactaeraofficial@gmail.com</a>.<br>
                    &copy; 2026 AERA. All rights reserved.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderNewsletterEmail({ subject, preheader, title, message, imageUrl, imageCaption, ctaLabel, ctaUrl, unsubscribeEmail }) {
  const safeTitle = escapeHtml(title || subject || "Notes from AERA");
  const safePreheader = escapeHtml(preheader || "A quiet moment with AERA.");
  const paragraphs = (message || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const bodyHtml = paragraphs.length
    ? paragraphs.map((p) => `<p class="text-body" style="margin: 0 0 18px; font-size: 15px; line-height: 1.7; color: #434c74;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("")
    : `<p class="text-body" style="margin: 0 0 18px; font-size: 15px; line-height: 1.7; color: #434c74;">${escapeHtml(message || "")}</p>`;

  const ctaBlock = (ctaLabel && ctaUrl) ? `
    <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin: 28px 0 12px;">
      <tr>
        <td align="center" style="border-radius: 9999px; background-color: #384168;" class="btn-primary">
          <a href="${escapeHtml(ctaUrl)}" target="_blank" class="btn-primary-text" style="display: inline-block; padding: 14px 32px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #ffffff; text-decoration: none; border-radius: 9999px;">
            ${escapeHtml(ctaLabel)} &rarr;
          </a>
        </td>
      </tr>
    </table>` : "";

  const imageBlock = imageUrl ? `
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="margin: 18px 0 24px;">
      <tr>
        <td align="center">
          <img src="${escapeHtml(imageUrl)}" alt="${safeTitle}" width="528" style="width: 100%; max-width: 528px; height: auto; border-radius: 14px; display: block; border: 1px solid rgba(56, 65, 104, 0.08);" />
          ${imageCaption ? `<div class="text-muted" style="font-size: 12px; color: #7882a5; margin-top: 8px; text-align: center; font-style: italic;">${escapeHtml(imageCaption)}</div>` : ''}
        </td>
      </tr>
    </table>` : "";

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(subject)}</title>
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0 !important; padding: 0 !important; width: 100% !important; min-width: 100%; background-color: #f7f4ee; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #384168; }
    .brand-logo { display: block; width: 96px; height: auto; margin: 0 auto; }
    @media (prefers-color-scheme: dark) {
      body, .email-bg { background-color: #121520 !important; }
      .card-surface { background-color: #1c2133 !important; border-color: rgba(255, 255, 255, 0.08) !important; }
      .text-title { color: #fdfaf6 !important; }
      .text-body { color: #d2d6e4 !important; }
      .text-muted { color: #8e96b3 !important; }
      .divider { border-color: rgba(255, 255, 255, 0.08) !important; }
      .btn-primary { background-color: #f7f4ee !important; }
      .btn-primary-text { color: #1c2133 !important; }
      .tag-chip { background-color: rgba(255, 255, 255, 0.08) !important; color: #d2d6e4 !important; }
      .footer-text { color: #6e7694 !important; }
      .brand-logo { filter: brightness(0) invert(1) !important; -webkit-filter: brightness(0) invert(1) !important; }
    }
    [data-ogsc] body, [data-ogsc] .email-bg { background-color: #121520 !important; }
    [data-ogsc] .card-surface { background-color: #1c2133 !important; border-color: rgba(255, 255, 255, 0.08) !important; }
    [data-ogsc] .text-title { color: #fdfaf6 !important; }
    [data-ogsc] .text-body { color: #d2d6e4 !important; }
    [data-ogsc] .text-muted { color: #8e96b3 !important; }
    [data-ogsc] .btn-primary { background-color: #f7f4ee !important; }
    [data-ogsc] .btn-primary-text { color: #1c2133 !important; }
    [data-ogsc] .brand-logo { filter: brightness(0) invert(1) !important; }
  </style>
</head>
<body class="email-bg" style="margin: 0; padding: 0; background-color: #f7f4ee; -webkit-font-smoothing: antialiased;">
  <div style="display: none; font-size: 1px; color: #f7f4ee; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    ${safePreheader}
    &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847;
  </div>
  <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" class="email-bg" style="background-color: #f7f4ee; table-layout: fixed;">
    <tr>
      <td align="center" style="padding: 40px 16px 50px;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px;" role="presentation">
          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <a href="${getSiteUrl()}" target="_blank" style="text-decoration: none; display: inline-block;">
                <img src="${getLogoUrl()}" alt="AERA" width="96" height="58" class="brand-logo" style="display:block;width:96px;height:auto;margin:0 auto;border:0;outline:none;" />
              </a>
              <div class="text-muted" style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.22em; color: #6a7499; margin-top: 8px; font-weight: 600;">Stay a little longer</div>
            </td>
          </tr>
          <tr>
            <td class="card-surface" style="background-color: #ffffff; border-radius: 24px; border: 1px solid rgba(56, 65, 104, 0.1); padding: 44px 36px; box-shadow: 0 12px 36px rgba(36, 43, 75, 0.04);">
              <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
                <tr>
                  <td>
                    <span class="tag-chip" style="display: inline-block; padding: 6px 14px; background-color: #f1ede4; color: #384168; border-radius: 9999px; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;">
                      AERA Bulletin
                    </span>
                    <h1 class="text-title" style="margin: 20px 0 16px; font-size: 26px; line-height: 1.3; font-weight: 600; color: #242b4b; letter-spacing: -0.02em;">
                      ${safeTitle}
                    </h1>
                  </td>
                </tr>
              </table>
              ${imageBlock}
              <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="margin-top: 10px;">
                <tr>
                  <td>
                    ${bodyHtml}
                    ${ctaBlock}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 32px 20px 0;">
              <table border="0" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td align="center" style="padding-bottom: 12px;">
                    <a href="https://www.instagram.com/aeraclucofficial" target="_blank" class="footer-text" style="color: #727b9e; font-size: 12px; text-decoration: none; margin: 0 8px;">Instagram</a>
                    <span class="footer-text" style="color: #c4c7d5;">&bull;</span>
                    <a href="https://www.tiktok.com/@aeraclucofficial" target="_blank" class="footer-text" style="color: #727b9e; font-size: 12px; text-decoration: none; margin: 0 8px;">TikTok</a>
                    <span class="footer-text" style="color: #c4c7d5;">&bull;</span>
                    <a href="https://www.facebook.com/thisisaera" target="_blank" class="footer-text" style="color: #727b9e; font-size: 12px; text-decoration: none; margin: 0 8px;">Facebook</a>
                  </td>
                </tr>
                <tr>
                  <td align="center" class="footer-text" style="font-size: 12px; color: #7882a5; line-height: 1.6;">
                    You’re receiving this because you subscribed to AERA newsletter.<br>
                    &copy; 2026 AERA. All rights reserved.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderContactInquiryEmail({ name, email, phone, subject, message }) {
  const logoUrl = getLogoUrl();
  const siteUrl = getSiteUrl();
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { background-color: #f7f4ee; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 24px; color: #384168; }
    .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 20px; border: 1px solid rgba(56,65,104,0.12); padding: 36px 32px; box-shadow: 0 8px 30px rgba(36,43,75,0.05); }
    .title { font-size: 22px; font-weight: 700; color: #242b4b; margin: 12px 0 20px; }
    .chip { display: inline-block; padding: 5px 12px; background: #e8ecf6; color: #242b4b; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; }
    .meta-box { background: #faf9f7; border-radius: 12px; padding: 16px 20px; margin-bottom: 24px; border: 1px solid rgba(56,65,104,0.06); }
    .meta-row { margin: 6px 0; font-size: 14px; }
    .meta-label { font-weight: 600; color: #727b9e; display: inline-block; width: 80px; }
    .msg-body { font-size: 15px; line-height: 1.7; color: #384168; white-space: pre-wrap; background: #faf9f7; border-left: 3px solid #384168; padding: 12px 18px; margin: 16px 0; border-radius: 0 8px 8px 0; }
  </style>
</head>
<body>
  <div style="text-align: center; margin-bottom: 20px;">
    <a href="${siteUrl}" target="_blank" style="text-decoration:none;">
      <img src="${logoUrl}" alt="AERA" width="96" height="58" style="display:block;width:96px;height:auto;margin:0 auto;border:0;" />
    </a>
  </div>
  <div class="card">
    <span class="chip">New Website Inquiry</span>
    <h1 class="title">${escapeHtml(subject)}</h1>
    <div class="meta-box">
      <div class="meta-row"><span class="meta-label">From:</span> <b>${escapeHtml(name)}</b></div>
      <div class="meta-row"><span class="meta-label">Email:</span> <a href="mailto:${escapeHtml(email)}" style="color:#384168;">${escapeHtml(email)}</a></div>
      <div class="meta-row"><span class="meta-label">Phone:</span> ${escapeHtml(phone || "Not provided")}</div>
      <div class="meta-row"><span class="meta-label">Received:</span> ${new Date().toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</div>
    </div>
    <div style="font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; color: #727b9e;">Customer Message:</div>
    <div class="msg-body">${escapeHtml(message)}</div>
    <div style="text-align: center; margin-top: 28px;">
      <a href="mailto:${escapeHtml(email)}?subject=Re: ${encodeURIComponent(subject)}" style="display:inline-block;padding:12px 28px;background:#384168;color:#ffffff;text-decoration:none;border-radius:999px;font-size:13px;font-weight:600;">Reply Directly to Customer</a>
    </div>
  </div>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, req);

  try {
    const { action, ...body } = await req.json();
    const db = adminClient();

    if (action === "get-branding" || action === "get-logo") {
      return json({
        logoUrl: getLogoUrl(),
        siteUrl: getSiteUrl(),
        brandName: "AERA",
        tagline: "Stay a little longer"
      });
    }

    if (action === "create-order") {
      const customer = body.customer || {}, delivery = body.delivery || {}, items = Array.isArray(body.items) ? body.items : [];
      if (!emailOk(customer.email) || clean(customer.name, 120).length < 2 || !items.length) {
        return json({ error: "Please provide a valid customer email, name, and order items." }, 400);
      }
      const normalizedItems = items.slice(0, 30).map((item) => ({
        id: clean(item.id, 100),
        name: clean(item.name, 150),
        qty: Math.max(1, Math.min(99, Number(item.qty) || 1)),
        price: Math.max(0, Number(item.price) || 0),
        meta: clean(item.meta, 150),
        img: clean(item.img, 1000)
      }));
      if (normalizedItems.some((item) => !item.name || !Number.isFinite(item.price))) {
        return json({ error: "Invalid order items." }, 400);
      }

      // Independent product price & active discount validation from DB
      const { data: dbProducts } = await db.from("products").select("id,name,price,discount,discount_type,active");
      let calculatedSubtotal = 0;
      const verifiedItems = normalizedItems.map((item) => {
        const match = dbProducts?.find((p) => (item.id && p.id === item.id) || p.name.toLowerCase() === item.name.toLowerCase());
        let unitPrice = item.price;
        let originalPrice = item.price;
        let appliedDiscount = 0;
        if (match) {
          originalPrice = Number(match.price) || 0;
          const disc = Number(match.discount) || 0;
          if (disc > 0) {
            appliedDiscount = disc;
            if (match.discount_type === "fixed") {
              unitPrice = Math.max(0, originalPrice - disc);
            } else {
              unitPrice = Math.max(0, originalPrice * (1 - disc / 100));
            }
          } else {
            unitPrice = originalPrice;
          }
        }
        unitPrice = Math.round(unitPrice * 100) / 100;
        calculatedSubtotal += unitPrice * item.qty;
        return {
          ...item,
          price: unitPrice,
          originalPrice,
          discount: appliedDiscount
        };
      });
      calculatedSubtotal = Math.round(calculatedSubtotal * 100) / 100;

      // Independent GGX shipping calculation (Origin: Greater Metro Manila)
      const deliveryCity = clean(delivery.city, 120).toLowerCase();
      const deliveryArea = clean(delivery.area, 60).toLowerCase();
      let validatedShipping = 150; // default Luzon fallback

      const { data: zones } = await db.from("shipping_zones").select("code,name,rate,cities,is_active");
      if (deliveryArea === "mm" || deliveryArea === "metro manila" ||
          ["caloocan", "las piñas", "makati", "malabon", "mandaluyong", "manila", "marikina", "muntinlupa", "navotas", "parañaque", "pasay", "pasig", "quezon city", "san juan", "taguig", "valenzuela", "pateros"].some((c) => deliveryCity.includes(c))) {
        validatedShipping = 80;
      } else if (deliveryArea === "cavite" || ["bacoor", "dasmarinas", "dasmariñas", "general trias", "imus", "tanza", "trece martires"].some((c) => deliveryCity.includes(c))) {
        validatedShipping = 150;
      } else if (deliveryArea === "rizal" || ["antipolo", "cainta", "san mateo", "taytay", "binangonan", "rodriguez"].some((c) => deliveryCity.includes(c))) {
        validatedShipping = 150;
      } else if (deliveryArea === "bulacan" || ["balagtas", "baliuag", "bulacan", "guiguinto", "malolos", "plaridel", "pulilan"].some((c) => deliveryCity.includes(c))) {
        validatedShipping = 150;
      } else if (deliveryArea === "visayas") {
        validatedShipping = 180;
      } else if (deliveryArea === "mindanao") {
        validatedShipping = 200;
      } else if (deliveryArea === "luzon") {
        validatedShipping = 150;
      }

      if (zones && zones.length) {
        const matched = zones.find((z) => z.is_active && (z.code === deliveryArea || (Array.isArray(z.cities) && z.cities.some((c) => deliveryCity.includes(c.toLowerCase())))));
        if (matched) {
          validatedShipping = Number(matched.rate) || validatedShipping;
        }
      }

      // Check site_content for free shipping threshold
      const { data: freeShipSetting } = await db.from("site_content").select("value").eq("key", "shipping_free_over").maybeSingle();
      const freeShipThreshold = Number(freeShipSetting?.value) || 0;
      if (freeShipThreshold > 0 && calculatedSubtotal >= freeShipThreshold) {
        validatedShipping = 0;
      }

      // VAT calculation (12% default, inclusive for PH retail)
      const vatRate = 12;
      const netSubtotal = Math.round((calculatedSubtotal / (1 + vatRate / 100)) * 100) / 100;
      const vatAmount = Math.round((calculatedSubtotal - netSubtotal) * 100) / 100;
      const total = calculatedSubtotal + validatedShipping;

      const orderNumber = `AERA-${new Date().getUTCFullYear()}-${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
      const trackingToken = crypto.randomUUID() + crypto.randomUUID();
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(trackingToken));
      const tokenHash = Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
      let receiptPath = null;
      if (body.receipt) {
        const mime = clean(body.receipt.mime, 80);
        const encoded = clean(body.receipt.base64, 14_000_000);
        if (!/^image\/(jpeg|png|webp)$/.test(mime) || !encoded || encoded.length > 13_981_016) {
          return json({ error: "Receipt must be a JPEG, PNG, or WebP under 10 MB." }, 400);
        }
        const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
        if (bytes.byteLength > 10 * 1024 * 1024) return json({ error: "Receipt must be under 10 MB." }, 400);
        const extension = mime === "image/jpeg" ? "jpg" : mime.split("/")[1];
        receiptPath = `${orderNumber}.${extension}`;
        const { error: receiptError } = await db.storage.from("receipts").upload(receiptPath, bytes, { contentType: mime, upsert: false });
        if (receiptError) throw new Error("Receipt upload failed.");
      }

      const { data: order, error } = await db.from("orders").insert({
        order_number: orderNumber,
        customer_name: clean(customer.name, 120),
        customer_email: clean(customer.email, 254).toLowerCase(),
        customer_phone: clean(customer.phone, 30),
        street: clean(delivery.street, 200),
        barangay: clean(delivery.barangay, 120),
        city: clean(delivery.city, 120),
        province: clean(delivery.area, 60),
        zip: clean(delivery.zip, 20),
        delivery_notes: clean(delivery.note, 500),
        items: verifiedItems,
        subtotal: calculatedSubtotal,
        shipping: validatedShipping,
        vat_rate: vatRate,
        vat_amount: vatAmount,
        total,
        payment_method: clean(body.paymentMethod, 50),
        receipt_url: receiptPath,
        status: "order_received",
        tracking_token_hash: tokenHash,
        status_updated_at: new Date().toISOString()
      }).select("id,order_number,created_at,total,status").single();
      if (error) throw error;
      await db.from("order_status_history").insert({ order_id: order.id, status: "order_received", note: "Order received" });
      const trackUrl = `${Deno.env.get("PUBLIC_SITE_URL") || "https://ravecalangi.github.io/area-new"}/track-order.html`;
      const luxuryHtml = renderOrderConfirmationEmail({
        customerName: clean(customer.name, 120),
        orderNumber,
        orderDate: new Date().toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }),
        items: verifiedItems,
        subtotal: calculatedSubtotal,
        shipping: validatedShipping,
        vatAmount,
        vatRate,
        total,
        deliveryArea: [clean(delivery.barangay, 120), clean(delivery.city, 120), clean(delivery.area, 60)].filter(Boolean).join(", "),
        trackUrl
      });
      const emailSent = await sendBrevo({ sender: sender(), to: [{ email: clean(customer.email, 254) }], subject: `AERA — Order Received ${orderNumber}`, htmlContent: luxuryHtml });
      return json({ orderNumber, trackingToken, orderDate: order.created_at, total, status: "order_received", emailSent }, 201);
    }

    if (action === "track-order") {
      const orderNumber = clean(body.orderNumber, 40).toUpperCase();
      const email = clean(body.email, 254).toLowerCase();
      if (!/^[A-Z0-9-]{10,40}$/i.test(orderNumber)) return json({ error: "Enter a valid Order ID." }, 400);
      if (!email || !emailOk(email)) return json({ error: "Enter your order ID and the email used at checkout." }, 400);
      const { data: order } = await db.from("orders").select("id,order_number,created_at,status,status_updated_at,items,total,shipping,vat_amount").eq("order_number", orderNumber).eq("customer_email", email).maybeSingle();
      if (!order) return json({ error: "We could not find an order matching that ID and email combination." }, 404);
      const { data: history } = await db.from("order_status_history").select("status,note,created_at").eq("order_id", order.id).order("created_at", { ascending: true });
      return json({ order: { ...order, history: history || [] } });
    }

    if (action === "admin-list-orders") {
      await requireAdmin(req);
      const { data, error } = await db.from("orders").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return json({ orders: data || [] });
    }

    if (action === "admin-list-blogs") {
      await requireAdmin(req);
      const { data, error } = await db.from("blogs").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return json({ blogs: data || [] });
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
      const email = clean(body.email, 254).toLowerCase();
      if (!emailOk(email)) return json({ error: "Enter a valid email address." }, 400);
      await db.from("newsletter_subscribers").upsert({ email, status: "subscribed" }, { onConflict: "email" });
      const welcomeHtml = renderNewsletterEmail({
        subject: "Welcome to AERA Circle",
        title: "Welcome to our ritual.",
        message: "Thank you for joining AERA Circle. We’re glad to have you with us for quiet rituals, new releases, and subscriber-only notes.\n\nTake your time, breathe, and stay a little longer.",
        ctaLabel: "Explore the Collection",
        ctaUrl: `${getSiteUrl()}shop.html`
      });
      sendBrevo({
        sender: sender(),
        to: [{ email }],
        subject: "Welcome to AERA Circle",
        htmlContent: welcomeHtml
      }).catch((err) => console.error("Welcome email notice:", err));
      return json({ message: "You’re on the list." });
    }

    if (action === "contact") {
      const email = clean(body.email, 254).toLowerCase();
      const name = clean(body.name, 120);
      const subject = clean(body.subject, 160) || "General Inquiry";
      const message = clean(body.message, 4000);
      const phone = clean(body.phone, 40);

      if (!emailOk(email) || name.length < 2 || message.length < 3) {
        return json({ error: "Please provide your name, valid email, and your message." }, 400);
      }

      // 1. Immediately log inquiry to contact_inquiries table so no message is lost
      let inquiryId = null;
      try {
        const { data: inq } = await db.from("contact_inquiries").insert({
          name, email, phone, subject, message, email_sent: false
        }).select("id").single();
        if (inq) inquiryId = inq.id;
      } catch (err) {
        console.error("Inquiry logging notice:", err);
      }

      // 2. Deliver email notification
      const recipient = Deno.env.get("CONTACT_RECIPIENT_EMAIL") || "contactaeraofficial@gmail.com";
      const inquiryHtml = renderContactInquiryEmail({ name, email, phone, subject, message });
      let emailSent = false;
      try {
        emailSent = await sendBrevo({
          sender: sender(),
          replyTo: { email, name },
          to: [{ email: recipient }],
          subject: `AERA Contact Inquiry — ${subject}`,
          htmlContent: inquiryHtml,
          textContent: `Customer Contact Inquiry\n-----------------------\nFrom: ${name} <${email}>\nPhone: ${phone || "N/A"}\nSubject: ${subject}\nSubmitted: ${new Date().toISOString()}\n\nMessage:\n${message}`
        });
        if (emailSent && inquiryId) {
          await db.from("contact_inquiries").update({ email_sent: true }).eq("id", inquiryId);
        }
      } catch (err) {
        console.error("Contact email delivery notice:", err);
      }

      return json({
        message: emailSent
          ? "Your message has been sent successfully. We'll get back to you soon."
          : "Your message was received and logged. Our team will get back to you soon."
      });
    }

    // ── REVIEWS API ──
    if (action === "submit-review") {
      const customerName = clean(body.customerName || body.name, 120);
      const customerEmail = clean(body.customerEmail || body.email, 254).toLowerCase();
      const rating = Math.max(1, Math.min(5, parseInt(body.rating, 10) || 5));
      const reviewTitle = clean(body.reviewTitle || body.title, 200);
      const reviewContent = clean(body.reviewContent || body.content || body.message, 2000);
      const productId = clean(body.productId, 100) || null;
      const productName = clean(body.productName, 200) || null;

      if (!customerName || customerName.length < 2 || !emailOk(customerEmail) || !reviewContent || reviewContent.length < 3) {
        return json({ error: "Please provide your name, valid email, and your review." }, 400);
      }

      // Check if reviews are globally enabled in site_content
      const { data: setting } = await db.from("site_content").select("value").eq("key", "reviews_enabled").maybeSingle();
      if (setting && setting.value === "false") {
        return json({ error: "Product reviews are currently not accepting submissions." }, 403);
      }

      const { data, error } = await db.from("reviews").insert({
        product_id: productId,
        product_name: productName,
        customer_name: customerName,
        customer_email: customerEmail,
        rating,
        review_title: reviewTitle,
        review_content: reviewContent,
        status: "pending",
        is_visible: true
      }).select("id,customer_name,rating,created_at").single();

      if (error) throw error;
      return json({ message: "Thank you! Your review has been submitted for moderation.", review: data }, 201);
    }

    if (action === "admin-list-reviews") {
      await requireAdmin(req);
      const { data, error } = await db.from("reviews").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return json({ reviews: data || [] });
    }

    if (action === "admin-update-review") {
      const user = await requireAdmin(req);
      const id = clean(body.id, 100);
      if (!id) return json({ error: "Review ID is required." }, 400);
      const updates = {
        updated_at: new Date().toISOString(),
        updated_by: user.id
      };
      if (body.rating !== undefined) updates.rating = Math.max(1, Math.min(5, parseInt(body.rating, 10) || 5));
      if (body.reviewTitle !== undefined) updates.review_title = clean(body.reviewTitle, 200);
      if (body.reviewContent !== undefined) updates.review_content = clean(body.reviewContent, 2000);
      if (body.status && ["pending", "approved", "rejected"].includes(body.status)) updates.status = body.status;
      if (typeof body.isVisible === "boolean") updates.is_visible = body.isVisible;

      const { data, error } = await db.from("reviews").update(updates).eq("id", id).select().single();
      if (error) throw error;
      return json({ message: "Review updated successfully.", review: data });
    }

    if (action === "admin-delete-review") {
      await requireAdmin(req);
      const id = clean(body.id, 100);
      if (!id) return json({ error: "Review ID is required." }, 400);
      const { error } = await db.from("reviews").delete().eq("id", id);
      if (error) throw error;
      return json({ ok: true, message: "Review deleted successfully." });
    }

    if (action === "admin-toggle-reviews-global") {
      await requireAdmin(req);
      const enabled = body.enabled === true || body.enabled === "true";
      const { error } = await db.from("site_content").upsert({
        key: "reviews_enabled",
        value: enabled ? "true" : "false",
        updated_at: new Date().toISOString()
      }, { onConflict: "key" });
      if (error) throw error;
      return json({ message: `Public reviews ${enabled ? 'enabled' : 'disabled'} successfully.`, enabled });
    }

    // ── SHIPPING ZONES API ──
    if (action === "admin-list-shipping-zones") {
      await requireAdmin(req);
      const { data, error } = await db.from("shipping_zones").select("*").order("sort_order", { ascending: true });
      if (error) throw error;
      return json({ zones: data || [] });
    }

    if (action === "admin-save-shipping-zone") {
      await requireAdmin(req);
      const code = clean(body.code, 40).toLowerCase();
      const name = clean(body.name, 100);
      const rate = Math.max(0, Number(body.rate) || 0);
      const cities = Array.isArray(body.cities) ? body.cities.map((c) => clean(c, 100)).filter(Boolean) : [];
      const description = clean(body.description, 250);
      const isActive = body.isActive !== false;
      const sortOrder = parseInt(body.sortOrder, 10) || 50;

      if (!code || !name) return json({ error: "Zone code and name are required." }, 400);
      const { data, error } = await db.from("shipping_zones").upsert({
        code,
        name,
        rate,
        cities,
        description,
        is_active: isActive,
        sort_order: sortOrder,
        updated_at: new Date().toISOString()
      }, { onConflict: "code" }).select().single();
      if (error) throw error;
      return json({ message: "Shipping zone saved successfully.", zone: data });
    }

    if (action === "admin-delete-shipping-zone") {
      await requireAdmin(req);
      const code = clean(body.code, 40).toLowerCase();
      if (!code) return json({ error: "Zone code is required." }, 400);
      const { error } = await db.from("shipping_zones").delete().eq("code", code);
      if (error) throw error;
      return json({ ok: true, message: "Shipping zone removed." });
    }

    if (action === "reseller-me") {
      const user = await currentUser(req);
      if (!user) return json({ error: "Unauthorized" }, 401);
      const { data: profile } = await db.from("profiles").select("id,role,full_name,business_name,contact_number,address,is_active,created_at").eq("id", user.id).maybeSingle();
      if (!profile || profile.role !== "reseller" || !profile.is_active) return json({ error: "This reseller account is unavailable." }, 403);
      const { data: balance } = await db.from("reseller_balances").select("balance,updated_at").eq("reseller_id", user.id).maybeSingle();
      const { data: transactions } = await db.from("reseller_balance_transactions").select("transaction_type,amount,description,balance_after,created_at").eq("reseller_id", user.id).order("created_at", { ascending: false }).limit(20);
      return json({ profile, email: user.email, balance: balance?.balance || 0, transactions: transactions || [] });
    }

    if (action === "admin-update-order-status") {
      const admin = await requireAdmin(req);
      const status = clean(body.status, 30);
      if (!orderStatuses.has(status)) return json({ error: "Invalid order status." }, 400);
      const { data: order, error } = await db.from("orders").update({ status, status_updated_at: new Date().toISOString() }).eq("id", clean(body.orderId, 80)).select("id,order_number,customer_email").single();
      if (error) throw error;
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
      return json({ resellers: data || [] });
    }

    if (action === "admin-create-reseller") {
      await requireAdmin(req);
      const email = clean(body.email, 254).toLowerCase(), password = String(body.password || "");
      if (!emailOk(email) || clean(body.fullName, 120).length < 2 || password.length < 12) {
        return json({ error: "Provide a name, valid email, and a password of at least 12 characters." }, 400);
      }
      const { data: created, error: createError } = await db.auth.admin.createUser({ email, password, email_confirm: true });
      if (createError) return json({ error: createError.message }, 400);
      const initialBalance = Math.max(0, Number(body.initialBalance) || 0);
      const { error: profileError } = await db.from("profiles").insert({
        id: created.user.id,
        role: "reseller",
        full_name: clean(body.fullName, 120),
        business_name: clean(body.businessName, 160),
        contact_number: clean(body.contactNumber, 30),
        address: clean(body.address, 500),
        is_active: body.isActive !== false
      });
      if (profileError) {
        await db.auth.admin.deleteUser(created.user.id);
        throw profileError;
      }
      await db.from("reseller_balances").insert({ reseller_id: created.user.id, balance: initialBalance });
      if (initialBalance) {
        await db.from("reseller_balance_transactions").insert({ reseller_id: created.user.id, transaction_type: "credit", amount: initialBalance, description: "Initial balance", balance_after: initialBalance });
      }
      return json({ id: created.user.id }, 201);
    }

    if (action === "admin-update-reseller") {
      await requireAdmin(req);
      const id = clean(body.resellerId, 80);
      const payload = {
        full_name: clean(body.fullName, 120),
        business_name: clean(body.businessName, 160),
        contact_number: clean(body.contactNumber, 30),
        address: clean(body.address, 500),
        is_active: body.isActive !== false
      };
      const { error } = await db.from("profiles").update(payload).eq("id", id).eq("role", "reseller");
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "admin-adjust-balance") {
      const admin = await requireAdmin(req);
      const id = clean(body.resellerId, 80), amount = Number(body.amount), type = clean(body.transactionType, 20);
      if (!Number.isFinite(amount) || amount <= 0 || !["credit", "debit", "adjustment"].includes(type)) {
        return json({ error: "Enter a valid positive balance amount." }, 400);
      }
      const { data: current, error: balanceError } = await db.from("reseller_balances").select("balance").eq("reseller_id", id).single();
      if (balanceError) throw balanceError;
      const next = type === "debit" ? Number(current.balance) - amount : Number(current.balance) + amount;
      if (next < 0) return json({ error: "This debit would make the balance negative." }, 400);
      const { error: updateError } = await db.from("reseller_balances").update({ balance: next, updated_at: new Date().toISOString() }).eq("reseller_id", id);
      if (updateError) throw updateError;
      await db.from("reseller_balance_transactions").insert({ reseller_id: id, transaction_type: type, amount, description: clean(body.description, 300), balance_after: next, created_by: admin.id });
      return json({ balance: next });
    }

    if (action === "admin-list-subscribers") {
      await requireAdmin(req);
      const { data: subscribers, error } = await db.from("newsletter_subscribers").select("id, email, status, created_at").order("created_at", { ascending: false });
      if (error) throw error;
      return json({ subscribers: subscribers || [], count: (subscribers || []).length });
    }

    if (action === "admin-add-subscriber") {
      await requireAdmin(req);
      const email = clean(body.email, 254).toLowerCase();
      if (!emailOk(email)) return json({ error: "Valid email address required." }, 400);
      const { data, error } = await db.from("newsletter_subscribers").upsert({ email, status: "subscribed", updated_at: new Date().toISOString() }, { onConflict: "email" }).select().single();
      if (error) throw error;
      return json({ ok: true, subscriber: data });
    }

    if (action === "admin-delete-subscriber") {
      await requireAdmin(req);
      const email = clean(body.email, 254).toLowerCase();
      if (!email) return json({ error: "Subscriber email required." }, 400);
      const { error } = await db.from("newsletter_subscribers").delete().eq("email", email);
      if (error) throw error;
      return json({ ok: true, message: "Subscriber removed." });
    }

    if (action === "admin-send-newsletter") {
      const user = await requireAdmin(req);
      const subject = clean(body.subject, 180);
      const preheader = clean(body.preheader, 200);
      const title = clean(body.title, 200);
      const message = clean(body.message, 20000);
      const imageUrl = clean(body.imageUrl, 1000);
      const imageCaption = clean(body.imageCaption, 200);
      const ctaLabel = clean(body.ctaLabel, 80);
      const ctaUrl = clean(body.ctaUrl, 500);
      const testEmail = clean(body.testEmail, 254).toLowerCase();

      if (!subject || !message) return json({ error: "Subject and announcement message are required." }, 400);

      const htmlContent = renderNewsletterEmail({
        subject,
        preheader,
        title: title || subject,
        message,
        imageUrl,
        imageCaption,
        ctaLabel,
        ctaUrl,
        unsubscribeEmail: testEmail || "subscriber@aera.com"
      });

      if (testEmail) {
        if (!emailOk(testEmail)) return json({ error: "Invalid test email address." }, 400);
        await sendBrevo({
          sender: sender(),
          to: [{ email: testEmail }],
          subject: `[PREVIEW] ${subject}`,
          htmlContent
        });
        return json({ ok: true, message: `Preview sent to ${testEmail}.` });
      }

      const { data: subs, error: subsError } = await db.from("newsletter_subscribers").select("email").eq("status", "subscribed");
      if (subsError) throw subsError;
      if (!subs || !subs.length) return json({ error: "No active subscribers found in database." }, 400);

      let sentCount = 0;
      for (const sub of subs) {
        if (emailOk(sub.email)) {
          try {
            await sendBrevo({
              sender: sender(),
              to: [{ email: sub.email }],
              subject,
              htmlContent
            });
            sentCount++;
          } catch (e) {
            console.error(`Failed to send to ${sub.email}:`, e);
          }
        }
      }

      // Log into newsletter_campaigns
      await db.from("newsletter_campaigns").insert({
        subject,
        preheader,
        title,
        message,
        image_url: imageUrl,
        image_caption: imageCaption,
        cta_label: ctaLabel,
        cta_url: ctaUrl,
        recipients_count: sentCount,
        sent_by: user.id
      }).catch((err) => console.error("Log campaign notice:", err));

      return json({ ok: true, count: sentCount, message: `Newsletter broadcast sent to ${sentCount} subscriber(s).` });
    }

    if (action === "upload-reseller-doc") {
      const tempId = clean(body.tempId, 80).replace(/[^a-zA-Z0-9_-]/g, "") || crypto.randomUUID();
      const docKey = clean(body.docKey, 40);
      const allowedKeys = ["id1_front", "id1_back", "id2_front", "id2_back", "profile_photo", "signature"];
      if (!allowedKeys.includes(docKey)) {
        return json({ error: "Invalid document type." }, 400);
      }
      const dataUrl = String(body.dataUrl || "");
      const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) {
        return json({ error: "Please upload a valid JPG, PNG, WebP, or PDF file." }, 400);
      }
      const contentType = match[1];
      const b64 = match[2];
      const binaryStr = atob(b64);
      if (binaryStr.length > 5 * 1024 * 1024) {
        return json({ error: "File size must be 5 MB or smaller." }, 400);
      }
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const ext = contentType === "application/pdf" ? "pdf" : contentType.split("/")[1];
      const path = `${tempId}/${docKey}-${Date.now()}.${ext}`;
      const { error: uploadError } = await db.storage.from("reseller-documents").upload(path, bytes, {
        contentType,
        upsert: true
      });
      if (uploadError) throw uploadError;
      return json({ ok: true, path });
    }

    if (action === "submit-reseller-application") {
      const fullName = clean(body.fullName, 160);
      const mobileNumber = clean(body.mobileNumber, 40);
      const email = clean(body.email, 254).toLowerCase();
      const currentAddress = clean(body.currentAddress, 500);
      const deliveryAddress = clean(body.deliveryAddress, 500);
      const preferredTier = clean(body.preferredTier, 20);
      const initialOrderTiming = clean(body.initialOrderTiming, 80);
      const deliveryExpectation = clean(body.deliveryExpectation, 80);
      const printedName = clean(body.printedName, 160);
      const signatureName = clean(body.signatureName, 160);
      const signedDate = clean(body.signedDate, 40);
      const eSigConsent = body.electronicSignatureConsent === true;
      const consents = (body.consents && typeof body.consents === "object") ? body.consents : {};

      if (fullName.length < 2 || !mobileNumber || !emailOk(email) || !currentAddress || !deliveryAddress) {
        return json({ error: "Please complete all required applicant information in Section A." }, 400);
      }
      if (!["tier1", "tier2", "tier3", "assist"].includes(preferredTier) || !initialOrderTiming) {
        return json({ error: "Please select your preferred reseller tier and initial order timing in Section C." }, 400);
      }
      if (!deliveryExpectation) {
        return json({ error: "Please select how you expect to receive your orders in Section D." }, 400);
      }
      const requiredConsents = ["accurate", "approvalOnly", "termsAgreed", "confirmBeforePay", "idRequirement", "privacyNotice", "idConsent"];
      if (!requiredConsents.every((k) => consents[k] === true)) {
        return json({ error: "Please check all required confirmation and consent boxes in Section E." }, 400);
      }
      if (!printedName || !signatureName || !signedDate || !eSigConsent) {
        return json({ error: "Please complete your printed name, electronic signature, date, and e-signature confirmation." }, 400);
      }

      const idSubmitLater = body.idSubmitLater === true;
      const idDocPaths = (body.idDocPaths && typeof body.idDocPaths === "object") ? body.idDocPaths : {};
      const profilePhotoPath = clean(body.profilePhotoPath, 300) || null;
      if (!idSubmitLater && (!idDocPaths.id1_front || !idDocPaths.id2_front || !profilePhotoPath)) {
        return json({ error: "Please upload both Valid IDs and your 2x2 profile photo, or check the option to submit them separately." }, 400);
      }

      const referenceCode = `AERA-RES-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      const row = {
        reference_code: referenceCode,
        full_name: fullName,
        mobile_number: mobileNumber,
        email,
        current_address: currentAddress,
        delivery_address: deliveryAddress,
        contact_channels: Array.isArray(body.contactChannels) ? body.contactChannels.map((x) => clean(x, 60)).filter(Boolean) : [],
        contact_channel_other: clean(body.contactChannelOther, 120) || null,
        contact_channel_details: clean(body.contactChannelDetails, 300) || null,
        currently_selling: body.currentlySelling === true,
        existing_shop_name: clean(body.existingShopName, 160) || null,
        current_products_sold: clean(body.currentProductsSold, 500) || null,
        selling_channels: Array.isArray(body.sellingChannels) ? body.sellingChannels.map((x) => clean(x, 80)).filter(Boolean) : [],
        selling_channel_other: clean(body.sellingChannelOther, 120) || null,
        applying_for: body.applyingFor === "business" ? "business" : "self",
        registered_business_name: clean(body.registeredBusinessName, 160) || null,
        business_role: clean(body.businessRole, 120) || null,
        business_authorized: body.businessAuthorized === true,
        preferred_tier: preferredTier,
        initial_order_timing: initialOrderTiming,
        preferred_order_date: clean(body.preferredOrderDate, 40) || null,
        interested_products: Array.isArray(body.interestedProducts) ? body.interestedProducts.map((x) => clean(x, 80)).filter(Boolean) : [],
        delivery_expectation: deliveryExpectation,
        assistance_needed: Array.isArray(body.assistanceNeeded) ? body.assistanceNeeded.map((x) => clean(x, 100)).filter(Boolean) : [],
        assistance_other: clean(body.assistanceOther, 200) || null,
        needs_auth_letter: ["yes", "no", "not_sure"].includes(clean(body.needsAuthLetter, 20)) ? clean(body.needsAuthLetter, 20) : "no",
        auth_letter_platform: clean(body.authLetterPlatform, 160) || null,
        additional_notes: clean(body.additionalNotes, 2000) || null,
        id_submit_later: idSubmitLater,
        id_doc_paths: idDocPaths,
        profile_photo_path: profilePhotoPath,
        consents,
        printed_name: printedName,
        signature_name: signatureName,
        signed_date: signedDate,
        electronic_signature_consent: eSigConsent,
        status: "pending"
      };

      const { data: inserted, error: insertError } = await db.from("reseller_applications").insert(row).select("id,reference_code").single();
      if (insertError) throw insertError;

      try {
        await sendBrevo({
          sender: sender(),
          to: [{ email, name: fullName }],
          subject: `AERA Circle Reseller Application Received (${referenceCode})`,
          htmlContent: `<div style="font-family:sans-serif;max-width:560px;margin:auto;color:#384168;line-height:1.6">
            <h2 style="margin-bottom:8px">Thank you for applying to AERA Circle!</h2>
            <p>Hi ${esc(fullName)},</p>
            <p>We have received your reseller application (Reference: <strong>${esc(referenceCode)}</strong>).</p>
            <p>Submitting this form does not guarantee approval yet. Our team will review your details and reach out through your preferred contact channel with next steps before any payment is required.</p>
            ${idSubmitLater ? '<p><strong>Reminder:</strong> Since you opted to submit your 2 valid IDs and 2×2 profile photo separately, please send clear photos via email to <a href="mailto:contactaeraofficial@gmail.com">contactaeraofficial@gmail.com</a> or Facebook Messenger referencing your code above.</p>' : ''}
            <p style="margin-top:20px;font-size:13px;color:#666">Questions? Contact us at contactaeraofficial@gmail.com.</p>
          </div>`
        });
      } catch (mailErr) {
        console.warn("Reseller application confirmation email skipped:", mailErr);
      }

      return json({ ok: true, id: inserted.id, referenceCode: inserted.reference_code }, 201);
    }

    if (action === "admin-list-reseller-applications") {
      await requireAdmin(req);
      const { data, error } = await db.from("reseller_applications").select("*").order("created_at", { ascending: false });
      if (error) throw error;

      const applications = await Promise.all((data || []).map(async (app) => {
        const signedDocs = {};
        const docPaths = (app.id_doc_paths && typeof app.id_doc_paths === "object") ? app.id_doc_paths : {};
        for (const [k, p] of Object.entries(docPaths)) {
          if (typeof p === "string" && p) {
            const { data: s } = await db.storage.from("reseller-documents").createSignedUrl(p, 3600);
            if (s?.signedUrl) signedDocs[k] = s.signedUrl;
          }
        }
        let profilePhotoUrl = null;
        if (typeof app.profile_photo_path === "string" && app.profile_photo_path) {
          const { data: s } = await db.storage.from("reseller-documents").createSignedUrl(app.profile_photo_path, 3600);
          if (s?.signedUrl) profilePhotoUrl = s.signedUrl;
        }
        return { ...app, signedDocs, profilePhotoUrl };
      }));

      return json({ applications });
    }

    if (action === "admin-update-reseller-application") {
      const admin = await requireAdmin(req);
      const id = clean(body.applicationId, 80);
      const status = clean(body.status, 20);
      if (!id || !["pending", "approved", "rejected"].includes(status)) {
        return json({ error: "Invalid application ID or status." }, 400);
      }
      const { error } = await db.from("reseller_applications").update({
        status,
        admin_notes: clean(body.adminNotes, 1000) || null,
        reviewed_by: admin.id,
        reviewed_at: new Date().toISOString()
      }).eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Request failed." }, 500);
  }
});
