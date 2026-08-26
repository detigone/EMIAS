const { PrismaClient } = require('@prisma/client');
const env = require('../env');

let prisma;

if (globalThis.__prisma) {
  prisma = globalThis.__prisma;
} else {
  prisma = new PrismaClient({
    datasourceUrl: env.DATABASE_URL || undefined,
  });
  globalThis.__prisma = prisma;
}

function getDb() {
  return prisma;
}

module.exports = { getDb, prisma };
