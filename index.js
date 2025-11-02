import express from "express";
import axios from "axios";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_ID = process.env.PHONE_ID;
const API_URL = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;

const DATA_FILE = "piggybank.json";
let data = fs.existsSync(DATA_FILE)
  ? JSON.parse(fs.readFileSync(DATA_FILE))
  : [];

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0];
  const message = changes?.value?.messages?.[0];

  if (message) {
    const from = message.from;
    const text = message.text?.body?.trim() || "";
    const now = new Date();

    if (text.startsWith("+")) {
      const parts = text.substring(1).split(" ");
      const amount = parseFloat(parts[0]);
      const description = parts.slice(1).join(" ");
      if (!isNaN(amount)) {
        data.push({ type: "income", amount, description, date: now });
        saveData();
        await sendMessage(from, `💰 Entrada registrada: +R$${amount.toFixed(2)} (${description})`);
      }
    } else if (text.startsWith("-")) {
      const parts = text.substring(1).split(" ");
      const amount = parseFloat(parts[0]);
      const description = parts.slice(1).join(" ");
      if (!isNaN(amount)) {
        data.push({ type: "expense", amount, description, date: now });
        saveData();
        await sendMessage(from, `💸 Saída registrada: -R$${amount.toFixed(2)} (${description})`);
      }
    } else if (text.startsWith("status")) {
      const days = parseInt(text.split(" ")[1]) || 30;
      const limit = new Date();
      limit.setDate(limit.getDate() - days);

      const filtered = data.filter(d => new Date(d.date) >= limit);
      const incomes = filtered
        .filter(d => d.type === "income")
        .reduce((t, d) => t + d.amount, 0);
      const expenses = filtered
        .filter(d => d.type === "expense")
        .reduce((t, d) => t + d.amount, 0);

      const balance = incomes - expenses;
      await sendMessage(
        from,
        `📊 Estatísticas (${days} dias):\n` +
        `Entradas: R$${incomes.toFixed(2)}\n` +
        `Saídas: R$${expenses.toFixed(2)}\n` +
        `Saldo: ${balance >= 0 ? "💚" : "❤️"} R$${balance.toFixed(2)}`
      );
    } else if (text.toLowerCase() === "help") {
      await sendMessage(
        from,
        "📘 *Comandos disponíveis:*\n" +
        "➕ `+valor descrição` → registrar entrada\n" +
        "➖ `-valor descrição` → registrar saída\n" +
        "📊 `status [dias]` → ver resumo financeiro\n" +
        "❓ `help` → ver esta mensagem"
      );
    }
  }

  res.sendStatus(200);
});

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server running on port 3000"));
