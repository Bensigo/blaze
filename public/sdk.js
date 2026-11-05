/* Blaze SDK. No data is sent or stored until consent is granted. */
(function (global) {
  'use strict';
  var config = null, active = false, lastPointer = 0, lastTimestamp = 0, visitPromise = null;
  var play = { running:false, foreground:false, inputUntil:0, last:0, elapsed:0, timer:null };
  var capture = null, captureState = {status:'idle'}, generation = 0;
  var frameBridge = null;
  var frameCaptureBridge = null;
  var previewInProgress = false;
  var names = ['visit','loaded','first_action','round_start','round_complete','retry','progression','error','exit','pointer','ui_click','player_action','milestone','player_profile'];
  function id() { return global.crypto && crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), function (n) { return n.toString(16).padStart(2,'0'); }).join(''); }
  function safeUrl(value) { try { var u = new URL(value); return u.origin + u.pathname; } catch (_) { return ''; } }
  function read(store, key) { try { return global[store].getItem(key); } catch (_) { return null; } }
  function write(store, key, value) { try { global[store].setItem(key,value); } catch (_) {} }
  function player(key) { var name='gm_player_'+key, value=read('localStorage',name); if(!value){value=id();write('localStorage',name,value);}return value; }
  function props(input) {
    var result = {}, allowed = ['step','level','result','code','x','y','duration','surface','screen','key','value','age_band','declared_country','interests'];
    if (!input || typeof input !== 'object') return result;
    allowed.forEach(function (key) { var v = input[key]; if (typeof v === 'number' && Number.isFinite(v)) result[key] = v; else if (typeof v === 'string') result[key] = v.replace(/https?:\/\/\S+/g,'[URL]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]').slice(0,100); });
    return result;
  }
  function emit(name, properties) {
    if (global.__WEB_GAME_STUDIO_AGENT__ === true) return;
    var u = new URL(location.href), campaign = u.searchParams.get('utm_campaign') || '', source = u.searchParams.get('utm_source') || '';
    var event = { id:id(), name:name, sessionId:config.sessionId, playerId:config.playerId, timestamp:new Date(lastTimestamp = Math.max(Date.now(), lastTimestamp + 1)).toISOString(), properties:props(properties), page:safeUrl(location.href), referrer:safeUrl(document.referrer), campaign:campaign.slice(0,100), source:source.slice(0,100), device:(/iPad|Tablet|PlayBook/i.test(navigator.userAgent)||(/Macintosh/i.test(navigator.userAgent)&&navigator.maxTouchPoints>1))?'tablet':/Mobi|Android/i.test(navigator.userAgent)?'mobile':'desktop' };
    if (config.test) event.properties.test = true;
    var request = fetch(config.endpoint + '/api/collect', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({sdkKey:config.sdkKey, events:[event]}), keepalive:true, credentials:'omit'}).then(function (response) { if(!response.ok && typeof global.CustomEvent==='function')global.dispatchEvent(new global.CustomEvent('blaze:deliverystatus',{detail:{status:'failed',httpStatus:response.status}}));return response.ok; }).catch(function () { if(typeof global.CustomEvent==='function')global.dispatchEvent(new global.CustomEvent('blaze:deliverystatus',{detail:{status:'failed',httpStatus:0}}));return false; });
    if (name === 'visit') visitPromise = request;
    return request;
  }
  function newSession() {resetPlay();config.sessionId=id();config.firstAction=false;write('sessionStorage',config.prefix+'id',config.sessionId);write('sessionStorage',config.prefix+'first','0');}
  function touch() {config.last=Date.now();write('sessionStorage',config.prefix+'last',String(config.last));}
  function foreground() { return !document.hidden && (typeof document.hasFocus !== 'function' || document.hasFocus()); }
  function resetPlay() { if (play.timer) clearInterval(play.timer); play.running=false;play.foreground=false;play.inputUntil=0;play.last=0;play.elapsed=0;play.timer=null; }
  function accruePlay(now) {
    if (play.running && play.foreground && play.last && now > play.last) play.elapsed += Math.max(0,Math.min(now,play.inputUntil)-play.last);
    play.last=now;
  }
  function flushPlay() {
    if (!active || !config || global.__WEB_GAME_STUDIO_AGENT__ === true) return;
    var seconds = Math.min(15, Math.floor(play.elapsed / 1000));
    if (seconds > 0) { play.elapsed=0; touch();emit('active_play',{duration:seconds}); }
  }
  function startPlay() {
    var now=Date.now();
    if (play.running) { accruePlay(now); flushPlay(); }
    else emit('active_play',{duration:0});
    play.running=true;play.foreground=foreground();play.inputUntil=0;play.last=now;play.elapsed=0;
    if (!play.timer) play.timer=setInterval(function () { accruePlay(Date.now());flushPlay(); },15000);
  }
  function stopPlay() { if (play.running) { accruePlay(Date.now());flushPlay(); } resetPlay(); }
  function playInput(event) {
    if (previewInProgress || !active || !play.running || event.isTrusted !== true || !foreground()) return;
    var now=Date.now();accruePlay(now);play.foreground=true;play.inputUntil=now+15000;
  }
  function playVisibility() { if (!play.running) return;accruePlay(Date.now());play.foreground=foreground(); }
  function send(name, properties) {
    if (previewInProgress || global.__WEB_GAME_STUDIO_AGENT__ === true || !active || !config || names.indexOf(name) < 0) return;
    if (['ui_click','player_action','milestone'].indexOf(name)>=0) {
      if (!properties || typeof properties !== 'object' || typeof properties.key !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(properties.key) || ('value' in properties && (typeof properties.value !== 'number' || !Number.isFinite(properties.value) || properties.value < 0 || properties.value > 1000000))) return;
      properties = {key:properties.key, value:properties.value};
    }
    if(Date.now()-config.last>30*60*1000){newSession();touch();emit('visit');if(document.readyState==='complete')emit('loaded');}
    if(name==='first_action'){if(config.firstAction)return;config.firstAction=true;write('sessionStorage',config.prefix+'first','1');}
    if(name==='round_complete' || name==='exit') stopPlay();
    touch();emit(name,properties);
    if(name==='round_start') startPlay();
  }
  function attachFrame(options) {
    if (!config) throw new Error('Initialize first');
    if (!options || !(options.frame instanceof global.HTMLIFrameElement) || !options.frame.isConnected || !options.frame.contentWindow || !(options.port instanceof global.MessagePort) || typeof options.nonce !== 'string' || !/^[A-Za-z0-9_-]{24,128}$/.test(options.nonce)) throw new Error('Invalid frame bridge');
    if (options.canvas && (!(options.canvas instanceof global.HTMLCanvasElement) || !options.canvas.isConnected || !options.canvas.width || !options.canvas.height)) throw new Error('Invalid reviewed canvas');
    var masks=options.previewMasks===undefined ? [] : options.previewMasks;
    if(!Array.isArray(masks) || masks.length>8 || masks.some(function(m){return !m || typeof m!=='object' || Object.keys(m).some(function(k){return ['x','y','width','height'].indexOf(k)<0;}) || !['x','y','width','height'].every(function(k){return Number.isFinite(m[k]);}) || m.x<0 || m.y<0 || m.width<=0 || m.height<=0 || m.x+m.width>1 || m.y+m.height>1;})) throw new Error('Invalid preview masks');
    masks=masks.map(function(m){return {x:m.x,y:m.y,width:m.width,height:m.height};});
    if (frameBridge) frameBridge.close();
    var frame=options.frame, port=options.port, canvas=options.canvas || null, nonce=options.nonce, lastSeq=0, lastActivity=0, lastFrame=0, lastFramePointer=0, burstAt=0, burst=0, closed=false, preview=null, usedClicks=new WeakSet();
    function clearCanvas() { if (canvas) { try { var ctx=canvas.getContext('2d'); if(ctx) ctx.clearRect(0,0,canvas.width,canvas.height); } catch (_) {} } }
    function stopPreview() { if(!preview)return;clearTimeout(preview.timer);preview=null;previewInProgress=false;clearCanvas(); }
    function startPreview(event) {
      if(closed || !frame.isConnected || !frame.contentWindow || !canvas || !canvas.isConnected || !canvas.width || !canvas.height || canvas.width>1920 || canvas.height>1080 || global.__WEB_GAME_STUDIO_AGENT__===true) throw new Error('Preview unavailable');
      if(!global.Event || !(event instanceof global.Event) || event.type!=='click' || event.isTrusted!==true || usedClicks.has(event) || !foreground()) throw new Error('Preview requires a trusted review-button click');
      if(global.navigator && global.navigator.userActivation && global.navigator.userActivation.isActive!==true) throw new Error('Preview requires active user interaction');
      if(global.performance && typeof global.performance.now==='function' && (!Number.isFinite(event.timeStamp) || global.performance.now()-event.timeStamp>2000 || global.performance.now()-event.timeStamp < -1000)) throw new Error('Preview click has expired');
      if(['starting','recording'].indexOf(captureState.status)>=0) throw new Error('Preview is unavailable during recording');
      usedClicks.add(event);stopPreview();resetPlay();var until=Date.now()+30000;preview={until:until,timer:setTimeout(stopPreview,30000)};previewInProgress=true;
      return {status:'previewing',expiresAt:new Date(until).toISOString()};
    }
    function previewVisibility() { if(document.hidden)stopPreview(); }
    function close() { if(closed)return;closed=true;stopPreview();if(capture && capture.waitingFrame && capture.source===canvas && !capture.cancelled && !capture.failed)fail(capture,'failed','frame_unavailable');port.onmessage=null;port.onmessageerror=null;try{port.close();}catch(_){} frame.removeEventListener('load',close);global.removeEventListener('pagehide',close);global.removeEventListener('blaze:capturestatus',captureStatus);document.removeEventListener('visibilitychange',previewVisibility);clearCanvas();if(frameBridge && frameBridge.close===close){frameBridge=null;frameCaptureBridge=null;} }
    function waitForCaptureFrame(c) {
      clearCanvas();c.waitingFrame=true;c.frameRequestedAt=Date.now();c.frameMinimumSeq=lastSeq;
      return new Promise(function(resolve){c.frameResolve=resolve;c.frameTimer=setTimeout(function(){if(c.waitingFrame && !c.cancelled && !c.failed)fail(c,'failed','frame_timeout');},3000);});
    }
    function captureStatus(e) { if (e && e.detail && ['starting','recording'].indexOf(e.detail.status)>=0) stopPreview(); else if(!preview) clearCanvas(); }
    function keys(value, allowed) { return value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).every(function (key) { return allowed.indexOf(key)>=0; }); }
    function discardBitmap(value) { if (global.ImageBitmap && value instanceof global.ImageBitmap) { try { value.close(); } catch (_) {} } }
    port.onmessage=function (event) {
      var m=event.data, bitmap=m && m.bitmap;
      try {
        if (closed || !frame.isConnected || !frame.contentWindow) { close();return; }
        if (!m || typeof m!=='object' || Array.isArray(m) || m.v!==1 || m.nonce!==nonce || !Number.isSafeInteger(m.seq) || m.seq<=lastSeq) return;
        var valid=false, properties;
        if (m.type==='activity') valid=keys(m,['v','nonce','seq','type','at']) && Number.isFinite(m.at) && m.at>=Date.now()-2000 && m.at<=Date.now()+1000;
        else if (m.type==='pointer') valid=keys(m,['v','nonce','seq','type','x','y','screen']) && Number.isFinite(m.x) && m.x>=0 && m.x<=1 && Number.isFinite(m.y) && m.y>=0 && m.y<=1 && typeof m.screen==='string' && /^[A-Za-z0-9_-]{1,40}$/.test(m.screen);
        else if (m.type==='frame') valid=keys(m,['v','nonce','seq','type','bitmap','at']) && (!('at' in m) || Number.isFinite(m.at)) && !!global.ImageBitmap && bitmap instanceof global.ImageBitmap && bitmap.width>0 && bitmap.height>0 && bitmap.width<=1920 && bitmap.height<=1080;
        else if (m.type==='event' && keys(m,['v','nonce','seq','type','name','properties']) && ['first_action','round_start','round_complete','retry','progression','error','exit'].indexOf(m.name)>=0) {
          properties=m.properties;
          if (properties===undefined) valid=true;
          else if (m.name==='round_complete') valid=keys(properties,['result']) && Object.keys(properties).length===1 && ['win','loss','draw','complete'].indexOf(properties.result)>=0;
          else if (m.name==='progression') valid=keys(properties,['level']) && Object.keys(properties).length===1 && Number.isInteger(properties.level) && properties.level>=0 && properties.level<=1000;
          else if (m.name==='error') valid=keys(properties,['code']) && Object.keys(properties).length===1 && ['asset_failed','network_failed','runtime_failed'].indexOf(properties.code)>=0;
        }
        if(!valid)return;
        lastSeq=m.seq;
        var now=Date.now();
        if(now-burstAt>=1000){burstAt=now;burst=0;} if(++burst>20)return;
        if(m.type==='frame') {
          var recording=active && capture && capture.source===canvas && captureState.status==='recording';
          var preparing=active && capture && capture.waitingFrame && capture.source===canvas && captureState.status==='starting' && Number.isFinite(m.at) && m.at>=capture.frameRequestedAt && m.at>=now-2000 && m.at<=now+1000 && m.seq>capture.frameMinimumSeq;
          if(preview && (now>=preview.until || document.hidden || !canvas || !canvas.isConnected || !canvas.width || !canvas.height || canvas.width>1920 || canvas.height>1080)) stopPreview();
          if(canvas && canvas.isConnected && (recording || preview || preparing) && global.__WEB_GAME_STUDIO_AGENT__!==true && now-lastFrame>=200) {
            try { lastFrame=now;var ctx=canvas.getContext('2d');if(ctx){ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);if(preview){ctx.fillStyle='#000';masks.forEach(function(m){var x=Math.floor(m.x*canvas.width),y=Math.floor(m.y*canvas.height);ctx.fillRect(x,y,Math.ceil((m.x+m.width)*canvas.width)-x,Math.ceil((m.y+m.height)*canvas.height)-y);});}if(preparing && capture.frameResolve){var resolve=capture.frameResolve;clearTimeout(capture.frameTimer);capture.frameTimer=null;capture.frameResolve=null;capture.waitingFrame=false;resolve(true);}} } catch (_) { if(preparing && capture && !capture.cancelled) fail(capture,'failed','frame_unavailable'); }
          }
          return;
        }
        if (preview || !active || global.__WEB_GAME_STUDIO_AGENT__===true) return;
        if(m.type==='event') send(m.name,properties);
        else if(m.type==='pointer') {
          if(now-lastFramePointer<1000 || !foreground()) return;
          lastFramePointer=now;send('pointer',{x:m.x,y:m.y,surface:'game',screen:m.screen});
        }
        else if(m.type==='activity') {
          if (now-lastActivity<1000 || !play.running || !foreground()) return;
          lastActivity=now;accruePlay(now);play.foreground=true;play.inputUntil=now+15000;
        }
      } finally { discardBitmap(bitmap); }
    };
    port.onmessageerror=close;frame.addEventListener('load',close);global.addEventListener('pagehide',close);global.addEventListener('blaze:capturestatus',captureStatus);document.addEventListener('visibilitychange',previewVisibility);if(typeof port.start==='function')port.start();
    frameBridge={close:close,startPreview:startPreview,stopPreview:stopPreview};frameCaptureBridge={matchesCanvas:function(value){return !closed && value===canvas;},waitForCaptureFrame:waitForCaptureFrame};return frameBridge;
  }
  function pointer(event) {
    if (previewInProgress || !active || Date.now() - lastPointer < 1000) return;
    lastPointer = Date.now();
    send('pointer',{x:Math.max(0,Math.min(1,event.clientX / Math.max(1,innerWidth))),y:Math.max(0,Math.min(1,event.clientY / Math.max(1,innerHeight))),surface:'viewport',screen:'viewport'});
  }
  function status(value, reason) {
    captureState = {status:value};
    if (reason) captureState.reason = reason;
    if (capture && capture.id) captureState.captureId = capture.id;
    if (typeof global.CustomEvent === 'function') { global.dispatchEvent(new global.CustomEvent('blaze:capturestatus', {detail:Object.assign({},captureState)})); global.dispatchEvent(new global.CustomEvent('gm:capturestatus', {detail:Object.assign({},captureState)})); }
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
    if (c.frameTimer) { clearTimeout(c.frameTimer); c.frameTimer=null; }
    if (c.frameResolve) { var resolve=c.frameResolve;c.frameResolve=null;c.waitingFrame=false;resolve(false); }
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
  var captureSeries = null;
  function stopCapture(options) {
    if (captureSeries && !(options && options.segment === true)) captureSeries.continue = false;
    var c = capture;
    if (options && options.discard === true) {
      generation++; if (!c) return Promise.resolve(status('cancelled'));
      c.cancelled = true; cleanup(c); c.chunks = [];
      if (c.abort) c.abort.abort();
      if (c.recorder && c.recorder.state !== 'inactive') { try { c.recorder.stop(); } catch (_) {} }
      status('cancelled');
      // Cancel once now and again after an in-flight upload settles, closing the upload/cancel race.
      var pending = c.uploadPromise || Promise.resolve();
      var grants = captureSeries ? captureSeries.grants.slice() : [c];
      var result = Promise.all(grants.map(cancel).concat([pending.catch(function () {})])).then(function () { return cancel(c); }).then(function () { return Object.assign({},captureState); });
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
  async function startCapture(options, segmentIndex) {
    if (global.__WEB_GAME_STUDIO_AGENT__ === true) return status('agent_session');
    var segment = typeof segmentIndex === 'number' ? segmentIndex : 0;
    if (segment > 0) {
      if (!captureSeries || !captureSeries.continue || !active || !config || captureSeries.sessionId !== config.sessionId || document.hidden) return Object.assign({},captureState);
      capture = null;
    }
    if (capture && !capture.cancelled && !capture.failed) return Object.assign({},captureState);
    if (!config || !active || !options || options.consent !== true) return status('consent_required');
    if (capture && !capture.cancelled) return Object.assign({},captureState);
    if (!segment) captureSeries = {continue:true,sessionId:config.sessionId,grants:[]};
    var seq = ++generation, c = {endpoint:config.endpoint,sessionId:config.sessionId,chunks:[],bytes:0,cancelled:false,segment:segment};
    captureSeries.grants.push(c);
    capture = c; status('starting');
    if (!visitPromise || !(await visitPromise)) { if (!c.cancelled) { c.failed=true; status('failed','visit_not_persisted'); } return Object.assign({},captureState); }
    if (c.cancelled || seq !== generation || !active || !config || config.sessionId !== c.sessionId) return Object.assign({},captureState);
    try {
      var response = await post(c.endpoint, '/api/capture/start', {sdkKey:config.sdkKey,sessionId:c.sessionId,consent:true,segment:segment});
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
      if (frameCaptureBridge && frameCaptureBridge.matchesCanvas(c.source)) {
        var gotFrame=await frameCaptureBridge.waitForCaptureFrame(c);
        if (!gotFrame || c.cancelled || c.failed || seq!==generation || !active || !config || config.sessionId!==c.sessionId || document.hidden) return Object.assign({},captureState);
      }
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
        c.uploadPromise=fetch(c.endpoint+'/api/capture/upload',{method:'POST',body:form,credentials:'omit',signal:c.abort.signal}).then(function (r) { if(!r.ok) throw Error('upload'); return r.json(); }).then(function (data) { if (c.cancelled) return; if (!data || data.status!=='ready') throw Error('upload'); status('ready'); if (c.continueNext && captureSeries && captureSeries.continue && active && !document.hidden && config && config.sessionId===c.sessionId && segment+1<Math.min(4,cfg.maxSegments||1)) setTimeout(function () { startCapture({consent:true},segment+1); },0); }).catch(function () { if (!c.cancelled) fail(c,'failed','upload_failed'); }).finally(function () { if(c.resolve){c.resolve(Object.assign({},captureState));c.resolve=null;} });
      };
      c.started=Date.now();c.recorder.start(1000);if (c.manualFrame) frame(c); if (c.failed) return Object.assign({},captureState);c.timer=setInterval(function () { frame(c); },200);c.deadline=setTimeout(function () { c.continueNext=true; stopCapture({segment:true}); },Math.min(30,cfg.maxDurationSeconds)*1000);return status('recording');
    } catch (_) { if (!c.cancelled) fail(c,'failed','capture_start_failed'); return Object.assign({},captureState); }
  }
  document.addEventListener('pointerdown',pointer, {passive:true});
  ['pointerdown','pointermove','keydown','touchstart'].forEach(function (name) { document.addEventListener(name,playInput,{passive:true}); });
  document.addEventListener('visibilitychange',playVisibility);
  global.addEventListener('blur',playVisibility);global.addEventListener('focus',playVisibility);
  global.addEventListener('pagehide',stopPlay);
  document.addEventListener('visibilitychange',function () { if (document.hidden && capture && !capture.cancelled && !capture.failed) { if (captureState.status === 'recording') stopCapture(); else if (captureState.status === 'starting') stopCapture({discard:true}); } });
  global.addEventListener('pagehide',function () { send('exit'); if (capture && ['recording','uploading'].indexOf(captureState.status) >= 0) stopCapture(); else if (captureState.status === 'starting') { if (captureSeries) captureSeries.continue=false; capture.cancelled=true; cancel(capture); } });
  global.Blaze = {
    init:function (options) { resetPlay();if (capture) stopCapture({discard:true});if(frameBridge)frameBridge.close(); if (!options || !options.sdkKey || !options.endpoint) throw new Error('endpoint and sdkKey are required'); if (options.test !== undefined && typeof options.test !== 'boolean') throw new Error('test must be a boolean'); var u = new URL(options.endpoint); if (!/^https?:$/.test(u.protocol)) throw new Error('Invalid endpoint'); active = false; config = {endpoint:u.origin,sdkKey:String(options.sdkKey),identityScope:typeof options.identityScope==='string' && /^[a-zA-Z0-9_-]{1,30}$/.test(options.identityScope)?options.identityScope:null,test:options.test === true,prefix:'gm_session_'+String(options.sdkKey)+'_'+(options.test === true ? 'test_' : '')}; if (options.consent === true) this.setConsent(true); },
    setConsent:function (consent) { if (!config) throw new Error('Initialize first'); if (global.__WEB_GAME_STUDIO_AGENT__ === true) { resetPlay();active = false; return; } if (consent !== true) { resetPlay();active = false; stopCapture({discard:true});if(frameBridge)frameBridge.close(); return; } if (active) return; config.playerId=config.identityScope?'scoped_'+config.identityScope+'_'+player('scope_'+config.identityScope):player(config.sdkKey);config.last=Number(read('sessionStorage',config.prefix+'last'))||0;config.sessionId=read('sessionStorage',config.prefix+'id');config.firstAction=read('sessionStorage',config.prefix+'first')==='1';if(!config.sessionId || Date.now()-config.last>30*60*1000)newSession();active = true;touch();emit('visit');if(document.readyState==='complete')emit('loaded');else global.addEventListener('load',function () { send('loaded'); },{once:true}); },
    track:function (name, properties) { send(name, properties); },
    startCapture:startCapture,
    stopCapture:stopCapture,
    getCaptureState:function () { return Object.assign({},captureState); },
    attachFrame:attachFrame,
    disable:function () { resetPlay();active = false; var cancelled=stopCapture({discard:true});if(frameBridge)frameBridge.close();return cancelled; }
  };
  // Compatibility alias for integrations installed before the Blaze rename.
  global.GameMarketing = global.Blaze;
})(window);
