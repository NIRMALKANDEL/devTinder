const mongoose = require("mongoose");

const connectionRequestSchema = new mongoose.Schema(
  {
    fromUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    toUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["interested", "ignored", "accepted", "rejected"],
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

connectionRequestSchema.index({ fromUserId: 1, toUserId: 1 });
// Added: speeds up "requests received" and "connections" lookups
connectionRequestSchema.index({ toUserId: 1, status: 1 });

// Added: the two user ids in a fixed order, so A->B and B->A share one key
const pairKeyFor = (a, b) => [String(a), String(b)].sort().join(":");

// Added: at most one active (interested/accepted) request per pair of users, in
// either direction. Ignored/rejected ones don't count, so a pair can try again.
// This makes the duplicate check in the route race-free (two quick clicks).
connectionRequestSchema.add({ pairKey: { type: String } });
connectionRequestSchema.index(
  { pairKey: 1 },
  {
    unique: true,
    name: "unique_active_pair",
    partialFilterExpression: {
      pairKey: { $exists: true },
      status: { $in: ["interested", "accepted"] },
    },
  }
);

connectionRequestSchema.pre("save", function (next) {
  if (this.fromUserId.equals(this.toUserId)) {
    return next(new Error("Cannot send a connection request to yourself"));
  }
  this.pairKey = pairKeyFor(this.fromUserId, this.toUserId);
  next();
});

const connectionRequest = mongoose.model(
  "connectionRequest",
  connectionRequestSchema
);

module.exports = { connectionRequest, pairKeyFor };
