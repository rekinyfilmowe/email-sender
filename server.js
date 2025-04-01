import express from 'express';
import nodemailer from 'nodemailer';

const app = express();
app.use(express.json());

const transporter = nodemailer.createTransport({
  host: 'host998067.hostido.net.pl',
  port: 587,
  secure: false, // UWAGA! dla 587 musi być "false"
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

app.post('/send-email', async (req, res) => {
  const { to, subject, html } = req.body;

try {
  await transporter.sendMail({
    from: `"Rekiny Filmowe" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html // <- to klucz do działania!
  });

    res.send({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).send({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Email sender server running on port ${PORT}`);
});
