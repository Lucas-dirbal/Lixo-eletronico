const fs = require("fs");
const path = require("path");
const express = require("express");
const Database = require("better-sqlite3");

const app = express();
const port = process.env.PORT || 3000;
const dataDir = path.join(__dirname, "data");
const dbPath = path.join(dataDir, "lixo-eletronico.sqlite");
const TARGET = 20;

fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    category TEXT NOT NULL,
    category_name TEXT NOT NULL,
    amount INTEGER NOT NULL,
    units INTEGER NOT NULL,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS donations (
    id TEXT PRIMARY KEY,
    from_student_id TEXT NOT NULL,
    to_student_id TEXT NOT NULL,
    units INTEGER NOT NULL,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY (to_student_id) REFERENCES students(id) ON DELETE CASCADE
  );
`);

app.use(express.json());
app.use(express.static(__dirname));

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function getState() {
  const students = db.prepare("SELECT id, name FROM students ORDER BY name COLLATE NOCASE").all();
  const entries = db
    .prepare(
      "SELECT id, student_id AS studentId, category, category_name AS categoryName, amount, units, date FROM entries ORDER BY date, created_at",
    )
    .all();
  const donations = db
    .prepare(
      `SELECT
        d.id,
        d.from_student_id AS fromId,
        from_student.name AS fromName,
        d.to_student_id AS toId,
        to_student.name AS toName,
        d.units,
        d.date
      FROM donations d
      JOIN students from_student ON from_student.id = d.from_student_id
      JOIN students to_student ON to_student.id = d.to_student_id
      ORDER BY d.date, d.created_at`,
    )
    .all();

  return {
    students: students.map((student) => ({
      ...student,
      entries: entries.filter((entry) => entry.studentId === student.id),
      donationsIn: donations.filter((donation) => donation.toId === student.id),
      donationsOut: donations.filter((donation) => donation.fromId === student.id),
    })),
  };
}

function totals(student) {
  const collected = student.entries.reduce((sum, entry) => sum + entry.units, 0);
  const donatedOut = student.donationsOut.reduce((sum, donation) => sum + donation.units, 0);
  const donatedIn = student.donationsIn.reduce((sum, donation) => sum + donation.units, 0);
  const net = collected - donatedOut + donatedIn;

  return {
    net,
    remaining: Math.max(TARGET - net, 0),
    surplus: Math.max(net - TARGET, 0),
  };
}

const insertStudent = db.prepare("INSERT INTO students (id, name) VALUES (@id, @name)");
const findStudentByName = db.prepare("SELECT id, name FROM students WHERE name = ? COLLATE NOCASE");
const findStudentById = db.prepare("SELECT id, name FROM students WHERE id = ?");

const getOrCreateStudent = db.transaction((name) => {
  const clean = normalizeName(name);
  if (!clean) {
    throw Object.assign(new Error("Nome do colega e obrigatorio."), { status: 400 });
  }

  const existing = findStudentByName.get(clean);
  if (existing) return existing;

  const student = { id: uid(), name: clean };
  insertStudent.run(student);
  return student;
});

function sendError(res, error) {
  const status = error.status || 500;
  res.status(status).json({ error: error.message || "Erro interno." });
}

app.get("/api/state", (_req, res) => {
  res.json(getState());
});

app.post("/api/entries", (req, res) => {
  try {
    const { studentName, category, categoryName, amount, units, date } = req.body;
    const parsedAmount = Number(amount);
    const parsedUnits = Number(units);

    if (!category || !categoryName || !date || parsedAmount < 1 || parsedUnits < 1) {
      throw Object.assign(new Error("Dados da entrega invalidos."), { status: 400 });
    }

    const student = getOrCreateStudent(studentName);
    db.prepare(
      `INSERT INTO entries (id, student_id, category, category_name, amount, units, date)
       VALUES (@id, @studentId, @category, @categoryName, @amount, @units, @date)`,
    ).run({
      id: uid(),
      studentId: student.id,
      category,
      categoryName,
      amount: parsedAmount,
      units: parsedUnits,
      date,
    });

    res.status(201).json(getState());
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/donations", (req, res) => {
  try {
    const { fromId, toId, units } = req.body;
    const parsedUnits = Number(units);

    if (!fromId || !toId || fromId === toId || parsedUnits < 1) {
      throw Object.assign(new Error("Dados da doacao invalidos."), { status: 400 });
    }

    const from = findStudentById.get(fromId);
    const to = findStudentById.get(toId);
    if (!from || !to) {
      throw Object.assign(new Error("Colega nao encontrado."), { status: 404 });
    }

    const currentState = getState();
    const fromTotals = totals(currentState.students.find((student) => student.id === fromId));
    const toTotals = totals(currentState.students.find((student) => student.id === toId));
    const allowed = Math.min(fromTotals.surplus, toTotals.remaining);

    if (parsedUnits > allowed) {
      throw Object.assign(new Error(`Doacao maxima permitida: ${allowed} unidade(s).`), { status: 400 });
    }

    db.prepare(
      `INSERT INTO donations (id, from_student_id, to_student_id, units, date)
       VALUES (@id, @fromId, @toId, @units, @date)`,
    ).run({
      id: uid(),
      fromId,
      toId,
      units: parsedUnits,
      date: new Date().toISOString().slice(0, 10),
    });

    res.status(201).json(getState());
  } catch (error) {
    sendError(res, error);
  }
});

app.delete("/api/students/:id", (req, res) => {
  db.prepare("DELETE FROM students WHERE id = ?").run(req.params.id);
  res.json(getState());
});

app.delete("/api/reset", (_req, res) => {
  db.transaction(() => {
    db.prepare("DELETE FROM donations").run();
    db.prepare("DELETE FROM entries").run();
    db.prepare("DELETE FROM students").run();
  })();
  res.json(getState());
});

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
  console.log(`Banco SQLite: ${dbPath}`);
});
