const fs = require("fs");
const path = require("path");
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Directory for saving JSON-based configs (if needed)
const DIR = path.join(__dirname, "../../../logs/saved-configs");
fs.mkdirSync(DIR, { recursive: true });

// Function to get file path for the strategy's config
function fileFor(mode) {
  return path.join(DIR, `${mode}.json`);
}

// 📥 Save a new named config for a strategy (DB + JSON)
exports.save = async (mode, config, name = "") => {
  console.log("📁 Saving config...");

  // Prisma - Save config to DB
  try {
    await prisma.strategyConfig.create({
      data: {
        strategyName: mode,
        name: name || null,
        amountToSpend: config.amountToSpend,
        slippage: config.slippage,
        interval: config.interval,
        maxTrades: config.maxTrades,
        tokenFeed: config.tokenFeed,
        maxSlippage: config.maxSlippage,
        priorityFeeLamports: config.priorityFeeLamports,
        haltOnFailures: config.haltOnFailures,
        dryRun: config.dryRun,
        // ... Add all other fields from the config object
      },
    });

    console.log("✅ Config saved to DB.");
  } catch (err) {
    console.error("❌ Failed to save config to DB:", err.message);
  }

  // JSON - Save the config to a JSON file
  const file = fileFor(mode);
  console.log("📁 Saving config to file:", file);

  let list;
  if (!fs.existsSync(file)) {
    console.log("📄 File does not exist. Creating new.");
    list = [];
  } else {
    const raw = fs.readFileSync(file);
    try {
      const parsed = JSON.parse(raw);
      list = Array.isArray(parsed) ? parsed : [parsed];
    } catch (err) {
      console.error("❌ Failed to parse config file:", err.message);
      throw new Error("Corrupted config file for " + mode);
    }
  }

  const entry = {
    strategy: mode,
    name: name || null,
    config,
    createdAt: Date.now(),
  };

  list.push(entry);
  fs.writeFileSync(file, JSON.stringify(list, null, 2));
  console.log("✅ Config saved to file.");
};

// 📖 Read all saved configs for a strategy (DB + JSON)
exports.read = async (mode) => {
  console.log("📖 Reading configs...");

  try {
    // Prisma - Fetch configs from DB
    const configsFromDB = await prisma.strategyConfig.findMany({
      where: { strategyName: mode },
    });
    return configsFromDB;
  } catch (err) {
    console.error("❌ Failed to read configs from DB:", err.message);
  }

  // JSON - Read from file if needed
  const file = fileFor(mode);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
};

// ❌ Delete all configs for a strategy (DB + JSON)
exports.remove = async (mode) => {
  console.log(`❌ Removing configs for ${mode}...`);

  // Prisma - Delete from DB
  try {
    await prisma.strategyConfig.deleteMany({
      where: { strategyName: mode },
    });
    console.log("✅ All configs deleted from DB.");
  } catch (err) {
    console.error("❌ Failed to delete configs from DB:", err.message);
  }

  // JSON - Delete the file (if it exists)
  const file = fileFor(mode);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    console.log("✅ Config file deleted.");
  }
};

// 📋 List all saved configs for all strategies (DB + JSON)
exports.listAll = async () => {
  console.log("📋 Listing all saved configs...");

  // Prisma - Get all configs from DB
  try {
    const configsFromDB = await prisma.strategyConfig.findMany();
    return configsFromDB;
  } catch (err) {
    console.error("❌ Failed to list configs from DB:", err.message);
  }

  // JSON - Get all files in the directory
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      const mode = path.basename(f, ".json");
      const configs = exports.read(mode) || [];
      return configs.map((entry) => ({
        ...entry,
        strategy: mode,
      }));
    });
};
