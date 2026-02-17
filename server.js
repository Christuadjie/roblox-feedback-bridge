// server.js - Discord Webhook Bridge
// Deploy ke: Railway, Render, atau Cloudflare Workers
// 
// ======================================================
// CARA DEPLOY KE RAILWAY (Gratis & Mudah):
// 1. Buat akun di railway.app
// 2. New Project > Deploy from GitHub (atau paste code)
// 3. Set Environment Variables di dashboard Railway
// 4. Salin URL dari Railway ke CONFIG.BRIDGE_URL di FeedbackServer.lua
// ======================================================

const http = require("http");
const https = require("https");
const url = require("url");

// =============================================
// KONFIGURASI - Isi lewat Environment Variables
// =============================================
const CONFIG = {
  // Discord Webhook URL - set di Railway/Render ENV vars
  DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL || "",

  // Secret key untuk validasi request dari Roblox
  // Set di ENV vars Railway DAN di FeedbackServer.lua
  SECRET_KEY: process.env.SECRET_KEY || "change-this-secret-key",

  // Port server
  PORT: process.env.PORT || 3000,

  // Rate limit: maks request per IP per menit
  RATE_LIMIT: 30,

  // Discord embed colors per kategori
  CATEGORY_COLORS: {
    "Bug Report": 0xff4444,
    Suggestion: 0x6464ff,
    Gameplay: 0x44dd88,
    Other: 0xffcc44,
  },

  // Discord embed thumbnails per kategori
  CATEGORY_ICONS: {
    "Bug Report": "🐛",
    Suggestion: "💡",
    Gameplay: "🎮",
    Other: "📝",
  },
};

// =============================================
// RATE LIMITER
// =============================================
const rateLimiter = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 menit

  if (!rateLimiter.has(ip)) {
    rateLimiter.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }

  const data = rateLimiter.get(ip);

  if (now > data.resetAt) {
    rateLimiter.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (data.count >= CONFIG.RATE_LIMIT) {
    return false;
  }

  data.count++;
  return true;
}

// Bersihkan rate limiter setiap 5 menit
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimiter.entries()) {
    if (now > data.resetAt) {
      rateLimiter.delete(ip);
    }
  }
}, 5 * 60 * 1000);

// =============================================
// DISCORD SENDER
// =============================================
function sendToDiscord(webhookUrl, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const urlParsed = new URL(webhookUrl);

    const options = {
      hostname: urlParsed.hostname,
      path: urlParsed.pathname + urlParsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "User-Agent": "RobloxFeedbackBridge/2.0",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, status: res.statusCode });
        } else {
          reject(
            new Error(`Discord responded with ${res.statusCode}: ${data}`)
          );
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    req.write(body);
    req.end();
  });
}

// =============================================
// BUILD DISCORD EMBED
// =============================================
function buildDiscordPayload(feedbackData) {
  const {
    id,
    username,
    userId,
    category,
    feedback,
    timestamp,
    gameId,
    placeId,
  } = feedbackData;

  const color = CONFIG.CATEGORY_COLORS[category] || 0x888888;
  const icon = CONFIG.CATEGORY_ICONS[category] || "📝";

  // Truncate feedback if too long
  const feedbackText =
    feedback.length > 1000 ? feedback.substring(0, 997) + "..." : feedback;

  const profileUrl =
    username !== "Anonymous" && userId
      ? `https://www.roblox.com/users/${userId}/profile`
      : null;

  const usernameDisplay =
    profileUrl && username !== "Anonymous"
      ? `[${username}](${profileUrl})`
      : username;

  const gamePlaceUrl = placeId
    ? `https://www.roblox.com/games/${placeId}`
    : null;

  const embed = {
    title: `${icon} New ${category} Feedback`,
    description: `\`\`\`\n${feedbackText}\n\`\`\``,
    color: color,
    fields: [
      {
        name: "👤 From",
        value: usernameDisplay,
        inline: true,
      },
      {
        name: "🏷️ Category",
        value: category,
        inline: true,
      },
      {
        name: "🆔 ID",
        value: `\`${id}\``,
        inline: true,
      },
    ],
    footer: {
      text: `Roblox Feedback System • Place ID: ${placeId || "N/A"}`,
    },
    timestamp: new Date().toISOString(),
  };

  // Add game link if available
  if (gamePlaceUrl) {
    embed.fields.push({
      name: "🎮 Game",
      value: `[View Game](${gamePlaceUrl})`,
      inline: true,
    });
  }

  return {
    username: "Feedback Bot 📬",
    avatar_url:
      "https://tr.rbxcdn.com/180DAY-8f5e39b99f2d5e31d3d8b3d5b8e9d9b3/420/420/AvatarHeadshot/Png/noFilter",
    embeds: [embed],
  };
}

// =============================================
// HTTP SERVER
// =============================================
const server = http.createServer(async (req, res) => {
  const clientIp =
    req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  const parsedUrl = url.parse(req.url, true);

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Secret-Key");

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check endpoint
  if (req.method === "GET" && parsedUrl.pathname === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "online",
        service: "Roblox Feedback Bridge",
        version: "2.0",
        timestamp: new Date().toISOString(),
        discord_configured: !!CONFIG.DISCORD_WEBHOOK_URL,
      })
    );
    return;
  }

  // Webhook endpoint
  if (req.method === "POST" && parsedUrl.pathname === "/webhook") {
    // Rate limit check
    if (!checkRateLimit(clientIp)) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Rate limit exceeded" }));
      console.warn(`[Bridge] Rate limit exceeded for IP: ${clientIp}`);
      return;
    }

    // Read body
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 5000) {
        // Too large
        res.writeHead(413);
        res.end(JSON.stringify({ error: "Payload too large" }));
        req.destroy();
      }
    });

    req.on("end", async () => {
      try {
        // Parse JSON
        const feedbackData = JSON.parse(body);

        // Validate required fields
        const required = ["feedback", "username", "category"];
        for (const field of required) {
          if (!feedbackData[field]) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Missing field: ${field}` }));
            return;
          }
        }

        // Basic validation
        if (feedbackData.feedback.length < 5 || feedbackData.feedback.length > 1200) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid feedback length" }));
          return;
        }

        console.log(
          `[Bridge] Received feedback from ${feedbackData.username} [${feedbackData.category}]: ${feedbackData.feedback.substring(0, 60)}...`
        );

        // Send to Discord
        if (!CONFIG.DISCORD_WEBHOOK_URL) {
          console.warn("[Bridge] DISCORD_WEBHOOK_URL not set!");
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Discord webhook not configured" }));
          return;
        }

        const discordPayload = buildDiscordPayload(feedbackData);
        await sendToDiscord(CONFIG.DISCORD_WEBHOOK_URL, discordPayload);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            id: feedbackData.id,
            message: "Feedback forwarded to Discord",
          })
        );

        console.log(`[Bridge] ✓ Sent to Discord - ID: ${feedbackData.id}`);
      } catch (error) {
        console.error(`[Bridge] Error:`, error.message);

        if (error.message.includes("JSON")) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        } else {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "Internal server error", details: error.message })
          );
        }
      }
    });

    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(CONFIG.PORT, () => {
  console.log("================================");
  console.log("  Roblox Feedback Bridge v2.0");
  console.log("================================");
  console.log(`🚀 Server running on port ${CONFIG.PORT}`);
  console.log(
    `🔔 Discord: ${CONFIG.DISCORD_WEBHOOK_URL ? "✓ Configured" : "✗ NOT SET"}`
  );
  console.log(`📡 Webhook endpoint: POST /webhook`);
  console.log(`💚 Health check: GET /`);
  console.log("================================");
});

process.on("unhandledRejection", (reason) => {
  console.error("[Bridge] Unhandled rejection:", reason);
});
