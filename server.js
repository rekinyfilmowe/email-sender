import express from 'express';
import nodemailer from 'nodemailer';
import PQueue from 'p-queue';
import fs from 'fs';
import path from 'path';
const invalidEmailsPath = path.join('logs', 'invalid-emails.json');

// Wczytaj czarną listę
function loadInvalidEmails() {
  if (!fs.existsSync(invalidEmailsPath)) return [];
  return JSON.parse(fs.readFileSync(invalidEmailsPath, 'utf8'));
}

// Zapisz czarną listę
function saveInvalidEmails(emails) {
  fs.writeFileSync(invalidEmailsPath, JSON.stringify(emails, null, 2));
}

// Dodaj adres do czarnej listy
function addInvalidEmail(email) {
  const emails = loadInvalidEmails();
  if (!emails.includes(email)) {
    emails.push(email);
    saveInvalidEmails(emails);
    console.log(`🚫 Dodano do czarnej listy: ${email}`);
  }
}

// Sprawdź, czy adres jest na czarnej liście
function isInvalidEmail(email) {
  const emails = loadInvalidEmails();
  return emails.includes(email);
}

const app = express();
app.use(express.json());

const queue = new PQueue({ concurrency: 1 });

let isBlocked = false;          // flaga blokady
let unblockTimeout = null;      // timeout na odblokowanie
const BLOCK_PAUSE = 30 * 60 * 1000; // 30 minut

const transporter = nodemailer.createTransport({
  host: 'host998067.hostido.net.pl',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false
  },
  connectionTimeout: 30000,
  greetingTimeout: 15000,
  logger: true,
  debug: true
});

// Funkcja logowania
function logEmail({ to, subject }) {
  const logPath = path.join('logs', 'emails.log');
  const timestamp = new Date().toISOString();
  const entry = `${timestamp} | TO: ${to} | SUBJECT: ${subject}\n`;

  fs.appendFile(logPath, entry, err => {
    if (err) console.error('Błąd zapisu loga:', err.message);
  });
}

// Wysyłka maili z mechanizmem anti-block i blacklistą
app.post('/send-email', async (req, res) => {
  const { to, subject, html, attachments } = req.body;

  if (isBlocked) {
    return res.status(429).send({ success: false, message: "Wysyłka wstrzymana — wykryta blokada konta, spróbuj ponownie później." });
  }

  // Sprawdź, czy adres nie jest na czarnej liście
  if (isInvalidEmail(to)) {
    return res.status(400).send({ success: false, message: `Adres ${to} został zablokowany po wcześniejszym błędzie 550.` });
  }

  const job = async () => {
    let attempt = 0;
    const maxRetries = 2;

    while (attempt <= maxRetries) {
      try {
        const info = await transporter.sendMail({
          from: `"Rekiny Filmowe" <${process.env.EMAIL_USER}>`,
          to,
          subject,
          html,
          attachments
        });

        console.log("✅ Wysłano e-mail:", info.response);
        logEmail({ to, subject });
        return;

      } catch (error) {
        attempt++;
        console.error(`Błąd wysyłki (próba ${attempt}):`, error.message);

        // Jeśli adres jest nieprawidłowy (550 5.1.1) → dodaj do czarnej listy
        if (error.response && error.response.includes('550 5.1.1')) {
          addInvalidEmail(to);
          throw new Error(`Adres ${to} nie istnieje — dodano do czarnej listy.`);
        }

        // Jeśli serwer zwrócił ogólną blokadę (550) → zatrzymaj wysyłkę
        if (error.response && error.response.includes('550')) {
  console.error("🚨 Wykryto blokadę konta (550). Wstrzymuję wysyłkę na 30 minut.");
  isBlocked = true;

  // Powiadom administratora o blokadzie
  try {
    await transporter.sendMail({
      from: `"Mailer System" <${process.env.EMAIL_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: "🚨 Blokada wysyłki e-mail (SMTP)",
      html: `<p>Wykryto blokadę SMTP dla konta <strong>${process.env.EMAIL_USER}</strong>.</p>
             <p>Wysyłka została wstrzymana na 30 minut.</p>
             <p>Błąd: ${error.message}</p>`
    });
    console.log("📧 Powiadomienie o blokadzie wysłane do administratora.");
  } catch (notifyError) {
    console.error("⚠️ Nie udało się wysłać powiadomienia o blokadzie:", notifyError.message);
  }

  if (unblockTimeout) clearTimeout(unblockTimeout);
  unblockTimeout = setTimeout(() => {
    isBlocked = false;
    console.log("✅ Blokada wysyłki została automatycznie zniesiona.");
  }, BLOCK_PAUSE);

  throw new Error("Blokada konta SMTP — pauza 30 minut.");
}


        if (attempt > maxRetries) throw error;
        await new Promise(res => setTimeout(res, 1000 * attempt));
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


// Endpointy pomocnicze
app.get('/queue-status', (req, res) => {
  res.json({
    pending: queue.pending,
    size: queue.size,
    blocked: isBlocked
  });
});

app.get('/smtp-check', async (req, res) => {
  try {
    await transporter.verify();
    res.send('🟢 SMTP działa — połączenie OK');
  } catch (err) {
    console.error('🔴 Błąd połączenia SMTP:', err.message);
    res.status(500).send('🔴 Błąd SMTP: ' + err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Email sender server running on port ${PORT}`));
