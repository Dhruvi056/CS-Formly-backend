const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { v4: uuidv4 } = require("uuid");

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function makeSpacesClient() {
  return new S3Client({
    region: requiredEnv("SPACES_REGION"),
    endpoint: requiredEnv("SPACES_ENDPOINT"), // e.g. https://sgp1.digitaloceanspaces.com
    credentials: {
      accessKeyId: requiredEnv("SPACES_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("SPACES_SECRET_ACCESS_KEY"),
    },
    forcePathStyle: false,
  });
}

function normalizeKeyPart(v) {
  return String(v || "")
    .trim()
    .replace(/[^\w.\-() ]+/g, "_")
    .replace(/\s+/g, "-")
    .slice(0, 120);
}

function buildKey({ kind, formId, fileName }) {
  const safeFile = normalizeKeyPart(fileName || "file");
  const id = uuidv4();
  if (kind === "profile") return `profile_photos/${id}-${safeFile}`;
  const safeForm = normalizeKeyPart(formId);
  return `forms/${safeForm}/${id}-${safeFile}`;
}

function encodeKeyForUrl(key) {
  return encodeURIComponent(key).replace(/%2F/g, "/");
}

function publicUrlForKey(key) {
  const cdn = process.env.SPACES_CDN_BASE;
  if (cdn) return `${cdn.replace(/\/$/, "")}/${encodeKeyForUrl(key)}`;
  const region = requiredEnv("SPACES_REGION");
  const bucket = requiredEnv("SPACES_BUCKET");
  return `https://${bucket}.${region}.digitaloceanspaces.com/${encodeKeyForUrl(key)}`;
}

async function presignPutUrl({ key, contentType, expiresInSec = 60, makePublic = false }) {
  const client = makeSpacesClient();
  const Bucket = requiredEnv("SPACES_BUCKET");

  const cmd = new PutObjectCommand({
    Bucket,
    Key: key,
    ContentType: contentType || "application/octet-stream",
    ...(makePublic ? { ACL: "public-read" } : {}),
  });

  return await getSignedUrl(client, cmd, { expiresIn: expiresInSec });
}

async function uploadBuffer({ key, buffer, contentType, makePublic = false }) {
  const client = makeSpacesClient();
  const Bucket = requiredEnv("SPACES_BUCKET");

  const cmd = new PutObjectCommand({
    Bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType || "application/octet-stream",
    ...(makePublic ? { ACL: "public-read" } : {}),
  });

  await client.send(cmd);
  return { key, url: publicUrlForKey(key) };
}

async function presignGetUrl({ key, expiresInSec = 60 }) {
  const client = makeSpacesClient();
  const Bucket = requiredEnv("SPACES_BUCKET");
  const cmd = new GetObjectCommand({ Bucket, Key: key });
  return await getSignedUrl(client, cmd, { expiresIn: expiresInSec });
}

async function findLatestKeyByFilename({ prefix, fileName }) {
  const client = makeSpacesClient();
  const Bucket = requiredEnv("SPACES_BUCKET");
  const target = String(fileName || "").trim().toLowerCase();
  if (!target) return "";

  let ContinuationToken = undefined;
  let best = null;

  // Keep it bounded: search first ~2000 keys max.
  for (let page = 0; page < 20; page++) {
    const out = await client.send(
      new ListObjectsV2Command({
        Bucket,
        Prefix: prefix,
        ContinuationToken,
        MaxKeys: 100,
      })
    );

    const items = out?.Contents || [];
    for (const it of items) {
      const k = String(it?.Key || "");
      if (!k) continue;
      if (!k.toLowerCase().includes(target)) continue;
      if (!best || (it.LastModified && best.LastModified && it.LastModified > best.LastModified)) {
        best = it;
      }
    }

    if (!out?.IsTruncated) break;
    ContinuationToken = out.NextContinuationToken;
    if (!ContinuationToken) break;
  }

  return best?.Key ? String(best.Key) : "";
}

module.exports = {
  buildKey,
  publicUrlForKey,
  presignPutUrl,
  presignGetUrl,
  uploadBuffer,
  findLatestKeyByFilename,
};

