const https = require('https');
const { rateLimitMiddleware } = require('./_rateLimit.js');

const AMAP_KEY = process.env.AMAP_KEY;

function httpsRequest(options, postData, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on('error', reject);
    if (timeoutMs) {
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('请求超时'));
      });
    }
    if (postData) req.write(postData);
    req.end();
  });
}

async function amapRequest(path, params) {
  if (!AMAP_KEY) {
    throw new Error('未配置高德地图Key');
  }

  const url = `https://restapi.amap.com${path}?key=${AMAP_KEY}&${params}`;
  const parsedUrl = new URL(url);

  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  };

  const result = await httpsRequest(options, null, 15000);
  
  if (result.statusCode !== 200) {
    throw new Error(`高德地图API返回错误: ${result.statusCode}`);
  }

  try {
    return JSON.parse(result.body);
  } catch (e) {
    throw new Error('解析高德地图API响应失败');
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'POST') {
    if (!rateLimitMiddleware(req, res)) return;

    try {
      const body = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => { data += chunk; });
        req.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });

      if (req.url.includes('/poi')) {
        const keyword = body.keyword || '';
        const location = body.location || '116.397428,39.90923';
        
        const result = await amapRequest(
          '/v3/place/around',
          `keywords=${encodeURIComponent(keyword)}&location=${location}&radius=5000&output=json&types=${encodeURIComponent(keyword)}`
        );

        if (result.status === '1' && result.pois) {
          const pois = result.pois.slice(0, 5).map(p => ({
            name: p.name,
            address: p.address,
            location: p.location,
            distance: p.distance
          }));
          res.status(200).json({ pois });
        } else {
          res.status(200).json({ pois: [] });
        }

      } else if (req.url.includes('/walking')) {
        const origin = body.origin || '116.397428,39.90923';
        const destination = body.destination || '';
        
        const result = await amapRequest(
          '/v3/direction/walking',
          `origin=${origin}&destination=${destination}&output=json`
        );

        if (result.status === '1' && result.route && result.route.paths) {
          const path = result.route.paths[0];
          const steps = (path.steps || []).map(s => ({
            instruction: s.instruction,
            distance: s.distance
          }));
          res.status(200).json({
            steps,
            distance: path.distance,
            duration: path.duration
          });
        } else {
          res.status(200).json({ steps: [], distance: 0, duration: 0 });
        }

      } else if (req.url.includes('/city')) {
        const location = body.location || '';
        
        const result = await amapRequest(
          '/v3/geocode/regeo',
          `location=${location}&output=json&radius=1000&extensions=base`
        );

        if (result.status === '1' && result.regeocode) {
          const addressComponent = result.regeocode.addressComponent || {};
          res.status(200).json({
            city: addressComponent.city || addressComponent.province || ''
          });
        } else {
          res.status(200).json({ city: '' });
        }

      } else {
        res.status(404).json({ error: 'Not Found' });
      }

    } catch (error) {
      console.error('导航API失败:', error);
      res.status(500).json({ error: error.message });
    }
    return;
  }

  res.status(404).json({ error: 'Not Found' });
};