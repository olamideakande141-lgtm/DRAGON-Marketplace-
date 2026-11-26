const CHANNEL = "@DRAGONMarketplace";
const SUPPORT = "https://t.me/dragon_supports_bot";
const AD_REWARD = 100;

const SUBSCRIBER_UNIT_PRICE = 750;
const SUBSCRIBER_MIN_QTY = 50;
const QTY_PRESETS = [50, 100, 250, 500, 1000];

const CAMPAIGN_TYPES = {
  channel: { label: "📢 Channel Promotion", kind: "subscriber" },
  group: { label: "👥 Group Promotion", kind: "subscriber" },
  bot: { label: "🤖 Bot Promotion (pricing not set)", kind: "unpriced" },
  miniapp: { label: "🧩 Mini App Promotion (pricing not set)", kind: "unpriced" },
  views: { label: "👁 Post Views (pricing not set)", kind: "unpriced" },
  reactions: { label: "❤️ Post Reactions (pricing not set)", kind: "unpriced" }
};

const MENU = {
  "💰 My Balance": "balance",
  "🪙 Deposit": "deposit",
  "⚡ Earn DRAGON": "earn",
  "📢 Promote": "promote",
  "👥 Refer Friends": "refer",
  "📜 History": "history",
  "🆘 Support": "support"
};

const fmt = n => Number(n || 0).toLocaleString();

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function telegram(env, method, data) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }
  );
  const result = await response.json();
  if (!result.ok) {
    console.log("TELEGRAM ERROR", method, JSON.stringify(result));
  }
  return result;
}

async function sendMessage(env, chatId, text, keyboard = null) {
  const data = { chat_id: chatId, text, parse_mode: "HTML" };
  if (keyboard) data.reply_markup = keyboard;
  return telegram(env, "sendMessage", data);
}

function menuKeyboard(env) {
  const adsUrl = `${env.PUBLIC_BASE_URL}/ads.html`;

  return {
    keyboard: [
      [{ text: "💰 My Balance" }, { text: "🎬 Watch Ads", web_app: { url: adsUrl } }],
      [{ text: "🪙 Deposit" }, { text: "⚡ Earn DRAGON" }],
      [{ text: "📢 Promote" }, { text: "👥 Refer Friends" }],
      [{ text: "📜 History" }, { text: "🆘 Support" }]
    ],
    resize_keyboard: true,
    is_persistent: true
  };
}

function promoKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "➕ Create New Campaign", callback_data: "promo_new" }],
      [
        { text: "📋 My Campaigns", callback_data: "promo_mine" },
        { text: "💲 Campaign Pricing", callback_data: "promo_pricing" }
      ],
      [{ text: "🧾 Promotion History", callback_data: "promo_history" }],
      [{ text: "⬅️ Back to Main Menu", callback_data: "menu" }]
    ]
  };
}

function cancelKeyboard() {
  return {
    inline_keyboard: [[{ text: "✖️ Cancel", callback_data: "promo_cancel" }]]
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
    "🐉 <b>DRAGON Marketplace</b>\n\nEarn. Promote. Grow.\n\nChoose an option from the menu below.",
    menuKeyboard(env)
  );
}

async function getBalance(env, userId) {
  return env.DB.prepare(`
    SELECT available, test_credits
    FROM balances WHERE telegram_id = ?
  `).bind(String(userId)).first();
}

// ---------- PROMOTE ----------

function validateDestination(type, raw) {
  const text = String(raw || "").trim();

  if (type === "channel" || type === "group") {
    const m = text.match(/^(?:https:\/\/)?t\.me\/([A-Za-z][A-Za-z0-9_]{4,})$|^@([A-Za-z][A-Za-z0-9_]{4,})$/i);
    if (!m) return null;
    return "https://t.me/" + (m[1] || m[2]);
  }

  if (type === "bot") {
    const m = text.match(/^(?:https:\/\/)?t\.me\/([A-Za-z][A-Za-z0-9_]{3,}bot)$|^@([A-Za-z][A-Za-z0-9_]{3,}bot)$/i);
    if (!m) return null;
    return "https://t.me/" + (m[1] || m[2]);
  }

  if (type === "miniapp") {
    const m = text.match(/^(?:https:\/\/)?t\.me\/([A-Za-z][A-Za-z0-9_]{4,})\/([A-Za-z0-9_-]{2,64})$/i);
    if (!m) return null;
    return "https://t.me/" + m[1] + "/" + m[2];
  }

  if (type === "views" || type === "reactions") {
    const m = text.match(/^(?:https:\/\/)?t\.me\/([A-Za-z][A-Za-z0-9_]{4,}|c\/\d+)\/(\d+)$/i);
    if (!m) return null;
    return "https://t.me/" + m[1] + "/" + m[2];
  }

  return null;
}

function priceFor(type, quantity) {
  const info = CAMPAIGN_TYPES[type];
  if (!info || info.kind !== "subscriber") return null;
  return quantity * SUBSCRIBER_UNIT_PRICE;
}

async function getDraft(env, id) {
  return env.DB.prepare(`
    SELECT * FROM promo_drafts WHERE telegram_id = ?
  `).bind(String(id)).first();
}

async function saveDraft(env, id, d) {
  await env.DB.prepare(`
    INSERT OR REPLACE INTO promo_drafts
      (telegram_id, step, campaign_type, destination, description, quantity, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(
    String(id),
    d.step,
    d.campaign_type || null,
    d.destination || null,
    d.description || null,
    d.quantity || null
  ).run();
}

async function deleteDraft(env, id) {
  await env.DB.prepare(`
    DELETE FROM promo_drafts WHERE telegram_id = ?
  `).bind(String(id)).run();
}

async function showPromoteMenu(env, chatId, user) {
  const id = String(user.id);
  const balance = await getBalance(env, id);

  const stats = await env.DB.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active,
           COALESCE(SUM(CASE WHEN status = 'active' THEN total_cost ELSE 0 END), 0) AS committed
    FROM campaigns WHERE advertiser_id = ?
  `).bind(id).first();

  return sendMessage(
    env,
    chatId,
    "📢 <b>Promote with DRAGON</b>\n\n" +
    "Promote your Telegram community, bot, Mini App or content and reach real users through DRAGON Marketplace.\n\n" +
    `Available balance: <b>${fmt(balance?.available)} DRAGON</b>\n` +
    `Active campaigns: ${fmt(stats?.active)}\n` +
    `Total campaigns: ${fmt(stats?.total)}\n` +
    `DRAGON in active campaigns: ${fmt(stats?.committed)}`,
    promoKeyboard()
  );
}

async function startCampaign(env, chatId, user) {
  await saveDraft(env, user.id, { step: "type" });

  const typeButtons = Object.entries(CAMPAIGN_TYPES).map(([key, t]) => [
    { text: t.label, callback_data: "promo_type_" + key }
  ]);

  return sendMessage(
    env,
    chatId,
    "➕ <b>New campaign</b>\n\nStep 1 of 5: choose what you want to promote.",
    {
      inline_keyboard: [...typeButtons, [{ text: "✖️ Cancel", callback_data: "promo_cancel" }]]
    }
  );
}

async function askDestination(env, chatId) {
  return sendMessage(
    env,
    chatId,
    "Step 2 of 5: send the link.\n\nChannel or group: <code>t.me/yourname</code> or <code>@yourname</code>",
    cancelKeyboard()
  );
}

async function askDescription(env, chatId) {
  return sendMessage(
    env,
    chatId,
    "Step 3 of 5: describe what users will receive or do (5 to 300 characters).",
    cancelKeyboard()
  );
}

async function askQuantity(env, chatId) {
  return sendMessage(
    env,
    chatId,
    `Step 4 of 5: choose the number of subscribers (minimum ${SUBSCRIBER_MIN_QTY}).`,
    {
      inline_keyboard: [
        QTY_PRESETS.slice(0, 3).map(n => ({ text: fmt(n), callback_data: "promo_qty_" + n })),
        QTY_PRESETS.slice(3).map(n => ({ text: fmt(n), callback_data: "promo_qty_" + n })),
        [{ text: "✏️ Custom quantity", callback_data: "promo_qty_custom" }],
        [{ text: "✖️ Cancel", callback_data: "promo_cancel" }]
      ]
    }
  );
}

async function showSummary(env, chatId, user, d) {
  const total = priceFor(d.campaign_type, d.quantity);
  const balance = await getBalance(env, user.id);
  const available = Number(balance?.available || 0);
  const enough = available >= total;

  const keyboard = enough
    ? { inline_keyboard: [
        [{ text: "✅ Confirm Campaign", callback_data: "promo_confirm" }],
        [{ text: "✖️ Cancel Campaign", callback_data: "promo_cancel" }]
      ] }
    : { inline_keyboard: [[{ text: "✖️ Cancel Campaign", callback_data: "promo_cancel" }]] };

  return sendMessage(
    env,
    chatId,
    "🧾 <b>Order summary</b>\n\n" +
    `Type: ${esc(CAMPAIGN_TYPES[d.campaign_type].label)}\n` +
    `Destination: ${esc(d.destination)}\n` +
    `Description: ${esc(d.description)}\n` +
    `Quantity: ${fmt(d.quantity)}\n` +
    `Price per subscriber: ${fmt(SUBSCRIBER_UNIT_PRICE)} DRAGON\n` +
    `Total required: <b>${fmt(total)} DRAGON</b>\n` +
    `Your available balance: ${fmt(available)} DRAGON\n\n` +
    (enough
      ? "Confirm to create this campaign. Reserving DRAGON and automatic publishing are not connected yet, so nothing is deducted at this stage."
      : "⚠️ Insufficient DRAGON balance for this order."),
    keyboard
  );
}

async function createCampaign(env, chatId, user) {
  const id = String(user.id);
  const d = await getDraft(env, id);

  if (!d || d.step !== "summary") {
    return showPromoteMenu(env, chatId, user);
  }

  const claimed = await env.DB.prepare(`
    DELETE FROM promo_drafts WHERE telegram_id = ? AND step = 'summary'
  `).bind(id).run();

  if (!claimed.meta || claimed.meta.changes !== 1) {
    return sendMessage(env, chatId, "This campaign was already submitted.", promoKeyboard());
  }

  const total = priceFor(d.campaign_type, d.quantity);
  if (total === null) {
    return sendMessage(env, chatId, "❌ Pricing for this type is not set yet.", promoKeyboard());
  }

  const balance = await getBalance(env, id);
  if (Number(balance?.available || 0) < total) {
    return sendMessage(
      env,
      chatId,
      `❌ <b>Insufficient DRAGON balance.</b>\n\nRequired: ${fmt(total)} DRAGON\nAvailable: ${fmt(balance?.available)} DRAGON`,
      promoKeyboard()
    );
  }

  const dup = await env.DB.prepare(`
    SELECT id FROM campaigns
    WHERE advertiser_id = ? AND destination = ? AND status IN ('pending_validation', 'active')
    LIMIT 1
  `).bind(id, d.destination).first();

  if (dup) {
    return sendMessage(
      env,
      chatId,
      `❌ You already have an open campaign for this destination (#${dup.id}).`,
      promoKeyboard()
    );
  }

  const result = await env.DB.prepare(`
    INSERT INTO campaigns
      (advertiser_id, campaign_type, destination, description, quantity, unit_price, total_cost, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_validation', CURRENT_TIMESTAMP)
  `).bind(
    id, d.campaign_type, d.destination, d.description,
    d.quantity, SUBSCRIBER_UNIT_PRICE, total
  ).run();

  return sendMessage(
    env,
    chatId,
    `✅ <b>Campaign #${result.meta?.last_row_id} created</b>\n\n` +
    `Status: Pending validation\nTotal: ${fmt(total)} DRAGON\n\n` +
    "DRAGON reservation and automatic publishing are the next build steps, so nothing has been deducted yet.",
    promoKeyboard()
  );
}

async function listCampaigns(env, chatId, user, title) {
  const rows = await env.DB.prepare(`
    SELECT id, campaign_type, destination, quantity, total_cost, status
    FROM campaigns WHERE advertiser_id = ?
    ORDER BY id DESC LIMIT 10
  `).bind(String(user.id)).all();

  const list = rows.results || [];

  if (!list.length) {
    return sendMessage(env, chatId, `${title}\n\nNo campaigns yet.`, promoKeyboard());
  }

  const lines = list.map(c =>
    `<b>#${c.id}</b> · ${esc(c.destination)}\n` +
    `${esc(CAMPAIGN_TYPES[c.campaign_type]?.label || c.campaign_type)} · ${fmt(c.quantity)} subscribers · ${fmt(c.total_cost)} DRAGON\n` +
    `Status: ${esc(String(c.status).replace(/_/g, " "))}`
  );

  return sendMessage(env, chatId, `${title}\n\n` + lines.join("\n\n"), promoKeyboard());
}

function pricingText() {
  return "💲 <b>Campaign pricing</b>\n\n" +
    "Subscribers: 750,000 DRAGON per 1,000 (750 DRAGON each)\n" +
    `Minimum order: ${SUBSCRIBER_MIN_QTY}\n\n` +
    "50 = 37,500 DRAGON\n100 = 75,000 DRAGON\n250 = 187,500 DRAGON\n500 = 375,000 DRAGON\n1,000 = 750,000 DRAGON\n5,000 = 3,750,000 DRAGON\n\n" +
    "Bot, Mini App, post view and reaction pricing is not set yet.";
}

async function handlePromoCallback(env, chatId, user, data) {
  if (data === "promo_menu") return showPromoteMenu(env, chatId, user);
  if (data === "promo_new") return startCampaign(env, chatId, user);
  if (data === "promo_pricing") return sendMessage(env, chatId, pricingText(), promoKeyboard());
  if (data === "promo_mine") return listCampaigns(env, chatId, user, "📋 <b>My Campaigns</b>");
  if (data === "promo_history") return listCampaigns(env, chatId, user, "🧾 <b>Promotion History</b>");
  if (data === "promo_confirm") return createCampaign(env, chatId, user);

  if (data === "promo_cancel") {
    await deleteDraft(env, user.id);
    return showPromoteMenu(env, chatId, user);
  }

  const draft = await getDraft(env, user.id);

  if (data.startsWith("promo_type_")) {
    const key = data.replace("promo_type_", "");
    const info = CAMPAIGN_TYPES[key];

    if (!info) {
      return sendMessage(env, chatId, "❌ Unknown campaign type.", promoKeyboard());
    }

    if (info.kind !== "subscriber") {
      return sendMessage(
        env,
        chatId,
        "This type's pricing is not set yet. Choose Channel or Group Promotion for now.",
        cancelKeyboard()
      );
    }

    await saveDraft(env, user.id, { step: "destination", campaign_type: key });
    return askDestination(env, chatId);
  }

  if (data === "promo_qty_custom") {
    if (!draft) return showPromoteMenu(env, chatId, user);
    await saveDraft(env, user.id, { ...draft, step: "quantity_custom" });
    return sendMessage(env, chatId, `Type the number of subscribers (minimum ${SUBSCRIBER_MIN_QTY}).`, cancelKeyboard());
  }

  if (data.startsWith("promo_qty_")) {
    const n = Number(data.replace("promo_qty_", ""));
    if (!draft || draft.step !== "quantity" || !Number.isInteger(n)) {
      return showPromoteMenu(env, chatId, user);
    }
    const next = { ...draft, step: "summary", quantity: n };
    await saveDraft(env, user.id, next);
    return showSummary(env, chatId, user, next);
  }

  return showPromoteMenu(env, chatId, user);
}

async function handleDraftText(env, chatId, user, draft, text) {
  if (draft.step === "destination") {
    const normalized = validateDestination(draft.campaign_type, text);
    if (!normalized) {
      return sendMessage(
        env,
        chatId,
        "❌ That link is not valid for this campaign type. Send it again, or cancel.",
        cancelKeyboard()
      );
    }
    await saveDraft(env, user.id, { ...draft, step: "description", destination: normalized });
    return askDescription(env, chatId);
  }

  if (draft.step === "description") {
    if (text.length < 5 || text.length > 300) {
      return sendMessage(env, chatId, "❌ Description must be 5 to 300 characters.", cancelKeyboard());
    }
    await saveDraft(env, user.id, { ...draft, step: "quantity", description: text });
    return askQuantity(env, chatId);
  }

  if (draft.step === "quantity_custom") {
    const cleaned = text.replace(/[,\s]/g, "");
    const n = Number(cleaned);
    const min = CAMPAIGN_TYPES[draft.campaign_type].kind === "subscriber" ? SUBSCRIBER_MIN_QTY : 1;

    if (!/^\d+$/.test(cleaned) || n < min || n > 1000000) {
      return sendMessage(
        env,
        chatId,
        `❌ Enter a whole number from ${fmt(min)} to 1,000,000.`,
        cancelKeyboard()
      );
    }

    const next = { ...draft, step: "summary", quantity: n };
    await saveDraft(env, user.id, next);
    return showSummary(env, chatId, user, next);
  }

  return sendMessage(
    env,
    chatId,
    "Please use the buttons above, or tap Cancel to stop.",
    cancelKeyboard()
  );
}

// ---------- MAIN ACTIONS ----------

async function handleAction(env, chatId, user, action) {
  if (action === "menu") {
    return showHome(env, chatId);
  }

  if (action === "promote") {
    return showPromoteMenu(env, chatId, user);
  }

  if (action === "balance") {
    const balance = await getBalance(env, user.id);
    return sendMessage(
      env,
      chatId,
      `💰 <b>Your DRAGON Balance</b>\n\nAvailable: <b>${fmt(balance?.available)} DRAGON</b>\nTest credits: ${fmt(balance?.test_credits)} DRAGON`
    );
  }

  if (action === "deposit") {
    return sendMessage(
      env,
      chatId,
      "🪙 <b>Choose a deposit network</b>\n\nSelect the network you will send from. You will then see only the address for that network.\n\nMinimum deposit: 5 USDT equivalent.",
      {
        inline_keyboard: [
          [{ text: "₿ Bitcoin (BTC)", callback_data: "dep_btc" }],
          [{ text: "💵 USDT TRC20", callback_data: "dep_trc20" }],
          [{ text: "💵 USDT BEP20", callback_data: "dep_bep20" }]
        ]
      }
    );
  }

  if (action === "dep_btc" || action === "dep_trc20" || action === "dep_bep20") {
    const networks = {
      dep_btc: {
        name: "Bitcoin (BTC)",
        address: env.BTC_ADDRESS,
        warning: "Send only Bitcoin (BTC) to this address. Other coins or tokens may be lost."
      },
      dep_trc20: {
        name: "USDT TRC20 (Tron network)",
        address: env.USDT_TRC20_ADDRESS,
        warning: "Send only USDT on the TRC20 (Tron) network. Other networks may be lost."
      },
      dep_bep20: {
        name: "USDT BEP20 (BNB Smart Chain)",
        address: env.USDT_BEP20_ADDRESS,
        warning: "Send only USDT on the BEP20 (BNB Smart Chain) network. Other networks may be lost."
      }
    };

    const net = networks[action];

    await sendMessage(env, chatId, "⏳ Loading your " + net.name + " address...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    return sendMessage(
      env,
      chatId,
      "🪙 <b>" + net.name + " deposit address</b>\n\n<code>" + (net.address || "Not configured") + "</code>\n\n⚠️ " + net.warning + "\n\nMinimum deposit: 5 USDT equivalent.\n\nTap the address to copy it."
    );
  }

  if (action === "earn") {
    return sendMessage(
      env,
      chatId,
      "⚡ <b>Earn DRAGON</b>\n\nJoin channel: 750 DRAGON\nJoin group: 750 DRAGON\nView post: 100 DRAGON\nReaction: 150 DRAGON\nStart promoted bot: 2,000 DRAGON\nMini App task: 2,000 DRAGON\n\nMembership tasks have a 14-day protection period.\n\nTap 🎬 Watch Ads in the menu to open the ad Mini App."
    );
  }

  if (action === "refer") {
    const link = `https://t.me/${env.BOT_USERNAME}?start=${user.id}`;
    return sendMessage(
      env,
      chatId,
      `👥 <b>Invite Friends</b>\n\nYour referral link:\n${link}\n\nReward: 2,500 DRAGON after your invited friend joins the required channels and completes their first verified task.\n\nAdvertiser commission: 1% on eligible paid campaigns.`
    );
  }

  if (action === "history") {
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
      `${item.amount > 0 ? "+" : ""}${item.amount} DRAGON — ${esc(item.description)}`
    );

    return sendMessage(env, chatId, "📜 <b>Recent History</b>\n\n" + lines.join("\n"));
  }

  if (action === "support") {
    return sendMessage(
      env,
      chatId,
      "🆘 <b>Support</b>\n\nTap the button below to contact our support team.",
      {
        inline_keyboard: [
          [{ text: "💬 Open Support Chat", url: SUPPORT }]
        ]
      }
    );
  }
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

  if (data.startsWith("promo_")) {
    return handlePromoCallback(env, chatId, user, data);
  }

  return handleAction(env, chatId, user, data);
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

  if (MENU[text]) {
    await deleteDraft(env, user.id);
    return handleAction(env, chatId, user, MENU[text]);
  }

  const draft = await getDraft(env, user.id);
  if (draft) {
    return handleDraftText(env, chatId, user, draft, text);
  }

  if (text === "/balance") {
    return handleAction(env, chatId, user, "balance");
  }

  if (text === "/help") {
    return sendMessage(env, chatId, "Use the menu at the bottom to access DRAGON Marketplace.\n\nSupport: " + SUPPORT);
  }

  return showHome(env, chatId);
}

// ---------- MONETAG POSTBACK (records only; does NOT credit DRAGON) ----------

async function handleMonetagPostback(request, env) {
  const url = new URL(request.url);
  const provided = url.searchParams.get("secret") || request.headers.get("X-Postback-Secret");

  if (!env.MONETAG_POSTBACK_SECRET || provided !== env.MONETAG_POSTBACK_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  const params = Object.fromEntries(url.searchParams.entries());
  delete params.secret;

  // Placeholder field names: update these after reading Monetag's postback documentation
  const eventId = params.event_id || params.request_id || params.ymid || "";
  const telegramId = params.user_id || params.telegram_id || null;

  if (!eventId) {
    return new Response("Missing event id", { status: 400 });
  }

  await env.DB.prepare(`
    INSERT OR IGNORE INTO provider_callbacks
      (provider, event_id, telegram_id, payload, status, received_at)
    VALUES ('monetag', ?, ?, ?, 'received_unverified', CURRENT_TIMESTAMP)
  `).bind(eventId, telegramId ? String(telegramId) : null, JSON.stringify(params)).run();

  console.log("MONETAG POSTBACK RECORDED", eventId);

  return new Response("OK");
}

// ---------- WEB APP AUTH AND API ----------

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

    if (url.pathname === "/monetag-postback" && request.method === "GET") {
      return handleMonetagPostback(request, env);
    }

    if (url.pathname === "/telegram-webhook" && request.method === "POST") {
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");

      if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }

      const update = await request.json();
      console.log("UPDATE", JSON.stringify(update).slice(0, 300));

      try {
        if (update.message) await handleMessage(env, update.message);
        if (update.callback_query) await handleCallback(env, update.callback_query);
      } catch (error) {
        console.log("UPDATE ERROR", String(error && error.stack ? error.stack : error));
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
