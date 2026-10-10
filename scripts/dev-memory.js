// Added: run the API against a throwaway in-memory MongoDB with demo users.
// Nothing touches the production database and no real email is sent.
//   npm run dev:memory   ->  login as aarav@example.com / Dev@12345
const { MongoMemoryServer } = require("mongodb-memory-server");

(async () => {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri("devTinder");
  process.env.ENABLE_CRON = "false";
  process.env.EMAIL_DRY_RUN = "true";

  const { start } = require("../src/app");
  const mongoose = require("mongoose");
  await start();
  const { seed, PASSWORD } = require("./seed");
  await mongoose.connection.syncIndexes();
  const { users } = await seed();
  console.log(`[dev:memory] seeded ${users.length} users. Login: ${users[0].emailId} / ${PASSWORD}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
