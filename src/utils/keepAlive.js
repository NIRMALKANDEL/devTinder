// Added: keeps the Render free instance awake.
// Render stops a free web service after 15 minutes without incoming requests, and a
// sleeping service answers non-browser requests (the Cloudflare Worker, uptime pingers)
// with a "Just a moment" bot check instead of waking up, so the site stays down until
// someone opens the onrender.com address in a browser. Calling our own public URL every
// 10 minutes counts as incoming traffic, so the service never falls asleep.
// RENDER_EXTERNAL_URL is set by Render automatically; elsewhere this does nothing.
const INTERVAL_MS = 10 * 60 * 1000;

const startKeepAlive = () => {
  const base = process.env.RENDER_EXTERNAL_URL;
  if (!base || process.env.KEEP_ALIVE === "false") return;
  const ping = async () => {
    try {
      const res = await fetch(`${base}/health`, {
        headers: { "User-Agent": "devtinder-keepalive" },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) console.warn(`[keep-alive] /health answered ${res.status}`);
    } catch (err) {
      console.warn("[keep-alive] ping failed:", err.message);
    }
  };
  setInterval(ping, INTERVAL_MS).unref();
  console.log(`[keep-alive] pinging ${base}/health every 10 minutes`);
};

module.exports = { startKeepAlive };
