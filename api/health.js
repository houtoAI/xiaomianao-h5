module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  res.status(200).json({
    status: 'ok',
    arkConfigured: !!process.env.VOLC_ARK_API_KEY,
    samiConfigured: !!(process.env.VOLC_SAMI_APPKEY && process.env.VOLC_SAMI_TOKEN),
    amapConfigured: !!process.env.AMAP_KEY
  });
};