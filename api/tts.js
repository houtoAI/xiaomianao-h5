const https = require('https');
const crypto = require('crypto');

const TTS_APP_ID = process.env.VOLC_TTS_APP_ID;
const TTS_ACCESS_KEY = process.env.VOLC_TTS_ACCESS_KEY;

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

async function getTtsAudio(text, speaker) {
  if (!TTS_APP_ID || !TTS_ACCESS_KEY) {
    throw new Error('未配置语音服务密钥: VOLC_TTS_APP_ID 或 VOLC_TTS_ACCESS_KEY');
  }

  const voiceType = speaker || 'zh_male_naiqimengwa_uranus_bigtts';
  const reqid = crypto.randomUUID();

  const body = JSON.stringify({
    app: {
      appid: TTS_APP_ID,
      token: 'access_token',
      cluster: 'volcano_tts'
    },
    user: {
      uid: 'xiaomianao_user'
    },
    audio: {
      voice_type: voiceType,
      encoding: 'mp3',
      speed_ratio: 1.0,
      volume_ratio: 1.0,
      pitch_ratio: 1.0
    },
    request: {
      reqid: reqid,
      text: text,
      text_type: 'plain',
      operation: 'query'
    }
  });

  const options = {
    hostname: 'openspeech.bytedance.com',
    port: 443,
    path: '/api/v1/tts',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer;' + TTS_ACCESS_KEY,
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const result = await httpsRequest(options, body, 15000);

  if (result.statusCode !== 200) {
    throw new Error('TTS API返回错误: ' + result.statusCode + ', ' + result.body);
  }

  try {
    const data = JSON.parse(result.body);
    if (data.code !== 3000) {
      throw new Error('TTS失败: code=' + data.code + ', message=' + (data.message || '未知错误'));
    }
    return data.data;
  } catch (e) {
    throw new Error('解析TTS响应失败: ' + e.message + ', body=' + result.body.substring(0, 200));
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
