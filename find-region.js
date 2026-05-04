const { S3Client, ListObjectsV2Command } = require("@aws-sdk/client-s3");
require("dotenv").config();

const regions = ["sfo3", "nyc3", "ams3", "sgp1", "fra1", "blr1", "syd1"];
const bucketName = "dhruvir-cs";

async function findBucket() {
  for (const region of regions) {
    console.log(`Testing region: ${region}...`);
    const client = new S3Client({
      region,
      endpoint: `https://${region}.digitaloceanspaces.com`,
      credentials: {
        accessKeyId: process.env.SPACES_ACCESS_KEY_ID,
        secretAccessKey: process.env.SPACES_SECRET_ACCESS_KEY,
      },
    });

    try {
      const cmd = new ListObjectsV2Command({ Bucket: bucketName, MaxKeys: 1 });
      await client.send(cmd);
      console.log(`\n✅ FOUND! The bucket "${bucketName}" is in region: ${region}`);
      process.exit(0);
    } catch (err) {
      if (err.Code === "NoSuchBucket" || err.message.includes("does not exist")) {
        // Continue to next region
      } else {
        console.log(`❌ Error in ${region}: ${err.message}`);
      }
    }
  }
  console.log("\n❌ Could not find the bucket in any common region. Please check if the name is correct.");
}

findBucket();
