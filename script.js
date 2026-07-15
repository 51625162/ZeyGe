import { FFmpeg } from 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js';
import { fetchFile, toBlobURL } from 'https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js';

/* ---------------- STATE ---------------- */
const state = {
  story: '',

  videoFile: null,
  videoDuration: 0,
  videoWidth: 0,
  videoHeight: 0,

  trimEnabled: false,
  trimStart: 0,
  trimDuration: 15,

  speed: 1,

  audioMode: 'keep',
  audioFile: null,
  strictSync: true,

  narrationBlob: null,

  subMode: 'none',
  srtFile: null,
  textSub: '',
  subFontSize: 20,
  subPosition: 'bottom',

  logoEnabled: false,
  logoFile: null,
  logoPosition: 'br',
  logoScale: 15,
  logoOpacity: 85,

  colorTone: 'none',
  aspectRatio: 'original',
  fadeEnabled: false,

  resolution: '720',
  crf: '23',
};

let lastRenderedBlob = null;

const STEP_LABELS = ['Hikaye','Video','Süre&Hız','Ses','Anlatım','Altyazı','Logo','Stil','Ayarlar','Paylaş'];
let currentStep = 0;

/* ---------------- STEPPER UI ---------------- */
const stepperEl = document.getElementById('stepper');
function renderStepper(){
  stepperEl.innerHTML = '';
  STEP_LABELS.forEach((label, i)=>{
    const tab = document.createElement('div');
    tab.className = 'step-tab' + (i===currentStep ? ' active':'') + (i<currentStep ? ' done':'');
    tab.innerHTML = `<span class="n">${String(i).padStart(2,'0')}</span> ${label}`;
    tab.addEventListener('click', ()=>{ if(i <= currentStep || state.videoFile) goToStep(i); });
    stepperEl.appendChild(tab);
  });
}
function goToStep(i){
  currentStep = i;
  document.querySelectorAll('.panel[data-step]').forEach(p=>{
    p.classList.toggle('active', Number(p.dataset.step) === i);
  });
  renderStepper();
  window.scrollTo({top:0, behavior:'smooth'});
}
document.querySelectorAll('[data-back]').forEach(btn=>{
  btn.addEventListener('click', ()=> goToStep(Number(btn.dataset.back)));
});
['toStep1','toStep2','toStep3','toStep4','toStep5','toStep6','toStep7','toStep8','toStep9'].forEach((id, idx)=>{
  const el = document.getElementById(id);
  if(el) el.addEventListener('click', ()=> goToStep(idx+1));
});
renderStepper();

/* ---------------- CLOCK (decorative timecode) ---------------- */
let frame = 0;
setInterval(()=>{
  frame++;
  const d = new Date();
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  const ss = String(d.getSeconds()).padStart(2,'0');
  const ff = String(frame % 25).padStart(2,'0');
  document.getElementById('clock').textContent = `${hh}:${mm}:${ss}:${ff}`;
}, 40);

/* ---------------- STEP 0: STORY / IDEA ---------------- */
document.getElementById('storyInput').addEventListener('input', (e)=>{ state.story = e.target.value; });
document.getElementById('toStep1').addEventListener('click', ()=>{
  // Best-effort prefill for later steps, only if user hasn't typed anything there yet.
  const aiTopicEl = document.getElementById('aiTopic');
  const narrationEl = document.getElementById('narrationText');
  if(state.story.trim()){
    if(aiTopicEl && !aiTopicEl.value.trim()) aiTopicEl.value = state.story.trim().slice(0, 120);
    if(narrationEl && !narrationEl.value.trim()) narrationEl.value = state.story.trim();
  }
});

/* ---------------- STEP 1: VIDEO ---------------- */
const videoInput = document.getElementById('videoInput');
const videoPreview = document.getElementById('videoPreview');
videoInput.addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  state.videoFile = file;
  const url = URL.createObjectURL(file);
  videoPreview.src = url;
  videoPreview.style.display = 'block';
  videoPreview.onloadedmetadata = ()=>{
    state.videoDuration = videoPreview.duration;
    state.videoWidth = videoPreview.videoWidth;
    state.videoHeight = videoPreview.videoHeight;
    document.getElementById('videoMeta').textContent =
      `${file.name} — ${state.videoWidth}x${state.videoHeight} — ${state.videoDuration.toFixed(1)}sn — ${(file.size/1024/1024).toFixed(1)}MB`;
    document.getElementById('totalDurationHint').textContent = `${state.videoDuration.toFixed(1)} sn`;
    document.getElementById('trimDuration').max = Math.ceil(state.videoDuration);
    document.getElementById('toStep2').disabled = false;
  };
});

/* ---------------- STEP 2: DURATION & SPEED ---------------- */
document.getElementById('trimEnabled').addEventListener('change', (e)=>{
  state.trimEnabled = e.target.checked;
  document.getElementById('trimWrap').style.display = state.trimEnabled ? 'block' : 'none';
});
document.querySelectorAll('#durationPreset .pill').forEach(p=>{
  p.addEventListener('click', ()=>{
    document.querySelectorAll('#durationPreset .pill').forEach(x=>x.classList.remove('selected'));
    p.classList.add('selected');
    if(p.dataset.val !== 'custom'){
      document.getElementById('trimDuration').value = p.dataset.val;
      state.trimDuration = Number(p.dataset.val);
    }
  });
});
document.getElementById('trimStart').addEventListener('input', (e)=>{ state.trimStart = Number(e.target.value) || 0; });
document.getElementById('trimDuration').addEventListener('input', (e)=>{ state.trimDuration = Number(e.target.value) || 1; });
document.getElementById('speedRange').addEventListener('input', (e)=>{
  state.speed = Number(e.target.value);
  document.getElementById('speedValue').textContent = state.speed.toFixed(2) + 'x';
});

/* ---------------- STEP 3: AUDIO ---------------- */
document.querySelectorAll('#audioMode .pill').forEach(p=>{
  p.addEventListener('click', ()=>{
    document.querySelectorAll('#audioMode .pill').forEach(x=>x.classList.remove('selected'));
    p.classList.add('selected');
    state.audioMode = p.dataset.val;
    document.getElementById('audioUploadWrap').style.display = (state.audioMode==='replace') ? 'block':'none';
  });
});
document.getElementById('audioInput').addEventListener('change', (e)=>{
  state.audioFile = e.target.files[0] || null;
  document.getElementById('audioFileHint').textContent = state.audioFile ? state.audioFile.name : 'Dosya seçilmedi.';
});
document.getElementById('strictSync').addEventListener('change', (e)=>{
  state.strictSync = e.target.checked;
});

/* ---------------- STEP 4: VOICE / NARRATION (Web Speech API) ---------------- */
const TONE_PRESETS = {
  eglenceli: { rate: 1.15, pitch: 1.3 },
  egitici:   { rate: 0.95, pitch: 1.0 },
  mizahi:    { rate: 1.05, pitch: 1.5 },
  sinematik: { rate: 0.85, pitch: 0.8 },
  resmi:     { rate: 0.9,  pitch: 0.95 },
};

let availableVoices = [];
function populateVoices(){
  availableVoices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  const sel = document.getElementById('voiceSelect');
  if(!availableVoices.length){
    sel.innerHTML = '<option>Bu tarayıcıda ses bulunamadı</option>';
    return;
  }
  const sorted = [...availableVoices].sort((a,b)=>{
    const aTr = a.lang.toLowerCase().startsWith('tr') ? 0 : 1;
    const bTr = b.lang.toLowerCase().startsWith('tr') ? 0 : 1;
    return aTr - bTr;
  });
  sel.innerHTML = sorted.map((v)=> `<option value="${availableVoices.indexOf(v)}">${v.name} (${v.lang})</option>`).join('');
}
if(window.speechSynthesis){
  populateVoices();
  window.speechSynthesis.onvoiceschanged = populateVoices;
} else {
  document.getElementById('voiceSelect').innerHTML = '<option>Bu tarayıcı sesli anlatımı desteklemiyor</option>';
  document.getElementById('previewVoiceBtn').disabled = true;
  document.getElementById('recordNarrationBtn').disabled = true;
}

function buildUtterance(){
  const text = document.getElementById('narrationText').value.trim();
  if(!text){ alert('Önce bir anlatım metni yaz.'); return null; }
  const tone = document.getElementById('voiceTone').value;
  const preset = TONE_PRESETS[tone] || TONE_PRESETS.resmi;
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = preset.rate;
  utter.pitch = preset.pitch;
  const voiceIdx = document.getElementById('voiceSelect').value;
  if(voiceIdx !== '' && availableVoices[voiceIdx]) utter.voice = availableVoices[voiceIdx];
  return utter;
}

document.getElementById('previewVoiceBtn').addEventListener('click', ()=>{
  if(!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = buildUtterance();
  if(utter) window.speechSynthesis.speak(utter);
});
document.getElementById('stopVoiceBtn').addEventListener('click', ()=>{
  if(window.speechSynthesis) window.speechSynthesis.cancel();
});

document.getElementById('recordNarrationBtn').addEventListener('click', async ()=>{
  const statusEl = document.getElementById('recordStatus');
  const utter = buildUtterance();
  if(!utter) return;
  if(!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia){
    statusEl.textContent = 'Bu tarayıcı sekme sesi kaydını desteklemiyor.';
    return;
  }
  try{
    statusEl.textContent = 'İzin ekranında "sekme sesini paylaş" kutusunu işaretle...';
    const stream = await navigator.mediaDevices.getDisplayMedia({ video:true, audio:true, preferCurrentTab:true });
    const audioTracks = stream.getAudioTracks();
    if(!audioTracks.length){
      statusEl.textContent = 'Ses paylaşılmadı — kayıt iptal edildi. Lütfen "sekme sesini paylaş" kutusunu işaretleyerek tekrar dene.';
      stream.getTracks().forEach(t=>t.stop());
      return;
    }
    const audioOnlyStream = new MediaStream(audioTracks);
    const chunks = [];
    const recorder = new MediaRecorder(audioOnlyStream);
    recorder.ondataavailable = (ev)=>{ if(ev.data.size > 0) chunks.push(ev.data); };
    recorder.onstop = ()=>{
      stream.getTracks().forEach(t=>t.stop());
      const blob = new Blob(chunks, { type:'audio/webm' });
      state.narrationBlob = blob;
      const url = URL.createObjectURL(blob);
      document.getElementById('narrationAudio').src = url;
      document.getElementById('narrationDownload').href = url;
      document.getElementById('narrationResult').style.display = 'block';
      statusEl.textContent = 'Kayıt tamamlandı.';
    };
    recorder.start();
    statusEl.textContent = 'Kaydediliyor... anlatım okunuyor.';
    window.speechSynthesis.cancel();
    utter.onend = ()=> setTimeout(()=> recorder.stop(), 400);
    utter.onerror = ()=> recorder.stop();
    window.speechSynthesis.speak(utter);
  } catch(err){
    statusEl.textContent = 'İptal edildi veya izin verilmedi: ' + err.message;
  }
});

document.getElementById('useNarrationBtn').addEventListener('click', ()=>{
  if(!state.narrationBlob) return;
  state.audioFile = new File([state.narrationBlob], 'zeyge_anlatim.webm', { type:'audio/webm' });
  state.audioMode = 'replace';
  document.querySelectorAll('#audioMode .pill').forEach(x=>{
    x.classList.toggle('selected', x.dataset.val === 'replace');
  });
  document.getElementById('audioUploadWrap').style.display = 'block';
  document.getElementById('audioFileHint').textContent = 'zeyge_anlatim.webm (kaydedilen anlatım) kullanılacak';
  alert('Anlatım, video sesi olarak ayarlandı. "Ses" adımından kontrol edebilirsin.');
});

/* ---------------- STEP 5: SUBTITLES ---------------- */
document.querySelectorAll('#subMode .pill').forEach(p=>{
  p.addEventListener('click', ()=>{
    document.querySelectorAll('#subMode .pill').forEach(x=>x.classList.remove('selected'));
    p.classList.add('selected');
    state.subMode = p.dataset.val;
    document.getElementById('srtUploadWrap').style.display = (state.subMode==='srt') ? 'block':'none';
    document.getElementById('textSubWrap').style.display = (state.subMode==='text') ? 'block':'none';
  });
});
document.getElementById('srtInput').addEventListener('change', (e)=>{
  state.srtFile = e.target.files[0] || null;
});
document.getElementById('textSubInput').addEventListener('input', (e)=>{ state.textSub = e.target.value; });
document.getElementById('subFontSize').addEventListener('input', (e)=>{ state.subFontSize = Number(e.target.value); });
document.getElementById('subPosition').addEventListener('change', (e)=>{ state.subPosition = e.target.value; });

/* ---------------- STEP 6: LOGO ---------------- */
document.getElementById('logoEnabled').addEventListener('change', (e)=>{
  state.logoEnabled = e.target.checked;
  document.getElementById('logoWrap').style.display = state.logoEnabled ? 'block':'none';
});
document.getElementById('logoInput').addEventListener('change', (e)=>{ state.logoFile = e.target.files[0] || null; });
document.getElementById('logoPosition').addEventListener('change', (e)=>{ state.logoPosition = e.target.value; });
document.getElementById('logoScale').addEventListener('input', (e)=>{ state.logoScale = Number(e.target.value); });
document.getElementById('logoOpacity').addEventListener('input', (e)=>{ state.logoOpacity = Number(e.target.value); });

/* ---------------- STEP 7: VISUAL STYLE + ASPECT ---------------- */
document.querySelectorAll('#colorTone .pill').forEach(p=>{
  p.addEventListener('click', ()=>{
    document.querySelectorAll('#colorTone .pill').forEach(x=>x.classList.remove('selected'));
    p.classList.add('selected');
    state.colorTone = p.dataset.val;
  });
});
document.querySelectorAll('#aspectRatio .pill').forEach(p=>{
  p.addEventListener('click', ()=>{
    document.querySelectorAll('#aspectRatio .pill').forEach(x=>x.classList.remove('selected'));
    p.classList.add('selected');
    state.aspectRatio = p.dataset.val;
  });
});
document.getElementById('fadeEnabled').addEventListener('change', (e)=>{ state.fadeEnabled = e.target.checked; });

/* ---------------- STEP 8: SETTINGS ---------------- */
document.getElementById('resSelect').addEventListener('change', (e)=>{ state.resolution = e.target.value; });
document.getElementById('crfSelect').addEventListener('change', (e)=>{ state.crf = e.target.value; });

/* ---------------- STEP 9: RENDER (ffmpeg.wasm) ---------------- */
const ffmpeg = new FFmpeg();
const consoleLog = document.getElementById('consoleLog');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const progressPct = document.getElementById('progressPct');
let ffmpegLoaded = false;

function log(msg, isErr){
  const line = document.createElement('div');
  if(isErr) line.className = 'err';
  line.textContent = msg;
  consoleLog.appendChild(line);
  consoleLog.scrollTop = consoleLog.scrollHeight;
}

ffmpeg.on('log', ({message}) => log(message));
ffmpeg.on('progress', ({progress}) => {
  const pct = Math.min(100, Math.max(0, Math.round(progress*100)));
  progressFill.style.width = pct + '%';
  progressPct.textContent = pct + '%';
});

async function ensureFFmpegLoaded(){
  if(ffmpegLoaded) return;
  progressText.textContent = 'FFmpeg çekirdeği indiriliyor...';
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  ffmpegLoaded = true;
  log('FFmpeg çekirdeği yüklendi.');
}

function srtFromPlainText(text, duration){
  const fmt = (s)=>{
    const h = String(Math.floor(s/3600)).padStart(2,'0');
    const m = String(Math.floor((s%3600)/60)).padStart(2,'0');
    const sec = String(Math.floor(s%60)).padStart(2,'0');
    const ms = String(Math.floor((s%1)*1000)).padStart(3,'0');
    return `${h}:${m}:${sec},${ms}`;
  };
  return `1\n${fmt(0)} --> ${fmt(Math.max(duration,1))}\n${text}\n`;
}

function logoPositionExpr(pos){
  const margin = 20;
  switch(pos){
    case 'tl': return { x:`${margin}`, y:`${margin}` };
    case 'tr': return { x:`main_w-overlay_w-${margin}`, y:`${margin}` };
    case 'bl': return { x:`${margin}`, y:`main_h-overlay_h-${margin}` };
    case 'center': return { x:`(main_w-overlay_w)/2`, y:`(main_h-overlay_h)/2` };
    case 'br':
    default: return { x:`main_w-overlay_w-${margin}`, y:`main_h-overlay_h-${margin}` };
  }
}

const COLOR_TONE_FILTERS = {
  eglenceli: 'eq=saturation=1.4:contrast=1.12:brightness=0.02',
  egitici:   'eq=saturation=1.0:contrast=1.05:brightness=0.0',
  mizahi:    'eq=saturation=1.3:contrast=1.15:brightness=0.02,vignette=PI/6',
  sinematik: 'eq=saturation=0.9:contrast=1.2:gamma=0.95,vignette=PI/5',
};

function computeCropForAspect(w, h, ratioStr){
  if(!w || !h || ratioStr === 'original') return null;
  const [rw, rh] = ratioStr.split(':').map(Number);
  const targetRatio = rw / rh;
  const sourceRatio = w / h;
  if(sourceRatio > targetRatio){
    let newW = Math.round((h * targetRatio) / 2) * 2;
    newW = Math.min(newW, w);
    const x = Math.floor((w - newW) / 2);
    return `crop=${newW}:${h}:${x}:0`;
  } else {
    let newH = Math.round((w / targetRatio) / 2) * 2;
    newH = Math.min(newH, h);
    const y = Math.floor((h - newH) / 2);
    return `crop=${w}:${newH}:0:${y}`;
  }
}

document.getElementById('renderBtn').addEventListener('click', async ()=>{
  if(!state.videoFile){ alert('Önce bir video yükle (SAHNE 01).'); return; }
  const btn = document.getElementById('renderBtn');
  btn.disabled = true;
  document.getElementById('resultWrap').style.display = 'none';
  progressFill.style.width = '0%';
  progressPct.textContent = '0%';

  try{
    progressText.textContent = 'Hazırlanıyor...';
    await ensureFFmpegLoaded();

    await ffmpeg.writeFile('input.mp4', await fetchFile(state.videoFile));

    let inputArgs = [];
    if(state.trimEnabled && state.trimStart > 0){
      inputArgs.push('-ss', String(state.trimStart));
    }
    inputArgs.push('-i', 'input.mp4');

    let audioInputIndex = null;
    let logoInputIndex = null;
    let nextInputIdx = 1;

    if(state.audioMode === 'replace' && state.audioFile){
      await ffmpeg.writeFile('newaudio', await fetchFile(state.audioFile));
      inputArgs.push('-i', 'newaudio');
      audioInputIndex = nextInputIdx++;
    }
    if(state.logoEnabled && state.logoFile){
      await ffmpeg.writeFile('logo.png', await fetchFile(state.logoFile));
      inputArgs.push('-i', 'logo.png');
      logoInputIndex = nextInputIdx++;
    }

    let subsFilterFragment = null;
    if(state.subMode === 'srt' && state.srtFile){
      const srtText = await state.srtFile.text();
      await ffmpeg.writeFile('subs.srt', srtText);
      subsFilterFragment = `subtitles=subs.srt:force_style='FontName=IBM Plex Sans,FontSize=${state.subFontSize},Outline=1,BorderStyle=1'`;
    } else if(state.subMode === 'text' && state.textSub.trim()){
      const effectiveDuration = state.trimEnabled ? state.trimDuration : (state.videoDuration || 10);
      const srtText = srtFromPlainText(state.textSub.trim(), effectiveDuration);
      await ffmpeg.writeFile('subs.srt', srtText);
      const alignment = state.subPosition === 'top' ? 8 : 2;
      subsFilterFragment = `subtitles=subs.srt:force_style='FontName=IBM Plex Sans,FontSize=${state.subFontSize},Outline=1,BorderStyle=1,Alignment=${alignment}'`;
    }

    const filters = [];
    let vLabel = '0:v';

    const cropExpr = computeCropForAspect(state.videoWidth, state.videoHeight, state.aspectRatio);
    if(cropExpr){
      filters.push(`[${vLabel}]${cropExpr}[vcrop]`);
      vLabel = 'vcrop';
    }

    const scaleExpr = state.resolution === 'original' ? null : `-2:${state.resolution}`;
    if(scaleExpr){
      filters.push(`[${vLabel}]scale=${scaleExpr}[vscaled]`);
      vLabel = 'vscaled';
    }

    if(state.colorTone !== 'none' && COLOR_TONE_FILTERS[state.colorTone]){
      filters.push(`[${vLabel}]${COLOR_TONE_FILTERS[state.colorTone]}[vtone]`);
      vLabel = 'vtone';
    }

    if(Math.abs(state.speed - 1) > 0.001){
      const ptsFactor = (1/state.speed).toFixed(4);
      filters.push(`[${vLabel}]setpts=${ptsFactor}*PTS[vspeed]`);
      vLabel = 'vspeed';
    }

    if(logoInputIndex !== null){
      const opacity = (state.logoOpacity/100).toFixed(2);
      filters.push(`[${logoInputIndex}:v]scale=iw*${(state.logoScale/100).toFixed(2)}:-1,format=rgba,colorchannelmixer=aa=${opacity}[logo]`);
      const pos = logoPositionExpr(state.logoPosition);
      filters.push(`[${vLabel}][logo]overlay=${pos.x}:${pos.y}[vlogo]`);
      vLabel = 'vlogo';
    }

    if(subsFilterFragment){
      filters.push(`[${vLabel}]${subsFilterFragment}[vsubs]`);
      vLabel = 'vsubs';
    }

    if(state.fadeEnabled){
      const totalDur = (state.trimEnabled ? state.trimDuration : (state.videoDuration || 10)) / state.speed;
      const fadeOutStart = Math.max(totalDur - 1, 0);
      filters.push(`[${vLabel}]fade=t=in:st=0:d=1,fade=t=out:st=${fadeOutStart.toFixed(2)}:d=1[vfade]`);
      vLabel = 'vfade';
    }

    let audioLabel = null;
    if(state.audioMode !== 'mute'){
      const audioSrc = state.audioMode === 'replace' && audioInputIndex !== null ? `${audioInputIndex}:a` : '0:a';
      const audioFilterParts = [];
      if(Math.abs(state.speed - 1) > 0.001){
        const clampedTempo = Math.min(2, Math.max(0.5, state.speed));
        audioFilterParts.push(`atempo=${clampedTempo.toFixed(3)}`);
      }
      if(state.fadeEnabled){
        const totalDur = (state.trimEnabled ? state.trimDuration : (state.videoDuration || 10)) / state.speed;
        const fadeOutStart = Math.max(totalDur - 1, 0);
        audioFilterParts.push(`afade=t=in:st=0:d=1`, `afade=t=out:st=${fadeOutStart.toFixed(2)}:d=1`);
      }
      const chain = audioFilterParts.length ? audioFilterParts.join(',') : 'anull';
      filters.push(`[${audioSrc}]${chain}[aout]`);
      audioLabel = 'aout';
    }

    const filterComplex = filters.join(';');
    const args = [...inputArgs, '-filter_complex', filterComplex, '-map', `[${vLabel}]`];

    if(audioLabel){
      args.push('-map', `[${audioLabel}]`);
      if(state.audioMode === 'replace' && state.strictSync) args.push('-shortest');
    } else {
      args.push('-an');
    }

    if(state.trimEnabled){
      args.push('-t', String(state.trimDuration / state.speed));
    }

    args.push(
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', state.crf,
      '-c:a', 'aac', '-b:a', '192k',
      '-pix_fmt', 'yuv420p',
      'output.mp4'
    );

    log('$ ffmpeg ' + args.join(' '));
    progressText.textContent = 'Render ediliyor...';
    await ffmpeg.exec(args);

    progressText.textContent = 'Tamamlandı';
    const data = await ffmpeg.readFile('output.mp4');
    const blob = new Blob([data.buffer], { type: 'video/mp4' });
    lastRenderedBlob = blob;
    const url = URL.createObjectURL(blob);
    document.getElementById('resultVideo').src = url;
    document.getElementById('downloadLink').href = url;
    document.getElementById('resultWrap').style.display = 'block';

    // prefill youtube title/description from story, if empty
    const ytTitleEl = document.getElementById('ytTitle');
    const ytDescEl = document.getElementById('ytDescription');
    if(state.story.trim()){
      if(ytTitleEl && !ytTitleEl.value.trim()) ytTitleEl.value = state.story.trim().slice(0, 90);
      if(ytDescEl && !ytDescEl.value.trim()) ytDescEl.value = state.story.trim();
    }

    log('Master MP4 hazır.');
  } catch(err){
    log('HATA: ' + err.message, true);
    progressText.textContent = 'Hata oluştu';
    console.error(err);
  } finally {
    btn.disabled = false;
  }
});

/* ---------------- SAVE AS (File System Access API) ---------------- */
document.getElementById('saveAsBtn').addEventListener('click', async ()=>{
  if(!lastRenderedBlob){ alert('Önce videoyu render et.'); return; }
  if(window.showSaveFilePicker){
    try{
      const handle = await window.showSaveFilePicker({
        suggestedName: 'zeyge_master.mp4',
        types: [{ description: 'MP4 Video', accept: { 'video/mp4': ['.mp4'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(lastRenderedBlob);
      await writable.close();
      alert('Video seçtiğin konuma kaydedildi.');
    } catch(err){
      if(err.name !== 'AbortError'){
        alert('Kaydetme başarısız: ' + err.message);
      }
    }
  } else {
    alert('Tarayıcın klasör seçerek kaydetmeyi desteklemiyor (bu özellik Chrome/Edge\'de var, Firefox/Safari\'de yok). "MP4 İNDİR" linkini kullanıp dosyayı istediğin klasöre (örn. Masaüstü) taşıyabilirsin.');
  }
});

/* ---------------- YOUTUBE SHARE ---------------- */
document.querySelectorAll('#ytMode .pill').forEach(p=>{
  p.addEventListener('click', ()=>{
    document.querySelectorAll('#ytMode .pill').forEach(x=>x.classList.remove('selected'));
    p.classList.add('selected');
    document.getElementById('ytSimpleWrap').style.display = p.dataset.val === 'simple' ? 'block':'none';
    document.getElementById('ytApiWrap').style.display = p.dataset.val === 'api' ? 'block':'none';
  });
});

document.getElementById('ytHelpToggle').addEventListener('click', (e)=>{
  e.preventDefault();
  const box = document.getElementById('ytHelpBox');
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('ytSimpleBtn').addEventListener('click', ()=>{
  if(!lastRenderedBlob){ alert('Önce videoyu render et.'); return; }
  const url = URL.createObjectURL(lastRenderedBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'zeyge_master.mp4';
  a.click();
  window.open('https://www.youtube.com/upload', '_blank');
});

function getYouTubeAccessToken(clientId){
  return new Promise((resolve, reject)=>{
    if(!window.google || !google.accounts || !google.accounts.oauth2){
      reject(new Error('Google Identity Services yüklenemedi. İnternet bağlantını kontrol et ve tekrar dene.'));
      return;
    }
    try{
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/youtube.upload',
        callback: (resp)=>{
          if(resp.error) reject(new Error(resp.error));
          else resolve(resp.access_token);
        }
      });
      client.requestAccessToken();
    } catch(err){
      reject(err);
    }
  });
}

async function uploadToYouTube({ file, title, description, privacy, clientId, onProgress, onStatus }){
  onStatus('Google ile giriş yapılıyor (bir pencere açılabilir)...');
  const token = await getYouTubeAccessToken(clientId);

  onStatus('Yükleme oturumu başlatılıyor...');
  const metadata = {
    snippet: { title: title || 'ZeyGe Studio Video', description: description || '', categoryId: '22' },
    status: { privacyStatus: privacy || 'private' }
  };
  const initRes = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(file.size),
    },
    body: JSON.stringify(metadata)
  });
  if(!initRes.ok){
    const errText = await initRes.text();
    throw new Error(`Oturum başlatılamadı (${initRes.status}): ${errText.slice(0,200)}`);
  }
  const uploadUrl = initRes.headers.get('Location');
  if(!uploadUrl) throw new Error('Yükleme adresi alınamadı.');

  onStatus('Video yükleniyor...');
  const result = await new Promise((resolve, reject)=>{
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', 'video/mp4');
    xhr.upload.onprogress = (e)=>{
      if(e.lengthComputable) onProgress(Math.round((e.loaded/e.total)*100));
    };
    xhr.onload = ()=>{
      if(xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else reject(new Error(`Yükleme hatası (${xhr.status}): ${xhr.responseText.slice(0,200)}`));
    };
    xhr.onerror = ()=> reject(new Error('Ağ hatası oluştu.'));
    xhr.send(file);
  });
  return result;
}

document.getElementById('ytUploadBtn').addEventListener('click', async ()=>{
  if(!lastRenderedBlob){ alert('Önce videoyu render et.'); return; }
  const clientId = document.getElementById('ytClientId').value.trim();
  if(!clientId){ alert('Önce bir Google OAuth İstemci Kimliği gir (yukarıdaki "Nasıl alınır?" bölümüne bak).'); return; }

  const title = document.getElementById('ytTitle').value.trim();
  const description = document.getElementById('ytDescription').value.trim();
  const privacy = document.getElementById('ytPrivacy').value;
  const statusEl = document.getElementById('ytStatus');
  const fillEl = document.getElementById('ytProgressFill');
  const pctEl = document.getElementById('ytProgressPct');
  const resultBox = document.getElementById('ytResultBox');
  resultBox.style.display = 'none';
  fillEl.style.width = '0%';
  pctEl.textContent = '0%';

  const btn = document.getElementById('ytUploadBtn');
  btn.disabled = true;
  try{
    const file = new File([lastRenderedBlob], 'zeyge_master.mp4', { type: 'video/mp4' });
    const result = await uploadToYouTube({
      file, title, description, privacy, clientId,
      onProgress: (pct)=>{ fillEl.style.width = pct + '%'; pctEl.textContent = pct + '%'; },
      onStatus: (msg)=>{ statusEl.textContent = msg; }
    });
    statusEl.textContent = 'Yükleme tamamlandı!';
    const videoId = result.id;
    resultBox.style.display = 'block';
    resultBox.innerHTML = videoId
      ? `Video yüklendi: <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank" style="color:var(--gold);">youtube.com/watch?v=${videoId}</a> (gizlilik: ${privacy})`
      : 'Yükleme tamamlandı ama video kimliği alınamadı, YouTube Studio\'nu kontrol et.';
  } catch(err){
    statusEl.textContent = 'Hata: ' + err.message;
    console.error(err);
  } finally {
    btn.disabled = false;
  }
});

/* ---------------- BONUS: OFFLINE AI DIRECTOR (template-based) ---------------- */
const TONE_OPENERS = {
  'Sinematik': 'Görüntü ağır çeker; kamera yavaşça {topic} üzerine kayar.',
  'Eğlenceli': 'Enerjik bir jingle ile açılır: "Bugün {topic} hakkında konuşuyoruz!"',
  'Komik': 'Absürt bir yanlış anlaşılma ile başlar, izleyici gülümser.',
  'Belgesel': 'Sakin bir anlatıcı sesiyle {topic} bağlamı kurulur.',
  'Teknik': 'Ekranda veri/şema belirir, {topic} net bir tanımla açılır.',
  'Duygusal': 'Kişisel bir anı ile {topic} konusuna insani bir giriş yapılır.',
  'Gerilim': 'Gergin bir müzik ve kesik kesik görüntülerle {topic} tehdidi hissettirilir.',
};

document.getElementById('aiGenBtn').addEventListener('click', ()=>{
  const topic = document.getElementById('aiTopic').value.trim() || 'bu konu';
  const tone = document.getElementById('aiTone').value;
  const opener = (TONE_OPENERS[tone] || TONE_OPENERS['Belgesel']).replace('{topic}', topic);

  const out = `[HOOK — İlk 30 sn]
${opener}
Soru: "Peki ya ${topic} hakkında bildiğin her şey yanlışsa?"

[BÖLÜM PLANI]
1. Giriş — ${topic} neden önemli?
2. Bağlam — Nasıl bu noktaya gelindi?
3. Ana gövde — ${topic} ile ilgili 3 kilit nokta
4. Dönüm noktası — En şaşırtıcı detay
5. Kapanış — Ne öğrendik?

[TON] ${tone}

[CTA ÖNERİLERİ]
- "Bu konuda ne düşünüyorsun, yorumlarda buluşalım."
- "Bir sonraki videoda ${topic} konusunun devamını işleyeceğiz, abone ol."
- "Bu bilgi işine yaradıysa beğenmeyi unutma."

[NOT] Bu iskelet, ZeyGe içinde şablon tabanlı ve tamamen yerel üretildi.
Anlatım metni olarak SAHNE 04'e kopyalayıp seslendirebilirsin.`;

  const outEl = document.getElementById('aiOutput');
  outEl.textContent = out;
  outEl.style.display = 'block';
});
