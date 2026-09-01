/**
 * Live weather for every network node, from the Open-Meteo forecast API
 * (free, no API key, no attribution key required).
 *
 * Nodes are batched into a single multi-coordinate request, refreshed on a
 * timer, and cached. If the network is unavailable - which is the normal case
 * for an offline demo - we fall back to the monsoon climatology in history.js so
 * the whole platform still produces coherent output, and every response says
 * plainly which source it used.
 */
import { NODES } from '../data/nodes.js';
import { MONTHLY_RAIN_MM_PER_DAY } from './history.js';
import { applyScenario } from './scenarios.js';

const API = 'https://api.open-meteo.com/v1/forecast';
const REFRESH_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12000;

/** @type {{ source:'live'|'climatology', fetchedAt:string|null, byNode:Record<string,any> }} */
let cache = { source: 'climatology', fetchedAt: null, byNode: {} };
let lastError = null;
let inFlight = null;

function climatologyFor(node, date = new Date()) {
  const month = date.getUTCMonth();
  const base = MONTHLY_RAIN_MM_PER_DAY[month];
  // Orographic uplift: the southern Meghalaya / Mizoram / Arunachal foothills
  // take far more rain than the Brahmaputra valley floor at the same latitude.
  const orographic = 1 + Math.min(node.elevationM, 2000) / 2500;
  const daily = base * orographic;
  return {
    nodeId: node.id,
    temperatureC: Math.round(28 - node.elevationM / 180),
    precipitationMm: Number(daily.toFixed(1)),
    rain3DayMm: Number((daily * 3).toFixed(1)),
    rain7DayMm: Number((daily * 7).toFixed(1)),
    windKmph: 8,
    source: 'climatology',
  };
}

function seedClimatology() {
  cache = {
    source: 'climatology',
    fetchedAt: new Date().toISOString(),
    byNode: Object.fromEntries(NODES.map((n) => [n.id, climatologyFor(n)])),
  };
}
seedClimatology();

async function fetchLive() {
  const lats = NODES.map((n) => n.lat.toFixed(4)).join(',');
  const lons = NODES.map((n) => n.lon.toFixed(4)).join(',');
  const url =
    `${API}?latitude=${lats}&longitude=${lons}` +
    '&current=temperature_2m,precipitation,wind_speed_10m' +
    '&daily=precipitation_sum' +
    '&forecast_days=7&past_days=3&timezone=Asia%2FKolkata';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Open-Meteo responded ${res.status}`);
    const body = await res.json();
    const series = Array.isArray(body) ? body : [body];
    if (series.length !== NODES.length) {
      throw new Error(`expected ${NODES.length} series, got ${series.length}`);
    }

    const byNode = {};
    series.forEach((s, i) => {
      const node = NODES[i];
      const daily = s.daily?.precipitation_sum ?? [];
      // past_days=3 puts today at index 3; the 3-day antecedent total is the
      // three days before it, which is what the landslide model needs.
      const antecedent = daily.slice(0, 3).reduce((a, b) => a + (b ?? 0), 0);
      const nextWeek = daily.slice(3, 10).reduce((a, b) => a + (b ?? 0), 0);
      byNode[node.id] = {
        nodeId: node.id,
        temperatureC: s.current?.temperature_2m ?? null,
        precipitationMm: s.current?.precipitation ?? 0,
        rain3DayMm: Number(antecedent.toFixed(1)),
        rain7DayMm: Number(nextWeek.toFixed(1)),
        forecastDailyMm: daily.slice(3, 10).map((v) => Number((v ?? 0).toFixed(1))),
        windKmph: s.current?.wind_speed_10m ?? null,
        source: 'live',
      };
    });

    cache = { source: 'live', fetchedAt: new Date().toISOString(), byNode };
    lastError = null;
  } finally {
    clearTimeout(timer);
  }
}

/** Refresh the cache, degrading to climatology rather than throwing. */
export async function refreshWeather() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      await fetchLive();
    } catch (err) {
      lastError = err.message;
      if (cache.source !== 'live') seedClimatology();
      // A previously fetched live cache is kept and simply goes stale - stale
      // real observations beat synthetic ones.
    } finally {
      inFlight = null;
    }
    return cache;
  })();
  return inFlight;
}

/**
 * Weather for a node. When a scenario other than `live` is named, its rainfall
 * overlay replaces the observed values - everything downstream is unchanged, so
 * the scenario exercises the real models.
 */
export function getWeather(nodeId, scenarioId = 'live') {
  const base = cache.byNode[nodeId] ?? climatologyFor(NODES.find((n) => n.id === nodeId));
  return scenarioId && scenarioId !== 'live' ? applyScenario(base, nodeId, scenarioId) : base;
}

export function weatherStatus() {
  return {
    source: cache.source,
    fetchedAt: cache.fetchedAt,
    nodeCount: Object.keys(cache.byNode).length,
    lastError,
    provider: 'Open-Meteo (open-meteo.com), free non-commercial tier',
  };
}

export function allWeather() {
  return cache.byNode;
}

export function startWeatherLoop() {
  refreshWeather();
  const t = setInterval(refreshWeather, REFRESH_MS);
  t.unref?.();
  return t;
}
