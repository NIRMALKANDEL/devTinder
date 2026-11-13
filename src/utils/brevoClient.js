// Sends one email through Brevo's HTTP API (free plan: 300 emails/day).
// Uses Node's built-in fetch, so no extra npm package is needed.
// Errors carry err.name and err.$metadata.httpStatusCode like AWS SDK errors,
// so emailQueue's isTransient() keeps working: 429/5xx/network errors retry,
// other 4xx (bad key, unverified sender, no credits) fail permanently.
const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

// "DevTinder <no-reply@projectdev.in>" -> { name: "DevTinder", email: "no-reply@projectdev.in" }
const parseSender = (value = "") => {
  const match = String(value).match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) return match[1] ? { name: match[1], email: match[2].trim() } : { email: match[2].trim() };
  return { email: String(value).trim() };
};

const sendWithBrevo = async ({ toAddress, fromAddress, subject, htmlBody, textBody }) => {
  let res;
  try {
    res = await fetch(BREVO_URL, {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: parseSender(fromAddress),
        to: [{ email: toAddress }],
        subject,
        htmlContent: htmlBody,
        textContent: textBody,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    // Network error or timeout: no status code, so the queue retries it
    err.name = err.name === "TimeoutError" ? "BrevoTimeout" : "BrevoNetworkError";
    throw err;
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || `Brevo responded ${res.status}`);
    err.name = res.status === 429 ? "BrevoThrottled" : `Brevo${body.code ? `_${body.code}` : res.status}`;
    err.$metadata = { httpStatusCode: res.status };
    throw err;
  }
  return { MessageId: body.messageId };
};

module.exports = { sendWithBrevo, parseSender };
