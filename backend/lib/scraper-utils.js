const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Retry mit exponential backoff (3× versuche, 1s → 2s → 4s).
async function retryWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      const delayMs = 1000 * Math.pow(2, i);
      console.log(`Retry ${i + 1}/${maxRetries} nach ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }
}

// Rate-Limiting: Min. Delay zwischen Requests.
function createRateLimiter(minDelayMs = 1000) {
  let lastCallTime = 0;
  return async function rateLimitedCall(fn) {
    const now = Date.now();
    const elapsed = now - lastCallTime;
    if (elapsed < minDelayMs) {
      await sleep(minDelayMs - elapsed);
    }
    lastCallTime = Date.now();
    return fn();
  };
}

// Validierung: Preis-Range Check (€0,10–€1,00/kWh).
function validatePrice(priceStr) {
  const match = priceStr?.match(/[\d,\.]+/);
  if (!match) return null;
  const price = parseFloat(match[0].replace(',', '.'));
  return (price >= 0.1 && price <= 1.0) ? price : null;
}

// Validierung: Grundpreis-Range Check (€0–€500/Jahr).
function validateBasicPrice(priceStr) {
  const match = priceStr?.match(/[\d,\.]+/);
  if (!match) return null;
  const price = parseFloat(match[0].replace(',', '.'));
  return (price >= 0 && price <= 500) ? price : null;
}

// Validierung: Anbieter-Name (keine Spam-Pattern).
function validateProvider(name) {
  if (!name || name.length < 2 || name.length > 50) return false;
  if (/\d{4,}/.test(name)) return false; // Zu viele Ziffern → Spam
  return true;
}

// Hash für Duplikat-Detection: hash(anbieter + sparte + ap + gp).
function hashContent(anbieter, sparte, ap, gp) {
  const crypto = require('crypto');
  const str = `${anbieter}|${sparte}|${ap}|${gp}`;
  return crypto.createHash('md5').update(str).digest('hex');
}

// Fetch mit User-Agent (nicht als Bot erkannt).
async function fetchWithUA(url) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };
  const response = await fetch(url, { headers, timeout: 30000 });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

module.exports = {
  sleep,
  retryWithBackoff,
  createRateLimiter,
  validatePrice,
  validateBasicPrice,
  validateProvider,
  hashContent,
  fetchWithUA,
};
