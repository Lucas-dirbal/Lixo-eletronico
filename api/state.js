import { getState, sendApiError } from "../lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Metodo nao permitido." });
    return;
  }

  try {
    res.json(await getState());
  } catch (error) {
    sendApiError(res, error);
  }
}
