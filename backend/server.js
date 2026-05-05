const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const db = new Database(path.join(__dirname, 'sizo.db'));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 } // 8MB
});

console.log('✅ База данных создана');

db.exec(`
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

// lightweight migration for older DBs
try {
  const cols = db.prepare(`PRAGMA table_info(records)`).all();
  const hasResolved = cols.some((c) => c.name === 'resolved');
  if (!hasResolved) {
    db.exec(`ALTER TABLE records ADD COLUMN resolved INTEGER NOT NULL DEFAULT 0;`);
  }
} catch (e) {
  console.warn('⚠️ Migration skipped:', e?.message ?? e);
}

db.exec(`
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

app.get('/records/:date/:type', (req, res) => {
  const { date, type } = req.params;
  const { sizo } = req.query;
  if (sizo) {
    const stmt = db.prepare('SELECT * FROM records WHERE date = ? AND type = ? AND sizo = ?');
    return res.json(stmt.all(date, type, String(sizo)));
  }

  const stmt = db.prepare('SELECT * FROM records WHERE date = ? AND type = ?');
  return res.json(stmt.all(date, type));
});

app.get('/records-summary/:date/:type', (req, res) => {
  const { date, type } = req.params;
  const stmt = db.prepare(`
    SELECT sizo, COUNT(*) as count
    FROM records
    WHERE date = ? AND type = ? AND value IS NOT NULL AND value != ''
    GROUP BY sizo
  `);
  return res.json(stmt.all(date, type));
});

app.get('/sizo-summary/:date/:type', (req, res) => {
  const { date, type } = req.params;

  const stmt = db.prepare(`
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
});

app.get('/sizo-image/:date/:type/:sizo', (req, res) => {
  const { date, type, sizo } = req.params;
  const stmt = db.prepare(`SELECT mime, data FROM sizo_images WHERE date = ? AND type = ? AND sizo = ?`);
  const row = stmt.get(date, type, sizo);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.setHeader('Content-Type', row.mime);
  return res.send(row.data);
});

// Simple gallery page to view all saved images in a browser.
// Optional filters: ?date=YYYY-MM-DD&type=advocate|transfer|visit
app.get('/photos', (req, res) => {
  const { date, type } = req.query;
  let rows = [];
  if (date && type) {
    const stmt = db.prepare(
      `SELECT date, type, sizo, mime, updatedAt FROM sizo_images WHERE date = ? AND type = ? ORDER BY updatedAt DESC`
    );
    rows = stmt.all(String(date), String(type));
  } else if (date) {
    const stmt = db.prepare(
      `SELECT date, type, sizo, mime, updatedAt FROM sizo_images WHERE date = ? ORDER BY updatedAt DESC`
    );
    rows = stmt.all(String(date));
  } else if (type) {
    const stmt = db.prepare(
      `SELECT date, type, sizo, mime, updatedAt FROM sizo_images WHERE type = ? ORDER BY updatedAt DESC`
    );
    rows = stmt.all(String(type));
  } else {
    const stmt = db.prepare(`SELECT date, type, sizo, mime, updatedAt FROM sizo_images ORDER BY updatedAt DESC`);
    rows = stmt.all();
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
});

app.delete('/sizo-image/:date/:type/:sizo', (req, res) => {
  const { date, type, sizo } = req.params;
  const stmt = db.prepare(`DELETE FROM sizo_images WHERE date = ? AND type = ? AND sizo = ?`);
  const info = stmt.run(date, type, sizo);
  return res.json({ success: true, deleted: info.changes });
});

app.post('/sizo-image', upload.single('image'), (req, res) => {
  const { date, type, sizo } = req.body;
  if (!date || !type || !sizo) return res.status(400).json({ error: 'missing_fields' });
  if (!req.file) return res.status(400).json({ error: 'missing_image' });

  const mime = req.file.mimetype || 'application/octet-stream';
  const data = req.file.buffer;
  const updatedAt = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO sizo_images (date, type, sizo, mime, data, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, type, sizo)
    DO UPDATE SET mime = excluded.mime, data = excluded.data, updatedAt = excluded.updatedAt
  `);
  stmt.run(date, type, sizo, mime, data, updatedAt);
  return res.json({ success: true });
});

app.post('/records', (req, res) => {
  const { date, type, sizo, rowNum, value, resolved } = req.body;
  const stmt = db.prepare(`
    INSERT INTO records (date, type, sizo, rowNum, value, resolved)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, type, sizo, rowNum) 
    DO UPDATE SET value = excluded.value, resolved = excluded.resolved
  `);
  stmt.run(date, type, sizo || 'main', rowNum, value || '', resolved ? 1 : 0);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
});
