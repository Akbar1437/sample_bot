import { Schema, model } from "mongoose";

const shopSchema = new Schema({
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
});

export const Shop = model("Shop", shopSchema);
