const mongoose = require("mongoose");
const nodeCrypto = require("crypto");

// Some hosting environments run older Node builds where global crypto is missing.
// MongoDB driver expects it for secure random generation.
if (!globalThis.crypto) {
  if (nodeCrypto.webcrypto) {
    globalThis.crypto = nodeCrypto.webcrypto;
  } else {
    globalThis.crypto = {
      getRandomValues: (typedArray) => nodeCrypto.randomFillSync(typedArray),
    };
  }
}

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB Connected Successfully");
  } catch (error) {
    console.error("MongoDB Connection Failed:", error.message);
    process.exit(1);
  }
};

module.exports = connectDB;

