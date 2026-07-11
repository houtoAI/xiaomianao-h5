const DAILY_LIMIT = 20;
const usageMap = new Map();

function getClientIp(req) {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0].trim();
  }
  const xRealIp = req.headers['x-real-ip'];
  if (xRealIp) {
    return xRealIp;
  }
  return req.socket.remoteAddress || 'unknown';
}

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function cleanupOldEntries() {
  const today = getTodayKey();
  for (const key of usageMap.keys()) {
    if (!key.endsWith(`_${today}`)) {
      usageMap.delete(key);
    }
  }
}

function checkLimit(req) {
  cleanupOldEntries();
  const ip = getClientIp(req);
  const today = getTodayKey();
  const key = `${ip}_${today}`;
  const count = usageMap.get(key) || 0;
  return {
    ip,
    count,
    limit: DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - count)
  };
}

function incrementUsage(req) {
  const ip = getClientIp(req);
  const today = getTodayKey();
  const key = `${ip}_${today}`;
  const count = (usageMap.get(key) || 0) + 1;
  usageMap.set(key, count);
  return count;
}

function rateLimitMiddleware(req, res) {
  const usage = checkLimit(req);
  if (usage.count >= usage.limit) {
    res.status(429).json({
      error: '今日使用次数已用完，请明天再来',
      count: usage.count,
      limit: usage.limit
    });
    return false;
  }
  incrementUsage(req);
  return true;
}

module.exports = {
  checkLimit,
  incrementUsage,
  rateLimitMiddleware,
  getClientIp,
  DAILY_LIMIT
};
