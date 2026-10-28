(function () {
  var canvas=document.querySelector('#game'),ctx=canvas.getContext('2d'), status=document.querySelector('#status');
  var state={phase:'ready',player:1,star:1,y:0,score:0,misses:0,ticks:0};
  function emit(name,p){ if(window.GameMarketing) window.GameMarketing.track(name,p); }
  function start(){emit('first_action');var retry=state.phase!=='ready'; state={phase:'playing',player:1,star:1,y:0,score:0,misses:0,ticks:0};emit(retry?'retry':'round_start');draw();}
  function move(delta){if(state.phase!=='playing')return;state.player=Math.max(0,Math.min(2,state.player+delta));draw();}
  function draw(){ctx.clearRect(0,0,720,400);ctx.fillStyle='#223451';for(var i=1;i<3;i++)ctx.fillRect(i*240-2,0,4,400);ctx.fillStyle='#8ef0c5';ctx.fillRect(state.player*240+85,350,70,18);ctx.font='36px system-ui';ctx.fillText('★',state.star*240+100,state.y+40);ctx.fillStyle='#fff';ctx.font='18px system-ui';ctx.fillText('Caught '+state.score+' / 3',20,30); status.textContent=state.phase==='won'?'You caught three stars!':state.phase==='playing'?'Catch the star':'Press Start to play';}
  function tick(){if(state.phase==='playing'){state.y+=5;state.ticks++;if(state.y>=320){if(state.player===state.star){state.score++;emit('progression',{step:String(state.score)});}else state.misses++;if(state.score>=3){state.phase='won';emit('round_complete',{result:'win'});}state.y=0;state.star=(state.score+state.misses)%3;}draw();}requestAnimationFrame(tick);}
  document.querySelector('#start').onclick=start;document.querySelector('#left').onclick=function(){move(-1)};document.querySelector('#right').onclick=function(){move(1)};
  document.addEventListener('keydown',function(e){if(e.key==='ArrowLeft'){e.preventDefault();move(-1)}if(e.key==='ArrowRight'){e.preventDefault();move(1)}if(e.key==='Enter')start()});
  window.gameMarketingAdapter={getState:function(){return Object.assign({},state)},get actions(){return state.phase==='playing'?[{id:'left',label:'Move one lane left'},{id:'right',label:'Move one lane right'},{id:'wait',label:'Wait for the falling star'}]:[{id:'start',label:'Start or retry the round'}]},act:function(id){if(id==='start'&&state.phase!=='playing')start();else if(id==='left')move(-1);else if(id==='right')move(1);else if(id!=='wait')throw Error('Invalid action');}};
  document.querySelector('#enable-tracking').onclick=function(){var key=document.querySelector('#sdk-key').value.trim();if(!key){document.querySelector('#tracking-status').textContent='Enter the game SDK key first.';return;}window.GameMarketing.init({endpoint:location.origin,sdkKey:key,consent:true});document.querySelector('#tracking-status').textContent='Tracking enabled for this session.';};
  document.querySelector('#disable-tracking').onclick=function(){window.GameMarketing.disable();document.querySelector('#tracking-status').textContent='Tracking disabled.';};
  draw();requestAnimationFrame(tick);
})();
