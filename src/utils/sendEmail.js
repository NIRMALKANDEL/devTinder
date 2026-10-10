const { SendEmailCommand } = require("@aws-sdk/client-ses");
const { sesClient } = require("./sesClient");
const { createEmailQueue } = require("./emailQueue");
const { render, fullName } = require("./emailTemplates");

const createSendEmailCommand = (toAddress, fromAddress, subject, htmlBody, textBody) => {
  return new SendEmailCommand({
    Destination: {
      CcAddresses: [],
      ToAddresses: [toAddress],
    },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: htmlBody,
        },
        Text: {
          Charset: "UTF-8",
          Data: textBody,
        },
      },
      Subject: {
        Charset: "UTF-8",
        Data: subject,
      },
    },
    Source: fromAddress,
    ReplyToAddresses: [],
    // Optional: lets SES publish bounce/complaint/delivery events for this email
    ...(process.env.SES_CONFIGURATION_SET && {
      ConfigurationSetName: process.env.SES_CONFIGURATION_SET,
    }),
  });
};

// Sends one email via AWS SES right now. Throws on any SES error so the queue
// can decide whether to retry. Prefer the queued helpers below.
// If EMAIL_DEMO_RECIPIENT is set, every email goes there instead of the real user.
const run = async ({ toAddress, subject, htmlBody, textBody }) => {
  const sendEmailCommand = createSendEmailCommand(
    process.env.EMAIL_DEMO_RECIPIENT || toAddress,
    process.env.SES_FROM_EMAIL,
    subject,
    htmlBody,
    textBody || htmlBody.replace(/<[^>]*>/g, "")
  );
  return sesClient.send(sendEmailCommand);
};

const envInt = (name, fallback) => {
  const value = parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

// One queue per process. Keep EMAIL_MAX_SEND_RATE at or below the SES MaxSendRate
// (14/sec on this account), divided by the number of app instances.
const emailQueue = createEmailQueue({
  send: run,
  maxSendRate: envInt("EMAIL_MAX_SEND_RATE", 10),
  concurrency: envInt("EMAIL_CONCURRENCY", 5),
  maxAttempts: envInt("EMAIL_MAX_ATTEMPTS", 4),
});

// Renders a template and queues it. Returns immediately and never throws:
// an email failure shouldn't fail the API request.
const queueTemplate = (toAddress, templateName, data, dedupeKey, windowMs) => {
  try {
    const { subject, htmlBody } = render(templateName, data);
    return emailQueue.enqueue({ toAddress, subject, htmlBody, dedupeKey, windowMs });
  } catch (err) {
    console.error(`[email] could not queue ${templateName}:`, err.message);
    return { queued: false, reason: "error" };
  }
};

// Verification / reset emails can be re-requested once a minute: long enough to
// stop inbox flooding, short enough not to block a user who really needs a new link
const RESEND_COOLDOWN_MS = 60 * 1000;

const sendConnectionRequestEmail = (toUser, fromUser) =>
  queueTemplate(
    toUser.emailId,
    "connectionRequest",
    { toUser, fromUser },
    `connectionRequest:${fromUser._id}:${toUser._id}`
  );

const sendRequestAcceptedEmail = (toUser, acceptedBy) =>
  queueTemplate(
    toUser.emailId,
    "requestAccepted",
    { toUser, acceptedBy },
    `requestAccepted:${acceptedBy._id}:${toUser._id}`
  );

// Sent right after signup: welcome message + email verification link
const sendWelcomeEmail = (user, verifyUrl) =>
  queueTemplate(user.emailId, "welcome", { user, verifyUrl }, `welcome:${user._id}`, RESEND_COOLDOWN_MS);

const sendPasswordResetEmail = (user, resetUrl) =>
  queueTemplate(user.emailId, "passwordReset", { user, resetUrl }, `passwordReset:${user._id}`, RESEND_COOLDOWN_MS);

// Bulk: queue one digest per user. `digests` is [{ toUser, senderNames }].
// dayKey makes re-running the job on the same day a no-op.
const sendPendingRequestsDigests = (digests, dayKey) =>
  digests.map(({ toUser, senderNames }) =>
    queueTemplate(
      toUser.emailId,
      "pendingRequestsDigest",
      { toUser, senderNames },
      `digest:${toUser._id}:${dayKey}`
    )
  );

// Reserve the right to send the welcome / reset email for this user. Returns
// false if one went out in the last minute. Call it before rotating the
// token, so a double-submitted form can't rotate it twice and break the link.
const claimWelcomeEmail = (user) => emailQueue.claim(`welcome:${user._id}`, RESEND_COOLDOWN_MS);
const claimPasswordResetEmail = (user) =>
  emailQueue.claim(`passwordReset:${user._id}`, RESEND_COOLDOWN_MS);
const releaseWelcomeEmail = (user) => emailQueue.release(`welcome:${user._id}`);
const releasePasswordResetEmail = (user) => emailQueue.release(`passwordReset:${user._id}`);

module.exports = {
  run,
  emailQueue,
  fullName,
  claimWelcomeEmail,
  claimPasswordResetEmail,
  releaseWelcomeEmail,
  releasePasswordResetEmail,
  sendConnectionRequestEmail,
  sendRequestAcceptedEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendPendingRequestsDigests,
};
