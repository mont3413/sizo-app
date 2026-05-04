const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const db = new Database(path.join(__dirname, 'sizo.db'));

console.log('✅ База данных создана');

db.exec(`
  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    sizo TEXT NOT NULL,
    rowNum INTEGER NOT NULL,
    value TEXT,
    UNIQUE(date, type, sizo, rowNum)
  );
`);

app.get('/records/:date/:type', (req, res) => {
  const { date, type } = req.params;
  const stmt = db.prepare('SELECT * FROM records WHERE date = ? AND type = ?');
  res.json(stmt.all(date, type));
});

app.post('/records', (req, res) => {
  const { date, type, sizo, rowNum, value } = req.body;
  const stmt = db.prepare(`
    INSERT INTO records (date, type, sizo, rowNum, value)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(date, type, sizo, rowNum) 
    DO UPDATE SET value = excluded.value
  `);
  stmt.run(date, type, sizo || 'main', rowNum, value || '');
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
});
