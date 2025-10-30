// @ts-nocheck
import dayjs from "dayjs";
import "dotenv/config";
import ExcelJS from "exceljs";
import { Bot, GrammyError, HttpError } from "grammy";
import mongoose from "mongoose";
import { Shop } from "./models/Shop.js";
import { User, Visit } from "./models/User.js";

const BOT_API_KEY = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS?.split(",").map(Number) || [];
const TARGET_LOCATION = {
  lat: parseFloat(process.env.TARGET_LAT || "0"),
  lng: parseFloat(process.env.TARGET_LNG || "0"),
};
const MAX_DISTANCE = 10000; // meters

// Create bot only if token is present. If not, use a safe stub so the process can run
// (useful for local dev when you want DB connectivity without a Telegram token).
let bot: any;
if (BOT_API_KEY) {
  bot = new Bot(BOT_API_KEY);
} else {
  console.warn("BOT_TOKEN is not set — bot will not start. Handlers are registered to a stub.");
  bot = {
    command: () => { },
    on: () => { },
    catch: () => { },
    start: async () => console.log("Bot start skipped (no BOT_TOKEN)."),
  } as any;
}

// User state to track flows (registration, visit photo/location)
type State =
  | { step: "register" }
  | { step: "awaiting_photo"; shopCode: string }
  | { step: "awaiting_location"; shopCode: string; photoId: string; location?: { lat: number; lng: number } };

const userStates = new Map<number, State>();

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
  // Get all active employees
  const activeEmployees = await User.find({ role: 'employee', isActive: true });
  if (activeEmployees.length === 0) return false;

  // Get today's visits
  const visits = await Visit.find({
    timestamp: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
  });

  // Check if each active employee has submitted
  return activeEmployees.map(emp => emp.telegramId).every((id) =>
    visits.some((visit) => visit.telegramId === id)
  );
}

// Start command
bot.command("start", async (ctx) => {
  if (!ctx.from) return ctx.reply("Error: User information not available");

  const { id, first_name, username } = ctx.from;

  // Check if user is admin first
  const isAdmin = ADMIN_IDS.includes(id);

  try {
    const existingUser = await User.findOne({ telegramId: id });
    if (existingUser) {
      if (!existingUser.isActive) {
        existingUser.isActive = true;
        await existingUser.save();
        return ctx.reply("Ваш аккаунт был повторно активирован.");
      }
      return ctx.reply(
        `Привет ${existingUser.firstName || existingUser.fullName || username}, вы уже зарегистрированы.`
      );
    }

    // Ask to register (employee ID or FIO)
    userStates.set(id, { step: "register" });
    await ctx.reply(
      isAdmin ?
        "Добро пожаловать, администратор! Пожалуйста, укажите ваше имя." :
        "Добро пожаловать! Пожалуйста, отправьте ваш служебный ID или ФИО для привязки аккаунта."
    );
  } catch (error) {
    console.error("Ошибка при /start:", error);
    ctx.reply("Произошла ошибка, попробуйте позже.");
  }
});

// Visit command triggered by scanning QR (/visit SHOP123)
bot.command("visit", async (ctx) => {
  if (!ctx.from) return;
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const code = parts[1];
  if (!code) return ctx.reply("Использование: /visit <SHOP_CODE>");

  const { id } = ctx.from;
  const user = await User.findOne({ telegramId: id });
  if (!user) return ctx.reply("Вы не зарегистрированы. Отправьте /start и укажите ваш ID или ФИО.");

  // Store state and ask for photo
  userStates.set(id, { step: "awaiting_photo", shopCode: code });
  ctx.reply(
    `Вы начали визит в магазин ${code}. Пожалуйста, отправьте фото (селфи или фото в магазине).`
  );
});

// Handle text messages (registration and simple button texts)
bot.on("message:text", async (ctx) => {
  if (!ctx.from) return;
  const { id } = ctx.from;
  const isAdmin = ADMIN_IDS.includes(id);
  const state = userStates.get(id);
  const text = ctx.message.text?.trim();

  // Registration flow: user sent employee ID or full name
  if (state?.step === "register") {
    try {
      const existing = await User.findOne({ telegramId: id });
      if (existing) {
        userStates.delete(id);
        return ctx.reply("Вы уже зарегистрированы.");
      }

      // Create new user with appropriate role
      const newUser = new User({
        telegramId: id,
        firstName: ctx.from?.first_name,
        username: ctx.from?.username,
        // store provided value in employeeId/fullName depending on content
        employeeId: text?.match(/^\d+$/) ? text : undefined,
        fullName: text?.match(/\D/) ? text : undefined,
        role: isAdmin ? 'admin' : 'employee',
        isActive: true
      });
      await newUser.save();
      userStates.delete(id);
      return ctx.reply("Спасибо! Ваш аккаунт привязан.");
    } catch (err) {
      console.error("Registration error:", err);
      return ctx.reply("Не удалось зарегистрироваться, попробуйте позже.");
    }
  }

  // If user clicked the reply keyboard 'Share location' button the text will be that text.
  // We just ignore it here because location arrives in message:location handler.
  if (text === "Share location") return;
});

// Handle photo: expect photo first (from /visit flow)
bot.on("message:photo", async (ctx) => {
  console.log('Received photo from:', ctx.from?.id);
  if (!ctx.from) return;
  const { id } = ctx.from;

  const state = userStates.get(id);
  console.log('Current user state:', { userId: id, state: state });

  if (!state || state.step !== "awaiting_photo") {
    console.log('Invalid state for photo:', state);
    return ctx.reply("Чтобы отметить визит, сначала откройте /visit <код_магазина>");
  }

  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  if (!photo?.file_id) return ctx.reply("Не удалось получить фото, повторите попытку.");

  // Check if photo was forwarded from another chat/channel
  if (ctx.message.forward_date || ctx.message.forward_from || ctx.message.forward_from_chat) {
    return ctx.reply("Пожалуйста, сделайте новое фото. Пересланные фото не принимаются.");
  }

  // Move to awaiting_location state and ask for location
  userStates.set(id, { step: "awaiting_location", shopCode: state.shopCode, photoId: photo.file_id });

  // send keyboard to request location
  await ctx.reply(
    "Пожалуйста, поделитесь геолокацией (кнопка ниже).",
    {
      reply_markup: {
        keyboard: [[{ text: "Share location", request_location: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    }
  );
});

// Handle location (after photo)
bot.on("message:location", async (ctx) => {
  if (!ctx.from) return;
  const { id, first_name, username } = ctx.from;
  const state = userStates.get(id);
  if (!state || state.step !== "awaiting_location") {
    return ctx.reply("Сначала начните визит командой /visit <код_магазина> и отправьте фото.");
  }

  const { latitude, longitude } = ctx.message.location;
  const distance = calculateDistance(latitude, longitude, TARGET_LOCATION.lat, TARGET_LOCATION.lng);
  if (distance > MAX_DISTANCE) {
    return ctx.reply(`Вы слишком далеко от точки (расстояние: ${Math.round(distance)} м).`);
  }

  try {
    // fetch shop name if available
    const shop = await Shop.findOne({ code: state.shopCode });
    const file = await ctx.api.getFile(state.photoId);

    const visit = new Visit({
      telegramId: id,
      firstName: first_name,
      username,
      shopCode: state.shopCode,
      shopName: shop?.name || state.shopCode,
      location: {
        type: "Point",
        coordinates: [longitude, latitude],
      },
      photoId: state.photoId,
      photoFilePath: file.file_path,
      timestamp: new Date(),
    });
    await visit.save();

    userStates.delete(id);
    await ctx.reply(`Спасибо! Записал визит в ${new Date().toLocaleTimeString()}`);

    if (await checkAllSubmitted()) {
      ctx.reply("Все сотрудники отчитались!");
    }
  } catch (err) {
    console.error("Ошибка при сохранении визита:", err);
    ctx.reply("Произошла ошибка, попробуйте позже.");
  }
});

// Admin report command: /report [day|week|YYYY-MM-DD]
// Admin command to list/manage employees
bot.command("employees", async (ctx) => {
  if (!ctx.from) return;
  const fromId = ctx.from.id;

  // Check if user is admin
  const admin = await User.findOne({ telegramId: fromId, role: 'admin' });
  if (!admin) return ctx.reply("У вас нет доступа к этой команде.");

  // Get all employees
  const employees = await User.find({ role: 'employee' }).sort({ registeredAt: -1 });

  if (employees.length === 0) {
    return ctx.reply("Пока нет зарегистрированных сотрудников.");
  }

  // Format employee list
  const list = employees.map((emp, i) =>
    `${i + 1}. ${emp.fullName || emp.firstName || emp.username || 'Без имени'} ` +
    `(ID: ${emp.employeeId || 'нет'}) - ${emp.isActive ? '✅ активен' : '❌ не активен'}`
  ).join('\n');

  await ctx.reply(
    `Список сотрудников:\n\n${list}\n\n` +
    'Команды управления:\n' +
    '/employee_activate <TG_ID> - активировать сотрудника\n' +
    '/employee_deactivate <TG_ID> - деактивировать сотрудника'
  );
});

// Admin command to activate employee
bot.command("employee_activate", async (ctx) => {
  if (!ctx.from) return;

  const admin = await User.findOne({ telegramId: ctx.from.id, role: 'admin' });
  if (!admin) return ctx.reply("У вас нет доступа к этой команде.");

  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = Number(parts[1]);

  if (!targetId) return ctx.reply("Использование: /employee_activate <TELEGRAM_ID>");

  try {
    const employee = await User.findOne({ telegramId: targetId, role: 'employee' });
    if (!employee) return ctx.reply("Сотрудник не найден.");

    employee.isActive = true;
    await employee.save();

    ctx.reply(`Сотрудник ${employee.fullName || employee.firstName || employee.telegramId} активирован.`);
  } catch (err) {
    console.error('Error activating employee:', err);
    ctx.reply("Ошибка при активации сотрудника.");
  }
});

// Admin command to deactivate employee
bot.command("employee_deactivate", async (ctx) => {
  if (!ctx.from) return;

  const admin = await User.findOne({ telegramId: ctx.from.id, role: 'admin' });
  if (!admin) return ctx.reply("У вас нет доступа к этой команде.");

  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = Number(parts[1]);

  if (!targetId) return ctx.reply("Использование: /employee_deactivate <TELEGRAM_ID>");

  try {
    const employee = await User.findOne({ telegramId: targetId, role: 'employee' });
    if (!employee) return ctx.reply("Сотрудник не найден.");

    employee.isActive = false;
    await employee.save();

    ctx.reply(`Сотрудник ${employee.fullName || employee.firstName || employee.telegramId} деактивирован.`);
  } catch (err) {
    console.error('Error deactivating employee:', err);
    ctx.reply("Ошибка при деактивации сотрудника.");
  }
});

bot.command("report", async (ctx) => {
  if (!ctx.from) return;
  console.log("Report requested by:", ctx.from);

  const fromId = ctx.from.id;
  // Convert ADMIN_IDS to numbers for proper comparison
  const adminIds = ADMIN_IDS.split(',').map(Number);
  console.log('Admin IDs:', adminIds, 'User ID:', fromId);

  if (!adminIds.includes(fromId)) {
    console.log('Access denied for:', fromId);
    return ctx.reply("У вас нет доступа к этой команде.");
  }

  await ctx.reply("Генерирую отчет...");
  console.log('Generating report...');

  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const arg = parts[1] || "day";
  console.log('Report type:', arg);

  let fromDate = new Date();
  let toDate = new Date();

  if (arg === "day") {
    fromDate = new Date(new Date().setHours(0, 0, 0, 0));
    toDate = new Date(new Date().setHours(23, 59, 59, 999));
  } else if (arg === "week") {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // start Monday
    fromDate = new Date(now.setDate(diff));
    fromDate.setHours(0, 0, 0, 0);
    toDate = new Date();
  } else {
    // try parse YYYY-MM-DD
    const parsed = dayjs(arg, "YYYY-MM-DD");
    if (parsed.isValid()) {
      fromDate = parsed.toDate();
      fromDate.setHours(0, 0, 0, 0);
      toDate = new Date(parsed.toDate());
      toDate.setHours(23, 59, 59, 999);
    } else {
      return ctx.reply("Неверный аргумент. Используйте: /report day | week | YYYY-MM-DD");
    }
  }

  try {
    console.log('Searching visits from', fromDate, 'to', toDate);
    const visits = await Visit.find({ timestamp: { $gte: fromDate, $lte: toDate } }).sort({ timestamp: 1 });
    console.log('Found visits:', visits.length);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Visits");
    sheet.columns = [
      { header: "TelegramId", key: "telegramId", width: 12 },
      { header: "Employee", key: "employee", width: 24 },
      { header: "ShopCode", key: "shopCode", width: 12 },
      { header: "ShopName", key: "shopName", width: 24 },
      { header: "Timestamp", key: "timestamp", width: 20 },
      { header: "Latitude", key: "lat", width: 12 },
      { header: "Longitude", key: "lng", width: 12 },
      { header: "PhotoFileId", key: "photoId", width: 44 },
      { header: "PhotoUrl", key: "photoUrl", width: 60 },
    ];

    for (const v of visits) {
      const coords = v.location?.coordinates || [];
      const lat = coords[1];
      const lng = coords[0];
      let photoUrl = "";
      if (v.photoFilePath) {
        photoUrl = `https://api.telegram.org/file/bot${BOT_API_KEY}/${v.photoFilePath}`;
      }

      sheet.addRow({
        telegramId: v.telegramId,
        employee: v.firstName || v.username || v._id,
        shopCode: v.shopCode,
        shopName: v.shopName,
        timestamp: dayjs(v.timestamp).format("YYYY-MM-DD HH:mm:ss"),
        lat,
        lng,
        photoId: v.photoId,
        photoUrl,
      });
    }

    console.log('Generating Excel buffer...');
    const buf = await workbook.xlsx.writeBuffer();
    console.log('Excel buffer generated, size:', buf.length);

    // Send as InputFile for better type safety
    await ctx.replyWithDocument({
      source: Buffer.from(buf),
      filename: `report_${arg}.xlsx`,
    });
  } catch (err) {
    console.error("Report generation error:", err);
    ctx.reply("Не удалось сформировать отчёт, попробуйте позже.");
  }
});

// Error handling
bot.catch((err) => {
  const ctx = err.ctx;
  console.error('Bot error occurred:');
  console.error('- Update ID:', ctx.update.update_id);
  console.error('- Chat ID:', ctx.chat?.id);
  console.error('- User ID:', ctx.from?.id);
  console.error('- Message:', ctx.message?.text);

  const e = err.error;
  if (e instanceof GrammyError) {
    console.error("Telegram API Error:", {
      error: e.description,
      method: e.method,
      payload: e.payload
    });
  } else if (e instanceof HttpError) {
    console.error("HTTP Error:", {
      error: e.error,
      statusCode: e.statusCode,
      method: e.method
    });
  } else {
    console.error("Unknown error:", e);
    console.error(e.stack);
  }
});

// Simple HTTP server for health checks
import http from 'http';

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
  } else {
    res.writeHead(404);
    res.end();
  }
});

// Start bot and health check server
async function startBot() {
  console.log('Starting bot...');
  console.log('Environment check:');
  console.log('- BOT_TOKEN:', BOT_API_KEY ? 'Present' : 'Missing');
  console.log('- ADMIN_IDS:', process.env.ADMIN_IDS);
  console.log('- MONGODB_URI:', process.env.MONGODB_URI);

  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is not defined");
  }

  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('MongoDB connected successfully');

    console.log('Starting bot...');
    bot.start({
      onStart: (botInfo) => {
        console.log('Bot connected to Telegram:', botInfo);
      },
    });

    console.log('Starting health check server...');
    server.listen(PORT);
    console.log(`Health check server listening on port ${PORT}`);

    // Test MongoDB connection by counting visits
    const visitCount = await Visit.countDocuments();
    console.log(`Connected to MongoDB. Found ${visitCount} visits in database.`);
  } catch (error) {
    console.error("Error during startup:", error);
    process.exit(1);  // Завершаем процесс при ошибке старта
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  server.close(() => {
    mongoose.disconnect();
    process.exit(0);
  });
});

startBot();
