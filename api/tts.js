const https = require('https');

const TTS_APPID = process.env.VOLC_ASR_APPID || process.env.VOLC_SAMI_APPKEY;
const TTS_TOKEN = process.env.VOLC_ASR_TOKEN || process.env.VOLC_SAMI_TOKEN;

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
  if (!TTS_APPID || !TTS_TOKEN) {
    throw new Error('未配置语音服务');
  }

  const voiceType = speaker || 'BV700_streaming';

  const body = JSON.stringify({
    app: {
      appid: TTS_APPID,
      token: 'access_token',
      cluster: 'volcano_tts'
    },
    user: {
      uid: 'xiaomianao_user'
    },
    audio: {
      voice: 'other',
      voice_type: voiceType,
      encoding: 'mp3',
      speed_ratio: 1.0,
      volume_ratio: 1.0,
      pitch_ratio: 1.0
    },
    request: {
      reqid: Date.now().toString(36) + Math.random().toString(36).substring(2, 8),
      text: text,
      text_type: 'plain',
      operation: 'query'
    }
  });

  const options = {
    hostname: 'openspeech.bytedance.com',
    port: 443,
    path: '/tts_middle_layer/tts',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer;' + TTS_TOKEN,
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const result = await httpsRequest(options, body, 15000);

  if (result.statusCode !== 200) {
    throw new Error(`TTS API返回错误: ${result.statusCode}`);
  }

  try {
    const data = JSON.parse(result.body);
    if (data.code !== 3000) {
      throw new Error(data.message || 'TTS失败');
    }
    return data.data;
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
