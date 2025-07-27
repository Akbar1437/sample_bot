import "dotenv/config";
import { Bot } from "grammy";
import { GrammyError, HttpError } from "grammy";
import mongoose from "mongoose";
import { User, Visit } from "./models/User.js";

const BOT_API_KEY = process.env.BOT_TOKEN;
const EMPLOYEE_IDS = process.env.EMPLOYEE_IDS?.split(",").map(Number) || [];
const TARGET_LOCATION = {
  lat: parseFloat(process.env.TARGET_LAT || "0"),
  lng: parseFloat(process.env.TARGET_LNG || "0"),
};
const MAX_DISTANCE = 10000; // meters

if (!BOT_API_KEY || EMPLOYEE_IDS.length !== 4) {
  throw new Error("Missing required environment variables");
}

const bot = new Bot(BOT_API_KEY);

// User state to track geolocation and photo submission
const userStates = new Map<
  number,
  { step: string; location?: { lat: number; lng: number } }
>();

// Haversine formula to calculate distance between two points
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Check if all employees have submitted
async function checkAllSubmitted(): Promise<boolean> {
  const visits = await Visit.find({
    timestamp: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
  });
  return EMPLOYEE_IDS.every((id) =>
    visits.some((visit) => visit.telegramId === id)
  );
}

// Start command
bot.command("start", async (ctx) => {
  if (!ctx.from) {
    return ctx.reply("Error: User information not available");
  }

  const { id, first_name, username } = ctx.from;
  if (!EMPLOYEE_IDS.includes(id)) {
    return ctx.reply("Вы не являетесь сотрудником.");
  }

  try {
    const existingUser = await User.findOne({ telegramId: id });
    if (!existingUser) {
      const newUser = new User({
        telegramId: id,
        firstName: first_name,
        username,
      });
      await newUser.save();
    }

    userStates.set(id, { step: "awaiting_location" });
    ctx.reply("Привет, отправь сначала свою геолокацию 📍");
  } catch (error) {
    console.error("Ошибка при регистрации пользователя:", error);
    ctx.reply("Произошла ошибка, попробуйте позже.");
  }
});

// Handle location
bot.on("message:location", async (ctx) => {
  if (!ctx.from) return;
  const { id } = ctx.from;
  const state = userStates.get(id);

  if (state?.step !== "awaiting_location") {
    return ctx.reply("Сначала отправь геолокацию 📍");
  }

  const { latitude, longitude } = ctx.message.location;
  const distance = calculateDistance(
    latitude,
    longitude,
    TARGET_LOCATION.lat,
    TARGET_LOCATION.lng
  );
  if (distance > MAX_DISTANCE) {
    return ctx.reply(
      `Вы слишком далеко от точки (расстояние: ${Math.round(distance)} м).`
    );
  }

  userStates.set(id, {
    step: "awaiting_photo",
    location: { lat: latitude, lng: longitude },
  });
  ctx.reply("Теперь сделай фото с места 📷");
});

// Handle photo
bot.on("message:photo", async (ctx) => {
  if (!ctx.from) return;
  const { id, first_name, username } = ctx.from;
  const state = userStates.get(id);

  if (state?.step !== "awaiting_photo" || !state.location) {
    return ctx.reply("Сначала отправь геолокацию 📍");
  }

  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  // if (ctx.message.forward_origin || ctx.message.photo) {
  //   return ctx.reply("Фото должно быть сделано с камеры, а не пересылкой!");
  // }

  try {
    const file = await ctx.api.getFile(photo.file_id);
    const visit = new Visit({
      telegramId: id,
      firstName: first_name,
      username,
      location: {
        type: "Point",
        coordinates: [state.location.lng, state.location.lat],
      },
      photoId: photo.file_id,
      timestamp: new Date(),
    });
    await visit.save();

    userStates.delete(id);
    ctx.reply(`Спасибо! Записал визит в ${new Date().toLocaleTimeString()}`);

    if (await checkAllSubmitted()) {
      ctx.reply("Все сотрудники отчитались!");
    }
  } catch (error) {
    console.error("Ошибка при сохранении визита:", error);
    ctx.reply("Произошла ошибка, попробуйте позже.");
  }
});

// Error handling
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;

  if (e instanceof GrammyError) {
    console.error("Error in request:", e.description);
  } else if (e instanceof HttpError) {
    console.error("Could not contact Telegram:", e);
  } else {
    console.error("Unknown error:", e);
  }
});

// Start bot
async function startBot() {
  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is not defined");
  }

  try {
    await mongoose.connect(MONGODB_URI);
    bot.start();
    console.log("MongoDB connected & bot started");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
  }
}

startBot();
