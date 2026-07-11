const https = require('https');

const ASR_APPID = process.env.VOLC_SAMI_APPKEY;
const ASR_TOKEN = process.env.VOLC_SAMI_TOKEN;

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

async function recognizeSpeech(audioBase64) {
  if (!ASR_APPID || !ASR_TOKEN) {
    throw new Error('未配置语音服务');
  }

  const body = JSON.stringify({
    app: {
      appid: ASR_APPID,
      token: 'access_token',
      cluster: 'volcano_asr'
    },
    user: {
      uid: 'xiaomianao_user'
    },
    audio: {
      format: 'wav',
      sample_rate: 16000,
      language: 'zh'
    },
    request: {
      reqid: Date.now().toString(36) + Math.random().toString(36).substring(2, 8),
      audio: audioBase64,
      operation: 'query'
    }
  });

  const options = {
    hostname: 'openspeech.bytedance.com',
    port: 443,
    path: '/api/v1/asr',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer;' + ASR_TOKEN,
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const result = await httpsRequest(options, body, 15000);

  if (result.statusCode !== 200) {
    throw new Error(`ASR API返回错误: ${result.statusCode}`);
  }

  try {
    const data = JSON.parse(result.body);
    if (data.code !== 3000) {
      throw new Error(data.message || 'ASR失败');
    }
    return data.data.result;
  } catch (e) {
    throw new Error('解析ASR响应失败: ' + e.message);
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
        let chunks = [];
        req.on('data', chunk => { chunks.push(chunk); });
        req.on('end', () => {
          try {
            const buffer = Buffer.concat(chunks);
            const contentType = req.headers['content-type'];
            
            if (contentType && contentType.includes('audio/wav')) {
              const base64 = buffer.toString('base64');
              resolve({ audio: base64 });
            } else {
              const jsonStr = buffer.toString('utf-8');
              resolve(JSON.parse(jsonStr));
            }
          } catch (e) {
            reject(e);
          }
        });
      });

      const audio = body.audio || '';
      const text = await recognizeSpeech(audio);

      res.status(200).json({ text, success: true });
    } catch (error) {
      console.error('ASR失败:', error);
      res.status(500).json({ error: error.message });
    }
    return;
  }

  res.status(404).json({ error: 'Not Found' });
};
