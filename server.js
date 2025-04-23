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
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

function logEmail({ to, subject }) {
  const logPath = path.join('logs', 'emails.log');
  const timestamp = new Date().toISOString();
  const entry = `${timestamp} | TO: ${to} | SUBJECT: ${subject}\n`;

  fs.appendFile(logPath, entry, err => {
    if (err) console.error('Błąd zapisu loga:', err.message);
  });
}

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
          subject,
          html,
          attachments
        });

        logEmail({ to, subject }); // 🧾 log po sukcesie
        return;

      } catch (error) {
        attempt++;
        console.error(`Błąd wysyłki (próba ${attempt}):`, error.message);
        if (attempt > maxRetries) throw error;
        await new Promise(res => setTimeout(res, 1000 * attempt)); // ⏱️ opóźnienie retry
      }
    }
  };

  queue.add(job)
    .then(() => {
      res.send({ success: true });
    })
    .catch((error) => {
      console.error('Ostateczna porażka:', error.message);
      res.status(500).send({ success: false, error: error.message });
    });
});

const PORT = process.env.PORT || 3000;

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

app.get('/queue-status', (req, res) => {
  res.json({
    pending: queue.pending,
    size: queue.size
  });
});

app.listen(PORT, () => {
  console.log(`Email sender server running on port ${PORT}`);
});
