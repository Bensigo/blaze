(function () {
  var canvas=document.querySelector('#game'),ctx=canvas.getContext('2d'), status=document.querySelector('#status');
  var state={phase:'ready',player:1,star:1,y:0,score:0,misses:0,ticks:0};
  function emit(name,p){ if(window.Blaze) window.Blaze.track(name,p); }
  function start(){emit('first_action');var retry=state.phase!=='ready'; state={phase:'playing',player:1,star:1,y:0,score:0,misses:0,ticks:0};emit(retry?'retry':'round_start');draw();}
  function move(delta){if(state.phase!=='playing')return;state.player=Math.max(0,Math.min(2,state.player+delta));draw();}
  function draw(){ctx.clearRect(0,0,720,400);ctx.fillStyle='#223451';for(var i=1;i<3;i++)ctx.fillRect(i*240-2,0,4,400);ctx.fillStyle='#8ef0c5';ctx.fillRect(state.player*240+85,350,70,18);ctx.font='36px system-ui';ctx.fillText('★',state.star*240+100,state.y+40);ctx.fillStyle='#fff';ctx.font='18px system-ui';ctx.fillText('Caught '+state.score+' / 3',20,30); status.textContent=state.phase==='won'?'You caught three stars!':state.phase==='playing'?'Catch the star':'Press Start to play';}
  function tick(){if(state.phase==='playing'){state.y+=5;state.ticks++;if(state.y>=320){if(state.player===state.star){state.score++;emit('progression',{step:String(state.score)});}else state.misses++;if(state.score>=3){state.phase='won';emit('round_complete',{result:'win'});}state.y=0;state.star=(state.score+state.misses)%3;}draw();}requestAnimationFrame(tick);}
  document.querySelector('#start').onclick=start;document.querySelector('#left').onclick=function(){move(-1)};document.querySelector('#right').onclick=function(){move(1)};
  document.addEventListener('keydown',function(e){if(e.key==='ArrowLeft'){e.preventDefault();move(-1)}if(e.key==='ArrowRight'){e.preventDefault();move(1)}if(e.key==='Enter')start()});
  document.querySelector('#enable-tracking').onclick=function(){var key=document.querySelector('#sdk-key').value.trim();if(!key){document.querySelector('#tracking-status').textContent='Enter the game SDK key first.';return;}window.Blaze.init({endpoint:location.origin,sdkKey:key,consent:true});document.querySelector('#tracking-status').textContent='Tracking enabled for this session.';};
  document.querySelector('#disable-tracking').onclick=function(){window.Blaze.disable();document.querySelector('#tracking-status').textContent='Tracking disabled.';};
  var captureStatus=document.querySelector('#capture-status');
  function showCapture(state) {
    var messages={idle:'Recording is off.',starting:'Checking recording availability…',recording:'Recording the game canvas. Stop to save or discard.',uploading:'Saving recording…',ready:'Recording saved privately.',cancelled:'Recording discarded.',consent_required:'Opt in to tracking and recording first.',not_sampled:'This session was not selected for recording.',quota_reached:'The game’s daily recording limit has been reached.',disabled:'The game owner has not enabled recording.',unsupported:'Recording is not supported in this browser.',failed:'Recording could not be saved.'};
    captureStatus.textContent=(messages[state.status]||'Recording unavailable.')+(state.reason?' ('+state.reason+')':'');
  }
  window.addEventListener('blaze:capturestatus',function(e){showCapture(e.detail)});
  document.querySelector('#start-capture').onclick=async function(){showCapture(await window.Blaze.startCapture({consent:true}));};
  document.querySelector('#stop-capture').onclick=async function(){showCapture(await window.Blaze.stopCapture());};
  document.querySelector('#discard-capture').onclick=async function(){showCapture(await window.Blaze.stopCapture({discard:true}));};
  draw();requestAnimationFrame(tick);
})();
