const http = require('http');
const https = require('https');
const crypto = require('crypto');

const ARK_API_KEY = process.env.VOLC_ARK_API_KEY;
const ARK_MODEL = process.env.VOLC_ARK_MODEL || 'doubao-1-5-lite-32k-250115';
const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com';

const DAILY_CHAT_LIMIT = 20;
const chatUsageMap = new Map();

function checkChatLimit(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${userId}_${today}`;
  const count = chatUsageMap.get(key) || 0;
  return { count, limit: DAILY_CHAT_LIMIT, remaining: Math.max(0, DAILY_CHAT_LIMIT - count) };
}

function incrementChatCount(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${userId}_${today}`;
  const count = (chatUsageMap.get(key) || 0) + 1;
  chatUsageMap.set(key, count);
  return count;
}

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

async function proxyArkChat(messages, model, apiKey) {
  const key = apiKey || ARK_API_KEY;
  if (!key) {
    throw new Error('未配置API Key');
  }

  const url = `${ARK_BASE_URL}/v3/chat/completions`;
  const parsedUrl = new URL(url);

  const body = JSON.stringify({
    model: model || ARK_MODEL,
    messages: messages,
    temperature: 0.7,
    max_tokens: 500,
    stream: false
  });

  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const result = await httpsRequest(options, body, 30000);
  
  if (result.statusCode !== 200) {
    throw new Error(`方舟API返回错误: ${result.statusCode}`);
  }

  try {
    return JSON.parse(result.body);
  } catch (e) {
    throw new Error('解析方舟API响应失败');
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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

      const messages = body.messages || [];
      const userId = body.userId || 'anonymous';

      const usage = checkChatLimit(userId);
      if (usage.count >= usage.limit) {
        res.status(429).json({ error: '今日对话次数已用完', count: usage.count, limit: usage.limit });
        return;
      }

      const result = await proxyArkChat(messages, body.model);
      incrementChatCount(userId);

      res.status(200).json(result);
    } catch (error) {
      console.error('代理请求失败:', error);
      res.status(500).json({ error: error.message });
    }
    return;
  }

  res.status(404).json({ error: 'Not Found' });
};