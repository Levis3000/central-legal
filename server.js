const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

// One deploy, separate public URLs per app:
//   /snaptract/privacy  /snaptract/terms  (+ .json for the iOS app)
//   /falaah/privacy     /falaah/terms
//   /towly/privacy      /towly/terms
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
};

app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.get('/', (_req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});

// Towly contact form config from Railway env (no key baked into HTML).
//   TOWLY_SUPABASE_URL       = https://….supabase.co
//   TOWLY_SUPABASE_ANON_KEY  = <public anon key>
function sendTowlyConfig(_req, res) {
  const config = {
    supabaseUrl: process.env.TOWLY_SUPABASE_URL || '',
    anonKey: process.env.TOWLY_SUPABASE_ANON_KEY || '',
  };
  res.type('application/javascript');
  res.set('Cache-Control', 'no-store');
  res.send(`window.TOWLY_CONFIG = ${JSON.stringify(config)};`);
}
app.get('/towly-config.js', sendTowlyConfig);
app.get('/towly/config.js', sendTowlyConfig);

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
      // Short path + product-prefixed filename the iOS app uses.
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
  console.log('  /snaptract/privacy  /snaptract/terms');
  console.log('  /falaah/privacy     /falaah/terms      /falaah/eula');
  console.log('  /towly/privacy      /towly/terms      /towly/eula');
  console.log('  /towly-config.js   (from TOWLY_SUPABASE_* env)');
});
