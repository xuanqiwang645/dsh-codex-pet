/** Local companion settings. Authentication stays in Codex; this page never accepts API keys. */
export const codexSettingsPage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>鲸鱼娘 · 桌宠设置</title><link rel="stylesheet" href="/standalone-ai/settings.css">
<script src="/standalone-ai/settings.js" defer></script></head><body><main>
<header><p class="eyebrow">鲸鱼娘 / CODEX COMPANION</p><h1>桌宠设置</h1><p>喂食、玩耍和动画随时可用。聊天沿用本机 Codex 登录。</p></header>
<section><div class="heading"><h2>可用额度</h2><button id="refresh-quota" type="button" class="secondary">刷新额度</button></div>
<p class="hint">这里显示 Codex 套餐额度及重置时间，不是 DeepSeek API 账户金额。</p>
<div id="quota" aria-live="polite">正在读取额度…</div></section>
<form id="settings"><section><h2>聊天</h2><label class="check"><input id="enabled" type="checkbox">启用桌宠聊天与手动碎碎念</label>
<label for="model">回答模型</label><select id="model" aria-describedby="model-current model-status" disabled><option value="">正在读取模型…</option></select>
<p id="model-current" class="hint" aria-live="polite"></p>
<div class="actions"><button id="refresh-models" type="button" class="secondary">刷新模型列表</button><span id="model-status" role="status">正在读取模型…</span></div>
<p class="hint">从本机 Codex 的模型目录选择，保存后用于下一次对话和碎碎念。无需填写密钥；自动碎碎念默认关闭。</p>
<div class="actions"><button id="check" type="button" class="secondary">检查 Codex 连接</button><span id="connection" role="status"></span></div>
<label class="check"><input id="automaticWhispers" type="checkbox">开启自动碎碎念</label>
<p class="hint">默认关闭。开启后会按间隔调用 Codex 并消耗套餐额度；关闭后仍可右键手动碎碎念。</p>
<label for="whisperIntervalSec">自动碎碎念间隔（秒）</label><input id="whisperIntervalSec" type="number" min="300" max="86400" step="1" value="300" required>
<p class="hint">最少 300 秒；仅在聊天已启用时自动生成。</p>
</section><footer><span id="status" role="status">正在读取设置…</span><button id="save" type="submit" disabled>保存设置</button></footer></form>
<form id="pet-settings"><section><h2>外观与移动</h2>
<label for="pet-select">宠物</label><select id="pet-select"></select>
<label for="pet-size">宠物大小（像素）</label><input id="pet-size" type="number" min="160" max="1200" step="1" value="462" required>
<label class="check"><input id="pet-fixed" type="checkbox">固定位置，关闭自主游走</label>
<p class="hint">仍可手动拖动与播放动画。大小和固定设置保存后，重启桌宠生效。</p>
<div class="actions"><button id="pet-save" type="submit" disabled>保存外观设置</button><span id="pet-status" role="status">正在读取宠物设置…</span></div>
</section></form>
<section class="help"><h2>桌面互动</h2><p>右键鲸鱼娘可打开喂食、玩耍、对话、额度查询和动画菜单。拖动可调整位置；“回到初始位置”可将它移回屏幕角落。</p><p>登录或套餐不可用时，喂食与玩耍仍能使用。需要登录时，请先在 Codex 应用内完成登录，再回来检查连接。</p></section>
</main></body></html>`;

export const codexSettingsStyle = `:root{color-scheme:light;--ink:#23354e;--muted:#64758c;--line:#dce3ed;--blue:#4564a7}*{box-sizing:border-box}body{margin:0;background:#f3f5fb;color:var(--ink);font:15px/1.65 "PingFang SC",system-ui,sans-serif}main{max-width:760px;margin:50px auto;padding:0 24px 36px}header{margin:0 0 28px}.eyebrow{font-size:12px;letter-spacing:1.7px;color:var(--blue);margin:0 0 9px}h1{font-size:32px;line-height:1.3;margin:0 0 12px}h2{font-size:18px;margin:0 0 14px}p{margin:8px 0;color:var(--muted)}section{padding:24px 28px;background:white;border:1px solid var(--line);border-radius:14px;margin:0 0 20px}.heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.heading h2{margin:0}label{display:block;margin:17px 0 7px;font-weight:600}.check{display:flex;align-items:center;gap:10px;font-size:14px}input[type=checkbox]{accent-color:var(--blue);width:18px;height:18px}input[type=text],input[type=number],select{width:100%;padding:11px 12px;border:1px solid #bdc9db;border-radius:7px;font:inherit;color:var(--ink)}button{font:600 14px "PingFang SC",system-ui,sans-serif;background:var(--blue);border:1px solid var(--blue);border-radius:7px;padding:10px 17px;color:white;cursor:pointer}button.secondary{background:white;color:var(--blue)}button:disabled{opacity:.55;cursor:wait}.hint{font-size:12px;margin:10px 0 16px}.actions,footer{display:flex;align-items:center;gap:16px;justify-content:space-between}footer{padding:0 6px 20px;font-size:13px}.actions{justify-content:flex-start;flex-wrap:wrap;margin-top:20px}#status[data-error=true],.error{color:#af3e39}.quota-bucket{margin-top:18px;padding-top:12px;border-top:1px solid var(--line)}.quota-bucket h3{font-size:14px;margin:0 0 7px}.quota-row{display:flex;gap:10px;justify-content:space-between;font-size:13px;margin:6px 0}.quota-value{font-variant-numeric:tabular-nums;font-weight:600}.quota-reset{font-size:11px;color:var(--muted);margin:-4px 0 9px;text-align:right}.help{background:transparent;border-style:dashed}.help p{font-size:13px}:focus-visible{outline:3px solid #a9bce9;outline-offset:3px}@media(max-width:550px){main{margin:26px auto;padding:0 14px}section{padding:21px 18px}.heading{align-items:flex-start}h1{font-size:28px}footer{align-items:stretch;flex-direction:column}}`;

export const codexSettingsScript = `'use strict';
(() => {
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  history.replaceState(null, '', location.pathname);
  const get = id => document.getElementById(id);
  const status = (text, error=false) => { get('status').textContent=text; get('status').dataset.error=String(error); };
  async function request(path, method='GET', body) {
    const response = await fetch(path, {method, credentials:'omit', cache:'no-store', redirect:'error',
      headers:{'X-DSH-Pet-Token':token,...(body ? {'Content-Type':'application/json'} : {})},
      ...(body ? {body:JSON.stringify(body)} : {})});
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok===false) throw new Error(response.status===403 ? '本次打开凭据已失效，请从桌宠右键菜单重新打开设置。' : (typeof data.message==='string'&&data.message)||(typeof data.error==='string'&&data.error)||'本机服务暂时无法完成请求。');
    return data;
  }
  const element = (tag,text,cls) => {const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node;};
  const resets = stamp => stamp===null ? '重置时间未提供' : '重置：'+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(stamp*1000));
  async function quota() {
    get('refresh-quota').disabled=true;
    get('quota').textContent='正在读取额度…';
    try {
      const data=await request('/companion/quota');
      const target=get('quota');target.replaceChildren();
      for(const bucket of data.buckets || []) {
        const card=element('div','', 'quota-bucket');card.append(element('h3',bucket.label));
        for(const window of bucket.windows || []) {
          const row=element('div','', 'quota-row');row.append(element('span',window.label));
          row.append(element('span',window.remainingPercent===null ? '暂不可用' : '剩余 '+window.remainingPercent+'%', 'quota-value'));
          card.append(row,element('div',resets(window.resetsAt),'quota-reset'));
        }
        if(!bucket.windows.length)card.append(element('p','窗口数据未提供','hint'));
        target.append(card);
      }
    } catch(error) {get('quota').textContent=error.message;}
    finally {get('refresh-quota').disabled=false;}
  }
  get('refresh-quota').addEventListener('click',quota);
  let settingsLoaded=false, modelsLoaded=false, modelsLoading=false, saving=false;
  let models=[], selectedModel='', configuredModel='', effectiveModel='', modelDirty=false, modelsGeneration=0;
  const modelStatus=(text,error=false)=>{get('model-status').textContent=text;get('model-status').className=error?'error':'';};
  const modelName=id=>{const model=models.find(item=>item.id===id);return model?(model.name&&model.name!==id?model.name+'（'+id+'）':id):id;};
  const validModel=()=>selectedModel===''||models.some(item=>item.id===selectedModel);
  const syncSave=()=>{get('save').disabled=saving||!settingsLoaded||!modelsLoaded||modelsLoading||!validModel();get('model').disabled=saving||!modelsLoaded||modelsLoading;get('refresh-models').disabled=saving||modelsLoading;};
  function showModelSelection() {
    const select=get('model');select.replaceChildren();
    const defaultModel=models.find(item=>item.isDefault===true);
    const follow=element('option',defaultModel?'跟随 Codex 默认（'+modelName(defaultModel.id)+'）':'跟随 Codex 默认');follow.value='';select.append(follow);
    for(const model of models){const option=element('option',modelName(model.id));option.value=model.id;select.append(option);}
    if(selectedModel&&!models.some(item=>item.id===selectedModel)) {
      const missing=element('option','目前不可用：'+selectedModel);missing.value=selectedModel;missing.disabled=true;select.append(missing);
    }
    select.value=selectedModel;select.disabled=!modelsLoaded||modelsLoading;
    get('model-current').textContent=effectiveModel?'当前回答模型：'+modelName(effectiveModel):'当前没有可用的回答模型。';
    if(modelsLoaded) {
      if(!validModel())modelStatus('已保存模型目前不可用，请选择其他模型后保存。',true);
      else modelStatus(modelDirty?'模型选择尚未保存。保存后用于下一次对话。':'选择后保存设置，无需重启桌宠。');
    }
    syncSave();
  }
  async function loadModels() {
    const generation=++modelsGeneration;
    modelsLoading=true;get('refresh-models').disabled=true;get('model').disabled=true;modelStatus('正在读取模型…');syncSave();
    try {
      const data=await request('/companion/models');
      if(generation!==modelsGeneration)return;
      models=Array.isArray(data.models)?data.models.filter(item=>item&&typeof item.id==='string'&&item.id):[];
      configuredModel=typeof data.configuredModel==='string'?data.configuredModel:'';
      effectiveModel=typeof data.effectiveModel==='string'?data.effectiveModel:'';
      if(!modelDirty)selectedModel=configuredModel;
      modelsLoaded=data.connected===true&&models.length>0;
      modelsLoading=false;showModelSelection();
      if(data.connected!==true)modelStatus('尚未连接 Codex。请先登录，再刷新模型列表。',true);
      else if(!models.length)modelStatus('Codex 暂未提供可选择的模型，请稍后刷新列表。',true);
    }catch(error){
      if(generation!==modelsGeneration)return;
      modelsLoaded=false;modelStatus('模型列表读取失败：'+error.message+' 可点击“刷新模型列表”重试。',true);
    }finally{
      if(generation===modelsGeneration){modelsLoading=false;get('refresh-models').disabled=false;get('model').disabled=!modelsLoaded;syncSave();}
    }
  }
  get('refresh-models').addEventListener('click',loadModels);
  get('model').addEventListener('change',()=>{if(saving||!modelsLoaded||modelsLoading)return;selectedModel=get('model').value;modelDirty=selectedModel!==configuredModel;showModelSelection();});
  get('settings').addEventListener('submit',async event => {
    event.preventDefault();
    if(saving||!settingsLoaded||!modelsLoaded||modelsLoading||!validModel()){status('请先读取模型列表，并选择当前可用的模型。',true);return;}
    saving=true;syncSave();status('正在保存…');
    try {
      const interval=Number(get('whisperIntervalSec').value);
      if(!Number.isInteger(interval)||interval<300||interval>86400)throw new Error('碎碎念间隔必须是 300–86400 秒的整数。');
      await request('/standalone-ai/settings','POST',{enabled:get('enabled').checked,model:selectedModel,automaticWhispers:get('automaticWhispers').checked,whisperIntervalSec:interval});
      configuredModel=selectedModel;modelDirty=false;
      status('已保存。下一次对话和碎碎念使用所选模型。');
      await loadModels();
    }
    catch(error){status(error.message,true);}finally{saving=false;syncSave();}
  });
  let mainPets=[];
  const petStatus=(text,error=false)=>{get('pet-status').textContent=text;get('pet-status').className=error?'error':'';};
  function showPet() {
    const pet=mainPets.find(item=>item.id===get('pet-select').value);
    if(!pet)return;
    get('pet-size').value=String(pet.size);get('pet-fixed').checked=pet.fixedEnabled===true;
  }
  function populatePets(config) {
    mainPets=config.main&&Array.isArray(config.main.pets)?config.main.pets:[];
    const previous=get('pet-select').value;
    get('pet-select').replaceChildren();
    for(const pet of mainPets){const option=element('option',pet.name||pet.id);option.value=pet.id;get('pet-select').append(option);}
    get('pet-select').value=mainPets.some(pet=>pet.id===previous)?previous:(mainPets[0]&&mainPets[0].id)||'';
    get('pet-save').disabled=!mainPets.length;showPet();
    if(!mainPets.length)petStatus('没有可编辑的主宠物。',true);
  }
  get('pet-select').addEventListener('change',showPet);
  get('pet-settings').addEventListener('submit',async event=>{
    event.preventDefault();get('pet-save').disabled=true;petStatus('正在保存…');
    try {
      const size=Number(get('pet-size').value),id=get('pet-select').value,fixed=get('pet-fixed').checked;
      if(!Number.isInteger(size)||size<160||size>1200)throw new Error('大小必须是 160–1200 像素的整数。');
      const latest=await request('/dsh-pet-7340/config');
      const pets=latest.main&&Array.isArray(latest.main.pets)?latest.main.pets:[];
      if(!pets.some(pet=>pet.id===id))throw new Error('这只宠物的配置已变化，请重新打开设置。');
      const updated=pets.map(pet=>pet.id===id?{...pet,size,fixedEnabled:fixed}:pet);
      const saved=await request('/dsh-pet-7340/config','PUT',{pets:updated});
      populatePets(saved);petStatus('已保存，重启桌宠后生效。');
    }catch(error){petStatus(error.message,true);}finally{get('pet-save').disabled=!mainPets.length;}
  });
  get('check').addEventListener('click',async () => {
    get('check').disabled=true;get('connection').textContent='正在检查…';
    try {const data=await request('/standalone-ai/test','POST',{});get('connection').textContent=data.message || (data.ok?'连接正常':'暂时无法连接');await loadModels();}
    catch(error){get('connection').textContent=error.message;}finally{get('check').disabled=false;}
  });
  if(!token){status('请从桌宠右键菜单打开本页。',true);get('quota').textContent='尚未连接本机服务';get('refresh-quota').disabled=true;get('refresh-models').disabled=true;get('check').disabled=true;return;}
  request('/standalone-ai/settings').then(data=>{get('enabled').checked=data.enabled===true;get('automaticWhispers').checked=data.automaticWhispers===true;get('whisperIntervalSec').value=String(data.whisperIntervalSec||300);settingsLoaded=true;syncSave();status('设置仅保存在本机。');}).catch(error=>{settingsLoaded=false;syncSave();status(error.message,true);});
  loadModels();
  request('/dsh-pet-7340/config').then(data=>{populatePets(data);if(mainPets.length)petStatus('大小和固定设置重启后生效。');}).catch(error=>petStatus(error.message,true));
  quota();
})();`;

export const codexSettingsAssets = {
  page: codexSettingsPage,
  script: codexSettingsScript,
  style: codexSettingsStyle,
};
