const express = require('express');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());

const transporter = nodemailer.createTransport({
  host: 'poczta.hostido.pl',
  port: 465,
  secure: true,
  auth: {
    user: 'twoj@email.pl', // <--- zmien na swoj email
    pass: 'twojehaslo'     // <--- zmien na swoje haslo
  }
});

app.post('/send-email', async (req, res) => {
  const { to, subject, text } = req.body;

  try {
    await transporter.sendMail({
      from: '"Rekiny Filmowe" <twoj@email.pl>', // <-- też dostosuj
      to,
      subject,
      text
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
