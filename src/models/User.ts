import { Schema, model } from "mongoose";

const userSchema = new Schema({
  telegramId: { type: Number, required: true, unique: true },
  firstName: { type: String },
  username: { type: String },
  employeeId: { type: String },
  fullName: { type: String },
  role: { type: String, enum: ['admin', 'employee'], default: 'employee' },
  isActive: { type: Boolean, default: true },
  registeredAt: { type: Date, default: Date.now },
});

const visitSchema = new Schema({
  telegramId: { type: Number, required: true },
  firstName: { type: String },
  username: { type: String },
  shopCode: { type: String },
  shopName: { type: String },
  location: {
    type: { type: String, enum: ["Point"], required: true },
    coordinates: [Number],
  },
  photoId: { type: String, required: true },
  // Optional cached Telegram file path (can be filled when generating reports)
  photoFilePath: { type: String },
  timestamp: { type: Date, required: true },
});

visitSchema.index({ location: "2dsphere" });

export const User = model("User", userSchema);
export const Visit = model("Visit", visitSchema);
