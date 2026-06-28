// api/tg-send-code.js
const { TelegramClient } = require("telegram");
const { StringSession }  = require("telegram/sessions");

const API_ID   = parseInt(process.env.TG_API_ID);
const API_HASH = process.env.TG_API_HASH;

// In-memory store for pending clients (per sessionId)
// Vercel serverless: each request may be a new instance,
// so we use a global Map that lives within the same warm instance.
if (!global._tgClients) global._tgClients = new Map();

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const { phone, sessionId } = req.body;
  if (!phone || !sessionId)   return res.status(400).json({ error: "phone and sessionId required" });

  try {
    const client = new TelegramClient(new StringSession(""), API_ID, API_HASH, {
      connectionRetries: 3,
    });

    await client.connect();

    const result = await client.sendCode(
      { apiId: API_ID, apiHash: API_HASH },
      phone
    );

    // Store client and phoneCodeHash in global map
    global._tgClients.set(sessionId, {
      client,
      phoneCodeHash: result.phoneCodeHash,
      phone,
      createdAt: Date.now(),
    });

    // Clean up old entries (> 10 min)
    for (const [key, val] of global._tgClients.entries()) {
      if (Date.now() - val.createdAt > 10 * 60 * 1000) {
        try { await val.client.disconnect(); } catch {}
        global._tgClients.delete(key);
      }
    }

    return res.status(200).json({ ok: true, type: result.type });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
