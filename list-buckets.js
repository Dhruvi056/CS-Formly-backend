const { S3Client, ListBucketsCommand } = require("@aws-sdk/client-s3");
require("dotenv").config();

async function listBuckets() {
  console.log("Listing all buckets in account...");
  
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
    const cmd = new ListBucketsCommand({});
    const out = await client.send(cmd);
    console.log("Available Buckets:");
    out.Buckets.forEach(b => console.log("- " + b.Name));
  } catch (err) {
    console.error("FAILURE:", err.message);
  }
}

listBuckets();
