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

function env(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

/** Resolve SMTP settings; accept common aliases so Railway naming mismatches don't break forms. */
function smtpSettings() {
  const host = env('SMTP_HOST');
  const user = env('SMTP_USER') || env('SMTP_FROM');
  const pass = env('SMTP_PASS') || env('SMTP_PASSWORD');
  const to =
    env('CONTACT_TO_EMAIL') ||
    env('SMTP_TO') ||
    env('SUPPORT_EMAIL') ||
    env('CONTACT_EMAIL');
  const from = env('SMTP_FROM') || user;
  const port = Number(env('SMTP_PORT') || 587);
  const secure =
    env('SMTP_SECURE') === 'true' ||
    env('SMTP_SECURE') === '1' ||
    port === 465;
  const missing = [];
  if (!host) missing.push('SMTP_HOST');
  if (!user) missing.push('SMTP_USER (or SMTP_FROM)');
  if (!pass) missing.push('SMTP_PASS');
  if (!to) missing.push('CONTACT_TO_EMAIL (or SMTP_TO)');
  return { host, user, pass, to, from, port, secure, missing, configured: missing.length === 0 };
}

function smtpConfigured() {
  return smtpSettings().configured;
}

function createTransport(settings) {
  const s = settings || smtpSettings();
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: {
      user: s.user,
      pass: s.pass,
    },
  });
}

/**
 * Shared contact endpoint for all app forms.
 * Env (set on the central-legal Railway service — not the AI proxy):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER (or SMTP_FROM), SMTP_PASS
 *   CONTACT_TO_EMAIL (or SMTP_TO) — destination inbox, never shown publicly
 *   SMTP_FROM optional
 *
 * Subject is always prefixed with the app name, e.g. "[Guide Sight] Privacy Request"
 */
app.post('/api/contact', async (req, res) => {
  try {
    const smtp = smtpSettings();
    if (!smtp.configured) {
      console.error('[contact] SMTP not configured, missing:', smtp.missing.join(', '));
      return res.status(503).json({
        ok: false,
        error: 'Contact form is not configured yet. Please try again later.',
        missing: smtp.missing,
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

    const mail = {
      from: `"${appName} Contact" <${smtp.from}>`,
      to: smtp.to,
      replyTo: email || undefined,
      subject,
      text,
    };

    const transport = createTransport(smtp);
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
  const smtp = smtpSettings();
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    configured: smtp.configured,
    missing: smtp.missing,
    // names only — never values
    present: {
      SMTP_HOST: Boolean(env('SMTP_HOST')),
      SMTP_USER: Boolean(env('SMTP_USER')),
      SMTP_FROM: Boolean(env('SMTP_FROM')),
      SMTP_PASS: Boolean(env('SMTP_PASS') || env('SMTP_PASSWORD')),
      SMTP_PORT: Boolean(env('SMTP_PORT')),
      CONTACT_TO_EMAIL: Boolean(env('CONTACT_TO_EMAIL')),
      SMTP_TO: Boolean(env('SMTP_TO')),
    },
  });
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
  if (!smtpConfigured()) {
    console.log('  SMTP missing:', smtpSettings().missing.join(', '));
  }
});
