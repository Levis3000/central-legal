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

/** Pull bare address from `Name <addr@host>` or plain addr. */
function extractEmail(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim();
}

/** Resolve SMTP settings; accept common aliases so Railway naming mismatches don't break forms. */
function smtpSettings() {
  const host = env('SMTP_HOST');
  const fromRaw = env('SMTP_FROM');
  const user = env('SMTP_USER') || extractEmail(fromRaw);
  const pass = env('SMTP_PASS') || env('SMTP_PASSWORD');
  const to =
    env('CONTACT_TO_EMAIL') ||
    env('SMTP_TO') ||
    env('SUPPORT_EMAIL') ||
    env('CONTACT_EMAIL');
  const from = fromRaw || user;
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
    // Fail fast — Railway / blocked SMTP ports otherwise hang the request forever.
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 20_000,
    auth: {
      user: s.user,
      pass: s.pass,
    },
    tls: {
      // Gmail / STARTTLS on 587
      minVersion: 'TLSv1.2',
    },
    requireTLS: !s.secure && s.port === 587,
  });
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Optional HTTPS path — more reliable on Railway than raw SMTP. */
async function sendViaResend({ from, to, replyTo, subject, text }) {
  const key = env('RESEND_API_KEY');
  if (!key) return null;
  const fromAddr = from.includes('<') ? from : `Contact <${extractEmail(from)}>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddr,
      to: [to],
      reply_to: replyTo || undefined,
      subject,
      text,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data && (data.message || data.error)) || `Resend HTTP ${res.status}`);
  }
  return data;
}

/**
 * Shared contact endpoint for all app forms.
 * Env (set on the central-legal Railway service — not the AI proxy):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER (or SMTP_FROM), SMTP_PASS
 *   CONTACT_TO_EMAIL (or SMTP_TO) — destination inbox, never shown publicly
 *   SMTP_FROM optional
 *   RESEND_API_KEY optional — preferred when set (HTTPS, avoids SMTP hangs)
 *
 * Subject is always prefixed with the app name, e.g. "[Guide Sight] Privacy Request"
 */
app.post('/api/contact', async (req, res) => {
  try {
    const smtp = smtpSettings();
    const hasResend = Boolean(env('RESEND_API_KEY'));
    if (!smtp.configured && !hasResend) {
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

    const fromAddress = smtp.from || env('SMTP_FROM') || env('SMTP_USER') || 'onboarding@resend.dev';
    const toAddress = smtp.to || env('CONTACT_TO_EMAIL') || env('SMTP_TO');
    if (!toAddress) {
      return res.status(503).json({
        ok: false,
        error: 'Contact form is not configured yet. Please try again later.',
        missing: ['CONTACT_TO_EMAIL'],
      });
    }

    const mail = {
      from: `"${appName} Contact" <${extractEmail(fromAddress)}>`,
      to: toAddress,
      replyTo: email || undefined,
      subject,
      text,
    };

    if (hasResend) {
      await sendViaResend(mail);
      return res.json({ ok: true, via: 'resend' });
    }

    console.log(`[contact] SMTP send via ${smtp.host}:${smtp.port} secure=${smtp.secure} user=${smtp.user}`);
    const transport = createTransport(smtp);
    await withTimeout(transport.sendMail(mail), 25_000, 'SMTP send');
    try { transport.close(); } catch (_) { /* ignore */ }
    return res.json({ ok: true, via: 'smtp' });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    const code = err && (err.code || err.responseCode);
    console.error('[contact] send failed', { message: msg, code, response: err && err.response });
    const timedOut = /timed out|Timeout|ETIMEDOUT|ESOCKET|ECONNECTION/i.test(msg);
    const authFail = /Invalid login|Username and Password not accepted|EAUTH|535|534|Application-specific password/i.test(msg + String(code || ''));
    return res.status(timedOut ? 504 : 500).json({
      ok: false,
      error: timedOut
        ? 'Email server did not respond in time. Try SMTP_PORT=465 and SMTP_SECURE=true, or set RESEND_API_KEY.'
        : authFail
          ? 'Email login failed. Use SMTP_USER=your full Gmail address and an App Password (not your normal Gmail password).'
          : "Couldn't send just now — please try again in a moment.",
      hint: timedOut ? 'timeout' : authFail ? 'auth' : 'smtp',
    });
  }
});

app.get('/api/contact/status', (_req, res) => {
  const smtp = smtpSettings();
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    configured: smtp.configured || Boolean(env('RESEND_API_KEY')),
    missing: smtp.configured || env('RESEND_API_KEY') ? [] : smtp.missing,
    smtp: {
      host: smtp.host || null,
      port: smtp.port || null,
      secure: smtp.secure,
      userSet: Boolean(smtp.user),
    },
    // names only — never values
    present: {
      SMTP_HOST: Boolean(env('SMTP_HOST')),
      SMTP_USER: Boolean(env('SMTP_USER')),
      SMTP_FROM: Boolean(env('SMTP_FROM')),
      SMTP_PASS: Boolean(env('SMTP_PASS') || env('SMTP_PASSWORD')),
      SMTP_PORT: Boolean(env('SMTP_PORT')),
      CONTACT_TO_EMAIL: Boolean(env('CONTACT_TO_EMAIL')),
      SMTP_TO: Boolean(env('SMTP_TO')),
      RESEND_API_KEY: Boolean(env('RESEND_API_KEY')),
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
