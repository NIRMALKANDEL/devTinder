// Added: one-time migration for the "one active request per pair" index.
// Fills pairKey on connection requests created before it existed, then builds the
// index. Safe to run more than once. Run on the server after deploying:
//   node scripts/migrate-pair-keys.js
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const { connectionRequest, pairKeyFor } = require("../src/models/connectionRequest");

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const missing = await connectionRequest.find({ pairKey: { $exists: false } }).select("fromUserId toUserId").lean();
  const ops = missing.map((r) => ({
    updateOne: { filter: { _id: r._id }, update: { $set: { pairKey: pairKeyFor(r.fromUserId, r.toUserId) } } },
  }));
  if (ops.length) await connectionRequest.bulkWrite(ops, { ordered: false });
  console.log(`pairKey set on ${ops.length} request(s)`);
  await connectionRequest.syncIndexes();
  console.log("indexes:", (await connectionRequest.collection.indexes()).map((i) => i.name).join(", "));
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error("Migration failed:", err.message);
  await mongoose.disconnect();
  process.exit(1);
});
