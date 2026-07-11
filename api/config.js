const { checkLimit, getClientIp, DAILY_LIMIT } = require('./_rateLimit.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'GET') {
    const arkApiKey = process.env.VOLC_ARK_API_KEY || '';
    const arkModel = process.env.VOLC_ARK_MODEL || 'doubao-1-5-lite-32k-250115';
    const ttsAppId = process.env.VOLC_TTS_APP_ID || '';
    const ttsAccessKey = process.env.VOLC_TTS_ACCESS_KEY || '';
    const samiAppkey = process.env.VOLC_SAMI_APPKEY || '';
    const samiToken = process.env.VOLC_SAMI_TOKEN || '';

    const usage = checkLimit(req);

    res.status(200).json({
      arkApiKey: arkApiKey ? arkApiKey.substring(0, 8) + '...' : '',
      arkModel: arkModel,
      samiAppkey: samiAppkey ? samiAppkey.substring(0, 8) + '...' : '',
      samiConfigured: !!samiAppkey && !!samiToken,
      ttsConfigured: !!ttsAppId && !!ttsAccessKey,
      dailyLimit: DAILY_LIMIT,
      usedCount: usage.count,
      remainingCount: usage.remaining
    });
    return;
  }

  if (req.method === 'POST') {
    res.status(200).json({ success: true, message: '请通过Vercel环境变量配置' });
    return;
  }

  res.status(404).json({ error: 'Not Found' });
};
