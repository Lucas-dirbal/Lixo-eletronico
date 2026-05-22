import { addDonation, sendApiError } from "../lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Metodo nao permitido." });
    return;
  }

  try {
    res.status(201).json(await addDonation(req.body));
  } catch (error) {
    sendApiError(res, error);
  }
}
