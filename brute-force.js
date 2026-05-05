const { S3Client, ListObjectsV2Command } = require("@aws-sdk/client-s3");
require("dotenv").config();

const bucketNames = ["csformly", "cs-formly", "sycu-formly", "sycu",];
const regions = ["sfo3", "nyc3"];

async function bruteForce() {
  for (const region of regions) {
    for (const name of bucketNames) {
      console.log(`Testing ${name} in ${region}...`);
      const client = new S3Client({
        region,
        endpoint: `https://${region}.digitaloceanspaces.com`,
        credentials: {
          accessKeyId: process.env.SPACES_ACCESS_KEY_ID,
          secretAccessKey: process.env.SPACES_SECRET_ACCESS_KEY,
        },
      });

      try {
        const cmd = new ListObjectsV2Command({ Bucket: name, MaxKeys: 1 });
        await client.send(cmd);
        console.log(`\n✅ SUCCESS! Bucket: ${name}, Region: ${region}`);
        process.exit(0);
      } catch (err) {
        // Continue
      }
    }
  }
  console.log("\n❌ No combination worked.");
}

bruteForce();
