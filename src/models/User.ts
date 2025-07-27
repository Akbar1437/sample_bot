import { Schema, model } from "mongoose";

const userSchema = new Schema({
  telegramId: { type: Number, required: true, unique: true },
  firstName: { type: String },
  username: { type: String },
});

const visitSchema = new Schema({
  telegramId: { type: Number, required: true },
  firstName: { type: String },
  username: { type: String },
  location: {
    type: { type: String, enum: ["Point"], required: true },
    coordinates: [Number],
  },
  photoId: { type: String, required: true },
  timestamp: { type: Date, required: true },
});

visitSchema.index({ location: "2dsphere" });

export const User = model("User", userSchema);
export const Visit = model("Visit", visitSchema);
