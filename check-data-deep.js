const mongoose = require("mongoose");
require("dotenv").config();

async function checkData() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const Submission = mongoose.model("Submission", new mongoose.Schema({}, { strict: false }));
    const all = await Submission.find({}).sort({ createdAt: -1 }).limit(10);
    
    console.log(`Found ${all.length} submissions.`);
    all.forEach((s, i) => {
      console.log(`\n--- Submission ${i+1} ---`);
      console.log(JSON.stringify(s.data, null, 2));
    });
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkData();
