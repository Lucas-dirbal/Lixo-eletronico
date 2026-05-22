import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  addDonation,
  addEntry,
  getState,
  loginUser,
  removeStudent,
  registerUser,
  resetState,
  sendApiError,
} from "./lib/db.js";

const app = express();
const port = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = __dirname;

app.use(express.json());
app.use(express.static(publicDir));

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/api/state", async (_req, res) => {
  try {
    res.json(await getState());
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    res.status(201).json({ user: await registerUser(req.body) });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    res.json({ user: await loginUser(req.body) });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/entries", async (req, res) => {
  try {
    res.status(201).json(await addEntry(req.body));
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/donations", async (req, res) => {
  try {
    res.status(201).json(await addDonation(req.body));
  } catch (error) {
    sendApiError(res, error);
  }
});

app.delete("/api/students/:id", async (req, res) => {
  try {
    res.json(await removeStudent(req.params.id));
  } catch (error) {
    sendApiError(res, error);
  }
});

app.delete("/api/reset", async (_req, res) => {
  try {
    res.json(await resetState());
  } catch (error) {
    sendApiError(res, error);
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
  console.log(
    process.env.TURSO_DATABASE_URL
      ? "Banco SQLite remoto via libSQL/Turso."
      : "Banco SQLite local em data/lixo-eletronico.sqlite.",
  );
});
