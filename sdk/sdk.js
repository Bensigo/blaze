/* Game Marketing SDK. No data is sent or stored until consent is granted. */
(function (global) {
  'use strict';
  var config = null, active = false, lastPointer = 0, lastTimestamp = 0;
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
    var u = new URL(location.href), campaign = u.searchParams.get('utm_campaign') || '', source = u.searchParams.get('utm_source') || '';
    var event = { id:id(), name:name, sessionId:config.sessionId, playerId:config.playerId, timestamp:new Date(lastTimestamp = Math.max(Date.now(), lastTimestamp + 1)).toISOString(), properties:props(properties), page:safeUrl(location.href), referrer:safeUrl(document.referrer), campaign:campaign.slice(0,100), source:source.slice(0,100), device:/Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop' };
    fetch(config.endpoint + '/api/collect', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({sdkKey:config.sdkKey, events:[event]}), keepalive:true, credentials:'omit'}).catch(function () {});
  }
  function newSession() {config.sessionId=id();config.firstAction=false;write('sessionStorage',config.prefix+'id',config.sessionId);write('sessionStorage',config.prefix+'first','0');}
  function touch() {config.last=Date.now();write('sessionStorage',config.prefix+'last',String(config.last));}
  function send(name, properties) {
    if (!active || !config || names.indexOf(name) < 0) return;
    if(Date.now()-config.last>30*60*1000){newSession();touch();emit('visit');if(document.readyState==='complete')emit('loaded');}
    if(name==='first_action'){if(config.firstAction)return;config.firstAction=true;write('sessionStorage',config.prefix+'first','1');}
    touch();emit(name,properties);
  }
  function pointer(event) {
    if (!active || Date.now() - lastPointer < 1000) return;
    lastPointer = Date.now();
    send('pointer',{x:Math.max(0,Math.min(1,event.clientX / Math.max(1,innerWidth))),y:Math.max(0,Math.min(1,event.clientY / Math.max(1,innerHeight)))});
  }
  document.addEventListener('pointerdown',pointer, {passive:true});
  global.addEventListener('pagehide',function () { send('exit'); });
  global.GameMarketing = {
    init:function (options) { if (!options || !options.sdkKey || !options.endpoint) throw new Error('endpoint and sdkKey are required'); var u = new URL(options.endpoint); if (!/^https?:$/.test(u.protocol)) throw new Error('Invalid endpoint'); active = false; config = {endpoint:u.origin,sdkKey:String(options.sdkKey),prefix:'gm_session_'+String(options.sdkKey)+'_'}; if (options.consent === true) this.setConsent(true); },
    setConsent:function (consent) { if (!config) throw new Error('Initialize first'); if (consent !== true) { active = false; return; } if (active) return; config.playerId=player(config.sdkKey);config.last=Number(read('sessionStorage',config.prefix+'last'))||0;config.sessionId=read('sessionStorage',config.prefix+'id');config.firstAction=read('sessionStorage',config.prefix+'first')==='1';if(!config.sessionId || Date.now()-config.last>30*60*1000)newSession();active = true;touch();emit('visit');if(document.readyState==='complete')emit('loaded');else global.addEventListener('load',function () { send('loaded'); },{once:true}); },
    track:function (name, properties) { send(name, properties); },
    disable:function () { active = false; }
  };
})(window);
