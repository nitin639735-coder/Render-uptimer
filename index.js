const fetch = require("node-fetch");
const http = require("http");

// ═══════════════════════════════════════════════════
//  ⚙️  CONFIG — यहाँ अपने URLs डालो
// ═══════════════════════════════════════════════════

const SELF_URL = "https://your-ping-worker.onrender.com"; // ← अपना Render URL डालो

const HF_SPACES = [
  "https://huggingface.co/spaces/Xmen19/claw4?logs=container",
  "https://space2-username.hf.space",
  "https://space3-username.hf.space",
  "https://space4-username.hf.space",
  "https://space5-username.hf.space",
  "https://space6-username.hf.space",
  "https://space7-username.hf.space",
  "https://space8-username.hf.space",
  "https://space9-username.hf.space",
  "https://space10-username.hf.space",
  "https://space11-username.hf.space",
  "https://space12-username.hf.space",
  "https://space13-username.hf.space",
  "https://space14-username.hf.space",
  "https://space15-username.hf.space",
];

const CONFIG = {
  minInterval: 5 * 60 * 1000,   // 5 min
  maxInterval: 12 * 60 * 1000,  // 12 min
  retries: 3,
  retryBaseDelay: 4000,          // 4 sec (exponential backoff)
  requestTimeout: 20000,         // 20 sec per request
  jitterBetweenUrls: [1000, 3500], // 1–3.5 sec gap between each URL ping
};

// ═══════════════════════════════════════════════════
//  📊 STATS
// ═══════════════════════════════════════════════════

const stats = {
  rounds: 0,
  totalPings: 0,
  success: 0,
  failed: 0,
  startTime: Date.now(),
  lastRoundTime: null,
  perSpace: {},
};

HF_SPACES.forEach((url) => {
  stats.perSpace[url] = { success: 0, failed: 0 };
});

// ═══════════════════════════════════════════════════
//  🎲 RANDOM HELPERS
// ═══════════════════════════════════════════════════

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min) + min);
}

function getRandomInterval() {
  return randomBetween(CONFIG.minInterval, CONFIG.maxInterval);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPad; CPU OS 17_3 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36",
];

const ACCEPT_LANGS = [
  "en-US,en;q=0.9",
  "en-GB,en;q=0.8",
  "en-IN,en;q=0.7",
  "en;q=0.6",
];

function getRandomHeaders() {
  return {
    "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": ACCEPT_LANGS[Math.floor(Math.random() * ACCEPT_LANGS.length)],
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": Math.random() > 0.5 ? "no-cache" : "max-age=0",
    "DNT": Math.random() > 0.5 ? "1" : "0",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
  };
}

// ═══════════════════════════════════════════════════
//  🖨️  LOGGER
// ═══════════════════════════════════════════════════

function formatUptime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${h}h ${m}m ${s}s`;
}

function now() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

function log(type, msg) {
  const labels = {
    ok:    `${C.green}[ ✓ OK  ]${C.reset}`,
    fail:  `${C.red}[ ✗ ERR ]${C.reset}`,
    warn:  `${C.yellow}[ ⚠ WRN ]${C.reset}`,
    info:  `${C.cyan}[ ℹ INF ]${C.reset}`,
    stats: `${C.magenta}[ ◈ STS ]${C.reset}`,
    head:  `${C.bold}${C.blue}[ ━━━━━ ]${C.reset}`,
  };
  console.log(`${labels[type] || labels.info} ${C.dim}${now()}${C.reset}  ${msg}`);
}

// ═══════════════════════════════════════════════════
//  🌐 PING WITH RETRY + TIMEOUT + BACKOFF
// ═══════════════════════════════════════════════════

async function pingURL(url) {
  for (let attempt = 1; attempt <= CONFIG.retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeout);

    try {
      const res = await fetch(url, {
        headers: getRandomHeaders(),
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      return { ok: res.ok, status: res.status };
    } catch (err) {
      clearTimeout(timer);
      if (attempt < CONFIG.retries) {
        const backoff = CONFIG.retryBaseDelay * attempt;
        log("warn", `Retry ${attempt}/${CONFIG.retries} → ${url}  (${err.message}) wait ${backoff/1000}s`);
        await sleep(backoff);
      } else {
        throw err;
      }
    }
  }
}

// ═══════════════════════════════════════════════════
//  🔄 SHUFFLE — हर round में अलग order
// ═══════════════════════════════════════════════════

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ═══════════════════════════════════════════════════
//  📡 PING ALL SPACES + SELF
// ═══════════════════════════════════════════════════

async function pingAll() {
  stats.rounds++;
  stats.lastRoundTime = Date.now();

  log("head", `━━━  Round #${stats.rounds} Started  ━━━━━━━━━━━━━━━━━━━━━━`);

  // Shuffle order every round (anti-pattern detection)
  const shuffledSpaces = shuffle(HF_SPACES);
  const allTargets = [...shuffledSpaces, SELF_URL];

  let roundOk = 0;
  let roundFail = 0;

  for (const url of allTargets) {
    const isSelf = url === SELF_URL;
    const label = isSelf ? `${C.cyan}[SELF]${C.reset} ${url}` : url;

    try {
      const result = await pingURL(url);
      stats.totalPings++;
      stats.success++;
      roundOk++;

      if (!isSelf) {
        stats.perSpace[url] = stats.perSpace[url] || { success: 0, failed: 0 };
        stats.perSpace[url].success++;
      }

      log("ok", `${label}  →  HTTP ${result.status}`);
    } catch (err) {
      stats.totalPings++;
      stats.failed++;
      roundFail++;

      if (!isSelf) {
        stats.perSpace[url] = stats.perSpace[url] || { success: 0, failed: 0 };
        stats.perSpace[url].failed++;
      }

      log("fail", `${label}  →  ${err.message}`);
    }

    // Random jitter between pings
    const jitter = randomBetween(...CONFIG.jitterBetweenUrls);
    await sleep(jitter);
  }

  // Round summary
  const rate = ((stats.success / stats.totalPings) * 100).toFixed(1);
  const uptime = formatUptime(Date.now() - stats.startTime);

  log("stats", `Round #${stats.rounds} done  |  ✓ ${roundOk}  ✗ ${roundFail}  |  Overall: ${stats.success}/${stats.totalPings} (${rate}%)  |  Uptime: ${uptime}`);
  log("head", `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

// ═══════════════════════════════════════════════════
//  🌍 HTTP SERVER (Render Web Service के लिए जरूरी)
// ═══════════════════════════════════════════════════

function buildStatusPage() {
  const uptime = formatUptime(Date.now() - stats.startTime);
  const rate = stats.totalPings > 0
    ? ((stats.success / stats.totalPings) * 100).toFixed(1)
    : "0.0";

  const spaceRows = HF_SPACES.map((url, i) => {
    const s = stats.perSpace[url] || { success: 0, failed: 0 };
    const total = s.success + s.failed;
    const spaceRate = total > 0 ? ((s.success / total) * 100).toFixed(0) : "-";
    const shortUrl = url.replace("https://", "").replace(".hf.space", "");
    return `<tr>
      <td>#${i + 1}</td>
      <td>${shortUrl}</td>
      <td style="color:#4ade80">${s.success}</td>
      <td style="color:#f87171">${s.failed}</td>
      <td>${spaceRate}%</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html>
<head>
  <title>Ping Worker Status</title>
  <meta charset="utf-8"/>
  <meta http-equiv="refresh" content="60"/>
  <style>
    body { font-family: monospace; background: #0f172a; color: #e2e8f0; padding: 2rem; }
    h1 { color: #38bdf8; } h2 { color: #94a3b8; font-size: 0.9rem; }
    .card { background: #1e293b; border-radius: 8px; padding: 1.5rem; margin: 1rem 0; }
    .big { font-size: 2rem; font-weight: bold; color: #4ade80; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
    table { width: 100%; border-collapse: collapse; }
    th { color: #38bdf8; text-align: left; padding: 6px; border-bottom: 1px solid #334155; }
    td { padding: 6px; border-bottom: 1px solid #1e293b; font-size: 0.85rem; }
    .badge { display: inline-block; background: #4ade80; color: #000; border-radius: 4px; padding: 2px 8px; font-size: 0.75rem; }
  </style>
</head>
<body>
  <h1>🛰️ HF Space Ping Worker</h1>
  <span class="badge">LIVE</span>
  <div class="grid">
    <div class="card"><div>Uptime</div><div class="big">${uptime}</div></div>
    <div class="card"><div>Total Pings</div><div class="big">${stats.totalPings}</div></div>
    <div class="card"><div>Success Rate</div><div class="big">${rate}%</div></div>
  </div>
  <div class="card">
    <table>
      <tr><th>#</th><th>Space</th><th>✓ OK</th><th>✗ Fail</th><th>Rate</th></tr>
      ${spaceRows}
    </table>
  </div>
  <p style="color:#475569;font-size:0.75rem">Auto-refreshes every 60s · Rounds: ${stats.rounds}</p>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "alive",
      uptime: formatUptime(Date.now() - stats.startTime),
      rounds: stats.rounds,
      success: stats.success,
      failed: stats.failed,
      total: stats.totalPings,
    }));
  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(buildStatusPage());
  }
});

server.listen(process.env.PORT || 3000, () => {
  log("info", `🌐 HTTP server on port ${process.env.PORT || 3000} (status page: /  health: /health)`);
});

// ═══════════════════════════════════════════════════
//  🚀 MAIN LOOP
// ═══════════════════════════════════════════════════

async function start() {
  log("info", `${C.bold}🚀 Ping Worker starting...${C.reset}`);
  log("info", `📡 Monitoring ${HF_SPACES.length} HF Spaces + 1 Self-ping = ${HF_SPACES.length + 1} total targets`);
  log("info", `⏱️  Interval: ${CONFIG.minInterval/60000}–${CONFIG.maxInterval/60000} min (random)`);

  // First ping immediately on start
  await pingAll();

  while (true) {
    const delay = getRandomInterval();
    log("info", `⏳ Next round in ${(delay / 60000).toFixed(1)} minutes...`);
    await sleep(delay);
    await pingAll();
  }
}

// ═══════════════════════════════════════════════════
//  🛡️ ERROR GUARDS
// ═══════════════════════════════════════════════════

process.on("uncaughtException", (err) => {
  log("fail", `Uncaught Exception: ${err.message}`);
});

process.on("unhandledRejection", (reason) => {
  log("fail", `Unhandled Rejection: ${reason}`);
});

process.on("SIGTERM", () => {
  log("warn", "SIGTERM — shutting down gracefully");
  process.exit(0);
});

start();
