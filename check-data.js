const mongoose = require("mongoose");
require("dotenv").config();

async function checkExistingFiles() {
  console.log("Connecting to MongoDB to check file storage paths...");
  try {
    await mongoose.connect(process.env.MONGO_URI);
    
    // Check submissions for any file URLs
    const Submission = mongoose.model("Submission", new mongoose.Schema({}, { strict: false }));
    const latest = await Submission.find({ payload: { $regex: /http/ } }).sort({ createdAt: -1 }).limit(5);

    if (latest.length === 0) {
      console.log("No submissions found with file URLs.");
    } else {
      console.log("Found recent file URLs:");
      latest.forEach(s => {
        console.log("- " + s.payload);
      });
    }
    
    process.exit(0);
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

checkExistingFiles();
