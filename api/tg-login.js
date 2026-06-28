// api/tg-login.js
// Single endpoint: handles both sendCode + signIn in one long-lived connection
// Uses Vercel's 60s max execution time

const { TelegramClient } = require("telegram");
const { StringSession }  = require("telegram/sessions");
const { Api }            = require("telegram/tl");

const API_ID   = parseInt(process.env.TG_API_ID);
const API_HASH = process.env.TG_API_HASH;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const { phone, code, password, phoneCodeHash } = req.body;

  if (!phone) return res.status(400).json({ error: "phone required" });

  const client = new TelegramClient(new StringSession(""), API_ID, API_HASH, {
    connectionRetries: 3,
  });

  try {
    await client.connect();

    // Step 1: No code yet — send OTP and return phoneCodeHash
    if (!code) {
      const result = await client.sendCode(
        { apiId: API_ID, apiHash: API_HASH },
        phone
      );
      await client.disconnect();
      return res.status(200).json({
        ok: true,
        step: "code_sent",
        phoneCodeHash: result.phoneCodeHash,
      });
    }

    // Step 2: Have code — sign in
    if (!phoneCodeHash) return res.status(400).json({ error: "phoneCodeHash required" });

    try {
      await client.invoke(new Api.auth.SignIn({
        phoneNumber:   phone,
        phoneCodeHash: phoneCodeHash,
        phoneCode:     code,
      }));
    } catch (e) {
      if (e.errorMessage === "SESSION_PASSWORD_NEEDED") {
        if (!password) {
          await client.disconnect();
          return res.status(200).json({ ok: true, step: "need_2fa" });
        }
        // 2FA
        const { computeCheck } = require("telegram/Password");
        const pwdData  = await client.invoke(new Api.account.GetPassword());
        const pwdCheck = await computeCheck(pwdData, password);
        await client.invoke(new Api.auth.CheckPassword({ password: pwdCheck }));
      } else {
        throw e;
      }
    }

    const sessionString = client.session.save();
    const me = await client.getMe();
    await client.disconnect();

    return res.status(200).json({
      ok:        true,
      step:      "done",
      session:   sessionString,
      phone:     me.phone || phone,
      username:  me.username ? `@${me.username}` : (me.firstName || "Telegram User"),
      firstName: me.firstName || "",
    });

  } catch (e) {
    try { await client.disconnect(); } catch {}
    return res.status(500).json({ error: e.message });
  }
};
