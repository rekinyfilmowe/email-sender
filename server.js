import express from 'express';
import nodemailer from 'nodemailer';
import PQueue from 'p-queue';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(express.json());

const queue = new PQueue({ concurrency: 1 });

const transporter = nodemailer.createTransport({
  host: 'host998067.hostido.net.pl',
  port: 587, // jeśli nie działa, zmień na 465 + secure:true
  secure: false, // dla 587 (STARTTLS); zmień na true dla 465
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false // do testów; jeśli działa, usuń
  },
  connectionTimeout: 30000,
  greetingTimeout: 15000,
  logger: true, // debug
  debug: true   // debug
});

// Funkcja logowania wysyłek
function logEmail({ to, subject }) {
  const logPath = path.join('logs', 'emails.log');
  const timestamp = new Date().toISOString();
  const entry = `${timestamp} | TO: ${to} | SUBJECT: ${subject}\n`;

  fs.appendFile(logPath, entry, err => {
    if (err) console.error('Błąd zapisu loga:', err.message);
  });
}

// Endpoint do wysyłki maila
app.post('/send-email', async (req, res) => {
  const { to, subject, html, attachments } = req.body;

  const job = async () => {
    let attempt = 0;
    const maxRetries = 2;

    while (attempt <= maxRetries) {
      try {
        await transporter.sendMail({
          from: `"Rekiny Filmowe" <${process.env.EMAIL_USER}>`,
          to,
          bcc: 'system@rekinyfilmowe.pl',
          subject,
          html,
          attachments
        });

        logEmail({ to, subject });
        return;
      } catch (error) {
        attempt++;
        console.error(`Błąd wysyłki (próba ${attempt}):`, error);
        if (attempt > maxRetries) throw error;
        await new Promise(res => setTimeout(res, 1000 * attempt));
      }
    }
  };

  queue.add(job)
    .then(() => res.send({ success: true }))
    .catch((error) => {
      console.error('Ostateczna porażka:', error);
      res.status(500).send({ success: false, error: error.message });
    });
});

// Endpoint do podglądu logów
app.get('/logs', (req, res) => {
  const logPath = path.join('logs', 'emails.log');

  fs.readFile(logPath, 'utf8', (err, data) => {
    if (err) {
      console.error('Błąd odczytu loga:', err.message);
      return res.status(500).send('Nie udało się odczytać loga.');
    }
    res.set('Content-Type', 'text/plain');
    res.send(data);
  });
});

// Status kolejki
app.get('/queue-status', (req, res) => {
  res.json({
    pending: queue.pending,
    size: queue.size
  });
});

// Sprawdzenie połączenia SMTP
app.get('/smtp-check', async (req, res) => {
  try {
    await transporter.verify();
    res.send('🟢 SMTP działa — połączenie OK');
  } catch (err) {
    console.error('🔴 Błąd połączenia SMTP:', err);
    res.status(500).send('🔴 Błąd SMTP: ' + err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Email sender server running on port ${PORT}`));
