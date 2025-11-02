// /api/webhook.js
import { Client } from "pg";

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_ID = process.env.PHONE_ID;
const API_URL = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;

let client;

// Lazy DB init (serverless-safe)
async function initDb() {
  if (!client) {
    client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
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
  }
  return client;
}

// send WhatsApp message
async function sendMessage(to, text) {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    });

    const data = await res.json().catch(() => null);
    console.log(
      "WhatsApp API response:",
      data,
      "Status:",
      res.status,
      res.statusText
    );

    if (!res.ok) {
      console.error("sendMessage error:", data);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Network or fetch error:", err);
    return false;
  }
}

export default async function handler(req, res) {
  const db = await initDb();

  // VERIFY webhook
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }

    return res.status(403).end();
  }

  // HANDLE incoming WhatsApp messages
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
        const category = parts.slice(1).join(" ").substring(0, 50);

        if (!isNaN(amount)) {
          const typeText = type === "income" ? "💰 Entrada" : "💸 Saída";
          const msg =
            `${typeText} registrada: ${amount.toFixed(2)} (${category})` +
            (category.length === 50
              ? " ⚠️ Categoria truncada para 50 caracteres."
              : "");

          const sent = await sendMessage(from, msg);

          if (sent) {
            await db.query(
              "INSERT INTO transactions (type, amount, category, date) VALUES ($1, $2, $3, $4)",
              [type, amount, category, now]
            );
          } else {
            console.error("Transaction not saved because message failed");
          }
        }
      } else if (text.startsWith("status")) {
        const days = parseInt(text.split(" ")[1]) || 30;
        const limit = new Date();
        limit.setDate(limit.getDate() - days);

        const { rows } = await db.query(
          "SELECT type, amount FROM transactions WHERE date >= $1",
          [limit]
        );

        const incomes = rows
          .filter((r) => r.type === "income")
          .reduce((t, r) => t + parseFloat(r.amount), 0);
        const expenses = rows
          .filter((r) => r.type === "expense")
          .reduce((t, r) => t + parseFloat(r.amount), 0);
        const balance = incomes - expenses;

        await sendMessage(
          from,
          `📊 Estatísticas (${days} dias):\nEntradas: R$${incomes.toFixed(
            2
          )}\nSaídas: R$${expenses.toFixed(2)}\nSaldo: ${
            balance >= 0 ? "💚" : "❤️"
          } R$${balance.toFixed(2)}`
        );
      } else {
        await sendMessage(
          from,
          "📘 *Comandos disponíveis:*\n➕ `+valor categoria` → registrar entrada\n➖ `-valor categoria` → registrar saída\n📊 `status [dias]` → ver resumo financeiro"
        );
      }
    }

    return res.status(200).end();
  }

  // unsupported method
  return res.status(405).end();
}
