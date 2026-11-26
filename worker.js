
const CHANNEL = "@DRAGONMarketplace";
const SUPPORT = "https://t.me/dragon_supports_bot";
const AD_REWARD = 100;

async function telegram(env, method, data) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }
  );
  return response.json();
}

async function sendMessage(env, chatId, text, keyboard = null) {
  const data = { chat_id: chatId, text, parse_mode: "HTML" };
  if (keyboard) data.reply_markup = keyboard;
  return telegram(env, "sendMessage", data);
}

function mainKeyboard(env) {
  const adsUrl = `${env.PUBLIC_BASE_URL}/ads.html`;

  return {
    inline_keyboard: [
      [
        { text: "💰 My Balance", callback_data: "balance" },
        { text: "🎬 Watch Ads", web_app: { url: adsUrl } }
      ],
      [
        { text: "🪙 Deposit", callback_data: "deposit" },
        { text: "⚡ Earn DRAGON", callback_data: "earn" }
      ],
      [
        { text: "📢 Promote", callback_data: "promote" },
        { text: "👥 Refer Friends", callback_data: "refer" }
      ],
      [
        { text: "📜 History", callback_data: "history" },
        { text: "🆘 Support", url: SUPPORT }
      ]
    ]
  };
}

async function isMember(env, userId) {
  const result = await telegram(env, "getChatMember", {
    chat_id: CHANNEL,
    user_id: userId
  });

  if (!result.ok) return false;

  return ["member", "administrator", "creator"].includes(
    result.result.status
  );
}

async function registerUser(env, user, referrer = null) {
  const id = String(user.id);

  await env.DB.prepare(`
    INSERT OR IGNORE INTO users
      (telegram_id, username, first_name, joined_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(id, user.username || "", user.first_name || "").run();

  await env.DB.prepare(`
    INSERT OR IGNORE INTO balances (telegram_id)
    VALUES (?)
  `).bind(id).run();

  if (referrer && String(referrer) !== id) {
    const exists = await env.DB.prepare(`
      SELECT telegram_id FROM users WHERE telegram_id = ?
    `).bind(String(referrer)).first();

    if (exists) {
      await env.DB.prepare(`
        INSERT OR IGNORE INTO referrals
          (referrer_id, referred_id, created_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `).bind(String(referrer), id).run();
    }
  }
}

async function showJoinMessage(env, chatId) {
  return sendMessage(
    env,
    chatId,
    "🐉 <b>Welcome to DRAGON Marketplace!</b>\n\nPlease join our official channel before using the bot.",
    {
      inline_keyboard: [
        [{ text: "📢 Join Official Channel", url: "https://t.me/DRAGONMarketplace" }],
        [{ text: "✅ I Have Joined", callback_data: "check_join" }]
      ]
    }
  );
}

async function showHome(env, chatId) {
  return sendMessage(
    env,
    chatId,
    "🐉 <b>DRAGON Marketplace</b>\n\nEarn. Promote. Grow.\n\nChoose an option below.",
    mainKeyboard(env)
  );
}

async function getBalance(env, userId) {
  return env.DB.prepare(`
    SELECT available, test_credits
    FROM balances WHERE telegram_id = ?
  `).bind(String(userId)).first();
}

async function handleCallback(env, callback) {
  const data = callback.data;
  const chatId = callback.message.chat.id;
  const user = callback.from;

  await telegram(env, "answerCallbackQuery", {
    callback_query_id: callback.id
  });

  if (data === "check_join") {
    if (!(await isMember(env, user.id))) {
      return sendMessage(env, chatId, "❌ You have not joined the official channel yet.");
    }
    await registerUser(env, user);
    return showHome(env, chatId);
  }

  if (!(await isMember(env, user.id))) {
    return showJoinMessage(env, chatId);
  }

  await registerUser(env, user);

  if (data === "balance") {
    const balance = await getBalance(env, user.id);
    return sendMessage(
      env,
      chatId,
      `💰 <b>Your DRAGON Balance</b>\n\nAvailable: <b>${Number(balance?.available || 0).toLocaleString()} DRAGON</b>\nTest credits: ${Number(balance?.test_credits || 0).toLocaleString()} DRAGON`
    );
  }

  if (data === "deposit") {
    return sendMessage(
      env,
      chatId,
      "🪙 <b>Deposit</b>\n\nBTC:\n" + (env.BTC_ADDRESS || "Not configured") +
      "\n\nUSDT TRC20:\n" + (env.USDT_TRC20_ADDRESS || "Not configured") +
      "\n\nUSDT BEP20:\n" + (env.USDT_BEP20_ADDRESS || "Not configured") +
      "\n\nMinimum deposit: 5 USDT equivalent.\n\nDeposit verification is not yet connected. Do not send funds until the verification system has been tested."
    );
  }

  if (data === "earn") {
    return sendMessage(
      env,
      chatId,
      "⚡ <b>Earn DRAGON</b>\n\nJoin channel: 750 DRAGON\nJoin group: 750 DRAGON\nView post: 100 DRAGON\nReaction: 150 DRAGON\nStart promoted bot: 2,000 DRAGON\nMini App task: 2,000 DRAGON\n\nMembership tasks have a 14-day protection period.\n\nUse Watch Ads to open the ad Mini App."
    );
  }

  if (data === "promote") {
    return sendMessage(
      env,
      chatId,
      "📢 <b>Promote with DRAGON</b>\n\nCampaign creation and payment reservation are not enabled in this starter version. They need to be connected before accepting advertiser funds."
    );
  }

  if (data === "refer") {
    const link = `https://t.me/${env.BOT_USERNAME}?start=${user.id}`;
    return sendMessage(
      env,
      chatId,
      `👥 <b>Invite Friends</b>\n\nYour referral link:\n${link}\n\nReward: 2,500 DRAGON after your invited friend joins the required channels and completes their first verified task.\n\nAdvertiser commission: 1% on eligible paid campaigns.`
    );
  }

  if (data === "history") {
    const rows = await env.DB.prepare(`
      SELECT amount, description, created_at
      FROM ledger
      WHERE telegram_id = ?
      ORDER BY id DESC LIMIT 10
    `).bind(String(user.id)).all();

    const history = rows.results || [];

    if (!history.length) {
      return sendMessage(env, chatId, "📜 No transactions yet.");
    }

    const lines = history.map(item =>
      `${item.amount > 0 ? "+" : ""}${item.amount} DRAGON — ${item.description}`
    );

    return sendMessage(env, chatId, "📜 <b>Recent History</b>\n\n" + lines.join("\n"));
  }
}

async function handleMessage(env, message) {
  if (!message.text) return;

  const chatId = message.chat.id;
  const user = message.from;
  const text = message.text.trim();

  if (text.startsWith("/start")) {
    const parts = text.split(/\s+/);
    const referrer = parts[1] || null;

    if (!(await isMember(env, user.id))) {
      await registerUser(env, user);
      return showJoinMessage(env, chatId);
    }

    await registerUser(env, user, referrer);
    return showHome(env, chatId);
  }

  if (!(await isMember(env, user.id))) {
    return showJoinMessage(env, chatId);
  }

  await registerUser(env, user);

  if (text === "/balance") {
    const balance = await getBalance(env, user.id);
    return sendMessage(
      env,
      chatId,
      `Available: ${Number(balance?.available || 0).toLocaleString()} DRAGON`
    );
  }

  if (text === "/help") {
    return sendMessage(env, chatId, "Use the menu to access DRAGON Marketplace. Support: " + SUPPORT);
  }

  return showHome(env, chatId);
}

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

  const secret = await crypto.subtle.sign(
    "HMAC",
    secretKey,
    encoder.encode(botToken)
  );

  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const calculated = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(checkString)
  );

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

async function handleApi(request, env) {
  const initData = request.headers.get("X-Telegram-Init-Data");
  const user = await verifyWebApp(initData, env.BOT_TOKEN);

  if (!user?.id) {
    return Response.json({ error: "Invalid Telegram session" }, { status: 401 });
  }

  const id = String(user.id);

  await registerUser(env, user);

  const url = new URL(request.url);

  if (url.pathname === "/api/me") {
    const balance = await getBalance(env, id);
    return Response.json({
      available: balance?.available || 0,
      testCredits: balance?.test_credits || 0,
      adReward: AD_REWARD,
      testMode: env.ADS_TEST_MODE === "true"
    });
  }

  if (url.pathname === "/api/ad/complete" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const sessionId = String(body.sessionId || "");

    if (!/^[a-zA-Z0-9-]{10,100}$/.test(sessionId)) {
      return Response.json({ error: "Invalid session" }, { status: 400 });
    }

    try {
      await env.DB.prepare(`
        INSERT INTO ad_events
          (session_id, telegram_id, status, created_at)
        VALUES (?, ?, 'pending_verification', CURRENT_TIMESTAMP)
      `).bind(sessionId, id).run();
    } catch {
      return Response.json({ error: "Duplicate ad session" }, { status: 409 });
    }

    if (env.ADS_TEST_MODE === "true") {
      await env.DB.batch([
        env.DB.prepare(`
          UPDATE balances SET test_credits = test_credits + ?
          WHERE telegram_id = ?
        `).bind(AD_REWARD, id),

        env.DB.prepare(`
          UPDATE ad_events SET status = 'test_completed'
          WHERE session_id = ?
        `).bind(sessionId)
      ]);

      return Response.json({
        success: true,
        test: true,
        reward: AD_REWARD,
        message: "Test ad completed. These credits cannot be withdrawn."
      });
    }

    return Response.json({
      success: true,
      pending: true,
      message: "Ad completion recorded. Waiting for trusted Monetag verification."
    });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "online", app: "DRAGON Marketplace" });
    }

    if (url.pathname === "/telegram-webhook" && request.method === "POST") {
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");

      if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }

      const update = await request.json();

      try {
        if (update.message) await handleMessage(env, update.message);
        if (update.callback_query) await handleCallback(env, update.callback_query);
      } catch (error) {
        console.error("Telegram update error:", error);
      }

      return new Response("OK");
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("DRAGON Marketplace is running.");
  }
};
