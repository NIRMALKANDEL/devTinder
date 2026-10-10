// Reusable email templates. Each one takes user-specific data and returns
// { subject, htmlBody }. User-supplied values are escaped before going into HTML.

const escapeHtml = (str = "") =>
  String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Subjects are plain text, but a newline in a name must never reach a header
const oneLine = (str = "") => String(str).replace(/[\r\n]+/g, " ").trim();

const fullName = (user) => `${user.firstName} ${user.lastName || ""}`.trim();

const templates = {
  // Sent right after signup (and on login while unverified)
  welcome: ({ user, verifyUrl }) => ({
    subject: "Welcome to DevTinder! Please verify your email",
    htmlBody: `<h1>Hi ${escapeHtml(user.firstName)}, welcome to DevTinder!</h1>
<p>You have successfully registered on DevTinder, the place where developers meet, connect and build together.</p>
<p>Find developers who share your skills, send connection requests to people you'd love to code with, and grow your network one match at a time.</p>
<p>Please verify your email to activate your account:</p>
<p><a href="${escapeHtml(verifyUrl)}">Verify my email</a></p>
<p>If the button doesn't work, copy this link into your browser:<br>${escapeHtml(verifyUrl)}</p>
<p>Happy coding,<br>The DevTinder Team</p>`,
  }),

  passwordReset: ({ user, resetUrl }) => ({
    subject: "Reset your DevTinder password",
    htmlBody: `<h1>Hi ${escapeHtml(user.firstName)},</h1>
<p>We received a request to reset your DevTinder password. This link is valid for 15 minutes:</p>
<p><a href="${escapeHtml(resetUrl)}">Reset my password</a></p>
<p>If the button doesn't work, copy this link into your browser:<br>${escapeHtml(resetUrl)}</p>
<p>If you didn't ask for this, you can ignore this email. Your password won't change.</p>`,
  }),

  connectionRequest: ({ toUser, fromUser }) => ({
    subject: oneLine(
      `${fromUser.firstName} is interested in connecting on DevTinder`
    ),
    htmlBody: `<h1>Hi ${escapeHtml(toUser.firstName)},</h1><p>${escapeHtml(fullName(fromUser))} sent you a connection request on DevTinder. Log in to accept or reject it.</p>`,
  }),

  requestAccepted: ({ toUser, acceptedBy }) => ({
    subject: oneLine(
      `${acceptedBy.firstName} accepted your connection request on DevTinder`
    ),
    htmlBody: `<h1>Hi ${escapeHtml(toUser.firstName)},</h1><p>${escapeHtml(fullName(acceptedBy))} accepted your connection request. You're now connected on DevTinder!</p>`,
  }),

  // Added: admin notification when a user is reported
  userReported: ({ reporter, reported, reason, details }) => ({
    subject: oneLine(`DevTinder report: ${fullName(reported)} (${reason})`),
    htmlBody: `<h1>New user report</h1>
<p><strong>Reported:</strong> ${escapeHtml(fullName(reported))} (${escapeHtml(String(reported._id))})</p>
<p><strong>By:</strong> ${escapeHtml(fullName(reporter))} (${escapeHtml(String(reporter._id))})</p>
<p><strong>Reason:</strong> ${escapeHtml(reason)}</p>
<p><strong>Details:</strong> ${escapeHtml(details || "-")}</p>`,
  }),

  // Daily digest of requests still waiting for a reply
  pendingRequestsDigest: ({ toUser, senderNames }) => ({
    subject: "Pending Connection Requests on DevTinder",
    htmlBody: `<h1>Hi ${escapeHtml(toUser.firstName)},</h1>
<p>You have ${senderNames.length} new connection request${senderNames.length === 1 ? "" : "s"} waiting on DevTinder from:</p>
<ul>${senderNames.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul>
<p>Log in to accept or reject them.</p>`,
  }),
};

const render = (templateName, data) => {
  const template = templates[templateName];
  if (!template) throw new Error(`Unknown email template: ${templateName}`);
  return template(data);
};

module.exports = { render, fullName };
