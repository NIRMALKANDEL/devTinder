const { SendEmailCommand } = require("@aws-sdk/client-ses");
const { sesClient } = require("./sesClient");

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
  });
};

// Sends an email via AWS SES. The sender must be a verified SES identity
// (and, while in the SES sandbox, the recipient must be verified too).
const run = async ({ toAddress, subject, htmlBody, textBody }) => {
  const sendEmailCommand = createSendEmailCommand(
    toAddress,
    process.env.SES_FROM_EMAIL,
    subject,
    htmlBody,
    textBody || htmlBody.replace(/<[^>]*>/g, "")
  );

  try {
    return await sesClient.send(sendEmailCommand);
  } catch (caught) {
    if (caught instanceof Error && caught.name === "MessageRejected") {
      return caught;
    }
    throw caught;
  }
};

// Names come from user input, so escape them before putting them in HTML
const escapeHtml = (str = "") =>
  String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const fullName = (user) => `${user.firstName} ${user.lastName || ""}`.trim();

// Never throws: an email failure shouldn't fail the API request.
// If EMAIL_DEMO_RECIPIENT is set, every email goes there instead of the real user.
const safeSend = async (options) => {
  const toAddress = process.env.EMAIL_DEMO_RECIPIENT || options.toAddress;
  if (!toAddress) return;
  try {
    const result = await run({ ...options, toAddress });
    if (result instanceof Error) {
      console.error("Email rejected by SES:", result.message);
    }
    return result;
  } catch (err) {
    console.error("Error sending email:", err.message);
  }
};

const sendConnectionRequestEmail = (toUser, fromUser) =>
  safeSend({
    toAddress: toUser.emailId,
    subject: `${fromUser.firstName} is interested in connecting on DevTinder`,
    htmlBody: `<h1>Hi ${escapeHtml(toUser.firstName)},</h1><p>${escapeHtml(fullName(fromUser))} sent you a connection request on DevTinder. Log in to accept or reject it.</p>`,
  });

const sendRequestAcceptedEmail = (toUser, acceptedBy) =>
  safeSend({
    toAddress: toUser.emailId,
    subject: `${acceptedBy.firstName} accepted your connection request on DevTinder`,
    htmlBody: `<h1>Hi ${escapeHtml(toUser.firstName)},</h1><p>${escapeHtml(fullName(acceptedBy))} accepted your connection request. You're now connected on DevTinder!</p>`,
  });

// Sent right after signup: welcome message + email verification link
const sendWelcomeEmail = (user, verifyUrl) =>
  safeSend({
    toAddress: user.emailId,
    subject: "Welcome to DevTinder! Please verify your email",
    htmlBody: `<h1>Hi ${escapeHtml(user.firstName)}, welcome to DevTinder!</h1>
<p>You have successfully registered on DevTinder, the place where developers meet, connect and build together.</p>
<p>Find developers who share your skills, send connection requests to people you'd love to code with, and grow your network one match at a time.</p>
<p>Please verify your email to activate your account:</p>
<p><a href="${verifyUrl}">Verify my email</a></p>
<p>If the button doesn't work, copy this link into your browser:<br>${verifyUrl}</p>
<p>Happy coding,<br>The DevTinder Team</p>`,
  });

const sendPasswordResetEmail = (user, resetUrl) =>
  safeSend({
    toAddress: user.emailId,
    subject: "Reset your DevTinder password",
    htmlBody: `<h1>Hi ${escapeHtml(user.firstName)},</h1>
<p>We received a request to reset your DevTinder password. This link is valid for 15 minutes:</p>
<p><a href="${resetUrl}">Reset my password</a></p>
<p>If the button doesn't work, copy this link into your browser:<br>${resetUrl}</p>
<p>If you didn't ask for this, you can ignore this email. Your password won't change.</p>`,
  });

module.exports = {
  run,
  sendConnectionRequestEmail,
  sendRequestAcceptedEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
};
