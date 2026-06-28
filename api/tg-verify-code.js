// api/tg-verify-code.js
const { TelegramClient } = require("telegram");
const { StringSession }  = require("telegram/sessions");

const API_ID   = parseInt(process.env.TG_API_ID);
const API_HASH = process.env.TG_API_HASH;

if (!global._tgClients) global._tgClients = new Map();

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const { sessionId, code, password } = req.body;
  if (!sessionId || !code) return res.status(400).json({ error: "sessionId and code required" });

  const entry = global._tgClients.get(sessionId);
  if (!entry) {
    return res.status(400).json({ error: "Session expired. Please send code again." });
  }

  const { client, phoneCodeHash, phone } = entry;

  try {
    // Try sign in with code
    try {
      await client.invoke(
        new (require("telegram/tl").Api.auth.SignIn)({
          phoneNumber:   phone,
          phoneCodeHash: phoneCodeHash,
          phoneCode:     code,
        })
      );
    } catch (e) {
      // If 2FA required
      if (e.errorMessage === "SESSION_PASSWORD_NEEDED") {
        if (!password) {
          return res.status(200).json({ need2fa: true });
        }
        // Use 2FA password
        const { computeCheck } = require("telegram/Password");
        const passwordData = await client.invoke(
          new (require("telegram/tl").Api.account.GetPassword)()
        );
        const passwordCheck = await computeCheck(passwordData, password);
        await client.invoke(
          new (require("telegram/tl").Api.auth.CheckPassword)({ password: passwordCheck })
        );
      } else {
        throw e;
      }
    }

    // Get session string
    const sessionString = client.session.save();

    // Get user info
    const me = await client.getMe();
    await client.disconnect();
    global._tgClients.delete(sessionId);

    return res.status(200).json({
      ok:       true,
      session:  sessionString,
      phone:    me.phone   || phone,
      username: me.username ? `@${me.username}` : (me.firstName || "Telegram User"),
      firstName: me.firstName || "",
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
