import { removeStudent, sendApiError } from "../../lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "DELETE") {
    res.setHeader("Allow", "DELETE");
    res.status(405).json({ error: "Metodo nao permitido." });
    return;
  }

  try {
    res.json(await removeStudent(req.query.id));
  } catch (error) {
    sendApiError(res, error);
  }
}
