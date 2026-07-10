const https = require('https');
const crypto = require('crypto');

const VOLC_ACCESS_KEY = process.env.VOLC_ACCESS_KEY;
const VOLC_SECRET_KEY = process.env.VOLC_SECRET_KEY;
const SAMI_APPKEY = process.env.VOLC_SAMI_APPKEY;

let cachedToken = null;
let tokenExpiresAt = 0;

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function hmacSha256(key, str) {
  return crypto.createHmac('sha256', key).update(str, 'utf8').digest();
}

async function getSamiToken() {
  if (!VOLC_ACCESS_KEY || !VOLC_SECRET_KEY || !SAMI_APPKEY) {
    throw new Error('未配置语音服务密钥');
  }

  const now = Date.now() / 1000;
  if (cachedToken && tokenExpiresAt > now + 60) {
    return cachedToken;
  }

  const host = 'open.volcengineapi.com';
  const region = 'cn-north-1';
  const service = 'sami';
  const action = 'GetToken';
  const version = '2021-07-27';
  const algorithm = 'HMAC-SHA256';
  const requestType = 'request';

  const isoDate = new Date().toISOString().replace(/[-:]/g, '').replace('.000', 'Z');
  const date = isoDate.substring(0, 8);

  const body = JSON.stringify({
    appkey: SAMI_APPKEY,
    token_version: 'volc-auth-v1',
    expiration: 3600
  });

  const bodyHash = sha256(body);

  const headers = {
    'Host': host,
    'Content-Type': 'application/json; charset=utf-8',
    'X-Date': isoDate,
    'X-Content-Sha256': bodyHash
  };

  const sortedKeys = Object.keys(headers).sort();
  const signedHeaders = sortedKeys.join(';').toLowerCase();
  
  let canonicalHeaders = '';
  for (const key of sortedKeys) {
    canonicalHeaders += key.toLowerCase() + ':' + headers[key] + '\n';
  }

  const query = `Action=${action}&Version=${version}`;
  const canonicalRequest = `${'POST'}\n/\n${query}\n${canonicalHeaders}${signedHeaders}\n${bodyHash}`;
  const hashedCanonicalRequest = sha256(canonicalRequest);

  const credentialScope = `${date}/${region}/${service}/${requestType}`;
  const stringToSign = `${algorithm}\n${isoDate}\n${credentialScope}\n${hashedCanonicalRequest}`;

  const kDate = hmacSha256(VOLC_SECRET_KEY, date);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, requestType);
  const signature = hmacSha256(kSigning, stringToSign).toString('hex');

  const authorization = `${algorithm} Credential=${VOLC_ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const options = {
    hostname: host,
    port: 443,
    path: `/?${query}`,
    method: 'POST',
    headers: {
      'Host': host,
      'Content-Type': 'application/json; charset=utf-8',
      'X-Date': isoDate,
      'X-Content-Sha256': bodyHash,
      'Authorization': authorization
    }
  };

  const result = await new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  if (result.statusCode !== 200) {
    throw new Error(`获取Token失败: ${result.statusCode} - ${result.body}`);
  }

  const data = JSON.parse(result.body);
  if (data.status_code !== 20000000) {
    throw new Error(data.status_text || '获取Token失败');
  }

  cachedToken = data.token;
  tokenExpiresAt = data.expires_at;
  return cachedToken;
}

async function getTtsAudio(text, speaker, speed) {
  const token = await getSamiToken();

  const payload = JSON.stringify({
    speaker: speaker || 'zh_female_qingxin',
    text: text,
    audio_config: {
      format: 'mp3',
      sample_rate: 24000,
      speech_rate: speed !== undefined ? speed : 0
    }
  });

  const body = JSON.stringify({
    appkey: SAMI_APPKEY,
    token: token,
    namespace: 'TTS',
    payload: payload
  });

  const options = {
    hostname: 'sami.bytedance.com',
    port: 443,
    path: '/api/v1/invoke',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const result = await new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('请求超时')));
    req.write(body);
    req.end();
  });

  if (result.statusCode !== 200) {
    throw new Error(`TTS API返回错误: ${result.statusCode}`);
  }

  const data = JSON.parse(result.body);
  if (data.status_code !== 20000000) {
    throw new Error(data.status_text || 'TTS失败');
  }

  return data.data;
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

      const text = body.text || '';
      const speaker = body.speaker || '';
      const speed = body.speed;
      const audioBase64 = await getTtsAudio(text, speaker, speed);
      const audioBuffer = Buffer.from(audioBase64, 'base64');

      res.setHeader('Content-Type', 'audio/mp3');
      res.setHeader('Content-Length', audioBuffer.length);
      res.status(200).end(audioBuffer);
    } catch (error) {
      console.error('TTS失败:', error);
      res.status(500).json({ error: error.message });
    }
    return;
  }

  res.status(404).json({ error: 'Not Found' });
};
