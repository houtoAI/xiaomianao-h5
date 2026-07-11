const https = require('https');
const crypto = require('crypto');

const ACCESS_KEY = process.env.VOLC_ACCESS_KEY;
const SECRET_KEY = process.env.VOLC_SECRET_KEY;
const SAMI_APPKEY = process.env.VOLC_SAMI_APPKEY;

let cachedToken = null;
let cachedTokenExpiresAt = 0;

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

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function hmacSHA256(key, content) {
  return crypto.createHmac('sha256', key).update(content).digest();
}

function getCurrentFormatDate() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

async function getSamiToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedTokenExpiresAt > now + 300) {
    return cachedToken;
  }

  if (!ACCESS_KEY || !SECRET_KEY || !SAMI_APPKEY) {
    throw new Error('未配置语音服务密钥');
  }

  const region = 'cn-north-1';
  const service = 'sami';
  const action = 'GetToken';
  const version = '2021-07-27';
  const method = 'POST';
  const path = '/';
  const contentType = 'application/json; charset=utf-8';
  const host = 'open.volcengineapi.com';
  const query = `Action=${action}&Version=${version}`;

  const formatDate = getCurrentFormatDate();
  const date = formatDate.substring(0, 8);

  const bodyObj = {
    appkey: SAMI_APPKEY,
    token_version: 'volc-auth-v1',
    expiration: 36000
  };
  const bodyStr = JSON.stringify(bodyObj);

  const bodyHash256 = sha256(bodyStr);

  const headers = {
    'Host': host,
    'Content-Type': contentType,
    'X-Date': formatDate,
    'X-Content-Sha256': bodyHash256
  };

  const sortedKeys = Object.keys(headers).sort();

  let signedStr = '';
  let signedHeadersStr = '';
  for (const key of sortedKeys) {
    signedHeadersStr += ';' + key.toLowerCase();
    signedStr += key.toLowerCase() + ':' + headers[key] + '\n';
  }
  signedHeadersStr = signedHeadersStr.substring(1);

  const canonicalRequest = method + '\n' +
    path + '\n' +
    query + '\n' +
    signedStr + '\n' +
    signedHeadersStr + '\n' +
    bodyHash256;

  const hashedCanonReq = sha256(canonicalRequest);

  const credentialScope = date + '/' + region + '/' + service + '/' + 'request';

  const signingStr = 'HMAC-SHA256' + '\n' +
    formatDate + '\n' +
    credentialScope + '\n' +
    hashedCanonReq;

  const kDate = hmacSHA256(SECRET_KEY, date);
  const kRegion = hmacSHA256(kDate, region);
  const kService = hmacSHA256(kRegion, service);
  const signingKey = hmacSHA256(kService, 'request');

  const signature = crypto.createHmac('sha256', signingKey).update(signingStr).digest('hex');

  const credential = ACCESS_KEY + '/' + credentialScope;
  const authorization = 'HMAC-SHA256' + ' Credential=' + credential +
    ', SignedHeaders=' + signedHeadersStr +
    ', Signature=' + signature;

  const options = {
    hostname: host,
    port: 443,
    path: path + '?' + query,
    method: method,
    headers: {
      'Host': host,
      'Content-Type': contentType,
      'X-Date': formatDate,
      'X-Content-Sha256': bodyHash256,
      'Authorization': authorization,
      'Content-Length': Buffer.byteLength(bodyStr)
    }
  };

  const result = await httpsRequest(options, bodyStr, 15000);

  if (result.statusCode !== 200) {
    throw new Error(`获取SAMI Token失败: ${result.statusCode}, ${result.body}`);
  }

  try {
    const data = JSON.parse(result.body);
    if (data.status_code !== 20000000) {
      throw new Error(data.status_text || '获取SAMI Token失败');
    }
    cachedToken = data.token;
    cachedTokenExpiresAt = data.expires_at;
    return cachedToken;
  } catch (e) {
    throw new Error('解析SAMI Token响应失败: ' + e.message);
  }
}

async function getTtsAudio(text, speaker) {
  const token = await getSamiToken();

  const voiceType = speaker || 'zh_male_naiqimengwa_uranus_bigtts';

  const body = JSON.stringify({
    text: text,
    voice_type: voiceType,
    audio_config: {
      format: 'mp3',
      sample_rate: 24000,
      speech_rate: 1.0
    }
  });

  const options = {
    hostname: 'sami.bytedance.com',
    port: 443,
    path: `/api/text_to_speech?appkey=${encodeURIComponent(SAMI_APPKEY)}&token=${encodeURIComponent(token)}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const result = await httpsRequest(options, body, 15000);

  if (result.statusCode !== 200) {
    throw new Error(`TTS API返回错误: ${result.statusCode}, ${result.body}`);
  }

  try {
    const data = JSON.parse(result.body);
    if (data.code !== 0) {
      throw new Error(`TTS失败: code=${data.code}, message=${data.msg || '未知错误'}, body=${result.body}`);
    }
    return data.data.audio;
  } catch (e) {
    throw new Error('解析TTS响应失败: ' + e.message);
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
      const audioBase64 = await getTtsAudio(text, speaker);
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