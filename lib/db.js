import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const TARGET = 20;
const isVercel = Boolean(process.env.VERCEL);

if (!process.env.TURSO_DATABASE_URL && !isVercel) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (isVercel && !process.env.TURSO_DATABASE_URL) {
  console.warn("TURSO_DATABASE_URL nao configurada. Configure o banco Turso/libSQL nas Environment Variables.");
}

const db = createClient({
  url:
    process.env.TURSO_DATABASE_URL ||
    (isVercel ? "file:/tmp/lixo-eletronico.sqlite" : `file:${path.join(dataDir, "lixo-eletronico.sqlite")}`),
  authToken: process.env.TURSO_AUTH_TOKEN,
});

let initialized;

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function httpError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export async function initDb() {
  if (!initialized) {
    initialized = db.batch(
      [
        `CREATE TABLE IF NOT EXISTS students (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS entries (
          id TEXT PRIMARY KEY,
          student_id TEXT NOT NULL,
          category TEXT NOT NULL,
          category_name TEXT NOT NULL,
          amount INTEGER NOT NULL,
          units INTEGER NOT NULL,
          date TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS donations (
          id TEXT PRIMARY KEY,
          from_student_id TEXT NOT NULL,
          to_student_id TEXT NOT NULL,
          units INTEGER NOT NULL,
          date TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (from_student_id) REFERENCES students(id) ON DELETE CASCADE,
          FOREIGN KEY (to_student_id) REFERENCES students(id) ON DELETE CASCADE
        )`,
      ].map((sql) => ({ sql })),
    );
  }

  return initialized;
}

function rows(result) {
  return result.rows.map((row) => Object.fromEntries(Object.entries(row)));
}

export async function getState() {
  await initDb();

  const [studentsResult, entriesResult, donationsResult] = await db.batch([
    {
      sql: "SELECT id, name FROM students ORDER BY name COLLATE NOCASE",
    },
    {
      sql: `SELECT
        id,
        student_id AS studentId,
        category,
        category_name AS categoryName,
        amount,
        units,
        date
      FROM entries
      ORDER BY date, created_at`,
    },
    {
      sql: `SELECT
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
    },
  ]);

  const entries = rows(entriesResult);
  const donations = rows(donationsResult);

  return {
    students: rows(studentsResult).map((student) => ({
      ...student,
      entries: entries.filter((entry) => entry.studentId === student.id),
      donationsIn: donations.filter((donation) => donation.toId === student.id),
      donationsOut: donations.filter((donation) => donation.fromId === student.id),
    })),
  };
}

function totals(student) {
  const collected = student.entries.reduce((sum, entry) => sum + Number(entry.units), 0);
  const donatedOut = student.donationsOut.reduce((sum, donation) => sum + Number(donation.units), 0);
  const donatedIn = student.donationsIn.reduce((sum, donation) => sum + Number(donation.units), 0);
  const net = collected - donatedOut + donatedIn;

  return {
    net,
    remaining: Math.max(TARGET - net, 0),
    surplus: Math.max(net - TARGET, 0),
  };
}

async function getOrCreateStudent(name) {
  const clean = normalizeName(name);
  if (!clean) {
    throw httpError("Nome do colega e obrigatorio.");
  }

  await initDb();

  const existing = await db.execute({
    sql: "SELECT id, name FROM students WHERE name = ? COLLATE NOCASE",
    args: [clean],
  });

  if (existing.rows[0]) {
    return Object.fromEntries(Object.entries(existing.rows[0]));
  }

  const student = { id: uid(), name: clean };
  await db.execute({
    sql: "INSERT INTO students (id, name) VALUES (?, ?)",
    args: [student.id, student.name],
  });
  return student;
}

export async function addEntry(input) {
  const { studentName, category, categoryName, date } = input;
  const amount = Number(input.amount);
  const units = Number(input.units);

  if (!category || !categoryName || !date || amount < 1 || units < 1) {
    throw httpError("Dados da entrega invalidos.");
  }

  const student = await getOrCreateStudent(studentName);
  await db.execute({
    sql: `INSERT INTO entries (id, student_id, category, category_name, amount, units, date)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [uid(), student.id, category, categoryName, amount, units, date],
  });

  return getState();
}

export async function addDonation(input) {
  const { fromId, toId } = input;
  const units = Number(input.units);

  if (!fromId || !toId || fromId === toId || units < 1) {
    throw httpError("Dados da doacao invalidos.");
  }

  const state = await getState();
  const from = state.students.find((student) => student.id === fromId);
  const to = state.students.find((student) => student.id === toId);

  if (!from || !to) {
    throw httpError("Colega nao encontrado.", 404);
  }

  const allowed = Math.min(totals(from).surplus, totals(to).remaining);
  if (units > allowed) {
    throw httpError(`Doacao maxima permitida: ${allowed} unidade(s).`);
  }

  await db.execute({
    sql: `INSERT INTO donations (id, from_student_id, to_student_id, units, date)
      VALUES (?, ?, ?, ?, ?)`,
    args: [uid(), fromId, toId, units, new Date().toISOString().slice(0, 10)],
  });

  return getState();
}

export async function removeStudent(id) {
  await initDb();
  await db.execute({ sql: "DELETE FROM students WHERE id = ?", args: [id] });
  return getState();
}

export async function resetState() {
  await initDb();
  await db.batch(["DELETE FROM donations", "DELETE FROM entries", "DELETE FROM students"].map((sql) => ({ sql })));
  return getState();
}

export function sendApiError(res, error) {
  res.status(error.status || 500).json({ error: error.message || "Erro interno." });
}
