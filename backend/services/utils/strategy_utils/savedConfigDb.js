const prisma = require("../../../prisma/prisma");

module.exports = {
  async savePreset({ userId, mode, name = "", cfg }) {
    // Write both fields for forward/back-compat (some rows used `strategy`)
    return prisma.SavedConfigs.create({
      data: {
        strategyName: mode,
        strategy: mode,
        isSaved: true,
        savedAt: new Date(),
        name,
        userId,
        // store full object so nothing is lost
        extras: cfg,
      },
    });
  },

  // Accept optional `mode` filter; match either column for back-compat.
  async listPresets(userId, mode = null) {
    const rows = await prisma.SavedConfigs.findMany({
      where: {
        userId,
        isSaved: true,
        ...(mode
          ? { OR: [{ strategyName: mode }, { strategy: mode }] }
          : {}),
      },
      orderBy: { savedAt: "desc" },
      select: {
        id: true,
        strategyName: true,
        strategy: true, // legacy column
        name: true,
        savedAt: true,
        extras: true,
      },
    });

    // Coalesce so the router can safely read r.strategyName
    return rows.map((r) => ({
      ...r,
      strategyName: r.strategyName || r.strategy || null,
    }));
  },

  async updatePreset({ id, userId, name, cfg }) {
    return prisma.SavedConfigs.update({
      where: { id, userId },
      data: {
        name,
        extras: cfg,
        savedAt: new Date(), // bump timestamp
      },
    });
  },

  async deletePreset(userId, id) {
    return prisma.SavedConfigs.deleteMany({
      where: { id: +id, userId, isSaved: true },
    });
  },
};
