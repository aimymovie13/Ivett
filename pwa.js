(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const dialog = byId('install-dialog');
  const bar = byId('app-bar');
  const trigger = byId('install-open');
  const nativeButton = byId('install-native');
  const retryButton = byId('install-retry');
  const updateButton = byId('install-update');
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const displayMode = window.matchMedia('(display-mode: standalone)');
  let installed = displayMode.matches || navigator.standalone === true;
  let installPrompt = null;
  let registration = null;
  let ready = false;
  let checking = false;
  let updating = false;
  let setupPromise = null;
  let returnedFocus = null;

  function selectPlatform(platform) {
    for (const name of ['ios', 'android']) {
      const selected = name === platform;
      byId('tab-' + name).setAttribute('aria-selected', String(selected));
      byId('tab-' + name).tabIndex = selected ? 0 : -1;
      byId('guide-' + name).hidden = !selected;
    }
  }
  selectPlatform(ios ? 'ios' : 'android');
  for (const name of ['ios', 'android']) {
    byId('tab-' + name).addEventListener('click', () => selectPlatform(name));
    byId('tab-' + name).addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const next = name === 'ios' ? 'android' : 'ios';
      selectPlatform(next);
      byId('tab-' + next).focus();
    });
  }

  function renderInstall() {
    trigger.textContent = installed ? 'Offline infó' : '↓ Telepítés';
    byId('install-guides').hidden = installed;
    byId('already-installed').hidden = !installed;
    nativeButton.hidden = installed || !installPrompt;
    nativeButton.disabled = !ready;
  }

  function setStatus(isReady, message, failed = false) {
    ready = isReady;
    bar.dataset.ready = String(ready);
    bar.dataset.error = String(failed);
    byId('offline-text').textContent = ready
      ? (navigator.onLine ? 'Offline játékra kész' : 'Offline játék • indulhat a mentés!')
      : message;
    const detail = byId('offline-detail');
    detail.dataset.ready = String(ready);
    detail.textContent = ready
      ? '✓ A játék és mind a 7 kép elmentve erre az eszközre. A hangokhoz sem kell internet.'
      : message;
    retryButton.hidden = !failed;
    renderInstall();
  }

  function openDialog() {
    returnedFocus = document.activeElement;
    window.dispatchEvent(new CustomEvent('ivett:install-open'));
    dialog.showModal();
    void checkOffline();
  }
  trigger.addEventListener('click', openDialog);
  byId('install-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    window.dispatchEvent(new CustomEvent('ivett:install-close'));
    returnedFocus?.focus();
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    renderInstall();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    installPrompt = null;
    renderInstall();
  });
  displayMode.addEventListener?.('change', event => {
    installed = event.matches || navigator.standalone === true;
    renderInstall();
  });
  nativeButton.addEventListener('click', async () => {
    if (!installPrompt || !ready) return;
    const prompt = installPrompt;
    installPrompt = null;
    try {
      await prompt.prompt();
      await prompt.userChoice;
      navigator.storage?.persist?.().catch(() => {});
    } catch {
      byId('install-feedback').textContent = 'A böngésző menüjéből is telepítheted az alkalmazást az alábbi lépésekkel.';
    }
    renderInstall();
  });

  function askWorker(type) {
    return new Promise((resolve, reject) => {
      const worker = navigator.serviceWorker.controller || registration?.active;
      if (!worker) return reject(new Error('No active worker'));
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        channel.port1.close();
        reject(new Error('Offline check timed out'));
      }, type === 'SAVE_OFFLINE' ? 45000 : 10000);
      channel.port1.onmessage = event => {
        clearTimeout(timer);
        channel.port1.close();
        resolve(event.data);
      };
      worker.postMessage({type}, [channel.port2]);
    });
  }

  async function checkOffline(repair = false) {
    if (checking || !registration?.active) return;
    checking = true;
    try {
      let result = await askWorker('GET_OFFLINE_STATUS');
      if (!result.ready && repair && navigator.onLine) {
        setStatus(false, 'Játék letöltése az offline használathoz…');
        result = await askWorker('SAVE_OFFLINE');
      }
      setStatus(result.ready, navigator.onLine
        ? 'Az offline mentés még nincs kész. Próbáld újra.'
        : 'Az offline mentéshez először internet kell.', !result.ready);
    } catch {
      setStatus(false, 'Az offline mentést nem sikerült ellenőrizni. Próbáld újra.', true);
    } finally {
      checking = false;
    }
  }

  function offerUpdate() {
    updateButton.hidden = !(navigator.serviceWorker.controller && registration?.waiting &&
      registration.waiting !== navigator.serviceWorker.controller);
  }
  updateButton.addEventListener('click', () => {
    if (!registration?.waiting) return;
    updating = true;
    updateButton.disabled = true;
    updateButton.textContent = 'Frissítés…';
    registration.waiting.postMessage({type: 'SKIP_WAITING'});
  });

  async function setup() {
    if (setupPromise) return setupPromise;
    setupPromise = (async () => {
      if (!('serviceWorker' in navigator) || !window.isSecureContext) {
        setStatus(false, 'Az offline telepítéshez nyisd meg a játéklinket Safariban vagy Chrome-ban.');
        return;
      }
      setStatus(false, 'Játék letöltése az offline használathoz…');
      const watchdog = setTimeout(() => {
        if (!ready) setStatus(false, 'A letöltés még nem készült el. Ellenőrizd az internetkapcsolatot.', true);
      }, 30000);
      try {
        registration = await navigator.serviceWorker.register('./sw.js', {scope: './', updateViaCache: 'none'});
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' || worker.state === 'activated') offerUpdate();
            if (worker.state === 'redundant' && !ready) setStatus(false, 'A letöltés megszakadt. Próbáld újra internetkapcsolattal.', true);
          });
        });
        offerUpdate();
        registration = await navigator.serviceWorker.ready;
        clearTimeout(watchdog);
        offerUpdate();
        await checkOffline(true);
      } catch {
        clearTimeout(watchdog);
        setStatus(false, 'Az offline mentés nem sikerült. Nyisd meg Chrome-ban vagy Safariban, és próbáld újra.', true);
      }
    })().finally(() => {setupPromise = null;});
    return setupPromise;
  }

  retryButton.addEventListener('click', async () => {
    if (registration?.active) await checkOffline(true);
    else {
      // Retry the registration even when an earlier first install is still pending.
      setupPromise = null;
      await setup();
    }
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      offerUpdate();
      if (updating) location.reload();
      else void checkOffline();
    });
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'OFFLINE_STATUS' && event.source === navigator.serviceWorker.controller) {
        setStatus(event.data.ready, 'Az offline mentés még nincs kész.', !event.data.ready);
      }
    });
  }
  window.addEventListener('online', () => {
    if (registration?.active) void checkOffline(true);
    else void setup();
  });
  window.addEventListener('offline', () => void checkOffline());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void checkOffline();
  });
  renderInstall();
  void setup();
})();
