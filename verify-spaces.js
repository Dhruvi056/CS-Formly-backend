const { S3Client, ListObjectsV2Command } = require("@aws-sdk/client-s3");
require("dotenv").config();

async function testConnection() {
  console.log("Testing DigitalOcean Spaces Connection...");
  console.log("Region:", process.env.SPACES_REGION);
  console.log("Endpoint:", process.env.SPACES_ENDPOINT);
  console.log("Bucket:", process.env.SPACES_BUCKET);

  const client = new S3Client({
    region: process.env.SPACES_REGION,
    endpoint: process.env.SPACES_ENDPOINT,
    credentials: {
      accessKeyId: process.env.SPACES_ACCESS_KEY_ID,
      secretAccessKey: process.env.SPACES_SECRET_ACCESS_KEY,
    },
    forcePathStyle: false,
  });

  try {
    const cmd = new ListObjectsV2Command({
      Bucket: process.env.SPACES_BUCKET,
      MaxKeys: 1,
    });
    await client.send(cmd);
    console.log("SUCCESS: Connected to bucket!");
  } catch (err) {
    console.error("FAILURE:", err.message);
    if (err.Code) console.error("Error Code:", err.Code);
  }
}

testConnection();
