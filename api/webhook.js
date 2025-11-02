import { Client } from "pg";
import axios from "axios";

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_ID = process.env.PHONE_ID;
const API_URL = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // for Vercel Postgres
});

await client.connect();
await client.query(`
  CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    type VARCHAR(10) NOT NULL,
    amount NUMERIC NOT NULL,
    category VARCHAR(50),
    date TIMESTAMP DEFAULT NOW()
  )
`);

export default async function handler(req, res) {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }

  if (req.method === "POST") {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (message) {
      const from = message.from;
      const text = message.text?.body?.trim() || "";
      const now = new Date();

      if (text.startsWith("+") || text.startsWith("-")) {
        const type = text.startsWith("+") ? "income" : "expense";
        const parts = text.substring(1).split(" ");
        const amount = parseFloat(parts[0]);
        const description = parts.slice(1).join(" ");

        if (!isNaN(amount)) {
          const category = parts.slice(1).join(" ").substring(0, 50);

          await client.query(
            "INSERT INTO transactions (type, amount, category, date) VALUES ($1, $2, $3, $4)",
            [type, amount, category, now]
          );

          await sendMessage(
            from,
            `${type === "income" ? "💰 Entrada" : "💸 Saída"} registrada: ${amount.toFixed(2)} (${category})` +
            (category.length === 50 ? " ⚠️ Categoria truncada para 50 caracteres." : "")
          );
        }
      } else if (text.startsWith("status")) {
        const days = parseInt(text.split(" ")[1]) || 30;
        const limit = new Date();
        limit.setDate(limit.getDate() - days);

        const { rows } = await client.query(
          "SELECT type, amount FROM transactions WHERE date >= $1",
          [limit]
        );

        const incomes = rows.filter(r => r.type === "income").reduce((t, r) => t + parseFloat(r.amount), 0);
        const expenses = rows.filter(r => r.type === "expense").reduce((t, r) => t + parseFloat(r.amount), 0);
        const balance = incomes - expenses;

        await sendMessage(
          from,
          `📊 Estatísticas (${days} dias):\nEntradas: R$${incomes.toFixed(2)}\nSaídas: R$${expenses.toFixed(2)}\nSaldo: ${balance >= 0 ? "💚" : "❤️"} R$${balance.toFixed(2)}`
        );
      } else {
        await sendMessage(
          from,
          "📘 *Comandos disponíveis:*\n➕ `+valor categoria` → registrar entrada\n➖ `-valor categoria` → registrar saída\n📊 `status [dias]` → ver resumo financeiro"
        );
      }
    }
    return res.sendStatus(200);
  }

  return res.sendStatus(405);
}

async function sendMessage(to, text) {
  await axios.post(
    API_URL,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    },
    { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
  );
}
