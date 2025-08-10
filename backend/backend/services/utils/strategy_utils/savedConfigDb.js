const prisma = require("../../../prisma/prisma");

module.exports = {
  async savePreset({ userId, mode, name = "", cfg }) {
    return prisma.SavedConfigs.create({
      data: {
        strategyName: mode,
        isSaved: true,
        savedAt: new Date(),
        name,
        userId,
        /* store full object so nothing is lost */
        extras: cfg,
      },
    });
  },

  async listPresets(userId) {
    return prisma.SavedConfigs.findMany({
      where: { userId, isSaved: true },
      orderBy: { savedAt: "desc" },
      select: {
        id: true,
        strategyName: true,
        name: true,
        savedAt: true,
        extras: true,
      },
    });
  },



  async updatePreset({ id, userId, name, cfg }) {
  return prisma.SavedConfigs.update({
    where: { id, userId },
    data: {
      name,
      extras   : cfg,
      savedAt  : new Date(),     // bump timestamp
    },
  });
},

  async deletePreset(userId, id) {
    return prisma.SavedConfigs.deleteMany({
      where: { id: +id, userId, isSaved: true },
    });
  },
};