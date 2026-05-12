const express = require("express");
const crypto = require("crypto");

const app = express();

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || "be1c80e984fe2a49487fb307ab0a43a2";
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

const SYSTEM_PROMPT = "你是小助,Nico 的私人 AI 助理,風格溫暖親切像好友。你說繁體中文,可以幫忙聊天、規劃行程、回答問題、提供建議、寫文字等任何事。回覆簡潔有力,適當用 emoji,避免過長廢話。";

const userHistory = {};

const verifySignature = (body, signature) => {
  const hash = crypto.createHmac("SHA256", LINE_CHANNEL_SECRET).update(body).digest("base64");
  return hash === signature;
};

app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

app.get("/", (req, res) => res.send("小助 LINE Bot 運行中"));

console.log("=== 環境變數檢查 ===");
console.log("LINE_CHANNEL_SECRET:", LINE_CHANNEL_SECRET ? "SET len=" + LINE_CHANNEL_SECRET.length : "MISSING");
console.log("LINE_CHANNEL_ACCESS_TOKEN:", LINE_CHANNEL_ACCESS_TOKEN ? "SET len=" + LINE_CHANNEL_ACCESS_TOKEN.length : "MISSING");
console.log("ANTHROPIC_API_KEY:", ANTHROPIC_API_KEY ? "SET len=" + ANTHROPIC_API_KEY.length : "MISSING");

app.post("/webhook", async (req, res) => {
  console.log("[WEBHOOK] received request");

  const signature = req.headers["x-line-signature"];

  if (!verifySignature(req.rawBody, signature)) {
    console.log("[WEBHOOK] signature INVALID");
    return res.status(401).send("Invalid signature");
  }

  console.log("[WEBHOOK] signature OK");
  res.status(200).send("OK");

  const events = req.body.events || [];
  console.log("[WEBHOOK] events count:", events.length);

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") {
      console.log("[EVENT] skip non-text event");
      continue;
    }

    const userId = event.source.userId;
    const userText = event.message.text;
    const replyToken = event.replyToken;

    console.log("[EVENT] user:", userId, "text:", userText);

    if (!userHistory[userId]) userHistory[userId] = [];
    userHistory[userId].push({ role: "user", content: userText });

    if (userHistory[userId].length > 20) {
      userHistory[userId] = userHistory[userId].slice(-20);
    }

    try {
      console.log("[CLAUDE] calling API");
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: userHistory[userId]
        })
      });

      console.log("[CLAUDE] status:", response.status);
      const data = await response.json();
      console.log("[CLAUDE] data:", JSON.stringify(data).slice(0, 500));

      const reply = (data.content && data.content.map(b => b.text || "").join("")) || "抱歉,我暫時無法回應";
      console.log("[REPLY] text:", reply);

      userHistory[userId].push({ role: "assistant", content: reply });

      console.log("[LINE] sending reply");
      const lineRes = await fetch("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + LINE_CHANNEL_ACCESS_TOKEN
        },
        body: JSON.stringify({
          replyToken: replyToken,
          messages: [{ type: "text", text: reply }]
        })
      });

      console.log("[LINE] reply status:", lineRes.status);
      if (lineRes.status !== 200) {
        const errorBody = await lineRes.text();
        console.log("[LINE] reply ERROR body:", errorBody);
      } else {
        console.log("[LINE] reply OK");
      }

    } catch (err) {
      console.error("[ERROR] message:", err.message);
      console.error("[ERROR] stack:", err.stack);
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("小助 Bot 啟動在 port " + PORT));
