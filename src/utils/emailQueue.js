// In-process background queue for outgoing email.
// API handlers enqueue and return immediately; the queue sends in the background,
// respecting the SES send rate, retrying transient failures with backoff and
// dropping duplicates. Jobs live in memory, so anything still queued is lost if
// the process crashes (on SIGTERM we drain first, see drain()).
const crypto = require("crypto");
const validator = require("validator");

// SES errors that will never succeed on retry
const PERMANENT_ERRORS = new Set([
  "MessageRejected",
  "InvalidParameterValue",
  "MailFromDomainNotVerifiedException",
  "ConfigurationSetDoesNotExistException",
  "AccountSendingPausedException",
  "ConfigurationSetSendingPausedException",
  "InvalidClientTokenId",
  "SignatureDoesNotMatch",
  "AccessDenied",
  "AccessDeniedException",
]);

const isTransient = (err) => {
  if (PERMANENT_ERRORS.has(err.name)) return false;
  const status = err.$metadata && err.$metadata.httpStatusCode;
  // No HTTP status means a network error / timeout; 429 and 5xx are worth retrying
  return !status || status === 429 || status >= 500 || /Throttl/i.test(err.name);
};

// Log addresses as "a***@domain.com" so logs don't leak full emails
const maskEmail = (email = "") => email.replace(/^(.).*(@.*)$/, "$1***$2");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createEmailQueue = ({
  send, // async ({ toAddress, subject, htmlBody, textBody }) => SES response
  maxSendRate = 10, // emails per second, keep at or below the SES MaxSendRate
  concurrency = 5,
  maxAttempts = 4,
  retryBaseMs = 2000,
  dedupeWindowMs = 10 * 60 * 1000,
  maxQueueSize = 10000,
  logger = console,
}) => {
  const pending = [];
  const recentKeys = new Map(); // dedupeKey -> expiry timestamp
  const claimedKeys = new Set(); // keys reserved by claim(), awaiting enqueue
  const sendTimes = []; // timestamps of sends in the last second
  let running = 0;
  let retryTimers = 0;
  let accepting = true;
  const idleWaiters = [];
  const stats = { queued: 0, sent: 0, failed: 0, retried: 0, duplicates: 0, invalid: 0 };

  const isIdle = () => pending.length === 0 && running === 0 && retryTimers === 0;
  const notifyIfIdle = () => {
    if (isIdle()) idleWaiters.splice(0).forEach((resolve) => resolve());
  };

  const isRecentlyQueued = (key) => {
    const expiry = recentKeys.get(key);
    if (expiry && expiry > Date.now()) return true;
    recentKeys.delete(key);
    return false;
  };

  // Synchronously reserve a dedupe key. Returns false if it was used recently.
  // Call before any await so two concurrent requests can't both pass the check.
  const claim = (key, windowMs = dedupeWindowMs) => {
    if (isRecentlyQueued(key)) return false;
    recentKeys.set(key, Date.now() + windowMs);
    claimedKeys.add(key);
    return true;
  };

  // Give back a claimed key that won't be used (e.g. the DB update failed)
  const release = (key) => {
    if (claimedKeys.delete(key)) recentKeys.delete(key);
  };

  const pruneKeys = () => {
    const now = Date.now();
    for (const [key, expiry] of recentKeys) if (expiry <= now) recentKeys.delete(key);
  };

  // Wait until another send fits inside the per-second rate limit
  const waitForRateSlot = async () => {
    for (;;) {
      const now = Date.now();
      while (sendTimes.length && now - sendTimes[0] >= 1000) sendTimes.shift();
      if (sendTimes.length < maxSendRate) {
        sendTimes.push(now);
        return;
      }
      await sleep(1000 - (now - sendTimes[0]));
    }
  };

  const processJob = async (job) => {
    job.attempts += 1;
    try {
      await waitForRateSlot();
      const result = await send(job.message);
      stats.sent += 1;
      logger.log(
        `[email] sent ${job.id} to ${maskEmail(job.message.toAddress)} (MessageId ${result && result.MessageId})`
      );
    } catch (err) {
      if (isTransient(err) && job.attempts < maxAttempts) {
        stats.retried += 1;
        const delay = retryBaseMs * 2 ** (job.attempts - 1) + Math.floor(Math.random() * 250);
        logger.warn(
          `[email] ${job.id} attempt ${job.attempts}/${maxAttempts} failed (${err.name}), retrying in ${delay}ms`
        );
        retryTimers += 1;
        setTimeout(() => {
          retryTimers -= 1;
          pending.push(job);
          pump();
        }, delay);
      } else {
        stats.failed += 1;
        logger.error(
          `[email] ${job.id} to ${maskEmail(job.message.toAddress)} failed permanently after ${job.attempts} attempt(s): ${err.name}: ${err.message}`
        );
      }
    }
  };

  const pump = () => {
    while (running < concurrency && pending.length) {
      const job = pending.shift();
      running += 1;
      processJob(job).finally(() => {
        running -= 1;
        pump();
        notifyIfIdle();
      });
    }
  };

  // Returns { queued: true, id } or { queued: false, reason }. Never throws.
  // windowMs: how long the same dedupeKey is treated as a duplicate
  const enqueue = ({ toAddress, subject, htmlBody, textBody, dedupeKey, windowMs = dedupeWindowMs }) => {
    const to = String(toAddress || "").trim().toLowerCase();
    if (!validator.isEmail(to)) {
      stats.invalid += 1;
      logger.warn(`[email] skipped invalid recipient "${maskEmail(to)}"`);
      return { queued: false, reason: "invalid_address" };
    }
    if (!accepting) {
      logger.error(`[email] queue is shutting down, dropped email to ${maskEmail(to)}`);
      return { queued: false, reason: "shutting_down" };
    }
    if (pending.length >= maxQueueSize) {
      logger.error(`[email] queue full (${maxQueueSize}), dropped email to ${maskEmail(to)}`);
      return { queued: false, reason: "queue_full" };
    }

    // Default key: same recipient + same content = duplicate (e.g. a double click)
    const key =
      dedupeKey ||
      `${to}:${crypto.createHash("sha256").update(`${subject}\n${htmlBody}`).digest("hex")}`;
    if (claimedKeys.has(key)) {
      claimedKeys.delete(key); // reserved by this caller via claim()
    } else if (isRecentlyQueued(key)) {
      stats.duplicates += 1;
      return { queued: false, reason: "duplicate" };
    }
    if (recentKeys.size > 5000) pruneKeys();
    recentKeys.set(key, Date.now() + windowMs);

    const id = crypto.randomUUID();
    pending.push({ id, attempts: 0, message: { toAddress: to, subject, htmlBody, textBody } });
    stats.queued += 1;
    pump();
    return { queued: true, id };
  };

  // Stop accepting new email and wait (up to timeoutMs) for queued email to go out
  const drain = (timeoutMs = 25000) => {
    accepting = false;
    if (isIdle()) return Promise.resolve(true);
    return Promise.race([
      new Promise((resolve) => idleWaiters.push(() => resolve(true))),
      sleep(timeoutMs).then(() => false),
    ]);
  };

  const getStats = () => ({ ...stats, pending: pending.length, running, retrying: retryTimers });

  return { enqueue, claim, release, isRecentlyQueued, drain, getStats };
};

module.exports = { createEmailQueue, isTransient, maskEmail };
