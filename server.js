const express = require('express');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

// One deploy, separate public URLs per app:
//   /snaptract/privacy  /snaptract/terms  (+ .json for the iOS app)
//   /falaah/privacy     /falaah/terms
//   /towly/privacy      /towly/terms
//   /guide-sight/privacy /guide-sight/terms /guide-sight/contact
const APPS = {
  snaptract: {
    label: 'SnapTract',
    files: {
      privacy: 'snaptract-privacy-policy.html',
      terms: 'snaptract-terms-of-service.html',
      eula: 'snaptract-eula.html',
      contact: 'snaptract-contact.html',
      '': 'snaptract.html',
    },
    json: {
      privacy: 'snaptract-privacy-policy.json',
      terms: 'snaptract-terms-of-service.json',
      eula: 'snaptract-eula.json',
    },
  },
  falaah: {
    label: 'Falaah',
    files: {
      privacy: 'falaah-privacy-policy.html',
      terms: 'falaah-terms-of-service.html',
      eula: 'falaah-eula.html',
      both: 'falaah-privacy-and-terms.html',
      contact: 'falaah-contact.html',
    },
  },
  towly: {
    label: 'Towly',
    files: {
      privacy: 'towly-privacy-policy.html',
      terms: 'towly-terms-of-service.html',
      eula: 'towly-eula.html',
      contact: 'towly-contact.html',
      '': 'towly.html',
    },
  },
  'guide-sight': {
    label: 'Guide Sight',
    files: {
      privacy: 'guide-sight-privacy-policy.html',
      terms: 'guide-sight-terms-of-service.html',
      contact: 'guide-sight-contact.html',
    },
  },
};

const APP_BY_SLUG = Object.fromEntries(
  Object.entries(APPS).map(([slug, cfg]) => [slug, cfg.label])
);

app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '48kb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.get('/', (_req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});

function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.CONTACT_TO_EMAIL
  );
}

function createTransport() {
  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    process.env.SMTP_SECURE === 'true' ||
    process.env.SMTP_SECURE === '1' ||
    port === 465;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * Shared contact endpoint for all app forms.
 * Env (set in Railway — do not commit secrets or the inbox address):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM (optional)
 *   CONTACT_TO_EMAIL  — destination inbox (not shown on any public page)
 *
 * Subject is always prefixed with the app name, e.g. "[Guide Sight] Privacy Request"
 */
app.post('/api/contact', async (req, res) => {
  try {
    if (!smtpConfigured()) {
      return res.status(503).json({
        ok: false,
        error: 'Contact form is not configured yet. Please try again later.',
      });
    }

    const body = req.body || {};
    // Honeypot — bots fill this; humans never see it.
    if (body.company || body.website) {
      return res.json({ ok: true });
    }

    const appSlug = String(body.app || '').trim().toLowerCase();
    const appName = APP_BY_SLUG[appSlug] || String(body.appName || '').trim();
    if (!appName) {
      return res.status(400).json({ ok: false, error: 'Unknown app.' });
    }

    const name = String(body.name || '').trim().slice(0, 200);
    const email = String(body.email || '').trim().slice(0, 320);
    const topic = String(body.topic || '').trim().slice(0, 200);
    const message = String(body.message || '').trim().slice(0, 8000);

    if (!message) {
      return res.status(400).json({ ok: false, error: 'Please enter a message.' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'Please enter a valid email.' });
    }

    const topicPart = topic || 'Support';
    const subject = `[${appName}] ${topicPart}`;
    const text = [
      `App: ${appName}`,
      `Name: ${name || '(not provided)'}`,
      `Reply-to: ${email || '(not provided)'}`,
      topic ? `Topic: ${topic}` : null,
      '',
      message,
    ]
      .filter((line) => line !== null)
      .join('\n');

    const fromAddress =
      process.env.SMTP_FROM ||
      process.env.SMTP_USER;

    const mail = {
      from: `"${appName} Contact" <${fromAddress}>`,
      to: process.env.CONTACT_TO_EMAIL,
      replyTo: email || undefined,
      subject,
      text,
    };

    const transport = createTransport();
    await transport.sendMail(mail);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[contact] send failed', err && err.message ? err.message : err);
    return res.status(500).json({
      ok: false,
      error: "Couldn't send just now — please try again in a moment.",
    });
  }
});

app.get('/api/contact/status', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, configured: smtpConfigured() });
});

for (const [slug, cfg] of Object.entries(APPS)) {
  for (const [doc, file] of Object.entries(cfg.files)) {
    const route = doc ? `/${slug}/${doc}` : `/${slug}`;
    app.get(route, (_req, res) => {
      res.set('Cache-Control', 'public, max-age=300');
      res.sendFile(path.join(ROOT, file));
    });
  }
  if (cfg.json) {
    for (const [doc, file] of Object.entries(cfg.json)) {
      app.get(`/${slug}/${doc}.json`, (_req, res) => {
        res.set('Cache-Control', 'public, max-age=300');
        res.type('json').send(fs.readFileSync(path.join(ROOT, file), 'utf8'));
      });
      app.get(`/${path.basename(file)}`, (_req, res) => {
        res.set('Cache-Control', 'public, max-age=300');
        res.type('json').send(fs.readFileSync(path.join(ROOT, file), 'utf8'));
      });
    }
  }
}

// Flat filenames still work (GitHub Pages–style links).
app.use(express.static(ROOT, {
  extensions: ['html'],
  setHeaders(res) {
    res.set('Cache-Control', 'public, max-age=300');
  },
}));

app.listen(PORT, () => {
  console.log(`central-legal listening on :${PORT}`);
  console.log('  POST /api/contact   (SMTP — subject prefixed with app name)');
  console.log('  /snaptract/privacy  /snaptract/terms');
  console.log('  /falaah/privacy     /falaah/terms      /falaah/eula');
  console.log('  /towly/privacy      /towly/terms      /towly/eula');
  console.log('  /guide-sight/privacy   /guide-sight/terms   /guide-sight/contact');
  console.log(`  SMTP configured: ${smtpConfigured() ? 'yes' : 'no'}`);
});
