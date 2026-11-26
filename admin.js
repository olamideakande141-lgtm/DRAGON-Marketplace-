const OWNER_ID = "8323896060";

const bad = message => Response.json({ error: message }, { status: 400 });

async function verifyWebApp(initData, botToken) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  params.delete("hash");

  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const encoder = new TextEncoder();

  const secretKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const secret = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(botToken));

  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const calculated = await crypto.subtle.sign("HMAC", key, encoder.encode(checkString));

  const calculatedHash = [...new Uint8Array(calculated)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  if (calculatedHash !== hash) return null;

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

  try {
    return JSON.parse(params.get("user"));
  } catch {
    return null;
  }
}

async function tgCall(env, method, data) {
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!result.ok) console.log("ADMIN TELEGRAM ERROR", method, JSON.stringify(result));
  return result;
}

export async function handleAdminMessage(env, message) {
  const chatId = message.chat.id;
  const fromId = String(message.from.id);

  if (fromId !== OWNER_ID) {
    console.log("ADMIN COMMAND DENIED", fromId);
    return tgCall(env, "sendMessage", {
      chat_id: chatId,
      text: "⛔ Access denied. This administration panel is restricted to the platform owner."
    });
  }

  return tgCall(env, "sendMessage", {
    chat_id: chatId,
    text: "🛡 <b>DRAGON ADMIN CONTROL CENTER</b>\n\nTap below to open the owner panel.",
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "🛡 Open Admin Panel", web_app: { url: `${env.PUBLIC_BASE_URL}/admin.html` } }
      ]]
    }
  });
}

async function requireOwner(request, env) {
  const initData = request.headers.get("X-Telegram-Init-Data");
  const user = await verifyWebApp(initData, env.BOT_TOKEN);

  if (!user?.id) {
    return { response: Response.json({ error: "Invalid Telegram session" }, { status: 401 }) };
  }

  if (String(user.id) !== OWNER_ID) {
    console.log("ADMIN API FORBIDDEN", String(user.id));
    return { response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { user };
}

async function writeAudit(env, adminId, action, target, previous, next, reason) {
  await env.DB.prepare(`
    INSERT INTO admin_audit_logs
      (admin_id, action, target, previous_value, new_value, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(
    String(adminId),
    action,
    String(target),
    String(previous ?? ""),
    String(next ?? ""),
    reason
  ).run();
}

async function scalar(env, sql, ...binds) {
  try {
    const stmt = env.DB.prepare(sql);
    const row = await (binds.length ? stmt.bind(...binds) : stmt).first();
    return row ? Object.values(row)[0] || 0 : 0;
  } catch (err) {
    console.log("ADMIN STAT ERROR", sql, String(err));
    return 0;
  }
}

async function overview(env) {
  return Response.json({
    totalUsers: await scalar(env, "SELECT COUNT(*) FROM users"),
    activeUsers: await scalar(env, "SELECT COUNT(*) FROM users WHERE status = 'active'"),
    suspendedUsers: await scalar(env, "SELECT COUNT(*) FROM users WHERE status = 'suspended'"),
    dragonCredited: await scalar(env, "SELECT COALESCE(SUM(amount), 0) FROM ledger WHERE amount > 0"),
    dragonDebited: await scalar(env, "SELECT COALESCE(-SUM(amount), 0) FROM ledger WHERE amount < 0"),
    dragonAvailable: await scalar(env, "SELECT COALESCE(SUM(available), 0) FROM balances"),
    activeCampaigns: await scalar(env, "SELECT COUNT(*) FROM campaigns WHERE status = 'active'"),
    pendingCampaigns: await scalar(env, "SELECT COUNT(*) FROM campaigns WHERE status = 'pending_validation'"),
    adCompletions: await scalar(env, "SELECT COUNT(*) FROM ad_events WHERE status = 'test_completed'"),
    referrals: await scalar(env, "SELECT COUNT(*) FROM referrals"),
    monetagCallbacks: await scalar(env, "SELECT COUNT(*) FROM provider_callbacks")
  });
}

async function searchUsers(env, q) {
  const term = q.trim().replace(/^@/, "");
  const rows = await env.DB.prepare(`
    SELECT telegram_id, username, first_name, joined_at, status
    FROM users
    WHERE telegram_id LIKE ? OR username LIKE ?
    ORDER BY joined_at DESC
    LIMIT 20
  `).bind(`%${term}%`, `%${term}%`).all();

  return Response.json({ results: rows.results || [] });
}

async function userDetail(env, id) {
  const userId = String(id);

  const user = await env.DB.prepare(`
    SELECT telegram_id, username, first_name, joined_at, status
    FROM users WHERE telegram_id = ?
  `).bind(userId).first();

  if (!user) return Response.json({ error: "User not found" }, { status: 404 });

  const balance = await env.DB.prepare(`
    SELECT available, test_credits FROM balances WHERE telegram_id = ?
  `).bind(userId).first();

  const ledger = await env.DB.prepare(`
    SELECT amount, description, created_at
    FROM ledger WHERE telegram_id = ?
    ORDER BY created_at DESC LIMIT 20
  `).bind(userId).all();

  const referrals = await env.DB.prepare(`
    SELECT referred_id, created_at
    FROM referrals WHERE referrer_id = ?
    ORDER BY created_at DESC LIMIT 20
  `).bind(userId).all();

  return Response.json({
    user,
    balance: balance || { available: 0, test_credits: 0 },
    ledger: ledger.results || [],
    referrals: referrals.results || []
  });
}

async function setStatus(request, env, adminId) {
  const body = await request.json();
  const id = String(body.id || "");
  const reason = String(body.reason || "").trim();
  const next = body.action === "reactivate" ? "active" : body.action === "suspend" ? "suspended" : null;

  if (!id || !next) return bad("Invalid request.");
  if (reason.length < 5) return bad("Reason must be at least 5 characters.");
  if (id === OWNER_ID) return bad("The owner account cannot be suspended.");

  const current = await env.DB.prepare(`
    SELECT status FROM users WHERE telegram_id = ?
  `).bind(id).first();

  if (!current) return Response.json({ error: "User not found" }, { status: 404 });

  await env.DB.prepare(`
    UPDATE users SET status = ? WHERE telegram_id = ?
  `).bind(next, id).run();

  await writeAudit(env, adminId, body.action, id, current.status, next, reason);

  return Response.json({ ok: true, status: next });
}

async function adjustBalance(request, env, adminId) {
  const body = await request.json();
  const id = String(body.id || "");
  const amount = Number(body.amount);
  const reason = String(body.reason || "").trim();
  const delta = body.direction === "debit" ? -amount : amount;

  if (!id) return bad("Telegram ID is required.");
  if (!Number.isInteger(amount) || amount <= 0 || amount > 1000000000) {
    return bad("Amount must be a whole number above 0.");
  }
  if (reason.length < 5) return bad("Reason must be at least 5 characters.");

  const before = await env.DB.prepare(`
    SELECT available FROM balances WHERE telegram_id = ?
  `).bind(id).first();

  if (!before) return Response.json({ error: "User balance record not found" }, { status: 404 });

  if (before.available + delta < 0) {
    return bad("This debit would make the balance negative.");
  }

  const update = await env.DB.prepare(`
    UPDATE balances SET available = available + ?
    WHERE telegram_id = ? AND available + ? >= 0
  `).bind(delta, id, delta).run();

  if (!update.meta || update.meta.changes !== 1) {
    return bad("The balance changed during this request. Please try again.");
  }

  const newBalance = before.available + delta;

  await env.DB.prepare(`
    INSERT INTO ledger (telegram_id, amount, description, created_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(id, delta, "Admin adjustment: " + reason).run();

  await writeAudit(env, adminId, "balance_adjustment", id, before.available, newBalance, reason);

  return Response.json({ ok: true, previous: before.available, new: newBalance });
}

async function listCampaigns(env) {
  const rows = await env.DB.prepare(`
    SELECT id, advertiser_id, campaign_type, destination, quantity, total_cost, status, created_at
    FROM campaigns ORDER BY id DESC LIMIT 50
  `).all();

  return Response.json({ results: rows.results || [] });
}

async function listAudit(env) {
  const rows = await env.DB.prepare(`
    SELECT admin_id, action, target, previous_value, new_value, reason, created_at
    FROM admin_audit_logs ORDER BY id DESC LIMIT 50
  `).all();

  return Response.json({ results: rows.results || [] });
}

export async function handleAdminApi(request, env) {
  const auth = await requireOwner(request, env);
  if (auth.response) return auth.response;

  const adminId = String(auth.user.id);
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    if (path === "/admin-api/overview" && request.method === "GET") return overview(env);
    if (path === "/admin-api/users" && request.method === "GET") {
      return searchUsers(env, url.searchParams.get("q") || "");
    }
    if (path === "/admin-api/user" && request.method === "GET") {
      return userDetail(env, url.searchParams.get("id") || "");
    }
    if (path === "/admin-api/status" && request.method === "POST") {
      return setStatus(request, env, adminId);
    }
    if (path === "/admin-api/adjust" && request.method === "POST") {
      return adjustBalance(request, env, adminId);
    }
    if (path === "/admin-api/campaigns" && request.method === "GET") return listCampaigns(env);
    if (path === "/admin-api/audit" && request.method === "GET") return listAudit(env);

    return Response.json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    console.log("ADMIN API ERROR", String(err && err.stack ? err.stack : err));
    return Response.json({ error: "Server error. Check the Worker logs." }, { status: 500 });
  }
}
