const { SESClient } = require("@aws-sdk/client-ses");

const Region = process.env.AWS_REGION || "ap-south-1";

const sesClient = new SESClient({
  region: Region,
  credentials: {
    accessKeyId: process.env.AWS_SES_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SES_SECRET_ACCESS_KEY,
  },
});

module.exports = { sesClient };
