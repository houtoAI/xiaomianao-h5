// 小棉袄 H5版 - 主程序（火山引擎版）

// ============ 配置 ============
const DEFAULT_CONFIG = {
  wakeWords: ['小棉袄', '小棉祆', '小绵袄'],
  endPhrases: ['再见', '拜拜', '挂了', '不聊了'],
  voiceSpeed: 1.0,
  speaker: 'BV700_streaming'
};

// ============ 状态 ============
let state = {
  messages: [],
  isVoiceServiceEnabled: false,
  isListening: false,
  isSpeaking: false,
  isProcessing: false,
  standbyMode: false,
  welcomeMode: true,
  showMoreMenu: false,
  showSettings: false,
  config: { ...DEFAULT_CONFIG },
  conversationHistory: [],
  currentAudio: null,
  currentAudioUrl: null,
  userName: '',
  askingUserName: false,
  askingMedicine: false,
  medicineReminder: null, // { medicines: ['降压药','降糖药'], times: ['08:00','20:00'] }
  medicineAlerting: false, // 正在吃药提醒中，等待用户回复
  medicineAlertedToday: { date: '', alerted: {} }, // 持久化今日已提醒记录
  medicineAlertInterval: null, // 重复提醒定时器
  medicineCheckerInterval: null, // 定时检查定时器
  familyPhone: null, // 儿女电话号码
  askingFamilyPhone: false, // 正在询问儿女电话
  askingCallConfirm: false, // 正在询问是否拨打电话
  askingCity: false, // 正在询问所在城市
  navigation: null,
  dailyChatCount: 0, // 今日已用对话次数
  dailyChatLimit: 20 // 每日对话上限
};

// ============ 用户标识（用于每日对话限制） ============
function getUserId() {
  let uid = localStorage.getItem('xiaomianao_uid');
  if (!uid) {
    // 生成随机UUID
    uid = 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
    localStorage.setItem('xiaomianao_uid', uid);
  }
  return uid;
}

function getDailyCountKey() {
  const today = new Date().toISOString().slice(0, 10);
  return 'xiaomianao_count_' + today;
}

// 清理过期的localStorage数据（启动时执行一次）
function cleanExpiredStorage() {
  const today = new Date().toISOString().slice(0, 10);
  const keysToRemove = [];

  // 检查所有xiaomianao相关的key
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('xiaomianao_count_')) {
      const dateInKey = key.replace('xiaomianao_count_', '');
      if (dateInKey !== today) {
        keysToRemove.push(key);
      }
    }
  }

  // 删除过期数据
  keysToRemove.forEach(key => {
    localStorage.removeItem(key);
    console.log('清理过期数据:', key);
  });
}

function getDailyChatCount() {
  const key = getDailyCountKey();
  const saved = localStorage.getItem(key);
  return saved ? parseInt(saved, 10) : 0;
}

function addDailyChatCount() {
  const key = getDailyCountKey();
  const count = getDailyChatCount() + 1;
  localStorage.setItem(key, count.toString());
  state.dailyChatCount = count;
  updateCountHint();
  return count;
}

function isChatLimitReached() {
  return getDailyChatCount() >= state.dailyChatLimit;
}

function updateCountHint() {
  const remaining = state.dailyChatLimit - getDailyChatCount();
  const hintEl = document.getElementById('countHint');
  if (hintEl) {
    if (remaining <= 0) {
      hintEl.textContent = '今日对话已用完';
      hintEl.style.color = '#e74c3c';
    } else if (remaining <= 5) {
      hintEl.textContent = `今日还可聊${remaining}次`;
      hintEl.style.color = '#e67e22';
    } else {
      hintEl.textContent = `今日还可聊${remaining}次`;
      hintEl.style.color = '#999';
    }
  }
}

// ============ DOM元素 ============
const $ = id => document.getElementById(id);
let chatArea, messageList, welcomePage;
let micBtn, pulseRing1, pulseRing2;
let recognizedText, voiceHint, endTip;
let moreBtn, moreMenu, overlay;
let settingsBtn, settingsModal, settingsClose, saveSettingsBtn;
let homeBtn;

// ============ 录音 (MediaRecorder API) ============
let mediaStream = null;

async function initRecorder() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true
      }
    });
    console.log('麦克风初始化成功');
    return true;
  } catch (e) {
    console.error('麦克风初始化失败:', e);
    alert('请允许麦克风权限才能使用语音功能');
    return false;
  }
}

// ============ 语音识别 (浏览器Web Speech API) ============
let speechRecognition = null;

function initSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    console.log('浏览器不支持Web Speech API');
    return false;
  }
  
  speechRecognition = new SR();
  speechRecognition.lang = 'zh-CN';
  speechRecognition.continuous = false;
  speechRecognition.interimResults = true;
  
  console.log('Web Speech API 初始化成功');
  return true;
}

// 初始化
initSpeechRecognition();

// ============ 统一音频引擎（VAD + 服务端ASR） ============
const audioEngine = {
  audioContext: null,
  source: null,
  scriptProcessor: null,
  gainNode: null,
  pcmData: [],
  isRunning: false,
  mode: 'standby', // standby | conversation | interrupt
  vadState: {
    started: false,
    speechStartTime: 0,
    lastSpeakTime: 0,
    speechFrameCount: 0,
  },
  sampleCount: 0,
  noSpeechTimeout: 5000,
  silenceStopDuration: 500,
  maxSpeechDuration: 30000,
  silenceThreshold: 0.012,
  speechStartFrames: 3,
  wakeWords: DEFAULT_CONFIG.wakeWords,
};

async function initAudioEngine() {
  if (!mediaStream) {
    const ok = await initRecorder();
    if (!ok) return false;
  }
  
  if (audioEngine.audioContext) return true;
  
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext({ sampleRate: 16000 });
    const source = ctx.createMediaStreamSource(mediaStream);
    const scriptProcessor = ctx.createScriptProcessor(2048, 1, 1);
    const gainNode = ctx.createGain();
    gainNode.gain.value = 0;
    
    scriptProcessor.onaudioprocess = onAudioProcess;
    
    audioEngine.audioContext = ctx;
    audioEngine.source = source;
    audioEngine.scriptProcessor = scriptProcessor;
    audioEngine.gainNode = gainNode;
    
    console.log('音频引擎初始化成功, 采样率:', ctx.sampleRate);
    return true;
  } catch (e) {
    console.error('音频引擎初始化失败:', e);
    return false;
  }
}

function startAudioEngine(mode) {
  if (audioEngine.isRunning) {
    audioEngine.mode = mode;
    audioEngine.pcmData = [];
    audioEngine.vadState = { started: false, speechStartTime: 0, lastSpeakTime: 0, speechFrameCount: 0 };
    audioEngine.sampleCount = 0;
    return;
  }
  
  audioEngine.mode = mode;
  audioEngine.pcmData = [];
  audioEngine.vadState = { started: false, speechStartTime: 0, lastSpeakTime: 0, speechFrameCount: 0 };
  audioEngine.sampleCount = 0;
  
  audioEngine.source.connect(audioEngine.scriptProcessor);
  audioEngine.scriptProcessor.connect(audioEngine.gainNode);
  audioEngine.gainNode.connect(audioEngine.audioContext.destination);
  
  if (audioEngine.audioContext.state === 'suspended') {
    audioEngine.audioContext.resume();
  }
  
  audioEngine.isRunning = true;
}

function stopAudioEngine() {
  if (!audioEngine.isRunning) return;
  
  try {
    audioEngine.scriptProcessor.disconnect();
    audioEngine.source.disconnect();
    audioEngine.gainNode.disconnect();
  } catch (e) {}
  
  audioEngine.isRunning = false;
  audioEngine.pcmData = [];
  console.log('音频引擎停止');
}

function onAudioProcess(event) {
  if (!audioEngine.isRunning) return;
  
  const channelData = event.inputBuffer.getChannelData(0);
  audioEngine.pcmData.push(new Float32Array(channelData));
  
  let sum = 0;
  const len = channelData.length;
  for (let i = 0; i < len; i++) {
    sum += channelData[i] * channelData[i];
  }
  const rms = Math.sqrt(sum / len);
  audioEngine.sampleCount += len;
  const now = Date.now();
  const vad = audioEngine.vadState;
  
  if (!vad.started) {
    if (rms > audioEngine.silenceThreshold) {
      vad.speechFrameCount++;
      if (vad.speechFrameCount >= audioEngine.speechStartFrames) {
        vad.started = true;
        vad.speechStartTime = now;
        vad.lastSpeakTime = now;
        vad.speechFrameCount = 0;
        console.log('VAD: 语音开始, rms=' + rms.toFixed(4));
        
        if (audioEngine.mode === 'conversation') {
          voiceHint.innerHTML = '<span>正在听您说话...</span>';
        }
        
        if (audioEngine.mode === 'interrupt') {
          console.log('TTS打断模式：检测到语音，立即停止TTS');
          stopSpeaking();
          audioEngine.mode = 'conversation';
          voiceHint.innerHTML = '<span>正在听您说话...</span>';
          state.isVoiceServiceEnabled = true;
          endTip.style.display = 'block';
          updateMicButton();
        }
      }
    } else {
      vad.speechFrameCount = 0;
    }
    
    const noSpeechSamples = 16000 * (audioEngine.noSpeechTimeout / 1000);
    if (audioEngine.sampleCount > noSpeechSamples && !vad.started) {
      if (audioEngine.mode === 'standby' || audioEngine.mode === 'interrupt') {
        audioEngine.pcmData = [];
        audioEngine.sampleCount = 0;
      } else if (audioEngine.mode === 'conversation') {
        console.log('VAD: 对话超时无语音');
        stopConversationListening_timeout();
      }
    }
  } else {
    if (rms > audioEngine.silenceThreshold) {
      vad.lastSpeakTime = now;
    } else {
      if (vad.lastSpeakTime > 0 && (now - vad.lastSpeakTime) > audioEngine.silenceStopDuration) {
        console.log('VAD: 语音结束');
        onSpeechEnd();
      }
    }
    
    if (now - vad.speechStartTime > audioEngine.maxSpeechDuration) {
      console.log('VAD: 达到最大语音时长');
      onSpeechEnd();
    }
  }
}

function onSpeechEnd() {
  const wavBlob = createWavBlob(audioEngine.pcmData, 16000);
  const mode = audioEngine.mode;
  
  audioEngine.vadState = { started: false, speechStartTime: 0, lastSpeakTime: 0 };
  audioEngine.pcmData = [];
  audioEngine.sampleCount = 0;
  
  if (wavBlob.size < 2000) {
    console.log('语音太短，忽略');
    return;
  }
  
  if (mode === 'standby') {
    checkWakeWord(wavBlob);
  } else if (mode === 'conversation') {
    stopAudioEngine();
    recognizeAndProcess(wavBlob);
  }
}

function stopConversationListening_timeout() {
  stopAudioEngine();
  // 语音播报"没听清"，老人眼睛不好
  voiceHint.innerHTML = '<span>没听到您说话，再说一遍？</span>';
  if (state.isVoiceServiceEnabled) {
    speak('抱歉，我没有听清，可以再说一遍吗？');
    // 兜底：processSpeakQueue有超时机制会自动restartListening
    // 这里加一个20秒兜底，防止任何意外导致卡死
    setTimeout(() => {
      if (state.isVoiceServiceEnabled && !state.isListening && !state.isProcessing) {
        console.warn('没听清兜底：20秒后仍未重启监听，强制重启');
        restartListening();
      }
    }, 20000);
  }
}

async function checkWakeWord(wavBlob) {
  try {
    const text = await recognizeSpeech(wavBlob);
    console.log('待机模式ASR结果:', text);
    if (text && state.config.wakeWords.some(w => text.includes(w))) {
      console.log('唤醒词触发！');
      stopAudioEngine();
      onWakeWordDetected();
    }
  } catch (e) {
    console.log('待机模式ASR失败:', e.message);
  }
}

async function checkWakeWordInterrupt(wavBlob) {
  try {
    const text = await recognizeSpeech(wavBlob);
    console.log('打断模式ASR结果:', text);
    if (text && state.config.wakeWords.some(w => text.includes(w))) {
      console.log('唤醒词打断TTS！');
      stopAudioEngine();
      onWakeWordDetected();
    }
  } catch (e) {
    console.log('打断模式ASR失败:', e.message);
  }
}

async function recognizeAndProcess(wavBlob) {
  state.isListening = false;
  updateMicButton();
  showPulseRings(false);
  voiceHint.innerHTML = '<span>正在识别...</span>';
  
  try {
    const text = await recognizeSpeech(wavBlob);
    console.log('识别结果:', text);
    
    if (text && text.trim()) {
      recognizedText.textContent = text;
      recognizedText.classList.add('show');
      
      if (state.isVoiceServiceEnabled) {
        processUserMessage(text);
      }
    } else {
      voiceHint.innerHTML = '<span>没听清楚，请再说一遍</span>';
      if (state.isVoiceServiceEnabled) {
        speak('抱歉，我没有听清，可以再说一遍吗？');
        // 兜底：processSpeakQueue有超时机制会自动restartListening
        setTimeout(() => {
          if (state.isVoiceServiceEnabled && !state.isListening && !state.isSpeaking && !state.isProcessing) {
            restartListening();
          }
        }, 8000);
      }
    }
  } catch (e) {
    console.error('语音识别失败:', e);
    voiceHint.innerHTML = '<span>识别失败，请重试</span>';
    if (state.isVoiceServiceEnabled) {
      speak('抱歉，我没有听清，可以再说一遍吗？');
      // 兜底：processSpeakQueue有超时机制会自动restartListening
      setTimeout(() => {
        if (state.isVoiceServiceEnabled && !state.isListening && !state.isSpeaking && !state.isProcessing) {
          restartListening();
        }
      }, 8000);
    }
  }
}

// ============ 待机模式 ============
function startStandbyMode() {
  if (state.standbyMode) return;
  state.standbyMode = true;
  console.log('进入待机模式');
  
  voiceHint.innerHTML = '<span>说"小棉袄"开始对话</span>';
  showPulseRings(false);
  updateMicButton();
  
  initAudioEngine().then(ok => {
    if (ok) {
      startAudioEngine('standby');
    }
  });
}

function stopStandbyMode() {
  if (!state.standbyMode) return;
  state.standbyMode = false;
  console.log('退出待机模式');
  
  if (audioEngine.mode === 'standby') {
    stopAudioEngine();
  }
}

// ============ 唤醒词触发 ============
function onWakeWordDetected() {
  console.log('唤醒词触发！');
  
  if (state.isSpeaking) {
    console.log('打断TTS播放');
    stopSpeaking();
    state.isVoiceServiceEnabled = true;
    endTip.style.display = 'block';
    updateMicButton();
    voiceHint.innerHTML = '<span>我在呢，您说</span>';
    
    setTimeout(() => {
      startConversationListening();
    }, 200);
    return;
  }
  
  startVoiceService();
}

// ============ 对话模式录音 ============
function startConversationListening() {
  state.isListening = true;
  updateMicButton();
  showPulseRings(true);
  recognizedText.textContent = '';
  recognizedText.classList.remove('show');
  voiceHint.innerHTML = '<span>正在听您说话...</span>';

  initAudioEngine().then(ok => {
    if (ok) {
      // 如果AI正在说话，用interrupt模式，检测到语音会自动打断TTS
      const mode = state.isSpeaking ? 'interrupt' : 'conversation';
      console.log('启动录音模式:', mode, 'isSpeaking:', state.isSpeaking);
      startAudioEngine(mode);
    }
  });
}

function stopConversationListening() {
  if (audioEngine.isRunning && audioEngine.mode === 'conversation') {
    // 如果正在说话，提前结束
    if (audioEngine.vadState.started) {
      onSpeechEnd();
    } else {
      stopAudioEngine();
      state.isListening = false;
      updateMicButton();
      showPulseRings(false);
      voiceHint.innerHTML = '<span>点麦克风开始对话</span>';
    }
  }
}

async function startRecording() {
  startConversationListening();
}

function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Int16Array(buffer);
}

function createWavBlob(pcmChunks, sampleRate) {
  const totalLength = pcmChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const pcm16bit = new Int16Array(totalLength);
  let offset = 0;
  for (const chunk of pcmChunks) {
    const pcm = floatTo16BitPCM(chunk);
    pcm16bit.set(pcm, offset);
    offset += pcm.length;
  }
  
  const buffer = new ArrayBuffer(44 + pcm16bit.length * 2);
  const view = new DataView(buffer);
  
  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }
  
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcm16bit.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, pcm16bit.length * 2, true);
  
  for (let i = 0; i < pcm16bit.length; i++) {
    view.setInt16(44 + i * 2, pcm16bit[i], true);
  }
  
  return new Blob([view], { type: 'audio/wav' });
}

function stopRecording() {
  stopConversationListening();
}

async function restartListening() {
  if (state.isVoiceServiceEnabled && !state.isListening && !state.isSpeaking && !state.isProcessing) {
    recognizedText.textContent = '';
    recognizedText.classList.remove('show');
    await startRecording();
  }
}

// ============ 语音识别 (调用后端ASR代理) ============
async function recognizeSpeech(audioBlob) {
  const arrayBuffer = await audioBlob.arrayBuffer();
  
  const response = await fetch('/api/asr', {
    method: 'POST',
    headers: {
      'Content-Type': 'audio/wav'
    },
    body: arrayBuffer
  });
  
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '识别失败' }));
    throw new Error(err.error || `ASR请求失败: ${response.status}`);
  }
  
  const data = await response.json();
  return data.text || '';
}

// ============ 语音合成 (调用后端TTS代理) ============
// 语音播放队列：按顺序播放多条语音，不跳过
const speakQueue = [];
let isSpeakingNow = false;
let speakQueueRunning = false;
let stopSpeakRequested = false;
let currentTtsController = null;

async function speak(text) {
  if (!text || !text.trim()) return;

  // 如果已请求停止，先清除，让新语音能播放
  if (stopSpeakRequested) {
    stopSpeakRequested = false;
  }

  // 加入队列
  speakQueue.push(text);
  console.log('语音入队，队列长度:', speakQueue.length);

  // 如果没在运行，启动队列处理
  if (!speakQueueRunning) {
    processSpeakQueue();
  }
}

async function processSpeakQueue() {
  // 防止重入
  if (speakQueueRunning) return;
  speakQueueRunning = true;
  stopSpeakRequested = false;

  while (speakQueue.length > 0 && !stopSpeakRequested) {
    const text = speakQueue.shift();
    isSpeakingNow = true;
    state.isSpeaking = true;
    updateMicButton();
    voiceHint.innerHTML = '<span>小棉袄在说话...</span>';

    let playedOk = false;

    try {
      // TTS请求加超时（15秒），防止服务端不响应导致卡死
      const ttsController = new AbortController();
      currentTtsController = ttsController;
      const ttsTimeout = setTimeout(() => ttsController.abort(), 15000);
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text,
          speaker: state.config.speaker
        }),
        signal: ttsController.signal
      });
      clearTimeout(ttsTimeout);
      currentTtsController = null;

      // 检查是否已被打断
      if (stopSpeakRequested || !state.isSpeaking) {
        console.log('TTS返回后发现已被打断，跳过播放');
        break;
      }

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: '合成失败' }));
        throw new Error(err.error || `TTS请求失败: ${response.status}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      state.currentAudio = audio;
      state.currentAudioUrl = audioUrl;

      // 再次检查打断标志
      if (stopSpeakRequested || !state.isSpeaking) {
        URL.revokeObjectURL(audioUrl);
        state.currentAudio = null;
        state.currentAudioUrl = null;
        break;
      }

      let playFinished = false;
      let playTimeout = null;
      let canplayTimeout = null;
      let playStarted = false;

      const finishPlayback = () => {
        if (playFinished) return;
        playFinished = true;
        clearTimeout(playTimeout);
        clearTimeout(canplayTimeout);
        try {
          audio.pause();
          audio.currentTime = 0;
          audio.onended = null;
          audio.onerror = null;
          audio.oncanplay = null;
        } catch(e) {}
        URL.revokeObjectURL(audioUrl);
        if (state.currentAudio === audio) {
          state.currentAudio = null;
          state.currentAudioUrl = null;
        }
        playedOk = true;
      };

      audio.onended = finishPlayback;
      audio.onerror = finishPlayback;

      const startPlay = () => {
        if (playStarted || stopSpeakRequested) return;
        playStarted = true;
        clearTimeout(canplayTimeout);

        const playPromise = audio.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(err => {
            console.error('音频播放被阻止:', err);
            finishPlayback();
          });
        }

        // TTS开始播放后启动打断监听（VAD interrupt模式）
        // 延迟500ms，等TTS开头的能量过去
        if (state.isVoiceServiceEnabled) {
          setTimeout(() => {
            if (stopSpeakRequested || !state.isSpeaking || playFinished) return;
            initAudioEngine().then(ok => {
              if (ok && state.isSpeaking && !stopSpeakRequested && !playFinished) {
                // 启动interrupt模式，确保VAD状态完全重置
                startAudioEngine('interrupt');
                console.log('打断监听已启动 (interrupt模式)');
              }
            });
          }, 500);
        }
      };

      audio.oncanplay = startPlay;
      if (audio.readyState >= 2) {
        startPlay();
      }

      // canplay超时
      canplayTimeout = setTimeout(() => {
        if (!playStarted) {
          console.warn('音频canplay超时，跳过');
          finishPlayback();
        }
      }, 3000);

      // 总播放超时
      playTimeout = setTimeout(() => {
        console.warn('音频播放总超时，跳过');
        try { audio.pause(); } catch(e) {}
        finishPlayback();
      }, 30000);

      // 等待播放结束
      while (!playFinished && !stopSpeakRequested) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // 如果被打断，跳出循环
      if (stopSpeakRequested) {
        finishPlayback();
        break;
      }

    } catch (e) {
      console.error('语音合成失败:', e);

      if (stopSpeakRequested) break;

      // 降级到浏览器TTS
      if ('speechSynthesis' in window) {
        console.log('降级到浏览器语音合成');
        // 先确保Audio方式的音频已停止
        if (state.currentAudio) {
          try { state.currentAudio.pause(); } catch(e) {}
          state.currentAudio = null;
          state.currentAudioUrl = null;
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN';
        utterance.rate = state.config.voiceSpeed || 1.0;
        let ttsDone = false;
        const finishTts = () => {
          if (ttsDone) return;
          ttsDone = true;
          clearTimeout(browserTtsTimeout);
          playedOk = true;
        };
        utterance.onend = finishTts;
        utterance.onerror = finishTts;
        const browserTtsTimeout = setTimeout(finishTts, 10000);
        try {
          window.speechSynthesis.speak(utterance);
        } catch(e2) {
          finishTts();
        }

        // 等待浏览器TTS播放
        while (!ttsDone && !stopSpeakRequested) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (stopSpeakRequested) {
          try { window.speechSynthesis.cancel(); } catch(e) {}
          break;
        }
      } else {
        playedOk = true; // 没有TTS，也算处理完了
      }
    }
  }

  // 队列处理完毕
  isSpeakingNow = false;
  state.isSpeaking = false;
  updateMicButton();

  // 停止interrupt模式的音频引擎
  if (audioEngine.isRunning && audioEngine.mode === 'interrupt') {
    stopAudioEngine();
  }

  speakQueueRunning = false;

  if (state.isVoiceServiceEnabled && !stopSpeakRequested) {
    setTimeout(() => restartListening(), 500);
  } else if (!state.standbyMode && !stopSpeakRequested) {
    voiceHint.innerHTML = '<span>点麦克风开始对话</span>';
  }
}

function stopSpeaking() {
  // 设置停止标志，processSpeakQueue会检查并退出
  stopSpeakRequested = true;
  // 清空队列
  speakQueue.length = 0;
  isSpeakingNow = false;

  // 中止正在进行的TTS请求
  if (currentTtsController) {
    try { currentTtsController.abort(); } catch(e) {}
    currentTtsController = null;
  }

  // 浏览器TTS
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch(e) {}
  }
  // 停止音频元素播放
  if (state.currentAudio) {
    try {
      state.currentAudio.onended = null;
      state.currentAudio.onerror = null;
      state.currentAudio.oncanplay = null;
      state.currentAudio.pause();
      state.currentAudio.currentTime = 0;
    } catch(e) {}
    state.currentAudio = null;
  }
  if (state.currentAudioUrl) {
    try { URL.revokeObjectURL(state.currentAudioUrl); } catch(e) {}
    state.currentAudioUrl = null;
  }
  state.isSpeaking = false;
  updateMicButton();
}

// ============ AI对话 (调用后端大模型代理) ============
async function callAI(message) {
  // 检查每日对话限制
  if (isChatLimitReached()) {
    const limitMsg = '今天的聊天次数用完啦，明天再来找我聊天吧，好好休息哦。';
    addMessage('ai', limitMsg);
    if (state.isVoiceServiceEnabled) {
      await speak(limitMsg);
    }
    return limitMsg;
  }

  // 构造system prompt，包含用户称呼
  const userName = state.userName || '';
  let systemContent = '你是小棉袄，一个贴心的AI陪伴助手。你的用户是一位老人，你要用温暖、亲切、耐心的语气和他/她交流。就像亲孙女一样关心老人的生活、健康和心情。回答要简洁明了，不要用复杂的词汇。回复控制在100字以内。';
  if (userName) {
    systemContent += `请称呼用户为"${userName}"，每次回复时可以自然地用这个称呼，但不要每次都重复称呼。不要用其他称呼（如爷爷奶奶等），统一用"${userName}"。`;
  }

  const messages = [
    {
      role: 'system',
      content: systemContent
    },
    ...state.conversationHistory.slice(-10),
    { role: 'user', content: message }
  ];

  const response = await fetch('/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messages: messages,
      temperature: 0.7,
      max_tokens: 500,
      userId: getUserId() // 带上用户标识，服务端也做限制
    })
  });

  if (!response.ok) {
    // 服务端返回429表示超限
    if (response.status === 429) {
      const limitMsg = '今天的聊天次数用完啦，明天再来找我聊天吧，好好休息哦。';
      addMessage('ai', limitMsg);
      if (state.isVoiceServiceEnabled) {
        await speak(limitMsg);
      }
      return limitMsg;
    }
    const err = await response.json().catch(() => ({ error: '请求失败' }));
    throw new Error(err.error || `API请求失败: ${response.status}`);
  }
  
  const data = await response.json();
  if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
    console.error('AI返回数据异常:', data);
    throw new Error('AI返回数据格式异常');
  }
  const reply = data.choices[0].message.content.trim();

  // 保存对话历史
  state.conversationHistory.push({ role: 'user', content: message });
  state.conversationHistory.push({ role: 'assistant', content: reply });

  if (state.conversationHistory.length > 20) {
    state.conversationHistory = state.conversationHistory.slice(-20);
  }

  // 计数+1
  addDailyChatCount();

  return reply;
}

// ============ 意图识别 ============
function detectIntent(text) {
  const lowerText = text.toLowerCase();
  
  const navigationPatterns = [
    /^(带我去|我要去|帮我找|找一下|附近有没有|导航去|怎么去|怎么走)/,
    /(附近|最近的).*(厕所|卫生间|洗手间|药店|药房|医院|超市|商场|便利店|吃饭|餐馆|饭店|公交|车站|公园|银行)/,
    /(厕所|卫生间|洗手间|药店|药房|医院|超市|商场|便利店|吃饭|餐馆|饭店|公交|车站|公园|银行).*(在哪|在哪里|怎么走|怎么去|附近)/
  ];
  
  for (const pattern of navigationPatterns) {
    if (pattern.test(lowerText)) {
      return { type: 'navigation', text };
    }
  }
  
  const weatherPatterns = [/天气|气温|温度|下雨|晴天|阴天|刮风|下雪|冷不冷|热不热|穿什么/];
  if (weatherPatterns.some(p => p.test(lowerText))) {
    return { type: 'weather', text };
  }

  // 提醒吃药：重新设置/修改/查看
  const medicinePatterns = [/重新设置.*吃药|修改.*吃药|修改.*药名|改一下.*吃药|重新.*药名|吃什么药|吃药提醒|提醒吃药/];
  if (medicinePatterns.some(p => p.test(lowerText))) {
    return { type: 'medicine', text };
  }

  // 切换城市
  const cityPatterns = [/换.*城市|改.*城市|修改.*城市|我在.*城市|换个城市|改一下.*城市|不在这里|换到/];
  if (cityPatterns.some(p => p.test(lowerText))) {
    return { type: 'switchCity', text };
  }

  if (state.config.endPhrases.some(phrase => text.includes(phrase))) {
    return { type: 'end', text };
  }

  return { type: 'chat', text };
}

// ============ 导航功能 ============

// 计算两点之间的距离（米），Haversine公式
function calcDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// 解析location字符串 "lng,lat" -> [lng, lat]
function parseLocation(locStr) {
  if (!locStr) return null;
  const parts = locStr.split(',');
  if (parts.length !== 2) return null;
  const lng = parseFloat(parts[0]);
  const lat = parseFloat(parts[1]);
  if (isNaN(lng) || isNaN(lat)) return null;
  return [lng, lat];
}

function extractPOIKeyword(text) {
  const poiWords = ['厕所', '卫生间', '洗手间', '药店', '药房', '医院', '超市', '商场', '便利店', '餐馆', '饭店', '吃饭', '公交', '车站', '公园', '银行'];
  for (const word of poiWords) {
    if (text.includes(word)) {
      if (word === '卫生间' || word === '洗手间') return '厕所';
      if (word === '药房') return '药店';
      if (word === '饭店' || word === '吃饭') return '餐馆';
      if (word === '车站') return '公交站';
      return word;
    }
  }
  return '';
}

function getUserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lng = position.coords.longitude.toFixed(6);
        const lat = position.coords.latitude.toFixed(6);
        resolve(lng + ',' + lat);
      },
      (error) => {
        console.log('获取位置失败:', error.message);
        resolve(null);
      },
      { timeout: 5000, enableHighAccuracy: false }
    );
  });
}

async function handleNavigation(text) {
  state.isProcessing = true;
  
  try {
    const keyword = extractPOIKeyword(text);
    if (!keyword) {
      const reply = '您想去哪里呢？可以说"附近有厕所吗"或者"帮我找药店"';
      addMessage('ai', reply);
      if (state.isVoiceServiceEnabled) await speak(reply);
      return;
    }
    
    voiceHint.innerHTML = '<span>正在为您查找附近的' + keyword + '...</span>';
    const searchingText = '好的，我帮您找找附近的' + keyword;
    addMessage('ai', searchingText);
    if (state.isVoiceServiceEnabled) await speak(searchingText);
    
    // 获取用户位置
    const userLocation = await getUserLocation();
    console.log('用户位置:', userLocation);
    
    // 搜索POI
    const poiResp = await fetch('/api/nav/poi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: keyword, location: userLocation })
    });
    const poiData = await poiResp.json();
    console.log('POI结果:', poiData);
    
    if (!poiData.pois || poiData.pois.length === 0) {
      const reply = '抱歉，没有找到附近的' + keyword + '，您能再详细说说位置吗？';
      addMessage('ai', reply);
      if (state.isVoiceServiceEnabled) await speak(reply);
      return;
    }
    
    const nearest = poiData.pois[0];
    const poiReply = '找到了！最近的' + keyword + '是' + nearest.name + '，在' + (nearest.address || '') + '。我给您指路。';
    addMessage('ai', poiReply);
    if (state.isVoiceServiceEnabled) await speak(poiReply);
    
    // 获取步行路线
    voiceHint.innerHTML = '<span>正在规划步行路线...</span>';
    const origin = userLocation || '116.397428,39.90923';
    const routeResp = await fetch('/api/nav/walking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        origin: origin, 
        destination: nearest.location 
      })
    });
    const routeData = await routeResp.json();
    console.log('路线结果:', routeData);
    
    if (!routeData.steps || routeData.steps.length === 0) {
      const reply = '路线规划有点问题，不过' + nearest.name + '就在' + (nearest.address || '附近') + '，您看看周围应该能找到。';
      addMessage('ai', reply);
      if (state.isVoiceServiceEnabled) await speak(reply);
      return;
    }
    
    // 初始化逐步导航
    state.navigation = {
      steps: routeData.steps,
      currentStep: 0,
      destination: nearest.location,
      keyword: keyword,
      poiName: nearest.name,
      totalDistance: routeData.distance,
      totalDuration: routeData.duration,
      watchId: null,
      lastSpeakTime: 0,
      stepReached: false
    };
    
    const totalDuration = Math.round(routeData.duration / 60);
    let introText = '走路过去大约' + routeData.distance + '米';
    if (totalDuration > 0) {
      introText += '，需要' + totalDuration + '分钟';
    }
    introText += '。听好了，第一步：' + routeData.steps[0].instruction;
    addMessage('ai', introText);
    if (state.isVoiceServiceEnabled) await speak(introText);
    
    voiceHint.innerHTML = '<span>导航中：第1步/' + routeData.steps.length + '步</span>';
    
    // 启动位置监控
    startNavigationWatch();
    
  } catch (error) {
    console.error('导航失败:', error);
    const errorMsg = '导航出了点问题，您能再说一遍吗？';
    addMessage('ai', errorMsg);
    if (state.isVoiceServiceEnabled) await speak(errorMsg);
  } finally {
    state.isProcessing = false;
  }
}

// 启动导航位置监控
function startNavigationWatch() {
  if (!navigator.geolocation || !state.navigation) return;
  
  state.navigation.watchId = navigator.geolocation.watchPosition(
    onNavigationPositionUpdate,
    (error) => {
      console.log('导航位置监控错误:', error.message);
    },
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 2000 }
  );
}

// 导航位置更新处理
function onNavigationPositionUpdate(position) {
  if (!state.navigation) return;
  
  const nav = state.navigation;
  const userLng = position.coords.longitude;
  const userLat = position.coords.latitude;
  
  // 计算当前步骤的剩余距离
  const currentStep = nav.steps[nav.currentStep];
  if (!currentStep) {
    stopNavigation();
    return;
  }
  
  // 获取当前步骤目的地（用路线终点估算，或简化为每步的距离）
  // 简化方案：根据已走距离和总距离的比例估算当前进度
  // 更准确的方式：累积每步距离，找到当前应该在哪个步骤
  
  // 用一个简单的方法：
  // 每次定位时，计算离总目的地的距离
  // 然后根据已走的步骤总距离，判断是否到达当前步骤终点
  
  const destLoc = parseLocation(nav.destination);
  if (!destLoc) return;
  
  const distToDest = calcDistance(userLat, userLng, destLoc[1], destLoc[0]);
  console.log('导航: 距离目的地', Math.round(distToDest), '米, 当前步骤', nav.currentStep + 1, '/', nav.steps.length);
  
  // 计算已完成步骤的累积距离
  let completedDistance = 0;
  for (let i = 0; i < nav.currentStep; i++) {
    completedDistance += nav.steps[i].distance;
  }
  
  // 当前步骤距离
  const currentStepDistance = currentStep.distance;
  const totalStepsDistance = completedDistance + currentStepDistance;
  
  // 估算剩余距离（从总距离反向推算）
  const remainingEstimate = nav.totalDistance - completedDistance;
  const stepProgress = remainingEstimate - distToDest;
  
  // 如果接近当前步骤终点（剩余距离小于50米或进度超过80%），播报下一步
  const now = Date.now();
  const timeSinceLastSpeak = now - nav.lastSpeakTime;
  
  if (!nav.stepReached && (distToDest < (nav.totalDistance - totalStepsDistance + 50) || stepProgress > currentStepDistance * 0.8)) {
    nav.stepReached = true;

    // 到了最后一步
    if (nav.currentStep >= nav.steps.length - 1) {
      // 接近最终目的地
      if (distToDest < 50 && timeSinceLastSpeak > 5000) {
        nav.lastSpeakTime = now;
        const arriveText = '好了，快到了，' + nav.keyword + '就在您附近了！';
        addMessage('ai', arriveText);
        if (state.isVoiceServiceEnabled) speak(arriveText);
        stopNavigation();
        return; // 已结束导航，不再继续判断
      }
    } else {
      // 播报下一步
      if (timeSinceLastSpeak > 3000) {
        nav.lastSpeakTime = now;
        nav.currentStep++;
        nav.stepReached = false;
        const nextStep = nav.steps[nav.currentStep];
        const stepText = '好的，第' + (nav.currentStep + 1) + '步：' + nextStep.instruction;
        addMessage('ai', stepText);
        voiceHint.innerHTML = '<span>导航中：第' + (nav.currentStep + 1) + '步/' + nav.steps.length + '步</span>';
        if (state.isVoiceServiceEnabled) speak(stepText);
      }
    }
  }

  // 如果距离目的地非常近，结束导航
  if (distToDest < 20) {
    const arriveText = '到了！' + nav.poiName + '就在这里。';
    addMessage('ai', arriveText);
    if (state.isVoiceServiceEnabled) speak(arriveText);
    stopNavigation();
    return; // 已结束导航
  }
}

// 停止导航
function stopNavigation() {
  if (state.navigation && state.navigation.watchId !== null) {
    navigator.geolocation.clearWatch(state.navigation.watchId);
  }
  state.navigation = null;
  voiceHint.innerHTML = '<span>点麦克风开始对话</span>';
}

// ============ 天气查询 ============

async function handleWeather(text) {
  voiceHint.innerHTML = '<span>正在查询天气...</span>';

  // 识别用户问的是今天还是明天
  const askTomorrow = /明天|后天|明日/.test(text);
  const askToday = /今天|今日/.test(text);

  try {
    let city = '';

    // 1. 优先用本地保存的城市
    const savedCity = localStorage.getItem('xiaomianao_city');
    console.log('本地保存的城市:', savedCity);
    if (savedCity) {
      city = savedCity;
    } else {
      // 2. 没保存城市时尝试定位
      console.log('尝试获取定位...');
      const location = await getUserLocation();
      console.log('定位结果:', location);
      if (location) {
        const cityInfo = await getCityByLocation(location);
        city = cityInfo.city || '';
        console.log('逆地理编码得到城市:', city);
      }
    }

    // 3. 如果还是没有城市，主动问用户
    if (!city) {
      console.log('没有城市，询问用户');
      state.askingCity = true;
      const reply = '我没法获取您的位置，您在哪个城市呀？告诉我一下，我帮您查天气，以后就按这个城市报天气了。';
      addMessage('ai', reply);
      if (state.isVoiceServiceEnabled) {
        await speak(reply);
        setTimeout(() => startRecording(), 400);
      }
      return;
    }

    // 4. 查询天气
    console.log('查询天气, 城市:', city, '问明天:', askTomorrow);
    const weather = await fetchWeather(city);
    console.log('天气查询结果:', weather);
    localStorage.setItem('xiaomianao_city', city);

    // 5. 播报天气和提示
    let weatherText;
    if (askTomorrow) {
      // 只播报明天
      const tips = generateWeatherTips(weather.tomorrow);
      weatherText = formatWeatherTextOnly(weather, 'tomorrow', tips);
    } else {
      // 默认播报今天+明天
      const tips = generateWeatherTips(weather.today);
      weatherText = formatWeatherText(weather, tips);
    }
    addMessage('ai', weatherText);

    if (state.isVoiceServiceEnabled) {
      await speak(weatherText);
    } else {
      voiceHint.innerHTML = '<span>点麦克风开始对话</span>';
    }
  } catch (e) {
    console.error('天气查询失败:', e);
    // 天气查询失败时，清除已保存的城市，下次再问用户
    // 不再说"看看窗外"这种废话
    localStorage.removeItem('xiaomianao_city');
    state.askingCity = true;
    const errorMsg = '天气没查到，您在哪个城市呀？告诉我一下，我重新帮您查。';
    addMessage('ai', errorMsg);
    if (state.isVoiceServiceEnabled) {
      await speak(errorMsg);
      setTimeout(() => startRecording(), 400);
    }
  }
}

// 只格式化某一天（today 或 tomorrow）的天气
function formatWeatherTextOnly(weather, dayKey, tips) {
  const day = weather[dayKey] || {};
  const 称呼 = state.userName ? state.userName : '您';
  const dayLabel = dayKey === 'tomorrow' ? '明天' : '今天';

  let str = `${称呼}，${dayLabel}${weather.city || ''}的天气是${day.dayWeather || '未知'}`;
  if (day.nightWeather && day.nightWeather !== day.dayWeather) {
    str += `转${day.nightWeather}`;
  }
  str += `，白天${day.dayTemp || '?'}度，晚上${day.nightTemp || '?'}度`;
  if (day.dayWindDir) {
    str += `，${day.dayWindDir}${day.dayWind || ''}级`;
  }

  // 贴心提示
  if (tips && tips.length > 0) {
    str += '。' + tips.join(' ');
  }
  return str;
}

// 根据经纬度查询城市（逆地理编码）
async function getCityByLocation(location) {
  try {
    console.log('逆地理编码查询, location:', location);
    const response = await fetch('/api/nav/city', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: location })
    });

    if (!response.ok) throw new Error('城市查询失败');
    const data = await response.json();
    console.log('逆地理编码结果:', data);
    return data;
  } catch (e) {
    console.error('城市查询失败:', e);
    return { city: '' };
  }
}

// 调用天气API
async function fetchWeather(city) {
  try {
    const response = await fetch('/api/weather', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city })
    });

    if (!response.ok) throw new Error('天气API失败');
    const data = await response.json();
    return data;
  } catch (e) {
    console.error('天气API调用失败:', e);
    throw e;
  }
}

// 生成贴心提示
function generateWeatherTips(today) {
  const tips = [];
  const dayWeather = today.dayWeather || '';
  const dayTemp = parseInt(today.dayTemp, 10);
  const nightTemp = parseInt(today.nightTemp, 10);

  // 防御性：无效温度不报
  if (isNaN(dayTemp)) {
    return tips;
  }
  const validNight = isNaN(nightTemp) ? dayTemp : nightTemp;

  // 温度提示（先判断极端温度）
  if (dayTemp <= 5) {
    tips.push('今天很冷，出门要穿厚外套，戴帽子手套，别冻着了。');
  } else if (dayTemp <= 10) {
    tips.push('今天比较冷，多穿件衣服，注意保暖。');
  } else if (dayTemp >= 35) {
    tips.push('今天特别热，出门记得带个水瓶，多喝水防中暑。尽量避开中午最热的时候出门。');
  } else if (dayTemp >= 30) {
    tips.push('今天天气比较热，多喝水，注意防晒。');
  }

  // 天气现象提示（先判断更具体的）
  if (dayWeather.includes('暴雨') || dayWeather.includes('大雨')) {
    tips.push('今天雨很大，尽量别出门了，出门要带伞，注意安全，别走积水的地方。');
  } else if (dayWeather.includes('雷阵雨')) {
    tips.push('今天有雷阵雨，出门记得带伞，家里的衣服记得收回来，不适合晒被子，注意防雷。');
  } else if (dayWeather.includes('阵雨') || dayWeather.includes('雨')) {
    tips.push('今天有雨，出门记得带伞，家里的衣服记得收回来，不适合晒被子。');
  } else if (dayWeather.includes('雨夹雪') || dayWeather.includes('雪')) {
    tips.push('今天有雪，路可能滑，出门小心，穿防滑的鞋子。');
  } else if (dayWeather.includes('晴') && dayTemp >= 28) {
    tips.push('今天晴天，适合晒被子晒衣服，但要注意防晒。');
  } else if (dayWeather.includes('多云') || dayWeather.includes('阴')) {
    tips.push('今天多云或阴天，天气还不错，可以出去走走。');
  } else if (dayWeather.includes('雾') || dayWeather.includes('霾')) {
    tips.push('今天有雾或霾，空气质量不太好，出门记得戴口罩，尽量少在外面待太久。');
  }

  // 大风提示（独立判断，因为可能与其他天气同时出现）
  const windLevel = parseInt(today.dayWind, 10) || 0;
  if (dayWeather.includes('大风') || windLevel >= 5) {
    tips.push('今天风大，出门注意安全，别在树下或广告牌下面走。');
  }

  // 昼夜温差提示
  const tempDiff = dayTemp - validNight;
  if (tempDiff >= 10) {
    tips.push('今天早晚温差大，早晚出门多带件外套，别着凉了。');
  }

  return tips;
}

// 格式化天气播报文本
function formatWeatherText(weather, tips) {
  const today = weather.today || {};
  const tomorrow = weather.tomorrow || {};

  const 称呼 = state.userName ? state.userName : '您';

  // 今天天气
  let todayStr = `${称呼}，今天${weather.city || ''}的天气是${today.dayWeather || '未知'}`;
  if (today.nightWeather && today.nightWeather !== today.dayWeather) {
    todayStr += `转${today.nightWeather}`;
  }
  todayStr += `，白天${today.dayTemp || '?'}度，晚上${today.nightTemp || '?'}度`;
  if (today.dayWindDir) {
    todayStr += `，${today.dayWindDir}${today.dayWind || ''}级`;
  }

  // 明天天气
  let tomorrowStr = '明天';
  if (tomorrow.dayWeather) {
    tomorrowStr += tomorrow.dayWeather;
    if (tomorrow.nightWeather && tomorrow.nightWeather !== tomorrow.dayWeather) {
      tomorrowStr += `转${tomorrow.nightWeather}`;
    }
    tomorrowStr += `，白天${tomorrow.dayTemp || '?'}度，晚上${tomorrow.nightTemp || '?'}度`;
  } else {
    tomorrowStr += '天气信息暂无';
  }

  // 贴心提示
  let tipsStr = tips.length > 0 ? tips.join(' ') : '';

  return `${todayStr}。${tomorrowStr}。${tipsStr}`;
}

// ============ 消息处理 ============
function addMessage(role, content) {
  state.messages.push({ role, content, time: Date.now() });
  renderMessages();
  scrollToBottom();
  saveChatHistory();
}

function renderMessages() {
  messageList.innerHTML = '';
  
  state.messages.forEach(msg => {
    const msgEl = document.createElement('div');
    msgEl.className = `message ${msg.role}`;
    
    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';
    
    const avatar = document.createElement('div');
    avatar.className = 'avatar ' + (msg.role === 'ai' ? 'ai-avatar' : 'user-avatar');
    
    if (msg.role === 'ai') {
      const img = document.createElement('img');
      img.src = 'images/avatar.png';
      img.alt = '小棉袄';
      avatar.appendChild(img);
    } else {
      avatar.textContent = '👵';
    }
    
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = msg.content;
    
    if (msg.role === 'user') {
      contentEl.appendChild(bubble);
      contentEl.appendChild(avatar);
    } else {
      contentEl.appendChild(avatar);
      contentEl.appendChild(bubble);
    }
    
    msgEl.appendChild(contentEl);
    messageList.appendChild(msgEl);
  });
}

function scrollToBottom() {
  setTimeout(() => {
    chatArea.scrollTop = chatArea.scrollHeight;
  }, 100);
}

async function processUserMessage(text) {
  if (!text || !text.trim()) return;
  
  const trimmedText = text.trim();
  recognizedText.textContent = '';
  recognizedText.classList.remove('show');
  
  if (state.welcomeMode) {
    state.welcomeMode = false;
  }
  
  showChatPage();
  addMessage('user', trimmedText);
  
  if (state.askingUserName) {
    state.userName = trimmedText;
    state.askingUserName = false;
    localStorage.setItem('xiaomianao_user_name', trimmedText);
    // 清空对话历史，避免旧称呼残留
    state.conversationHistory = [];
    localStorage.setItem('xiaomianao_history', JSON.stringify(state.conversationHistory));

    const reply = '好的，' + trimmedText + '，以后我就叫您' + trimmedText + '了，有什么我能帮您的吗？';
    addMessage('ai', reply);

    if (state.isVoiceServiceEnabled) {
      await speak(reply);
    }
    return;
  }

  // 动态识别"叫我XX"模式：用户在对话中主动要求改称呼时，立即保存
  // 支持：叫我爷爷 / 以后叫我爷爷 / 叫我一声爷爷 / 你就叫我爷爷吧
  const callNameMatch = trimmedText.match(/^(?:以后|今后|以后都|以后就|那就|就)?\s*叫(?:我|俺)(?:一声|叫做)?\s*([\u4e00-\u9fa5A-Za-z]{1,6})(?:吧|好了|就行)?$/);
  if (callNameMatch) {
    const newName = callNameMatch[1].trim();
    // 过滤无意义词
    const blacklist = ['爷爷的', '奶奶的', '名字', '什么', '咋样', '如何'];
    if (!blacklist.includes(newName) && newName !== state.userName) {
      state.userName = newName;
      localStorage.setItem('xiaomianao_user_name', newName);
      // 清空对话历史，避免旧称呼残留导致AI又用回旧称呼
      state.conversationHistory = [];
      localStorage.setItem('xiaomianao_history', JSON.stringify(state.conversationHistory));
      console.log('动态更新用户称呼:', newName, '，已清空对话历史');
      const reply = '好的，以后我就叫您' + newName + '了，您说吧，' + newName + '。';
      addMessage('ai', reply);
      if (state.isVoiceServiceEnabled) {
        await speak(reply);
      }
      return;
    }
  }

  // 提醒吃药：解析用户报的药名和时间
  if (state.askingMedicine) {
    const parsed = parseMedicineReminder(trimmedText);
    if (parsed.medicines.length === 0 && parsed.times.length === 0) {
      const reply = '我没听清药名和时间，请您再说一遍，比如：我吃降压药和降糖药，早上8点和晚上8点';
      addMessage('ai', reply);
      if (state.isVoiceServiceEnabled) {
        await speak(reply);
      }
      return;
    }

    state.askingMedicine = false;
    state.medicineReminder = parsed;
    localStorage.setItem('xiaomianao_medicine', JSON.stringify(parsed));

    const reply = formatMedicineReminder(parsed, state.userName);
    addMessage('ai', reply);
    if (state.isVoiceServiceEnabled) {
      await speak(reply);
    }

    // 保存后立即启动定时器
    startMedicineChecker();
    return;
  }

  // 联系儿女：解析电话号码
  if (state.askingFamilyPhone) {
    const phone = parsePhoneNumber(trimmedText);
    if (!phone) {
      const reply = '我没听清电话号码，请再说一遍，比如：13812345678';
      addMessage('ai', reply);
      if (state.isVoiceServiceEnabled) {
        await speak(reply);
      }
      return;
    }

    state.askingFamilyPhone = false;
    state.familyPhone = phone;
    localStorage.setItem('xiaomianao_family_phone', phone);

    const reply = `好的，电话号码${phone}已经记下来了，下次点击联系儿女就可以直接拨打。`;
    addMessage('ai', reply);
    if (state.isVoiceServiceEnabled) {
      await speak(reply);
    }
    return;
  }

  // 联系儿女：确认拨打
  if (state.askingCallConfirm) {
    state.askingCallConfirm = false;
    const yesWords = ['是', '好的', '行', '可以', '拨打', '打', '嗯', '哦', '要', '对'];
    if (yesWords.some(w => trimmedText.includes(w))) {
      const reply = '好的，正在为您拨打电话...';
      addMessage('ai', reply);
      if (state.isVoiceServiceEnabled) {
        await speak(reply);
      }
      // 拨打电话
      makePhoneCall(state.familyPhone);
    } else {
      const reply = '好的，不拨打。';
      addMessage('ai', reply);
      if (state.isVoiceServiceEnabled) {
        await speak(reply);
      }
    }
    return;
  }

  // 天气查询：用户回答所在城市
  if (state.askingCity) {
    // 先检测用户是否切换到了其他意图（如导航、提醒吃药、联系儿女、问天气等）
    // 如果是，清除askingCity标志，让流程继续走正常意图识别
    const switchIntent = detectIntent(trimmedText);
    const isSwitchAway = (
      switchIntent.type === 'navigation' ||
      switchIntent.type === 'medicine' ||
      switchIntent.type === 'end' ||
      // 联系儿女
      /联系.*(儿女|儿子|女儿|孩子)|打.*(电话|手机)|给.*(儿子|女儿|孩子).*打/.test(trimmedText) ||
      // 主动取消/换话题
      /^(算了|不查了|不想查|换个话题|不说了|没事|不用了)/.test(trimmedText)
    );
    // 注意：weather意图不切换，因为"问天气"本身可能被识别为weather，但用户其实是在回答城市
    // 只有明确的非天气意图才切换
    if (isSwitchAway) {
      console.log('用户切换了意图，清除askingCity标志:', switchIntent.type);
      state.askingCity = false;
      // 不return，继续走下面的正常意图流程
    } else {
      // 提取城市名：去掉"市"字、常见前缀
      let city = trimmedText
        .replace(/市$/, '')
        .replace(/^(我在|我住在|住在|我在|我|在)/, '')
        .replace(/(这里|这里附近|这附近|这儿|这里)$/, '')
        .trim();
      // 城市名应该是2-7个字，不包含"附近"、"厕所"等明显非城市词
      const nonCityKeywords = ['附近', '厕所', '药店', '医院', '超市', '导航', '天气', '吃药', '提醒', '电话'];
      const looksLikeCity = city.length >= 2 && city.length <= 7 && !nonCityKeywords.some(kw => city.includes(kw));

      if (!city || !looksLikeCity) {
        const reply = '没听清您在哪个城市，请再说一遍，比如：我在北京，或者我在深圳';
        addMessage('ai', reply);
        if (state.isVoiceServiceEnabled) {
          await speak(reply);
          setTimeout(() => startRecording(), 400);
        }
        return;
      }

      state.askingCity = false;
      localStorage.setItem('xiaomianao_city', city);

      // 直接查询该城市天气
      try {
        const weather = await fetchWeather(city);
        const tips = generateWeatherTips(weather.today);
        const weatherText = formatWeatherText(weather, tips);
        addMessage('ai', weatherText);
        if (state.isVoiceServiceEnabled) {
          await speak(weatherText);
        }
      } catch (e) {
        const reply = `好的，已经记下您在${city}，但天气查询暂时失败，下次再帮您查。`;
        addMessage('ai', reply);
        if (state.isVoiceServiceEnabled) {
          await speak(reply);
        }
      }
      return;
    }
  }

  // 吃药提醒中：检测用户确认回复
  if (state.medicineAlerting) {
    const ackWords = ['吃了', '吃过了', '吃完了', '吃了药', '知道了', '好的', '收到', '嗯', '哦', '行', '放心'];
    if (ackWords.some(w => trimmedText.includes(w))) {
      acknowledgeMedicineAlert();
      return;
    }
    // 用户说了别的，再提醒一次
    const medStr = state.medicineReminder.medicines.join('和');
    const称呼 = state.userName ? state.userName : '您';
    const remindMsg = `${称呼}，先吃药吧，记得吃${medStr}，吃了告诉我一声哦。`;
    addMessage('ai', remindMsg);
    if (state.isVoiceServiceEnabled) {
      await speak(remindMsg);
    }
    return;
  }

  const intent = detectIntent(trimmedText);
  console.log('意图:', intent.type);
  
  if (intent.type === 'end') {
    console.log('用户说再见，回到待机模式');
    stopVoiceService();
    return;
  }
  
  if (intent.type === 'navigation') {
    console.log('导航请求:', trimmedText);
    await handleNavigation(trimmedText);
    return;
  }

  if (intent.type === 'medicine') {
    console.log('吃药提醒请求:', trimmedText);
    await handleMedicineIntent(trimmedText);
    return;
  }

  if (intent.type === 'weather') {
    console.log('天气查询请求:', trimmedText);
    await handleWeather(trimmedText);
    return;
  }

  if (intent.type === 'switchCity') {
    console.log('切换城市请求:', trimmedText);
    state.askingCity = true;
    const oldCity = localStorage.getItem('xiaomianao_city') || '';
    const reply = oldCity
      ? `您原来设置的城市是${oldCity}，告诉我新城市名字吧，我帮您换。`
      : '您在哪个城市呀？告诉我城市名字，我帮您查天气。';
    addMessage('ai', reply);
    if (state.isVoiceServiceEnabled) {
      await speak(reply);
      setTimeout(() => startRecording(), 400);
    }
    return;
  }

  state.isProcessing = true;
  
  try {
    voiceHint.innerHTML = '<span>小棉袄正在思考...</span>';
    
    const reply = await callAI(trimmedText);
    addMessage('ai', reply);
    
    if (state.isVoiceServiceEnabled) {
      await speak(reply);
    } else {
      voiceHint.innerHTML = '<span>点麦克风开始对话</span>';
    }
  } catch (error) {
    console.error('处理消息失败:', error);
    const errorMsg = '不好意思，我现在有点累，您能再说一遍吗？';
    addMessage('ai', errorMsg);
    
    if (state.isVoiceServiceEnabled) {
      speak(errorMsg);
    }
  } finally {
    state.isProcessing = false;
  }
}

// ============ 语音服务控制 ============
async function toggleVoiceService() {
  // 如果正在聆听，停止录音（允许随时停止）
  if (state.isListening) {
    stopRecording();
    return;
  }
  
  // 如果正在说话，停止说话并开始聆听
  if (state.isSpeaking) {
    stopSpeaking();
    if (audioEngine.isRunning && audioEngine.mode === 'interrupt') {
      stopAudioEngine();
    }
    // 直接开始聆听（跳过欢迎语）
    if (!state.isVoiceServiceEnabled) {
      await startVoiceService_noWelcome();
    } else {
      setTimeout(() => startRecording(), 300);
    }
    return;
  }
  
  // 如果语音服务已启用，直接开始聆听
  if (state.isVoiceServiceEnabled) {
    await startRecording();
    return;
  }
  
  // 如果在待机模式，点击麦克风启动对话并开始聆听
  if (state.standbyMode) {
    stopStandbyMode();
  }
  
  // 首次启动语音服务
  await startVoiceService();
}

async function startVoiceService_noWelcome() {
  stopStandbyMode();
  
  const ok = await initAudioEngine();
  if (!ok) {
    startStandbyMode();
    return;
  }
  
  state.isVoiceServiceEnabled = true;
  state.welcomeMode = false;
  updateMicButton();
  endTip.style.display = 'block';
  showChatPage();
  
  await startRecording();
}

async function startVoiceService() {
  stopStandbyMode();
  
  const ok = await initAudioEngine();
  if (!ok) {
    startStandbyMode();
    return;
  }
  
  state.isVoiceServiceEnabled = true;
  state.welcomeMode = true;
  updateMicButton();
  endTip.style.display = 'block';
  showChatPage();
  
  if (!state.userName) {
    state.askingUserName = true;
    const welcomeText = '您好呀，我是小棉袄，想让我叫您什么呢？爷爷、奶奶，还是其他称呼？';
    addMessage('ai', welcomeText);
    speak(welcomeText);
  } else {
    const welcomeText = '您好呀' + state.userName + '，我是小棉袄，有什么我能帮您的吗？';
    addMessage('ai', welcomeText);
    speak(welcomeText);
  }
}

function goHome() {
  stopVoiceService();
  showHomePage();
}

function stopVoiceService() {
  state.isVoiceServiceEnabled = false;
  state.welcomeMode = false;
  stopRecording();
  stopSpeaking();
  if (audioEngine.isRunning && audioEngine.mode === 'interrupt') {
    stopAudioEngine();
  }
  updateMicButton();
  endTip.style.display = 'none';
  recognizedText.textContent = '';
  recognizedText.classList.remove('show');
  showPulseRings(false);
  
  startStandbyMode();
}

function updateMicButton() {
  micBtn.classList.remove('active', 'listening', 'speaking');
  
  if (state.isListening) {
    micBtn.classList.add('listening');
    micBtn.querySelector('.mic-icon').textContent = '⏹';
  } else {
    micBtn.querySelector('.mic-icon').textContent = '🎤';
  }
}

function showPulseRings(show) {
  pulseRing1.style.display = show ? 'block' : 'none';
  pulseRing2.style.display = show ? 'block' : 'none';
}

// ============ 快捷操作 ============
async function handleQuickAction(actionId) {
  // 提醒吃药：专门处理
  if (actionId === 'reminder') {
    if (!state.isVoiceServiceEnabled) {
      const ok = await initAudioEngine();
      if (!ok) return;
      state.isVoiceServiceEnabled = true;
      updateMicButton();
      endTip.style.display = 'block';
    }
    showChatPage();
    addMessage('user', '提醒吃药');

    if (state.medicineReminder && state.medicineReminder.medicines.length > 0) {
      // 已有保存的药名时间，直接播报日程
      const reply = formatMedicineReminder(state.medicineReminder, state.userName);
      addMessage('ai', reply);
      await speak(reply);
      // 播报完后继续监听，方便用户接着说"重新设置"等
      setTimeout(() => startRecording(), 400);
    } else {
      // 首次设置：询问药名和时间
      state.askingMedicine = true;
      const reply = '好的，您都吃什么药？需要几点提醒？请告诉我药名和时间，比如：我吃降压药和降糖药，早上8点和晚上8点';
      addMessage('ai', reply);
      await speak(reply);
      // 询问完直接进入监听
      setTimeout(() => startRecording(), 400);
    }
    return;
  }

  // 联系儿女：专门处理
  if (actionId === 'callFamily') {
    if (!state.isVoiceServiceEnabled) {
      const ok = await initAudioEngine();
      if (!ok) return;
      state.isVoiceServiceEnabled = true;
      updateMicButton();
      endTip.style.display = 'block';
    }
    showChatPage();
    addMessage('user', '联系儿女');

    if (state.familyPhone) {
      // 已有电话，询问是否拨打
      state.askingCallConfirm = true;
      const reply = `您儿女的电话是${state.familyPhone}，要拨打电话吗？`;
      addMessage('ai', reply);
      await speak(reply);
      setTimeout(() => startRecording(), 400);
    } else {
      // 首次设置：询问电话号码
      state.askingFamilyPhone = true;
      const reply = '您儿女的电话是多少？请告诉我电话号码，我帮您记下来，下次可以直接拨打。';
      addMessage('ai', reply);
      await speak(reply);
      setTimeout(() => startRecording(), 400);
    }
    return;
  }

  // 天气查询：专门处理
  if (actionId === 'weather') {
    if (!state.isVoiceServiceEnabled) {
      const ok = await initAudioEngine();
      if (!ok) return;
      state.isVoiceServiceEnabled = true;
      updateMicButton();
      endTip.style.display = 'block';
    }
    showChatPage();
    addMessage('user', '今天天气怎么样');
    await handleWeather('今天天气怎么样');
    return;
  }

  const actionMap = {
    healthFood: '给我推荐一个养生美食吧',
    toilet: '附近有厕所吗',
    pharmacy: '附近有药店吗'
  };

  const text = actionMap[actionId];
  if (text) {
    if (!state.isVoiceServiceEnabled) {
      state.isVoiceServiceEnabled = true;
      updateMicButton();
      endTip.style.display = 'block';
    }
    processUserMessage(text);
  }
}

// ============ 提醒吃药：解析与播报 ============
function parseMedicineReminder(text) {
  const result = { medicines: [], times: [] };

  // 1) 提取药名：匹配"XX药"，过滤掉"点药/些药/点药/这药"等误识别
  const medRegex = /([\u4e00-\u9fa5A-Za-z0-9]{1,8}药)/g;
  const medBlacklist = ['点药', '些药', '这药', '那药', '点药名', '种药', '个药', '的药', '吃药', '服药', '用药', '拿药', '买药', '找药'];
  let m;
  while ((m = medRegex.exec(text)) !== null) {
    const name = m[1];
    if (!medBlacklist.includes(name) && !result.medicines.includes(name)) {
      result.medicines.push(name);
    }
  }

  // 2) 提取"X点半"（先处理，避免被普通timeRegex误匹配为X点）
  const halfRegex = /(早上|上午|中午|下午|晚上|晚|清晨|早)?\s*(\d{1,2})\s*点半/g;
  const halfMatchedRanges = [];
  while ((m = halfRegex.exec(text)) !== null) {
    halfMatchedRanges.push([halfRegex.lastIndex - m[0].length, halfRegex.lastIndex]);
    let hour = parseInt(m[2], 10);
    const tag = m[1] || '';
    if (tag === '下午' || tag === '晚上' || tag === '晚') {
      if (hour < 12) hour += 12;
    } else if (tag === '中午') {
      if (hour < 12) hour = 12;
    }
    if (hour >= 0 && hour < 24) {
      const t = `${String(hour).padStart(2, '0')}:30`;
      if (!result.times.includes(t)) {
        result.times.push(t);
      }
    }
  }

  // 3) 提取时间：支持 早上/上午/中午/下午/晚上/晚 + 数字点/点分
  //    跳过已被halfRegex匹配过的"X点半"中的"X点"
  const timeRegex = /(早上|上午|中午|下午|晚上|晚|清晨|早)?\s*(\d{1,2})\s*(?:点|:|：)\s*(\d{1,2})?\s*分?/g;
  while ((m = timeRegex.exec(text)) !== null) {
    const matchStart = timeRegex.lastIndex - m[0].length;
    const matchEnd = timeRegex.lastIndex;
    // 检查当前匹配是否落在halfRegex已匹配范围内
    const inHalf = halfMatchedRanges.some(([s, e]) => matchStart >= s && matchEnd <= e);
    if (inHalf) continue;

    let hour = parseInt(m[2], 10);
    const minute = m[3] ? parseInt(m[3], 10) : 0;
    const tag = m[1] || '';
    // 12小时制转换
    if (tag === '下午' || tag === '晚上' || tag === '晚') {
      if (hour < 12) hour += 12;
    } else if (tag === '中午') {
      if (hour < 12) hour = 12;
    } else if (tag === '早上' || tag === '清晨' || tag === '上午' || tag === '早') {
      // 上午不变
    } else {
      // 没有时段词，若数字>=12按原值，否则视为上午
    }
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
      const hh = String(hour).padStart(2, '0');
      const mm = String(minute).padStart(2, '0');
      const t = `${hh}:${mm}`;
      if (!result.times.includes(t)) {
        result.times.push(t);
      }
    }
  }

  // 时间排序
  result.times.sort();
  return result;
}

function formatMedicineReminder(parsed, userName) {
  const称呼 = userName ? userName : '您';
  if (parsed.medicines.length === 0 || parsed.times.length === 0) {
    return '还没有设置吃药提醒，您可以告诉我药名和时间，我帮您记下来。';
  }
  const medStr = parsed.medicines.join('和');
  const timeStr = parsed.times.map(t => {
    const [h, m] = t.split(':');
    const hour = parseInt(h, 10);
    let label = '';
    if (hour < 6) label = '凌晨';
    else if (hour < 11) label = '早上';
    else if (hour < 13) label = '中午';
    else if (hour < 18) label = '下午';
    else label = '晚上';
    const hh12 = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
    return m === '00' ? `${label}${hh12}点` : `${label}${hh12}点${m}分`;
  }).join('和');
  return `好的${称呼}，您每天吃${medStr}，提醒时间是${timeStr}，记得按时吃药哦。`;
}

// 语音"提醒吃药"类意图处理
async function handleMedicineIntent(text) {
  // 重新设置 / 修改
  if (/重新设置|修改|改一下|重新/.test(text)) {
    state.askingMedicine = true;
    stopMedicineChecker(); // 先停止旧定时器
    const reply = '好的，请重新告诉我药名和时间，比如：我吃降压药和降糖药，早上8点和晚上8点';
    addMessage('ai', reply);
    if (state.isVoiceServiceEnabled) {
      await speak(reply);
    }
    return;
  }

  // 查询
  if (state.medicineReminder && state.medicineReminder.medicines.length > 0) {
    const reply = formatMedicineReminder(state.medicineReminder, state.userName);
    addMessage('ai', reply);
    if (state.isVoiceServiceEnabled) {
      await speak(reply);
    }
  } else {
    state.askingMedicine = true;
    const reply = '您还没设置吃药提醒呢，请告诉我药名和时间，比如：我吃降压药和降糖药，早上8点和晚上8点';
    addMessage('ai', reply);
    if (state.isVoiceServiceEnabled) {
      await speak(reply);
    }
  }
}

// ============ 联系儿女：电话解析与拨打 ============

function parsePhoneNumber(text) {
  // 匹配11位手机号（以1开头）
  const mobileRegex = /1[3-9]\d{9}/g;
  const match = mobileRegex.exec(text);
  if (match) {
    return match[0];
  }

  // 匹配带分隔符的电话号码（如138-1234-5678）
  const sepRegex = /1[3-9]\d[\-\s]?\d{4}[\-\s]?\d{4}/g;
  const match2 = sepRegex.exec(text);
  if (match2) {
    // 去掉分隔符
    return match2[0].replace(/[\-\s]/g, '');
  }

  // 匹配座机号码（如0771-12345678）
  const landlineRegex = /0\d{2,3}[\-\s]?\d{7,8}/g;
  const match3 = landlineRegex.exec(text);
  if (match3) {
    return match3[0].replace(/[\-\s]/g, '');
  }

  return null;
}

function makePhoneCall(phoneNumber) {
  // 使用 tel: 链接拨打电话
  // 在手机浏览器中会调用系统拨号界面
  // 在电脑浏览器中可能无效果或提示
  const telLink = `tel:${phoneNumber}`;
  console.log('拨打电话:', telLink);

  // 创建一个隐藏的链接并点击
  const link = document.createElement('a');
  link.href = telLink;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // 提示用户
  setTimeout(() => {
    if (state.isVoiceServiceEnabled) {
      const称呼 = state.userName ? state.userName : '您';
      const tipMsg = `${称呼}，如果电话没拨出去，请检查手机是否支持拨号功能。`;
      addMessage('ai', tipMsg);
      speak(tipMsg);
    }
  }, 3000);
}

// ============ 吃药提醒：定时器与闹铃 ============

// 启动定时检查（每30秒检查一次当前时间是否匹配提醒时间）
function startMedicineChecker() {
  stopMedicineChecker(); // 先清除旧的

  if (!state.medicineReminder || state.medicineReminder.times.length === 0) return;

  console.log('启动吃药提醒定时器，提醒时间:', state.medicineReminder.times);

  // 初始化今日已提醒记录（持久化到localStorage）
  const today = new Date().toISOString().slice(0, 10);
  const savedAlert = JSON.parse(localStorage.getItem('xiaomianao_med_alerted') || '{}');
  if (savedAlert.date !== today) {
    state.medicineAlertedToday = { date: today, alerted: {} };
  } else {
    state.medicineAlertedToday = savedAlert;
  }

  state.medicineCheckerInterval = setInterval(() => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${hh}:${mm}`;
    const todayStr = now.toISOString().slice(0, 10);

    // 跨天检测：日期变化时清空今日已提醒记录
    if (state.medicineAlertedToday.date !== todayStr) {
      state.medicineAlertedToday = { date: todayStr, alerted: {} };
      localStorage.setItem('xiaomianao_med_alerted', JSON.stringify(state.medicineAlertedToday));
    }

    // 当前时间是否匹配某个提醒时间
    if (state.medicineReminder.times.includes(currentTime)) {
      // 今天这个时间点还没提醒过
      if (!state.medicineAlertedToday.alerted[currentTime]) {
        state.medicineAlertedToday.alerted[currentTime] = true;
        localStorage.setItem('xiaomianao_med_alerted', JSON.stringify(state.medicineAlertedToday));
        console.log('吃药提醒触发:', currentTime);
        triggerMedicineAlert();
      }
    }
  }, 30000); // 每30秒检查一次
}

function stopMedicineChecker() {
  if (state.medicineCheckerInterval) {
    clearInterval(state.medicineCheckerInterval);
    state.medicineCheckerInterval = null;
  }
}

// 触发吃药提醒闹铃
async function triggerMedicineAlert() {
  if (state.medicineAlerting) return; // 已经在提醒中了

  state.medicineAlerting = true;

  // 如果正在说话，先停掉
  if (state.isSpeaking) {
    stopSpeaking();
  }

  // 进入对话模式
  if (!state.isVoiceServiceEnabled) {
    const ok = await initAudioEngine();
    if (!ok) return;
    state.isVoiceServiceEnabled = true;
    updateMicButton();
    endTip.style.display = 'block';
  }

  showChatPage();

  const medStr = state.medicineReminder.medicines.join('和');
  const称呼 = state.userName ? state.userName : '您';
  const alertMsg = `${称呼}，该吃药了！记得吃${medStr}哦，吃了没有呀？`;
  addMessage('ai', alertMsg);
  await speak(alertMsg);

  // 启动重复提醒：每60秒再问一次
  startMedicineRepeatAlert();
}

// 重复提醒
function startMedicineRepeatAlert() {
  stopMedicineRepeatAlert();

  state.medicineAlertInterval = setInterval(async () => {
    if (!state.medicineAlerting) {
      stopMedicineRepeatAlert();
      return;
    }

    // 如果正在说话，等下次
    if (state.isSpeaking || state.isListening) return;

    const medStr = state.medicineReminder.medicines.join('和');
    const称呼 = state.userName ? state.userName : '您';
    const repeatMsg = `${称呼}，您吃药了吗？记得吃${medStr}哦！`;
    addMessage('ai', repeatMsg);
    await speak(repeatMsg);
  }, 60000); // 每60秒重复
}

function stopMedicineRepeatAlert() {
  if (state.medicineAlertInterval) {
    clearInterval(state.medicineAlertInterval);
    state.medicineAlertInterval = null;
  }
}

// 用户确认吃药，停止提醒
function acknowledgeMedicineAlert() {
  if (!state.medicineAlerting) return false;
  state.medicineAlerting = false;
  stopMedicineRepeatAlert();

  const称呼 = state.userName ? state.userName : '您';
  const ackMsg = `好的${称呼}，吃了就好，那我放心了。`;
  addMessage('ai', ackMsg);
  speak(ackMsg);
  return true;
}

// ============ 更多菜单 ============
function toggleMoreMenu() {
  state.showMoreMenu = !state.showMoreMenu;
  moreMenu.style.display = state.showMoreMenu ? 'block' : 'none';
  overlay.style.display = state.showMoreMenu ? 'block' : 'none';
}

function closeMoreMenu() {
  state.showMoreMenu = false;
  moreMenu.style.display = 'none';
  overlay.style.display = 'none';
}

// ============ 设置 ============
function openSettings() {
  closeMoreMenu();
  state.showSettings = true;
  settingsModal.style.display = 'flex';
  loadSettingsFromServer();
}

function closeSettings() {
  state.showSettings = false;
  settingsModal.style.display = 'none';
}

async function loadSettingsFromServer() {
  try {
    const response = await fetch('/api/config');
    const data = await response.json();
    
    $('volcArkApiKey').value = '';
    $('volcArkApiKey').placeholder = data.arkApiKey ? `已配置: ${data.arkApiKey}...` : '请输入火山引擎方舟API Key';
    $('volcArkModel').value = data.arkModel || '';
    $('volcSamiAppkey').value = '';
    $('volcSamiAppkey').placeholder = data.samiAppkey ? `已配置: ${data.samiAppkey}...` : '请输入语音服务AppKey';
    $('volcSamiToken').value = '';
    $('volcSamiToken').placeholder = data.samiConfigured ? '已配置（不显示）' : '请输入语音服务Token';
  } catch (e) {
    console.error('加载配置失败:', e);
  }
}

async function saveSettings() {
  const config = {};
  
  const arkApiKey = $('volcArkApiKey').value.trim();
  const arkModel = $('volcArkModel').value.trim();
  const samiAppkey = $('volcSamiAppkey').value.trim();
  const samiToken = $('volcSamiToken').value.trim();
  
  if (arkApiKey) config.arkApiKey = arkApiKey;
  if (arkModel) config.arkModel = arkModel;
  if (samiAppkey) config.samiAppkey = samiAppkey;
  if (samiToken) config.samiToken = samiToken;
  
  try {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    
    if (response.ok) {
      alert('设置已保存！');
      closeSettings();
    } else {
      alert('保存失败，请重试');
    }
  } catch (e) {
    alert('保存失败: ' + e.message);
  }
}

// ============ 本地存储 ============
function saveChatHistory() {
  try {
    localStorage.setItem('xiaomianao_messages', JSON.stringify(state.messages.slice(-50)));
    localStorage.setItem('xiaomianao_history', JSON.stringify(state.conversationHistory.slice(-20)));
  } catch (e) {
    console.error('保存聊天记录失败:', e);
  }
}

function loadChatHistory() {
  try {
    const messages = localStorage.getItem('xiaomianao_messages');
    const history = localStorage.getItem('xiaomianao_history');
    
    if (messages) {
      state.messages = JSON.parse(messages);
      if (state.messages.length > 0) {
        state.messages = state.messages.slice(-5);
        renderMessages();
      }
    }
    
    if (history) {
      state.conversationHistory = JSON.parse(history);
    }
    
    const userName = localStorage.getItem('xiaomianao_user_name');
    if (userName) {
      state.userName = userName;
    }

    // 加载已保存的吃药提醒
    const medicine = localStorage.getItem('xiaomianao_medicine');
    if (medicine) {
      try {
        const medData = JSON.parse(medicine);
        if (medData && Array.isArray(medData.medicines) && Array.isArray(medData.times)) {
          state.medicineReminder = medData;
        }
      } catch (e) {
        console.error('加载吃药提醒失败:', e);
      }
    }

    // 加载后启动定时器
    if (state.medicineReminder && state.medicineReminder.times.length > 0) {
      startMedicineChecker();
    }

    // 加载已保存的儿女电话
    const familyPhone = localStorage.getItem('xiaomianao_family_phone');
    if (familyPhone) {
      state.familyPhone = familyPhone;
    }
  } catch (e) {
    console.error('加载聊天记录失败:', e);
  }
}

function showHomePage() {
  welcomePage.classList.remove('hide');
  messageList.style.display = 'none';
  voiceHint.innerHTML = '<span>说"小棉袄"开始对话</span>';
}

function showChatPage() {
  welcomePage.classList.add('hide');
  messageList.style.display = 'block';
}

// ============ 初始化 ============
async function init() {
  chatArea = $('chatArea');
  messageList = $('messageList');
  welcomePage = $('welcomePage');
  micBtn = $('micBtn');
  pulseRing1 = $('pulseRing1');
  pulseRing2 = $('pulseRing2');
  recognizedText = $('recognizedText');
  voiceHint = $('voiceHint');
  endTip = $('endTip');
  moreBtn = $('moreBtn');
  moreMenu = $('moreMenu');
  overlay = $('overlay');
  homeBtn = $('homeBtn');
  settingsBtn = $('settingsBtn');
  settingsModal = $('settingsModal');
  settingsClose = $('settingsClose');
  saveSettingsBtn = $('saveSettingsBtn');
  
  loadChatHistory();

  // 清理过期localStorage数据
  cleanExpiredStorage();

  // 初始化用户标识和每日计数
  getUserId();
  state.dailyChatCount = getDailyChatCount();
  updateCountHint();

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.log('浏览器不支持录音功能');
    micBtn.disabled = true;
    voiceHint.innerHTML = '<span>当前浏览器不支持录音，请使用Chrome或Edge</span>';
  }
  
  micBtn.addEventListener('click', toggleVoiceService);
  moreBtn.addEventListener('click', toggleMoreMenu);
  overlay.addEventListener('click', closeMoreMenu);
  homeBtn.addEventListener('click', goHome);
  $('settingsMenuItem').addEventListener('click', openSettings);
  settingsClose.addEventListener('click', closeSettings);
  saveSettingsBtn.addEventListener('click', saveSettings);
  
  // 快捷操作
  document.querySelectorAll('.quick-action').forEach(el => {
    el.addEventListener('click', () => {
      handleQuickAction(el.dataset.action);
    });
  });
  
  // 菜单点击
  document.querySelectorAll('.menu-item[data-page]').forEach(el => {
    el.addEventListener('click', () => {
      closeMoreMenu();
      alert(`${el.dataset.page} 功能开发中...`);
    });
  });
  
  // 检查服务配置状态
  try {
    const response = await fetch('/health');
    const health = await response.json();
    console.log('服务状态:', health);
    
    if (!health.arkConfigured) {
      voiceHint.innerHTML = '<span>请先在设置中配置火山引擎密钥</span>';
    } else {
      // 服务就绪，进入待机模式
      startStandbyMode();
    }
  } catch (e) {
    console.error('服务健康检查失败:', e);
    voiceHint.innerHTML = '<span>服务连接失败，请检查后端服务</span>';
  }
  
  console.log('小棉袄 H5版（火山引擎）初始化完成');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
