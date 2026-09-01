/**
 * NER Smart Logistics & Accessibility Intelligence Platform - API server.
 * SIH 2026, problem statement SIH26002, team CodeCrew.
 */
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { api } from './routes/api.js';
import { trainRiskModel } from './services/risk.js';
import { startWeatherLoop } from './services/weather.js';
import { validateNetwork } from './services/graph.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5174);

// Fail loudly on a malformed network rather than serving quietly broken routes.
const problems = validateNetwork();
if (problems.length) {
  console.error('Network validation failed:');
  for (const p of problems) console.error('  -', p);
  process.exit(1);
}

const card = trainRiskModel();
console.log(
  `[model] trained on ${card.samples.train} records in ${card.trainingMs} ms - ` +
    `held-out ROC-AUC ${card.heldOut.rocAuc}, accuracy ${card.heldOut.accuracy}`,
);

startWeatherLoop();

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));
app.use('/api', api);

// Serve the built SPA when it exists, so `npm run build && npm start` is a
// single-process deployment.
const dist = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use((req, res) => res.status(404).json({ error: `No route ${req.method} ${req.path}` }));

// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature.
app.use((err, req, res, _next) => {
  const status = err.status ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message ?? 'Internal error' });
});

app.listen(PORT, () => {
  console.log(`[api] NER logistics platform listening on http://localhost:${PORT}`);
  console.log(`[api] health: http://localhost:${PORT}/api/health`);
});
