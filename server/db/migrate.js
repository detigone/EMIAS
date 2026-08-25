'use strict';

/**
 * Миграции схемы БД «ЕМИАС». Единый источник истины для всех
 * компонентов системы (веб-панель, будущий бот, планировщик напоминаний).
 */

const MIGRATIONS = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          discord_id       TEXT UNIQUE,
          discord_username TEXT,
          discord_avatar   TEXT,
          full_name        TEXT NOT NULL,
          specialty        TEXT,
          role             TEXT NOT NULL DEFAULT 'Врач',
          status           TEXT NOT NULL DEFAULT 'offline',
          is_active        INTEGER NOT NULL DEFAULT 1,
          created_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS patients (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          card_number TEXT UNIQUE NOT NULL,
          full_name   TEXT NOT NULL,
          birth_date  TEXT,
          sex         TEXT CHECK (sex IN ('М', 'Ж')),
          oms_number  TEXT UNIQUE,
          blood_group TEXT,
          allergies   TEXT,
          phone       TEXT,
          created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS appointments (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_number TEXT UNIQUE NOT NULL,
          patient_id    INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
          doctor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
          date          TEXT NOT NULL,
          time          TEXT NOT NULL,
          status        TEXT NOT NULL DEFAULT 'waiting'
                        CHECK (status IN ('waiting', 'in_room', 'done', 'cancelled', 'no_show')),
          room          TEXT,
          created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
        CREATE INDEX IF NOT EXISTS idx_appointments_doctor ON appointments(doctor_id, date);
        CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

        CREATE TABLE IF NOT EXISTS emr_records (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          patient_id      INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
          doctor_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
          visit_date      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
          record_type     TEXT NOT NULL DEFAULT 'visit'
                          CHECK (record_type IN ('visit', 'lab', 'procedure')),
          complaints      TEXT,
          diagnosis_code  TEXT,
          diagnosis_text  TEXT,
          notes           TEXT,
          sick_leave_days INTEGER,
          created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_emr_patient ON emr_records(patient_id);

        CREATE TABLE IF NOT EXISTS prescriptions (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          prescription_number TEXT UNIQUE NOT NULL,
          patient_id          INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
          doctor_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
          medication          TEXT NOT NULL,
          dosage              TEXT NOT NULL,
          duration_days       INTEGER,
          issued_at           TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions(patient_id);

        CREATE TABLE IF NOT EXISTS sessions (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token      TEXT UNIQUE NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS audit_log (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
          action      TEXT NOT NULL,
          entity_type TEXT,
          entity_id   TEXT,
          details     TEXT,
          ip          TEXT,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
      `);
    },
  },
];

MIGRATIONS.push({
  version: 2,
  up(db) {
    // Привязка персонажей-граждан к Discord-аккаунту и статус аккаунта.
    db.exec(`
      ALTER TABLE patients ADD COLUMN discord_id TEXT;
      ALTER TABLE patients ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
      CREATE INDEX IF NOT EXISTS idx_patients_discord ON patients(discord_id);

      CREATE TABLE IF NOT EXISTS citizen_accounts (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id       TEXT UNIQUE NOT NULL,
        discord_username TEXT,
        discord_avatar   TEXT,
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        last_login_at    TEXT
      );

      CREATE TABLE IF NOT EXISTS citizen_sessions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        token      TEXT UNIQUE NOT NULL,
        account_id INTEGER NOT NULL REFERENCES citizen_accounts(id) ON DELETE CASCADE,
        patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },
});

MIGRATIONS.push({
  version: 3,
  up(db) {
    // Одноразовые коды привязки персонажа к Discord-аккаунту через бота.
    db.exec(`
      CREATE TABLE IF NOT EXISTS link_codes (
        code       TEXT PRIMARY KEY,
        patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        used_at    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_link_codes_patient ON link_codes(patient_id);
    `);
  },
});

MIGRATIONS.push({
  version: 4,
  up(db) {
    // Хранилище настроек бота/интеграций (вебхуки, каналы, флаги).
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key        TEXT PRIMARY KEY,
        value      TEXT,
        label      TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },
});

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const current = Number(
    db.prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`).get()?.value ?? 0
  );

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    migration.up(db);
    db.prepare(
      `INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(String(migration.version));
    console.log(`[db] миграция применена: v${migration.version}`);
  }
}

module.exports = { runMigrations };

if (require.main === module) {
  const { getDb } = require('./connection');
  runMigrations(getDb());
  console.log('[db] схема актуальна');
}
