(function (globalScope) {
  const POLLING_WINDOW_MS = 500;
  const TICK_INTERVAL_MS = 500;

  function roundNumber(value, digits = 0) {
    if (!Number.isFinite(value)) return 0;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function computePollingRateHzFromCount(eventCount, timeDeltaMs) {
    const count = Number.isFinite(eventCount) ? Math.max(0, Math.floor(eventCount)) : 0;
    const deltaMs = Number.isFinite(timeDeltaMs) ? timeDeltaMs : 0;
    if (deltaMs <= 0 || count === 0) return 0;
    return roundNumber((count * 1000) / deltaMs);
  }

  function updatePeakHz(peakHz, currentHz) {
    return Math.max(peakHz, roundNumber(currentHz));
  }

  function shouldAcceptMovementSample(event) {
    const dx = Number.isFinite(event.movementX) ? event.movementX : 0;
    const dy = Number.isFinite(event.movementY) ? event.movementY : 0;
    return dx !== 0 || dy !== 0;
  }

  function createSessionState() {
    return {
      totalEventCount: 0,
      currentHz: 0,
      peakHz: 0,
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      computePollingRateHzFromCount,
      updatePeakHz,
      shouldAcceptMovementSample,
      createSessionState,
      POLLING_WINDOW_MS,
      TICK_INTERVAL_MS,
    };
    return;
  }

  const state = {
    running: false,
    windowEventCount: 0,
    lastTickMs: 0,
    usingPointerLock: false,
    eventName: 'mousemove',
    activeSource: '',
    statsTimerId: 0,
    session: createSessionState(),
  };

  function getElements() {
    return {
      zone: document.querySelector('[data-test-zone]'),
      startButton: document.querySelector('[data-start]'),
      resetButton: document.querySelector('[data-reset]'),
      status: document.querySelector('[data-status]'),
      source: document.querySelector('[data-source]'),
      support: document.querySelector('[data-support]'),
      latestHz: document.querySelector('[data-latest-hz]'),
      peakHz: document.querySelector('[data-peak-hz]'),
      eventCount: document.querySelector('[data-event-count]'),
      sampleLimit: document.querySelector('[data-sample-limit]'),
      windowSize: document.querySelector('[data-window-size]'),
    };
  }

  function detectEventName() {
    return 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'mousemove';
  }

  function describeSupport() {
    const raw = 'onpointerrawupdate' in window ? '支持 pointerrawupdate' : '不支持 pointerrawupdate，使用 mousemove';
    const lock = 'pointerLockElement' in document ? '支持 Pointer Lock' : '不支持 Pointer Lock';
    return `${raw}；${lock}`;
  }

  function formatHz(value) {
    return value > 0 ? `${value.toLocaleString('zh-CN')} Hz` : '-- Hz';
  }

  function formatSeconds(ms) {
    return `${(ms / 1000).toLocaleString('zh-CN')} s`;
  }

  function getSampleWindowMs() {
    const value = Number(getElements().sampleLimit.value);
    return Number.isFinite(value) && value > 0 ? value : POLLING_WINDOW_MS;
  }

  function setRunning(nextRunning) {
    const elements = getElements();
    state.running = nextRunning;
    elements.startButton.textContent = nextRunning ? '停止测试' : '开始测试';
    elements.startButton.setAttribute('aria-pressed', String(nextRunning));
    elements.zone.classList.toggle('is-active', nextRunning);
    elements.status.textContent = nextRunning ? '相对移动采样中' : '已暂停';

    if (!nextRunning && document.pointerLockElement === elements.zone) {
      document.exitPointerLock();
    }
  }

  async function requestPointerLock(zone) {
    if (!zone.requestPointerLock) {
      getElements().status.textContent = '当前浏览器不支持 Pointer Lock';
      return;
    }
    try {
      await zone.requestPointerLock({ unadjustedMovement: true });
    } catch (error) {
      try {
        await zone.requestPointerLock();
      } catch (_) {
        getElements().status.textContent = 'Pointer Lock 请求被浏览器拒绝，无法开始测试';
      }
    }
  }

  function resetSession() {
    stopStatsTimer();
    state.windowEventCount = 0;
    state.lastTickMs = 0;
    state.activeSource = '';
    state.session = createSessionState();
    render();
  }

  function startStatsTimer() {
    stopStatsTimer();
    state.lastTickMs = 0;
    state.statsTimerId = window.setInterval(tickStats, getSampleWindowMs());
  }

  function stopStatsTimer() {
    if (!state.statsTimerId) return;
    window.clearInterval(state.statsTimerId);
    state.statsTimerId = 0;
  }

  function tickStats() {
    if (!state.running || !state.usingPointerLock) return;

    const timerMs = getSampleWindowMs();
    const nowMs = performance.now();
    const timeDeltaMs = state.lastTickMs > 0 ? nowMs - state.lastTickMs : timerMs;
    if (timeDeltaMs <= 0) return;

    const currentHz = computePollingRateHzFromCount(state.windowEventCount, timeDeltaMs);
    state.windowEventCount = 0;
    state.lastTickMs = nowMs;

    state.session.currentHz = currentHz;
    state.session.peakHz = updatePeakHz(state.session.peakHz, currentHz);
    render();
  }

  function onSampleLimitChange() {
    if (state.statsTimerId) {
      startStatsTimer();
    }
    if (state.running && state.usingPointerLock) {
      tickStats();
    } else {
      render();
    }
  }

  function beginLockedTest() {
    const elements = getElements();
    if (document.pointerLockElement === elements.zone) {
      setRunning(false);
      return;
    }
    elements.status.textContent = '正在进入相对移动模式';
    requestPointerLock(elements.zone);
  }

  function onPointerLockChange() {
    const elements = getElements();
    state.usingPointerLock = document.pointerLockElement === elements.zone;
    elements.zone.classList.toggle('is-locked', state.usingPointerLock);

    if (state.usingPointerLock) {
      resetSession();
      state.running = true;
      elements.startButton.textContent = '停止测试';
      elements.startButton.setAttribute('aria-pressed', 'true');
      elements.zone.classList.add('is-active');
      elements.status.textContent = '相对移动采样中';
      startStatsTimer();
    } else {
      stopStatsTimer();
      state.running = false;
      elements.startButton.textContent = '开始测试';
      elements.startButton.setAttribute('aria-pressed', 'false');
      elements.zone.classList.remove('is-active');
      elements.status.textContent = state.session.totalEventCount > 0 ? '测试已结束' : '已暂停';

      if (state.windowEventCount > 0) {
        tickStats();
      } else {
        render();
      }
    }
  }

  function pushSample(event) {
    if (!state.running || !state.usingPointerLock) return;
    if (!shouldAcceptMovementSample(event)) return;

    if (event.type === 'pointerrawupdate') {
      state.activeSource = 'pointerrawupdate';
    } else if (state.activeSource === 'pointerrawupdate') {
      return;
    } else {
      state.activeSource = 'mousemove';
    }

    state.windowEventCount += 1;
    state.session.totalEventCount += 1;
  }

  function render() {
    const elements = getElements();

    elements.source.textContent = state.activeSource || state.eventName;
    elements.support.textContent = describeSupport();
    elements.latestHz.textContent = formatHz(state.session.currentHz);
    elements.peakHz.textContent = formatHz(state.session.peakHz);
    elements.eventCount.textContent = state.session.totalEventCount.toLocaleString('zh-CN');
    elements.windowSize.textContent = formatSeconds(getSampleWindowMs());
  }

  function bindApp() {
    const elements = getElements();
    state.eventName = detectEventName();

    elements.startButton.addEventListener('click', beginLockedTest);
    elements.resetButton.addEventListener('click', resetSession);
    elements.sampleLimit.addEventListener('change', onSampleLimitChange);
    elements.zone.addEventListener('click', beginLockedTest);
    window.addEventListener('mousemove', pushSample, { passive: true });
    if (state.eventName === 'pointerrawupdate') {
      window.addEventListener('pointerrawupdate', pushSample, { passive: true });
    }
    document.addEventListener('pointerlockchange', onPointerLockChange);

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindApp);
  } else {
    bindApp();
  }

  globalScope.MousePollingStats = {
    computePollingRateHzFromCount,
    updatePeakHz,
    shouldAcceptMovementSample,
    createSessionState,
    POLLING_WINDOW_MS,
    TICK_INTERVAL_MS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
