(function () {
  'use strict';
  var phase = 'ready', selected = null;
  var canvas = document.querySelector('#game'), ctx = canvas.getContext('2d');
  var status = document.querySelector('#status');
  var choices = [{id:'left',label:'Choose the left star'},{id:'right',label:'Choose the right star'}];
  function draw() {
    ctx.clearRect(0,0,720,400);
    ctx.font = '64px system-ui';
    ctx.fillStyle = selected === 'right' ? '#536179' : '#8ef0c5'; ctx.fillText('★',160,210);
    ctx.fillStyle = selected === 'left' ? '#536179' : '#8ef0c5'; ctx.fillText('★',480,210);
    status.textContent = selected ? 'Selected ' + selected + ' · controlled lab' : 'Ready · controlled lab';
  }
  function act(id) {
    if (phase !== 'ready' || (id !== 'left' && id !== 'right')) throw new Error('Invalid lab action');
    selected = id;
    phase = id === 'left' ? 'won' : 'complete';
    draw();
  }
  window.gameMarketingAdapter = {
    getState: function () { return {phase:phase, selected:selected, lab:'decision-validation-v1'}; },
    get actions() { return phase === 'ready' ? choices.map(function (choice) { return Object.assign({},choice); }) : []; },
    act: act
  };
  document.querySelector('#left').onclick = function () { act('left'); };
  document.querySelector('#right').onclick = function () { act('right'); };
  draw();
})();
