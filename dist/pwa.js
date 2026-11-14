/* Install and offline status; document contents never enter the offline cache. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const dialog=$('pwa-dialog'),installButton=$('pwa-install-button'),statusButton=$('pwa-status');
  if(!dialog||!installButton||!statusButton)return;
  const isWeb=['https:','http:'].includes(location.protocol);
  if(!isWeb){installButton.hidden=true;statusButton.hidden=true;return;}
  let registration=null,deferredPrompt=null,offlineReady=false,controlled=Boolean(navigator.serviceWorker?.controller),applying=false,offlineFailed=false;
  let installed=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const baseURL=new URL('./',location.href).href;
  const instructions=()=>{
    if(installed)return 'Installed on this device. Open it from your Dock, Start menu or app launcher.';
    if(/iPhone|iPad|iPod/.test(navigator.userAgent))return 'In Safari, tap Share, choose Add to Home Screen, then Add.';
    if(/Safari/.test(navigator.userAgent)&&!/Chrome|Chromium|CriOS|Edg/.test(navigator.userAgent))return 'On Mac, choose File → Add to Dock in Safari.';
    return 'In Chrome or Edge, choose the install icon in the address bar or Install page as app in the browser menu.';
  };
  function render(){
    installButton.hidden=installed;
    statusButton.dataset.ready=String(offlineReady);
    statusButton.dataset.update=String(Boolean(registration?.waiting));
    $('pwa-status-label').textContent=registration?.waiting?'Update ready':offlineReady?(navigator.onLine?'Available offline':'Offline · drafts local'):offlineFailed?'Offline setup pending':'Preparing offline…';
    $('pwa-offline-title').textContent=offlineReady?'Ready for offline editing':offlineFailed?'Offline setup is not complete':'Preparing offline editing';
    $('pwa-offline-detail').textContent=offlineReady?'The editor, languages, diff checker, Markdown preview and schema generator are saved on this device. You can reopen this address without an internet connection.':offlineFailed?'The editor still works online. Check your connection and retry to make it available offline.':'Keep this page open with an internet connection while offline setup completes.';
    $('pwa-install-instructions').textContent=instructions();
    $('pwa-install-confirm').hidden=installed||!deferredPrompt;
    $('pwa-update-card').hidden=!registration?.waiting;
    $('pwa-apply-update').hidden=!registration?.waiting;
  }
  function openInfo(){
    render();
    if(!dialog.open)dialog.showModal();
    $('pwa-close').focus();
  }
  function message(worker,type,timeout=10000){
    return new Promise((resolve,reject)=>{
      if(!worker){reject(Error('No active worker'));return;}
      const channel=new MessageChannel();
      const timer=setTimeout(()=>{channel.port1.close();reject(Error('Offline setup did not respond'));},timeout);
      channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data);};
      worker.postMessage({type},[channel.port2]);
    });
  }
  function failedSetup(error){
    offlineFailed=true;
    if(error?.message)console.warn("[Note Studio Pro] Offline setup:",error.message);
    if(!offlineReady){$('pwa-status-label').textContent='Offline setup pending';$('pwa-offline-title').textContent='Offline setup is not complete';$('pwa-offline-detail').textContent='The editor still works online. Check your connection and retry to make it available offline.';}
    $('pwa-retry').hidden=offlineReady;
  }
  async function refreshStatus(){
    const worker=registration?.active;
    if(!worker)return;
    try{
      const result=await message(worker,'GET_STATUS');
      offlineReady=Boolean(result.offlineReady);
      render();$('pwa-retry').hidden=offlineReady;
      if(!offlineReady)failedSetup();
    }catch{failedSetup();}
  }
  async function install(){
    if(installed){openInfo();return;}
    if(!deferredPrompt){openInfo();return;}
    const prompt=deferredPrompt;deferredPrompt=null;render();
    try{
      await prompt.prompt();
      const choice=await prompt.userChoice;
      if(choice.outcome==='accepted'){installed=true;dialog.close();}
    }catch{openInfo();}
    render();
  }
  installButton.addEventListener('click',()=>{void install();});
  $('pwa-install-confirm').addEventListener('click',()=>{void install();});
  statusButton.addEventListener('click',openInfo);
  $('pwa-close').addEventListener('click',()=>dialog.close());
  $('pwa-done').addEventListener('click',()=>dialog.close());
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredPrompt=event;render();});
  window.addEventListener('appinstalled',()=>{installed=true;deferredPrompt=null;render();if(dialog.open)dialog.close();});
  window.addEventListener('online',()=>{render();void refreshStatus();});
  window.addEventListener('offline',render);
  $('pwa-apply-update').addEventListener('click',async()=>{
    if(applying||!registration?.waiting)return;
    if(!window.dispatchEvent(new Event('note-studio:before-update',{cancelable:true}))){$('pwa-update-detail').textContent='Your draft could not be saved locally. Export a workspace backup before updating.';return;}
    applying=true;$('pwa-apply-update').disabled=true;
    try{
      const result=await message(registration.waiting,'ACTIVATE_UPDATE');
      if(result.multipleWindows){$('pwa-update-detail').textContent='Close other Note Studio Pro tabs and windows, then apply the update here. This keeps their open drafts safe.';applying=false;$('pwa-apply-update').disabled=false;}
    }catch{applying=false;$('pwa-apply-update').disabled=false;$('pwa-update-detail').textContent='The update could not be applied. Keep editing and try again when online.';}
  });
  $('pwa-retry').addEventListener('click',async()=>{
    $('pwa-retry').disabled=true;
    try{
      if(!registration?.active)await register();
      if(registration?.active)await message(registration.active,'REFRESH_CACHE',60000);
      await registration?.update();
      await refreshStatus();
    }catch{failedSetup();}
    finally{$('pwa-retry').disabled=false;}
  });
  async function register(){
    if(!('serviceWorker'in navigator)||!window.isSecureContext){failedSetup(Error('Service workers are unavailable in this browser or the page is not a secure context.'));return;}
    registration=await navigator.serviceWorker.register(new URL('sw.js',baseURL),{scope:baseURL,updateViaCache:'none'});
    if(registration.waiting)render();
    const observe=worker=>{
      if(!worker)return;
      worker.addEventListener('statechange',()=>{
        if(worker.state==='installed'||worker.state==='activated'){render();void refreshStatus();}
        if(worker.state==='redundant')failedSetup();
      });
    };
    observe(registration.installing);
    registration.addEventListener('updatefound',()=>observe(registration.installing));
    if(registration.active)await refreshStatus();
  }
  if('serviceWorker'in navigator)navigator.serviceWorker.addEventListener('message',event=>{
    if(event.data?.type==='NOTE_STUDIO_CACHE_ERROR')failedSetup(Error(event.data.message));
  });
  if('serviceWorker'in navigator)navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(controlled){
      if(window.dispatchEvent(new Event('note-studio:before-update',{cancelable:true})))location.reload();
      else{$('pwa-update-detail').textContent='Save a backup before reopening the updated app.';applying=false;$('pwa-apply-update').disabled=false;}
    }
    controlled=true;void refreshStatus();
  });
  render();
  void register().catch(failedSetup);
})();
