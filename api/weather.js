const https = require('https');

const AMAP_KEY = process.env.AMAP_KEY;

function httpsRequest(options, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });
    req.on('error', reject);
    if (timeoutMs) {
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('请求超时'));
      });
    }
    req.end();
  });
}

// 高德天气API返回的天气代码映射
const weatherCodeMap = {
  '00': '晴', '01': '多云', '02': '阴', '03': '阵雨', '04': '雷阵雨',
  '05': '雷阵雨伴有冰雹', '06': '雨夹雪', '07': '小雨', '08': '中雨',
  '09': '大雨', '10': '暴雨', '11': '大暴雨', '12': '特大暴雨',
  '13': '阵雪', '14': '小雪', '15': '中雪', '16': '大雪',
  '17': '暴雪', '18': '雾', '19': '冻雨', '20': '沙尘暴',
  '21': '小到中雨', '22': '中到大雨', '23': '大到暴雨',
  '24': '暴雨到大暴雨', '25': '大暴雨到特大暴雨',
  '26': '小到中雪', '27': '中到大雪', '28': '大到暴雪', '29': '浮尘',
  '30': '扬沙', '31': '强沙尘暴', '53': '霾'
};

function parseWeatherCode(code) {
  return weatherCodeMap[code] || '未知';
}

async function getWeather(city) {
  if (!AMAP_KEY) {
    throw new Error('未配置高德地图Key');
  }

  // 高德天气API v3
  const url = `https://restapi.amap.com/v3/weather/weatherInfo?key=${AMAP_KEY}&city=${encodeURIComponent(city)}&extensions=all&output=json`;
  const parsedUrl = new URL(url);

  const result = await httpsRequest({
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  }, 15000);

  if (result.statusCode !== 200) {
    throw new Error(`天气API返回错误: ${result.statusCode}`);
  }

  const data = JSON.parse(result.body);
  if (data.status !== '1' || !data.forecasts || !data.forecasts[0]) {
    throw new Error('天气查询失败: ' + (data.info || '未知错误'));
  }

  const forecast = data.forecasts[0];
  const casts = forecast.casts || [];

  const today = casts[0] || {};
  const tomorrow = casts[1] || {};

  return {
    city: forecast.city || city,
    today: {
      dayWeather: parseWeatherCode(today.dayweather),
      nightWeather: parseWeatherCode(today.nightweather),
      dayTemp: today.daytemp,
      nightTemp: today.nighttemp,
      dayWindDir: today.daywind,
      dayWind: today.daypower
    },
    tomorrow: {
      dayWeather: parseWeatherCode(tomorrow.dayweather),
      nightWeather: parseWeatherCode(tomorrow.nightweather),
      dayTemp: tomorrow.daytemp,
      nightTemp: tomorrow.nighttemp,
      dayWindDir: tomorrow.daywind,
      dayWind: tomorrow.daypower
    }
  };
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

      const city = body.city || '';
      if (!city) {
        res.status(400).json({ error: '缺少城市参数' });
        return;
      }

      const weather = await getWeather(city);
      res.status(200).json(weather);
    } catch (error) {
      console.error('天气查询失败:', error);
      res.status(500).json({ error: error.message });
    }
    return;
  }

  res.status(404).json({ error: 'Not Found' });
};