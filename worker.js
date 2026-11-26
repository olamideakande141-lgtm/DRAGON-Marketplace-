
/**
 * DRAGON Marketplace 🐉
 * Cloudflare Worker + Telegram Bot API + D1
 *
 * Required secrets:
 * BOT_TOKEN, WEBHOOK_SECRET, SETUP_PASSWORD
 *
 * Required variables:
 * ADMIN_IDS, BOT_USERNAME
 *
 * Required D1 binding:
 * DB
 */

const BRAND = "🐉 <b>DRAGON Marketplace</b>";
const CHANNEL = "@DRAGONMarketplace";
const CHANNEL_URL = "https://t.me/DRAGONMarketplace";
const SUPPORT_URL = "https://t.me/dragon_supports_bot";
const WEBHOOK_PATH = "/telegram-webhook";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response("DRAGON Marketplace bot is running.");
    }

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "dragon-marketplace"
      });
    }

    // Protected webhook setup page
    if (url.pathname === "/setup" && request.method === "GET") {
      return new Response(`
        <!doctype html>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>DRAGON Setup</title>
        <body style="font:16px Arial;background:#f4f6fa;color:#172033">
        <main style="max-width:440px;margin:48px auto;padding:24px;background:white;border-radius:16px">
        <h2>🐉 DRAGON webhook setup</h2>
        <p>Enter your private setup password.</p>
        <form method="post">
        <input name="password" type="password" required
        placeholder="Setup password"
        style="box-sizing:border-box;width:100%;padding:14px;border:1px solid #ccd3df;border-radius:9px">
        <button style="margin-top:14px;padding:13px 18px;border:0;border-radius:9px;background:#263b66;color:white">
        Register webhook
        </button>
        </form>
        </main>
        </body>
      `, {
        headers: {
          "content-type": "text/html;charset=utf-8",
          "cache-control": "no-store"
        }
      });
    }

    if (url.pathname === "/setup" && request.method === "POST") {
      if (!env.SETUP_PASSWORD || !env.BOT_TOKEN || !env.WEBHOOK_SECRET) {
        return new Response("Missing Worker secrets.", { status: 500 });
      }

      const form = await request.formData();

      if (!safeEqual(
        String(form.get("password") || ""),
        env.SETUP_PASSWORD
      )) {
        return new Response("Incorrect setup password.", { status: 403 });
      }

      if (!/^[A-Za-z0-9_-]{1,256}$/.test(env.WEBHOOK_SECRET)) {
        return new Response(
          "WEBHOOK_SECRET may contain only letters, digits, _ and -.",
          { status: 400 }
        );
      }

      const result = await tg(env, "setWebhook", {
        url: url.origin + WEBHOOK_PATH,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query", "chat_member"]
      });

      return new Response(
        result.ok
          ? "Webhook registered. Open Telegram and send /start. Remove /setup and SETUP_PASSWORD after testing."
          : "Telegram error: " + (result.description || "Unknown error"),
        { status: result.ok ? 200 : 502 }
      );
    }

    // Telegram webhook
    if (url.pathname === WEBHOOK_PATH && request.method === "POST") {
      if (!safeEqual(
        request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "",
        env.WEBHOOK_SECRET || ""
      )) {
        return new Response("Unauthorized", { status: 401 });
      }

      let update;

      try {
        update = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      ctx.waitUntil(handleUpdate(update, env));

      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  }
};

function safeEqual(a, b) {
  if (a.length !== b.length) return false;

  let diff = 0;

  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}

async function tg(env, method, body) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  return response.json();
}

async function send(env, chat_id, text, reply_markup) {
  return tg(env, "sendMessage", {
    chat_id,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(reply_markup ? { reply_markup } : {})
  });
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function adminIds(env) {
  return (env.ADMIN_IDS || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
}

function isAdmin(user, env) {
  return adminIds(env).includes(String(user.id));
}

function money(units) {
  return (Number(units || 0) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function homeKeyboard(admin = false) {
  const rows = [
    [
      { text: "💰 My Balance", callback_data: "balance" },
      { text: "🪙 Deposit", callback_data: "deposit" }
    ],
    [
      { text: "🎯 Earn DRAGON", callback_data: "earn" },
      { text: "📣 Promote", callback_data: "promote" }
    ],
    [
      { text: "👥 Refer Friends", callback_data: "refer" },
      { text: "📜 History", callback_data: "history" }
    ],
    [
      { text: "📘 How it works", callback_data: "help" },
      { text: "🆘 Support", url: SUPPORT_URL }
    ]
  ];

  if (admin) {
    rows.push([
      { text: "⚙️ Admin panel", callback_data: "admin" }
    ]);
  }

  return { inline_keyboard: rows };
}

function backKeyboard(admin = false) {
  return {
    inline_keyboard: [
      [{ text: "⬅️ Main menu", callback_data: "home" }],
      ...(admin ? [[{ text: "⚙️ Admin", callback_data: "admin" }]] : [])
    ]
  };
}

async function member(env, id) {
  const result = await tg(env, "getChatMember", {
    chat_id: CHANNEL,
    user_id: id
  });

  return result.ok && (
    ["creator", "administrator", "member"].includes(result.result.status) ||
    (
      result.result.status === "restricted" &&
      result.result.is_member === true
    )
  );
}

async function ensureUser(env, user, refCode) {
  const referrer =
    refCode &&
    /^D\d+$/.test(refCode) &&
    refCode !== `D${user.id}`
      ? refCode.slice(1)
      : null;

  await env.DB.prepare(`
    INSERT OR IGNORE INTO users
    (telegram_user_id, username, first_name, referred_by, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).bind(
    String(user.id),
    user.username || null,
    user.first_name || null,
    referrer
  ).run();

  await env.DB.prepare(`
    INSERT OR IGNORE INTO user_balances
    (telegram_user_id, balance_units, reserved_units, updated_at)
    VALUES (?, 0, 0, datetime('now'))
  `).bind(String(user.id)).run();

  if (referrer) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO referrals
      (referrer_user_id, referred_user_id, fixed_reward_units, status)
      VALUES (?, ?, 250000, 'pending')
    `).bind(referrer, String(user.id)).run();
  }
}

async function requireJoin(env, chat, user) {
  if (await member(env, user.id)) {
    return true;
  }

  await send(
    env,
    chat,
    `${BRAND}

🔒 <b>Channel membership required</b>

Join our official channel before using the marketplace.`,
    {
      inline_keyboard: [
        [{ text: "📢 Join official channel", url: CHANNEL_URL }],
        [{ text: "✅ I've joined — check", callback_data: "check_join" }]
      ]
    }
  );

  return false;
}

async function handleUpdate(update, env) {
  try {
    if (update.callback_query) {
      const q = update.callback_query;

      await tg(env, "answerCallbackQuery", {
        callback_query_id: q.id
      });

      const chat = q.message?.chat?.id;

      if (!chat) return;

      if (q.data === "check_join") {
        if (await member(env, q.from.id)) {
          await send(
            env,
            chat,
            `${BRAND}\n\n✅ Membership confirmed. Welcome!`,
            homeKeyboard(isAdmin(q.from, env))
          );
        } else {
          await send(
            env,
            chat,
            `Membership not confirmed yet. Join ${CHANNEL_URL}`
          );
        }

        return;
      }

      if (!(await requireJoin(env, chat, q.from))) return;

      await routeAction(q.data, chat, q.from, env);
      return;
    }

    const m = update.message;

    if (!m?.from || !m.chat) return;

    const chat = m.chat.id;
    const user = m.from;
    const text = (m.text || "").trim();

    if (text.startsWith("/start")) {
      await ensureUser(env, user, text.split(/\s+/)[1] || null);

      if (!(await requireJoin(env, chat, user))) return;

      await send(
        env,
        chat,
        `${BRAND}
<i>Earn. Promote. Grow.</i>

Hello, <b>${esc(user.first_name || "Dragon member")}</b>!

Choose a service below.`,
        homeKeyboard(isAdmin(user, env))
      );

      return;
    }

    if (text === "/menu") {
      if (await requireJoin(env, chat, user)) {
        await send(
          env,
          chat,
          `${BRAND}\nChoose an option.`,
          homeKeyboard(isAdmin(user, env))
        );
      }

      return;
    }

    if (text === "/admin") {
      if (!isAdmin(user, env)) {
        await send(env, chat, "⛔ Admin access only.");
        return;
      }

      await send(env, chat, adminText(), adminKeyboard());
      return;
    }

    if (text.startsWith("/txid ")) {
      if (!(await requireJoin(env, chat, user))) return;

      const txid = text.slice(6).trim();

      if (txid.length < 20 || txid.length > 160) {
        await send(env, chat, "Please send a valid transaction hash after /txid.");
        return;
      }

      await env.DB.prepare(`
        INSERT OR IGNORE INTO deposit_submissions
        (telegram_user_id, txid, status, created_at)
        VALUES (?, ?, 'needs_verification', datetime('now'))
      `).bind(String(user.id), txid).run();

      await send(
        env,
        chat,
        "🧾 TXID received for verification intake. It has NOT been credited. Blockchain verification must be connected first.",
        homeKeyboard(isAdmin(user, env))
      );

      return;
    }

    if (await requireJoin(env, chat, user)) {
      await send(
        env,
        chat,
        "Use /menu to open DRAGON Marketplace.",
        homeKeyboard(isAdmin(user, env))
      );
    }

  } catch (error) {
    console.error("Update handler error:", error);
  }
}

function adminKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "📊 Overview", callback_data: "admin_stats" },
        { text: "👤 Find user", callback_data: "admin_users" }
      ],
      [
        { text: "💱 Conversion rate", callback_data: "admin_rate" },
        { text: "🎁 Task rewards", callback_data: "admin_rewards" }
      ],
      [
        { text: "⏸ Pause campaigns", callback_data: "admin_pause" }
      ],
      [
        { text: "⬅️ Main menu", callback_data: "home" }
      ]
    ]
  };
}

function adminText() {
  return `${BRAND}

⚙️ <b>Admin control centre</b>

Manage settings and monitor platform activity.`;
}

async function routeAction(action, chat, user, env) {
  const admin = isAdmin(user, env);

  if (action === "home") {
    await send(
      env,
      chat,
      `${BRAND}\nEarn. Promote. Grow.\n\nSelect a service.`,
      homeKeyboard(admin)
    );
    return;
  }

  if (action === "balance") {
    const r = await env.DB.prepare(`
      SELECT balance_units, reserved_units
      FROM user_balances
      WHERE telegram_user_id = ?
    `).bind(String(user.id)).first();

    await send(
      env,
      chat,
      `💰 <b>My Balance</b>

Available: <b>${money(r?.balance_units)} DRAGON</b>
Reserved: ${money(r?.reserved_units)} DRAGON

<i>DRAGON is an internal platform credit, not cash or a withdrawable cryptocurrency.</i>`,
      backKeyboard(admin)
    );

    return;
  }

  if (action === "deposit") {
    await send(
      env,
      chat,
      `🪙 <b>Deposit</b>

Minimum: 5 USDT equivalent.

<b>Bitcoin (BTC)</b>
<code>bc1q5tueekneell0twuaavs9gsacmehtr002g060m2</code>

<b>USDT TRC20</b>
<code>TBTz7KMsaJExn6yb6rXyzFPSdzuwaoLN6h</code>

<b>USDT BEP20</b>
<code>0x5eD3cA649EEA0832B3Ed22B3342Db6076071dFEe</code>

After sending, submit:
<code>/txid YOUR_TRANSACTION_HASH</code>

⚠️ TXIDs are only collected for intake. No balance is credited until blockchain verification is connected and tested.`,
      backKeyboard(admin)
    );

    return;
  }

  if (action === "earn") {
    await send(
      env,
      chat,
      `🎯 <b>Earn DRAGON</b>

📢 Join channel: <b>750</b>
👥 Join group: <b>750</b>
▶️ Verified rewarded ad: <b>100</b>
👁 View post: <b>100</b>
❤️ Reaction: <b>150</b>
🤖 Start promoted bot: <b>2,000</b>
📱 Mini App task: <b>2,000</b>

Membership tasks have a 14-day protection period.

<i>No live tasks are configured yet.</i>`,
      backKeyboard(admin)
    );

    return;
  }

  if (action === "promote") {
    await send(
      env,
      chat,
      `📣 <b>Promote your project</b>

Promote Telegram channels, groups, bots, Mini Apps, post views and reactions.

Campaigns are designed to reserve the full budget before publishing and spend only on verified completions.

<i>Campaign creation and payment processing still need to be connected.</i>`,
      backKeyboard(admin)
    );

    return;
  }

  if (action === "refer") {
    const username = (env.BOT_USERNAME || "YOUR_BOT_USERNAME").replace(/^@/, "");

    await send(
      env,
      chat,
      `👥 <b>Refer Friends</b>

Your referral link:
<code>https://t.me/${esc(username)}?start=D${user.id}</code>

Fixed reward: <b>2,500 DRAGON</b>
Advertiser commission: <b>1%</b>

Referral payouts remain pending until task and channel verification are integrated.`,
      backKeyboard(admin)
    );

    return;
  }

  if (action === "history") {
    const r = await env.DB.prepare(`
      SELECT entry_type, amount_units, note
      FROM dragon_ledger
      WHERE telegram_user_id = ?
      ORDER BY id DESC LIMIT 10
    `).bind(String(user.id)).all();

    const lines = (r.results || []).map(x =>
      `• ${esc(x.entry_type)}: ${money(x.amount_units)} DRAGON — ${esc(x.note || "")}`
    );

    await send(
      env,
      chat,
      `📜 <b>Transaction History</b>\n\n${lines.join("\n") || "No transactions yet."}`,
      backKeyboard(admin)
    );

    return;
  }

  if (action === "help") {
    await send(
      env,
      chat,
      `📘 <b>How DRAGON works</b>

1. Join our official channel.
2. Complete eligible promotional tasks.
3. Advertisers fund campaigns with supported crypto deposits.
4. Campaign budgets are reserved and released according to verified task results.

DRAGON credits are internal platform units, not a cryptocurrency, investment or guaranteed cash value.`,
      backKeyboard(admin)
    );

    return;
  }

  if (action === "admin") {
    if (!admin) {
      await send(env, chat, "⛔ Admin access only.");
      return;
    }

    await send(env, chat, adminText(), adminKeyboard());
    return;
  }

  if (action.startsWith("admin_")) {
    if (!admin) {
      await send(env, chat, "⛔ Admin access only.");
      return;
    }

    if (action === "admin_stats") {
      const users = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM users"
      ).first();

      const deposits = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM deposit_submissions"
      ).first();

      const campaigns = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM campaigns"
      ).first();

      await send(
        env,
        chat,
        `📊 <b>Platform overview</b>

Users: ${users?.n || 0}
TXID submissions: ${deposits?.n || 0}
Campaign records: ${campaigns?.n || 0}`,
        adminKeyboard()
      );

      return;
    }

    if (action === "admin_rate") {
      const r = await env.DB.prepare(`
        SELECT setting_value
        FROM settings
        WHERE setting_key = 'usdt_to_dragon'
      `).first();

      await send(
        env,
        chat,
        `💱 Current configured rate:
<b>${esc(r?.setting_value || "62500")} DRAGON / USDT</b>

Rate editing requires a secure audited admin workflow.`,
        adminKeyboard()
      );

      return;
    }

    await send(
      env,
      chat,
      "This admin operation requires its audited workflow to be configured before use.",
      adminKeyboard()
    );

    return;
  }

  await send(env, chat, "Choose an option.", homeKeyboard(admin));
}
