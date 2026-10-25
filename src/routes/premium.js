// Added: Premium plan info, the user's Premium status, and the Premium-only
// daily recommendations.
const crypto = require("crypto");
const express = require("express");
const { userAuth } = require("../middlewares/auth");
const { User } = require("../models/user");
const { Payment } = require("../models/payment");
const { connectionRequest } = require("../models/connectionRequest");
const { blockedIdsFor } = require("../utils/relations");
const { getPlan, isPremiumActive, requirePremium } = require("../utils/premium");
const razorpay = require("../utils/razorpay");
const { USER_SAFE_DATA } = require("./user");

const premiumRouter = express.Router();
const DAILY_PICKS = 5;

// Public: what the Premium page shows. checkoutEnabled is false until Razorpay keys
// and a confirmed price are set in .env.
premiumRouter.get("/premium/plan", (req, res) => {
  const plan = getPlan();
  res.json({
    data: {
      ...plan,
      checkoutEnabled: razorpay.isConfigured() && plan.priceConfirmed,
      mode: razorpay.isConfigured() ? razorpay.mode() : null,
    },
  });
});

premiumRouter.get("/premium/status", userAuth, async (req, res) => {
  try {
    const payments = await Payment.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("orderId amount currency status entitlementGranted durationDays createdAt paidAt -_id");
    res.json({
      data: {
        isPremium: isPremiumActive(req.user),
        premiumExpiresAt: req.user.premiumExpiresAt || null,
        payments,
      },
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Day key in India time, so picks change at midnight IST
const todayKey = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
const dailyRank = (day, me, other) =>
  crypto.createHash("sha1").update(`${day}:${me}:${other}`).digest("hex");

// Premium: up to 5 developers a day, ranked by shared skills. Excludes yourself,
// blocked users and anyone you already have a request or connection with (same
// rules as the feed). The same picks are shown all day; one you act on drops out.
premiumRouter.get("/premium/recommendations", userAuth, requirePremium, async (req, res) => {
  try {
    const me = req.user;
    const hidden = await blockedIdsFor(me);
    const requests = await connectionRequest
      .find({ $or: [{ fromUserId: me._id }, { toUserId: me._id }] })
      .select("fromUserId toUserId");
    requests.forEach((r) => {
      hidden.add(String(r.fromUserId));
      hidden.add(String(r.toUserId));
    });
    hidden.add(String(me._id));

    const mySkills = (me.skills || []).map((s) => String(s).toLowerCase());
    const notHidden = { _id: { $nin: [...hidden] } };
    const sameSkills = mySkills.length
      ? await User.find({ ...notHidden, skills: { $in: me.skills } })
          .collation({ locale: "en", strength: 2 })
          .select(USER_SAFE_DATA)
          .limit(200)
      : [];
    const others = await User.find({
      ...notHidden,
      _id: { $nin: [...hidden, ...sameSkills.map((u) => String(u._id))] },
    })
      .select(USER_SAFE_DATA)
      .limit(100);

    const day = todayKey();
    const picks = [...sameSkills, ...others]
      .map((u) => {
        const sharedSkills = (u.skills || []).filter((s) => mySkills.includes(String(s).toLowerCase()));
        return { user: u, sharedSkills, rank: dailyRank(day, me._id, u._id) };
      })
      .sort((a, b) => b.sharedSkills.length - a.sharedSkills.length || a.rank.localeCompare(b.rank))
      .slice(0, DAILY_PICKS)
      .map(({ user, sharedSkills }) => ({ ...user.toJSON(), sharedSkills }));

    res.json({ data: picks, day });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = premiumRouter;
