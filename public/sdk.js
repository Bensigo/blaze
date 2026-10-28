/* Game Marketing SDK. No data is sent or stored until consent is granted. */
(function (global) {
  'use strict';
  var config = null, active = false, lastPointer = 0, lastTimestamp = 0, visitPromise = null;
  var capture = null, captureState = {status:'idle'}, generation = 0;
  var names = ['visit','loaded','first_action','round_start','round_complete','retry','progression','error','exit','pointer'];
  function id() { return global.crypto && crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), function (n) { return n.toString(16).padStart(2,'0'); }).join(''); }
  function safeUrl(value) { try { var u = new URL(value); return u.origin + u.pathname; } catch (_) { return ''; } }
  function read(store, key) { try { return global[store].getItem(key); } catch (_) { return null; } }
  function write(store, key, value) { try { global[store].setItem(key,value); } catch (_) {} }
  function player(key) { var name='gm_player_'+key, value=read('localStorage',name); if(!value){value=id();write('localStorage',name,value);}return value; }
  function props(input) {
    var result = {}, allowed = ['step','level','result','code','x','y','duration'];
    if (!input || typeof input !== 'object') return result;
    allowed.forEach(function (key) { var v = input[key]; if (typeof v === 'number' && Number.isFinite(v)) result[key] = v; else if (typeof v === 'string') result[key] = v.replace(/https?:\/\/\S+/g,'[URL]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]').slice(0,100); });
    return result;
  }
  function emit(name, properties) {
    if (global.__WEB_GAME_STUDIO_AGENT__ === true) return;
    var u = new URL(location.href), campaign = u.searchParams.get('utm_campaign') || '', source = u.searchParams.get('utm_source') || '';
    var event = { id:id(), name:name, sessionId:config.sessionId, playerId:config.playerId, timestamp:new Date(lastTimestamp = Math.max(Date.now(), lastTimestamp + 1)).toISOString(), properties:props(properties), page:safeUrl(location.href), referrer:safeUrl(document.referrer), campaign:campaign.slice(0,100), source:source.slice(0,100), device:/Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop' };
    var request = fetch(config.endpoint + '/api/collect', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({sdkKey:config.sdkKey, events:[event]}), keepalive:true, credentials:'omit'}).then(function (response) { return response.ok; }).catch(function () { return false; });
    if (name === 'visit') visitPromise = request;
    return request;
  }
  function newSession() {config.sessionId=id();config.firstAction=false;write('sessionStorage',config.prefix+'id',config.sessionId);write('sessionStorage',config.prefix+'first','0');}
  function touch() {config.last=Date.now();write('sessionStorage',config.prefix+'last',String(config.last));}
  function send(name, properties) {
    if (global.__WEB_GAME_STUDIO_AGENT__ === true || !active || !config || names.indexOf(name) < 0) return;
    if(Date.now()-config.last>30*60*1000){newSession();touch();emit('visit');if(document.readyState==='complete')emit('loaded');}
    if(name==='first_action'){if(config.firstAction)return;config.firstAction=true;write('sessionStorage',config.prefix+'first','1');}
    touch();emit(name,properties);
  }
  function pointer(event) {
    if (!active || Date.now() - lastPointer < 1000) return;
    lastPointer = Date.now();
    send('pointer',{x:Math.max(0,Math.min(1,event.clientX / Math.max(1,innerWidth))),y:Math.max(0,Math.min(1,event.clientY / Math.max(1,innerHeight)))});
  }
  function status(value, reason) {
    captureState = {status:value};
    if (reason) captureState.reason = reason;
    if (capture && capture.id) captureState.captureId = capture.id;
    if (typeof global.CustomEvent === 'function') global.dispatchEvent(new global.CustomEvent('gm:capturestatus', {detail:Object.assign({},captureState)}));
    return Object.assign({},captureState);
  }
  function post(endpoint, path, body, signal) {
    return fetch(endpoint + path, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'omit',signal:signal});
  }
  function report(c, state, reason) {
    return post(c.endpoint, '/api/capture/status', {captureId:c.id,token:c.token,status:state,reason:reason}).catch(function () {});
  }
  function cancel(c) {
    if (!c || !c.id || !c.token) return Promise.resolve();
    return post(c.endpoint, '/api/capture/cancel', {captureId:c.id,token:c.token}).catch(function () {});
  }
  function cleanup(c) {
    if (!c) return;
    if (c.timer) clearInterval(c.timer);
    if (c.deadline) clearTimeout(c.deadline);
    if (c.stream) c.stream.getTracks().forEach(function (track) { track.stop(); });
  }
  function fail(c, kind, reason) {
    if (!c || c.cancelled) return;
    c.failed = true; cleanup(c);
    if (c.recorder && c.recorder.state !== 'inactive') { try { c.recorder.stop(); } catch (_) {} }
    c.chunks = []; status(kind, reason);
    if (c.id) report(c, kind, reason);
    if (c.resolve) { c.resolve(Object.assign({},captureState)); c.resolve = null; }
  }
  function frame(c) {
    if (c.cancelled || c.failed) return;
    try {
      c.ctx.drawImage(c.source,0,0,c.width,c.height);
      // Reading a pixel rejects cross-origin/tainted surfaces before any frame is requested.
      c.ctx.getImageData(0,0,1,1);
      c.ctx.fillStyle = '#000';
      c.masks.forEach(function (m) { var x=Math.floor(m.x*c.width),y=Math.floor(m.y*c.height); c.ctx.fillRect(x,y,Math.ceil((m.x+m.width)*c.width)-x,Math.ceil((m.y+m.height)*c.height)-y); });
      if (c.manualFrame && c.track) c.track.requestFrame();
    } catch (_) { fail(c,'failed','canvas_not_origin_clean'); }
  }
  function stopCapture(options) {
    var c = capture;
    if (options && options.discard === true) {
      generation++; if (!c) return Promise.resolve(status('cancelled'));
      c.cancelled = true; cleanup(c); c.chunks = [];
      if (c.abort) c.abort.abort();
      if (c.recorder && c.recorder.state !== 'inactive') { try { c.recorder.stop(); } catch (_) {} }
      status('cancelled');
      // Cancel once now and again after an in-flight upload settles, closing the upload/cancel race.
      var pending = c.uploadPromise || Promise.resolve();
      var result = Promise.all([cancel(c), pending.catch(function () {})]).then(function () { return cancel(c); }).then(function () { return Object.assign({},captureState); });
      if (c.resolve) { c.resolve(Object.assign({},captureState)); c.resolve = null; }
      return result;
    }
    if (c && !c.cancelled && !c.failed && !c.recorder && captureState.status === 'starting') return stopCapture({discard:true});
    if (!c || c.cancelled || c.failed || !c.recorder) return Promise.resolve(Object.assign({},captureState));
    if (c.stopPromise) return c.stopPromise;
    c.stopPromise = new Promise(function (resolve) { c.resolve = resolve; });
    cleanup(c);
    if (c.recorder.state !== 'inactive') { try { c.recorder.stop(); } catch (_) { fail(c,'failed','recorder_stop_failed'); } }
    return c.stopPromise;
  }
  async function startCapture(options) {
    if (global.__WEB_GAME_STUDIO_AGENT__ === true) return status('agent_session');
    if (capture && !capture.cancelled && !capture.failed) return Object.assign({},captureState);
    if (!config || !active || !options || options.consent !== true) return status('consent_required');
    if (capture && !capture.cancelled) return Object.assign({},captureState);
    var seq = ++generation, c = {endpoint:config.endpoint,sessionId:config.sessionId,chunks:[],bytes:0,cancelled:false};
    capture = c; status('starting');
    if (!visitPromise || !(await visitPromise)) { if (!c.cancelled) { c.failed=true; status('failed','visit_not_persisted'); } return Object.assign({},captureState); }
    if (c.cancelled || seq !== generation || !active || !config || config.sessionId !== c.sessionId) return Object.assign({},captureState);
    try {
      var response = await post(c.endpoint, '/api/capture/start', {sdkKey:config.sdkKey,sessionId:c.sessionId,consent:true});
      var grant = await response.json();
      if (grant && grant.captureId && grant.token) { c.id=grant.captureId;c.token=grant.token; }
      if (c.cancelled || seq !== generation || !active) { await cancel(c); return Object.assign({},captureState); }
      if (document.hidden) { c.cancelled=true; await cancel(c); return status('cancelled'); }
      if (!response.ok || !grant || grant.status !== 'pending') {
        c.failed=true;
        return status(grant && (grant.status === 'not_sampled' || grant.status === 'quota_reached' || grant.status === 'disabled') ? grant.status : 'failed', grant && grant.status === 'pending' ? 'invalid_grant' : undefined);
      }
      var cfg=grant.config, nodes;
      if (!c.id || !c.token || !cfg || !cfg.enabled || !cfg.surfaceReviewed || typeof cfg.canvasSelector !== 'string' || !Array.isArray(cfg.masks) || cfg.masks.length > 8 || !Number.isFinite(cfg.maxDurationSeconds) || cfg.maxDurationSeconds <= 0 || cfg.maxDurationSeconds > 30) { fail(c,'failed','invalid_config'); return Object.assign({},captureState); }
      if (cfg.masks.some(function (m) { return !m || !['x','y','width','height'].every(function (k) { return Number.isFinite(m[k]); }) || m.x < 0 || m.y < 0 || m.width <= 0 || m.height <= 0 || m.x+m.width > 1 || m.y+m.height > 1; })) { fail(c,'failed','invalid_masks'); return Object.assign({},captureState); }
      try { nodes = document.querySelectorAll(cfg.canvasSelector); } catch (_) { fail(c,'failed','invalid_canvas_selector'); return Object.assign({},captureState); }
      if (nodes.length !== 1 || !(nodes[0] instanceof global.HTMLCanvasElement) || !nodes[0].width || !nodes[0].height) { fail(c,'failed','canvas_not_unique'); return Object.assign({},captureState); }
      if (!global.MediaRecorder || typeof global.MediaRecorder.isTypeSupported !== 'function') { fail(c,'unsupported','media_recorder_unavailable'); return Object.assign({},captureState); }
      var mime = ['video/webm;codecs=vp8','video/webm','video/mp4'].find(function (type) { return global.MediaRecorder.isTypeSupported(type); });
      if (!mime) { fail(c,'unsupported','codec_unavailable'); return Object.assign({},captureState); }
      c.source=nodes[0]; c.masks=cfg.masks; var scale=Math.min(1,960/c.source.width,540/c.source.height);
      c.width=Math.max(1,Math.floor(c.source.width*scale)); c.height=Math.max(1,Math.floor(c.source.height*scale));
      var output=document.createElement('canvas'); output.width=c.width; output.height=c.height; c.ctx=output.getContext('2d');
      if (!c.ctx || typeof output.captureStream !== 'function') { fail(c,'unsupported','canvas_capture_unavailable'); return Object.assign({},captureState); }
      // Draw and check before a stream is created, so tainted content cannot escape.
      frame(c); if (c.failed) return Object.assign({},captureState);
      c.stream=output.captureStream(0); c.track=c.stream.getVideoTracks()[0];
      if (!c.track) { fail(c,'unsupported','canvas_capture_unavailable'); return Object.assign({},captureState); }
      c.manualFrame=typeof c.track.requestFrame === 'function';
      if (!c.manualFrame) { c.stream.getTracks().forEach(function (track) { track.stop(); }); c.stream=output.captureStream(5); c.track=c.stream.getVideoTracks()[0]; if (!c.track) { fail(c,'unsupported','canvas_capture_unavailable'); return Object.assign({},captureState); } }
      c.recorder=new global.MediaRecorder(c.stream,{mimeType:mime,videoBitsPerSecond:400000}); c.mime=mime;
      c.recorder.ondataavailable=function (event) { if (c.cancelled || c.failed || !event.data || !event.data.size) return; c.bytes+=event.data.size; if (c.bytes>3145728) { fail(c,'failed','size_limit'); return; } c.chunks.push(event.data); };
      c.recorder.onerror=function () { fail(c,'failed','recorder_error'); };
      c.recorder.onstop=function () {
        cleanup(c);
        if (c.cancelled || c.failed) return;
        var blob=new Blob(c.chunks,{type:c.mime}); c.chunks=[];
        if (!blob.size || blob.size>3145728) { fail(c,'failed',blob.size?'size_limit':'empty_recording'); return; }
        var form=new FormData();form.append('captureId',c.id);form.append('token',c.token);form.append('file',blob,c.mime.indexOf('mp4')>=0?'capture.mp4':'capture.webm');form.append('durationSeconds',String(Math.min(cfg.maxDurationSeconds,Math.max(0.001,(Date.now()-c.started)/1000))));form.append('recordedAt',new Date(c.started).toISOString());form.append('width',String(c.width));form.append('height',String(c.height));
        status('uploading'); c.abort=new AbortController();
        c.uploadPromise=fetch(c.endpoint+'/api/capture/upload',{method:'POST',body:form,credentials:'omit',signal:c.abort.signal}).then(function (r) { if(!r.ok) throw Error('upload'); return r.json(); }).then(function (data) { if (c.cancelled) return; if (!data || data.status!=='ready') throw Error('upload'); status('ready'); }).catch(function () { if (!c.cancelled) fail(c,'failed','upload_failed'); }).finally(function () { if(c.resolve){c.resolve(Object.assign({},captureState));c.resolve=null;} });
      };
      c.started=Date.now();c.recorder.start(1000);if (c.manualFrame) frame(c); if (c.failed) return Object.assign({},captureState);c.timer=setInterval(function () { frame(c); },200);c.deadline=setTimeout(function () { stopCapture(); },Math.min(30,cfg.maxDurationSeconds)*1000);return status('recording');
    } catch (_) { if (!c.cancelled) fail(c,'failed','capture_start_failed'); return Object.assign({},captureState); }
  }
  document.addEventListener('pointerdown',pointer, {passive:true});
  document.addEventListener('visibilitychange',function () { if (document.hidden && capture && !capture.cancelled && !capture.failed) { if (captureState.status === 'recording') stopCapture(); else if (captureState.status === 'starting') stopCapture({discard:true}); } });
  global.addEventListener('pagehide',function () { send('exit'); if (capture && ['starting','recording','uploading'].indexOf(captureState.status) >= 0) stopCapture({discard:true}); });
  global.GameMarketing = {
    init:function (options) { if (capture) stopCapture({discard:true}); if (!options || !options.sdkKey || !options.endpoint) throw new Error('endpoint and sdkKey are required'); var u = new URL(options.endpoint); if (!/^https?:$/.test(u.protocol)) throw new Error('Invalid endpoint'); active = false; config = {endpoint:u.origin,sdkKey:String(options.sdkKey),prefix:'gm_session_'+String(options.sdkKey)+'_'}; if (options.consent === true) this.setConsent(true); },
    setConsent:function (consent) { if (!config) throw new Error('Initialize first'); if (global.__WEB_GAME_STUDIO_AGENT__ === true) { active = false; return; } if (consent !== true) { active = false; stopCapture({discard:true}); return; } if (active) return; config.playerId=player(config.sdkKey);config.last=Number(read('sessionStorage',config.prefix+'last'))||0;config.sessionId=read('sessionStorage',config.prefix+'id');config.firstAction=read('sessionStorage',config.prefix+'first')==='1';if(!config.sessionId || Date.now()-config.last>30*60*1000)newSession();active = true;touch();emit('visit');if(document.readyState==='complete')emit('loaded');else global.addEventListener('load',function () { send('loaded'); },{once:true}); },
    track:function (name, properties) { send(name, properties); },
    startCapture:startCapture,
    stopCapture:stopCapture,
    getCaptureState:function () { return Object.assign({},captureState); },
    disable:function () { active = false; return stopCapture({discard:true}); }
  };
})(window);
