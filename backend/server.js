const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 } // 8MB
});

const USE_PG = Boolean(process.env.DATABASE_URL);
let pool = null;
let sqlite = null;

function mapRecordRow(row) {
  // Normalize sqlite/pg column naming for the frontend.
  return {
    id: row.id,
    date: row.date ?? row.day,
    type: row.type,
    sizo: row.sizo,
    rowNum: row.rowNum ?? row.rownum,
    value: row.value,
    resolved: row.resolved
  };
}

async function initPg() {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS records (
      id BIGSERIAL PRIMARY KEY,
      day DATE NOT NULL,
      type TEXT NOT NULL,
      sizo TEXT NOT NULL,
      rownum INTEGER NOT NULL,
      value TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      UNIQUE(day, type, sizo, rownum)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sizo_images (
      id BIGSERIAL PRIMARY KEY,
      day DATE NOT NULL,
      type TEXT NOT NULL,
      sizo TEXT NOT NULL,
      mime TEXT NOT NULL,
      data BYTEA NOT NULL,
      updatedat TIMESTAMPTZ NOT NULL,
      UNIQUE(day, type, sizo)
    );
  `);

  console.log('✅ Postgres schema ready');
}

function initSqlite() {
  // Local/dev default. NOTE: On Render Free web services the filesystem is ephemeral; don't rely on this in production there.
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (e) {
    throw new Error(
      'SQLite unavailable. Set DATABASE_URL for Postgres or install better-sqlite3 for local dev.'
    );
  }

  const dbFilePath = process.env.SQLITE_PATH || path.join(__dirname, 'sizo.db');
  sqlite = new Database(dbFilePath);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      sizo TEXT NOT NULL,
      rowNum INTEGER NOT NULL,
      value TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      UNIQUE(date, type, sizo, rowNum)
    );
  `);

  try {
    const cols = sqlite.prepare(`PRAGMA table_info(records)`).all();
    const hasResolved = cols.some((c) => c.name === 'resolved');
    if (!hasResolved) {
      sqlite.exec(`ALTER TABLE records ADD COLUMN resolved INTEGER NOT NULL DEFAULT 0;`);
    }
  } catch (e) {
    console.warn('⚠️ Migration skipped:', e?.message ?? e);
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sizo_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      sizo TEXT NOT NULL,
      mime TEXT NOT NULL,
      data BLOB NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(date, type, sizo)
    );
  `);

  console.log(`✅ SQLite ready at ${dbFilePath}`);
}

let dbInitPromise = null;

async function ensureDbReady() {
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      if (USE_PG) {
        console.log('🧠 Using Postgres (DATABASE_URL is set)');
        await initPg();
      } else {
        console.log('🧠 Using SQLite (DATABASE_URL is not set)');
        initSqlite();
      }
    })();
  }
  return dbInitPromise;
}

app.use(async (req, res, next) => {
  try {
    await ensureDbReady();
    next();
  } catch (e) {
    console.error('❌ DB init failed:', e);
    res.status(500).json({ error: 'db_init_failed' });
  }
});

app.get('/records/:date/:type', async (req, res) => {
  const { date, type } = req.params;
  const { sizo } = req.query;

  try {
    if (USE_PG) {
      if (sizo) {
        const { rows } = await pool.query(
          `SELECT id, day AS date, type, sizo, rownum AS "rowNum", value, resolved
           FROM records
           WHERE day = $1::date AND type = $2 AND sizo = $3
           ORDER BY rownum ASC`,
          [date, type, String(sizo)]
        );
        return res.json(rows.map(mapRecordRow));
      }
      const { rows } = await pool.query(
        `SELECT id, day AS date, type, sizo, rownum AS "rowNum", value, resolved
         FROM records
         WHERE day = $1::date AND type = $2
         ORDER BY sizo ASC, rownum ASC`,
        [date, type]
      );
      return res.json(rows.map(mapRecordRow));
    }

    if (sizo) {
      const stmt = sqlite.prepare('SELECT * FROM records WHERE date = ? AND type = ? AND sizo = ?');
      return res.json(stmt.all(date, type, String(sizo)));
    }
    const stmt = sqlite.prepare('SELECT * FROM records WHERE date = ? AND type = ?');
    return res.json(stmt.all(date, type));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'db_error' });
  }
});

app.get('/records-summary/:date/:type', async (req, res) => {
  const { date, type } = req.params;
  try {
    if (USE_PG) {
      const { rows } = await pool.query(
        `
        SELECT sizo, COUNT(*)::int AS count
        FROM records
        WHERE day = $1::date AND type = $2 AND value IS NOT NULL AND value <> ''
        GROUP BY sizo
        `,
        [date, type]
      );
      return res.json(rows);
    }

    const stmt = sqlite.prepare(`
      SELECT sizo, COUNT(*) as count
      FROM records
      WHERE date = ? AND type = ? AND value IS NOT NULL AND value != ''
      GROUP BY sizo
    `);
    return res.json(stmt.all(date, type));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'db_error' });
  }
});

app.get('/sizo-summary/:date/:type', async (req, res) => {
  const { date, type } = req.params;
  try {
    if (USE_PG) {
      const { rows } = await pool.query(
        `
        WITH counts AS (
          SELECT sizo, COUNT(*)::int AS count
          FROM records
          WHERE day = $1::date AND type = $2 AND value IS NOT NULL AND value <> ''
          GROUP BY sizo
        )
        SELECT
          i.sizo AS sizo,
          COALESCE(c.count, 0) AS count,
          1 AS "hasImage"
        FROM sizo_images i
        LEFT JOIN counts c ON c.sizo = i.sizo
        WHERE i.day = $3::date AND i.type = $4
        UNION
        SELECT
          c.sizo AS sizo,
          c.count AS count,
          0 AS "hasImage"
        FROM counts c
        WHERE c.sizo NOT IN (
          SELECT sizo FROM sizo_images WHERE day = $5::date AND type = $6
        )
        `,
        [date, type, date, type, date, type]
      );
      return res.json(rows);
    }

    const stmt = sqlite.prepare(`
      WITH counts AS (
        SELECT sizo, COUNT(*) as count
        FROM records
        WHERE date = ? AND type = ? AND value IS NOT NULL AND value != ''
        GROUP BY sizo
      )
      SELECT
        i.sizo as sizo,
        COALESCE(c.count, 0) as count,
        1 as hasImage
      FROM sizo_images i
      LEFT JOIN counts c ON c.sizo = i.sizo
      WHERE i.date = ? AND i.type = ?
      UNION
      SELECT
        c.sizo as sizo,
        c.count as count,
        0 as hasImage
      FROM counts c
      WHERE c.sizo NOT IN (
        SELECT sizo FROM sizo_images WHERE date = ? AND type = ?
      )
    `);
    return res.json(stmt.all(date, type, date, type, date, type));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'db_error' });
  }
});

app.get('/sizo-image/:date/:type/:sizo', async (req, res) => {
  const { date, type, sizo } = req.params;
  try {
    if (USE_PG) {
      const { rows } = await pool.query(
        `SELECT mime, data FROM sizo_images WHERE day = $1::date AND type = $2 AND sizo = $3`,
        [date, type, sizo]
      );
      const row = rows[0];
      if (!row) return res.status(404).json({ error: 'not_found' });
      res.setHeader('Content-Type', row.mime);
      return res.send(row.data);
    }

    const stmt = sqlite.prepare(`SELECT mime, data FROM sizo_images WHERE date = ? AND type = ? AND sizo = ?`);
    const row = stmt.get(date, type, sizo);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.setHeader('Content-Type', row.mime);
    return res.send(row.data);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'db_error' });
  }
});

// Simple gallery page to view all saved images in a browser.
// Optional filters: ?date=YYYY-MM-DD&type=advocate|transfer|visit
app.get('/photos', async (req, res) => {
  const { date, type } = req.query;
  try {
    let rows = [];
    if (USE_PG) {
      if (date && type) {
        const { rows: r } = await pool.query(
          `SELECT day AS date, type, sizo, mime, updatedat AS "updatedAt"
           FROM sizo_images
           WHERE day = $1::date AND type = $2
           ORDER BY updatedat DESC`,
          [String(date), String(type)]
        );
        rows = r;
      } else if (date) {
        const { rows: r } = await pool.query(
          `SELECT day AS date, type, sizo, mime, updatedat AS "updatedAt"
           FROM sizo_images
           WHERE day = $1::date
           ORDER BY updatedat DESC`,
          [String(date)]
        );
        rows = r;
      } else if (type) {
        const { rows: r } = await pool.query(
          `SELECT day AS date, type, sizo, mime, updatedat AS "updatedAt"
           FROM sizo_images
           WHERE type = $1
           ORDER BY updatedat DESC`,
          [String(type)]
        );
        rows = r;
      } else {
        const { rows: r } = await pool.query(
          `SELECT day AS date, type, sizo, mime, updatedat AS "updatedAt"
           FROM sizo_images
           ORDER BY updatedat DESC`
        );
        rows = r;
      }
    } else {
      if (date && type) {
        const stmt = sqlite.prepare(
          `SELECT date, type, sizo, mime, updatedAt FROM sizo_images WHERE date = ? AND type = ? ORDER BY updatedAt DESC`
        );
        rows = stmt.all(String(date), String(type));
      } else if (date) {
        const stmt = sqlite.prepare(
          `SELECT date, type, sizo, mime, updatedAt FROM sizo_images WHERE date = ? ORDER BY updatedAt DESC`
        );
        rows = stmt.all(String(date));
      } else if (type) {
        const stmt = sqlite.prepare(
          `SELECT date, type, sizo, mime, updatedAt FROM sizo_images WHERE type = ? ORDER BY updatedAt DESC`
        );
        rows = stmt.all(String(type));
      } else {
        const stmt = sqlite.prepare(`SELECT date, type, sizo, mime, updatedAt FROM sizo_images ORDER BY updatedAt DESC`);
        rows = stmt.all();
      }
    }

    const escape = (s) =>
      String(s)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');

    const cards = rows
      .map((r) => {
        const imgSrc = `/sizo-image/${encodeURIComponent(r.date)}/${encodeURIComponent(r.type)}/${encodeURIComponent(r.sizo)}`;
        return `
        <div class="card">
          <div class="meta">
            <div class="title">${escape(r.date)} · ${escape(r.type)} · ${escape(r.sizo)}</div>
            <div class="sub">${escape(r.mime)} · ${escape(r.updatedAt)}</div>
          </div>
          <a href="${imgSrc}" target="_blank" rel="noreferrer">
            <img src="${imgSrc}" alt="${escape(r.sizo)}" loading="lazy" />
          </a>
        </div>
      `;
      })
      .join('\n');

    return res
      .status(200)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .end(`<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Фото СИЗО</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; background:#0b0b0f; color:#fff; margin:0; }
      header { padding:16px; border-bottom:1px solid #27272a; background:#000; position:sticky; top:0; }
      .hint { color:#a1a1aa; font-size:13px; margin-top:6px; }
      .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap:12px; padding:16px; }
      .card { border:1px solid #27272a; background:#09090b; border-radius:16px; overflow:hidden; }
      .meta { padding:12px 12px 0 12px; }
      .title { font-weight:700; font-size:14px; }
      .sub { color:#a1a1aa; font-size:12px; margin-top:4px; }
      img { width:100%; height:220px; object-fit:contain; display:block; background:#000; margin-top:10px; }
      a { color:inherit; text-decoration:none; }
    </style>
  </head>
  <body>
    <header>
      <div style="font-weight:800; font-size:18px;">Фото (галерея)</div>
      <div class="hint">Фильтры: <code style="color:#fff;">/photos?date=2026-05-05&type=advocate</code> или только <code style="color:#fff;">date</code>/<code style="color:#fff;">type</code>. Всего: ${rows.length}</div>
    </header>
    <div class="grid">
      ${cards || '<div class="hint">Фото не найдены.</div>'}
    </div>
  </body>
</html>`);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'db_error' });
  }
});

app.delete('/sizo-image/:date/:type/:sizo', async (req, res) => {
  const { date, type, sizo } = req.params;
  try {
    if (USE_PG) {
      const { rowCount } = await pool.query(
        `DELETE FROM sizo_images WHERE day = $1::date AND type = $2 AND sizo = $3`,
        [date, type, sizo]
      );
      return res.json({ success: true, deleted: rowCount });
    }

    const stmt = sqlite.prepare(`DELETE FROM sizo_images WHERE date = ? AND type = ? AND sizo = ?`);
    const info = stmt.run(date, type, sizo);
    return res.json({ success: true, deleted: info.changes });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'db_error' });
  }
});

app.post('/sizo-image', upload.single('image'), async (req, res) => {
  const { date, type, sizo } = req.body;
  if (!date || !type || !sizo) return res.status(400).json({ error: 'missing_fields' });
  if (!req.file) return res.status(400).json({ error: 'missing_image' });

  const mime = req.file.mimetype || 'application/octet-stream';
  const data = req.file.buffer;
  const updatedAt = new Date().toISOString();

  try {
    if (USE_PG) {
      await pool.query(
        `
        INSERT INTO sizo_images (day, type, sizo, mime, data, updatedat)
        VALUES ($1::date, $2, $3, $4, $5, $6::timestamptz)
        ON CONFLICT (day, type, sizo)
        DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, updatedat = EXCLUDED.updatedat
        `,
        [date, type, sizo, mime, data, updatedAt]
      );
      return res.json({ success: true });
    }

    const stmt = sqlite.prepare(`
      INSERT INTO sizo_images (date, type, sizo, mime, data, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(date, type, sizo)
      DO UPDATE SET mime = excluded.mime, data = excluded.data, updatedAt = excluded.updatedAt
    `);
    stmt.run(date, type, sizo, mime, data, updatedAt);
    return res.json({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'db_error' });
  }
});

app.post('/records', async (req, res) => {
  const { date, type, sizo, rowNum, value, resolved } = req.body;
  try {
    if (USE_PG) {
      await pool.query(
        `
        INSERT INTO records (day, type, sizo, rownum, value, resolved)
        VALUES ($1::date, $2, $3, $4, $5, $6)
        ON CONFLICT (day, type, sizo, rownum)
        DO UPDATE SET value = EXCLUDED.value, resolved = EXCLUDED.resolved
        `,
        [date, type, sizo || 'main', rowNum, value || '', resolved ? 1 : 0]
      );
      return res.json({ success: true });
    }

    const stmt = sqlite.prepare(`
      INSERT INTO records (date, type, sizo, rowNum, value, resolved)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(date, type, sizo, rowNum) 
      DO UPDATE SET value = excluded.value, resolved = excluded.resolved
    `);
    stmt.run(date, type, sizo || 'main', rowNum, value || '', resolved ? 1 : 0);
    return res.json({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'db_error' });
  }
});

async function start() {
  await ensureDbReady();
  app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
  });
}

module.exports = app;

if (require.main === module) {
  start().catch((e) => {
    console.error('❌ Failed to start server:', e);
    process.exit(1);
  });
}
