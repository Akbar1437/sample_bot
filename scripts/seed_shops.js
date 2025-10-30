require("dotenv").config();
const mongoose = require("mongoose");

const shopSchema = new mongoose.Schema({ code: String, name: String });
const Shop = mongoose.model("Shop", shopSchema);

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is required in .env");
    process.exit(1);
  }
  await mongoose.connect(uri);
  const shops = [
    { code: "SHOP123", name: "Фируз" },
    { code: "SHOP124", name: "Магазин 2" },
  ];
  for (const s of shops) {
    await Shop.updateOne({ code: s.code }, { $set: s }, { upsert: true });
    console.log("Seeded", s.code);
  }
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
