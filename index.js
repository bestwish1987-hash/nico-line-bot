const express = require("express");
const crypto = require("crypto");

const app = express();

// ── 環境變數（部署時設定）──────────────────────────────────────
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || "be1c80e984fe2a49487fb307ab0a43a2";
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
// ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是「小助」，Nico 的私人 AI 助理，風格溫暖親切像好友。
你說繁體中文，可以幫忙聊天、規劃行程、回答問題、提供建議、寫文字等任何事。
回覆簡潔有力，適當用 emoji，避免過長廢話。`;

// 每個用戶的對話記憶（存在記憶體，重啟會清空）
const userHistory = {};

// 驗證 LINE 簽名
const verifySignature = (body, signature) => {
  const hash = crypto
    .createHmac("SHA256", LINE_CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
};

// 原始 body 解析（驗簽需要）
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

// 健康檢查
app.get("/", (req, res) => res.send("小助 LINE Bot 運行中 🤖"));

// Webhook 接收
app.post("/webhook", async (req, res) => {
  const signature = req.headers["x-line-signature"];

  // 驗證簽名
  if (!verifySignature(req.rawBody, signature)) {
    return res.status(401).send("Invalid signature");
  }

  res.status(200).send("OK"); // 立即回應 LINE

  const events = req.body.events || [];
  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") continue;

    const userId = event.source.userId;
    const userText = event.message.text;
    const replyToken = event.replyToken;

    // 建立/維護對話歷史
    if (!userHistory[userId]) userHistory[userId] = [];
    userHistory[userId].push({ role: "user", content: userText });

    // 只保留最近 20 則對話
    if (userHistory[userId].length > 20) {
      userHistory[userId] = userHistory[userId].slice(-20);
    }

    try {
      // 呼叫 Claude API
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

      const data = await response.json();
      const reply = data.content?.map(b => b.text || "").join("") || "抱歉，我暫時無法回應 😅";

      // 記錄助理回覆
      userHistory[userId].push({ role: "assistant", content: reply });

      // 回傳給 LINE
      await fetch("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
        },
        body: JSON.stringify({
          replyToken,
          messages: [{ type: "text", text: reply }]
        })
      });

    } catch (err) {
      console.error("Error:", err);
      // 發送錯誤訊息
      await fetch("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
        },
        body: JSON.stringify({
          replyToken,
          messages: [{ type: "text", text: "哎呀，出了點問題，請稍後再試 😓" }]
        })
      });
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`小助 Bot 啟動在 port ${PORT} 🚀`));
