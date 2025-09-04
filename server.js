// server.js
import express from 'express';
import nodemailer from 'nodemailer';
import PQueue from 'p-queue';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initInvalidEmails, addInvalidEmail, isInvalidEmail } from './invalid-emails.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const queue = new PQueue({ concurrency: 1 });

let isBlocked = false;
let unblockTimeout = null;
const BLOCK_PAUSE = 30 * 60 * 1000; // 30 min

// transporter (SMTP)
const transporter = nodemailer.createTransport({
  host: 'host998067.hostido.net.pl',
  port: 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  tls: { rejectUnauthorized: false },
  connectionTimeout: 30000,
  greetingTimeout: 15000,
  logger: true,
  debug: true
});

// log do pliku + STDOUT
function logEmail({ to, subject, accepted = [], rejected = [], messageId = '' }) {
  const logPath = path.join(__dirname, 'logs', 'emails.log');
  const timestamp = new Date().toISOString();
  const entry = `${timestamp} | TO:${to} | OK:[${accepted.join(',')}] | NO:[${rejected.join(',')}] | MID:${messageId} | ${subject}\n`;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFile(logPath, entry, err => {
    if (err) console.error('Błąd zapisu loga:', err.message);
  });
  console.log('[mail-log]', entry.trim());
}

// pomocnicze: czysty text z html
function htmlToText(html = '') {
  return String(html).replace(/<style[\s\S]*?<\/style>/gi, ' ')
                     .replace(/<[^>]+>/g, ' ')
                     .replace(/\s+/g, ' ')
                     .trim();
}

// 🔹 DWIE OSOBNE WYSYŁKI:
// 1) do użytkownika (bez BCC) — musi się udać; inaczej błąd
// 2) po sukcesie #1 — osobny mail do system@… (best-effort)
app.post('/send-email', async (req, res) => {
  const { to, subject, html, attachments } = req.body || {};

  if (isBlocked) {
    return res.status(429).send({ success: false, message: 'Wysyłka wstrzymana — blokada SMTP, spróbuj później.' });
  }
  if (!to || !subject || !html) {
    return res.status(400).send({ success: false, message: 'Brak wymaganych pól: to/subject/html' });
  }
  if (isInvalidEmail(to)) {
    return res.status(400).send({ success: false, message: `Adres ${to} zablokowany po wcześniejszym 550.` });
  }

  const job = async () => {
    let attempt = 0;
    const maxRetries = 2;

    while (attempt <= maxRetries) {
      try {
        // ── 1) MAIL DO UŻYTKOWNIKA ────────────────────────────────────────────────
        const infoUser = await transporter.sendMail({
          from: `"Rekiny Filmowe" <${process.env.EMAIL_USER}>`,
          to,
          subject,
          html,
          text: htmlToText(html),
          attachments
        });

        const accU = (infoUser.accepted || []).map(s => s.toLowerCase());
        const rejU = (infoUser.rejected || []).map(s => s.toLowerCase());
        const toLc = String(to || '').toLowerCase();

        console.log('SMTP (user):', infoUser.response, { accepted: accU, rejected: rejU });

        const userAccepted = accU.includes(toLc);
        if (!userAccepted) {
          // częściowy/pełny reject usera – traktujemy jak błąd (retry lub fail)
          attempt++;
          console.error('User not accepted by SMTP', { to, accepted: accU, rejected: rejU });
          if (attempt > maxRetries) {
            throw new Error(`Adresat ${to} nie został zaakceptowany przez serwer SMTP.`);
          }
          await new Promise(r => setTimeout(r, 1000 * attempt));
          continue;
        }

        // logujemy sukces usera
        logEmail({ to, subject, accepted: accU, rejected: rejU, messageId: infoUser.messageId });
        console.log("✅ wysłano do użytkownika:", to, "MID:", infoUser.messageId);

        // ── 2) MAIL DO SYSTEMU (best-effort) ──────────────────────────────────────
        try {
          const infoSys = await transporter.sendMail({
            from: `"Rekiny Filmowe" <${process.env.EMAIL_USER}>`,
            to: process.env.ADMIN_EMAIL || 'system@rekinyfilmowe.pl',
            subject: `KOPIA: ${subject}`,
            html,
            text: htmlToText(html),
            attachments
          });
          console.log("📋 kopia do system:", (process.env.ADMIN_EMAIL || 'system@rekinyfilmowe.pl'), 'MID:', infoSys.messageId);
        } catch (e) {
          console.warn('⚠️ nie udało się wysłać kopii do system@…:', e?.message || e);
        }

        // gotowe — wychodzimy
        return;

      } catch (error) {
        attempt++;
        const resp = error?.response || '';
        console.error(`Błąd wysyłki (próba ${attempt}):`, error?.message, resp);

        // 5.1.1 — adres nie istnieje ⇒ blacklist
        if (resp.includes('550 5.1.1')) {
          addInvalidEmail(to);
          throw new Error(`Adres ${to} nie istnieje — dodano do czarnej listy.`);
        }

        // 550 (policy / temporary block) ⇒ wstrzymaj wysyłkę na 30 min + powiadom admina
        if (resp.includes('550')) {
          console.error("🚨 Wykryto blokadę konta (550). Wstrzymuję wysyłkę na 30 minut.");
          isBlocked = true;

          try {
            await transporter.sendMail({
              from: `"System Mailer" <${process.env.EMAIL_USER}>`,
              to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
              subject: "🚨 Blokada SMTP - Rekiny Filmowe",
              html: `<p>Wykryto blokadę konta SMTP dla <b>${process.env.EMAIL_USER}</b>.</p>
                     <p>Wysyłka została wstrzymana na 30 minut.</p>
                     <p>Szczegóły błędu: ${error.message}</p>`
            });
            console.log("📧 Powiadomienie o blokadzie wysłane.");
          } catch (notifyError) {
            console.error("⚠️ Nie udało się wysłać powiadomienia o blokadzie:", notifyError.message);
          }

          if (unblockTimeout) clearTimeout(unblockTimeout);
          unblockTimeout = setTimeout(async () => {
            isBlocked = false;
            console.log("✅ Blokada wysyłki została automatycznie zniesiona.");
            try {
              await transporter.sendMail({
                from: `"System Mailer" <${process.env.EMAIL_USER}>`,
                to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
                subject: "✅ Wysyłka SMTP została wznowiona",
                html: `<p>Blokada konta SMTP dla <b>${process.env.EMAIL_USER}</b> została automatycznie zdjęta.</p>`
              });
              console.log("📧 Powiadomienie o odblokowaniu wysłane.");
            } catch (notifyError) {
              console.error("⚠️ Nie udało się wysłać powiadomienia o odblokowaniu:", notifyError.message);
            }
          }, BLOCK_PAUSE);

          throw new Error("Blokada konta SMTP — pauza 30 minut.");
        }

        if (attempt > maxRetries) throw error;
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  };

  queue.add(job)
    .then(() => res.send({ success: true }))
    .catch((error) => {
      console.error('Ostateczna porażka:', error.message);
      res.status(500).send({ success: false, error: error.message });
    });
});

// pomocnicze
app.get('/queue-status', (_req, res) => {
  res.json({ pending: queue.pending, size: queue.size, blocked: isBlocked });
});
app.get('/smtp-check', async (_req, res) => {
  try {
    await transporter.verify();
    res.send('🟢 SMTP działa — połączenie OK');
  } catch (err) {
    console.error('🔴 Błąd połączenia SMTP:', err.message);
    res.status(500).send('🔴 Błąd SMTP: ' + err.message);
  }
});

const PORT = process.env.PORT || 3000;

// 🔸 wczytaj blacklist do pamięci przed startem serwera
await initInvalidEmails();

app.listen(PORT, () => console.log(`Email sender server running on port ${PORT}`));
