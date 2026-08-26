/**
 * Миграции схемы БД «ЕМИАС».
 *
 * СHEMA УПРАВЛЯЕТСЯ PRISMA — используйте:
 *   npx prisma migrate dev --name emias   (локально)
 *   npx prisma migrate deploy            (прод)
 *
 * Prisma-схема: ../../prisma/schema.prisma (Minzdrav/schema.txt)
 */

async function runMigrations() {
  console.log('[db] Схема управляется Prisma. Используйте `npx prisma migrate deploy`.');
}

module.exports = { runMigrations };

if (require.main === module) {
  runMigrations();
}
