const mongoose = require("mongoose");

const connectDB = async () => {
  await mongoose.connect(
    "mongodb+srv://nirmalkandel001:p3NL67DpAHZmcUhn@cluster0.jbo97.mongodb.net/devTinder"
  );
};

module.exports = { connectDB };
