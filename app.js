(function (globalScope) {
  const POLLING_WINDOW_MS = 500;
  const TICK_INTERVAL_MS = 500;

  function roundNumber(value, digits = 0) {
    if (!Number.isFinite(value)) return 0;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function countEventsInWindow(eventTimes, windowMs = POLLING_WINDOW_MS, nowMs) {
    if (!Array.isArray(eventTimes) || !eventTimes.length) return 0;
    if (!Number.isFinite(windowMs) || windowMs <= 0) return eventTimes.length;
    const endMs = Number.isFinite(nowMs) ? nowMs : eventTimes[eventTimes.length - 1];
    const cutoff = endMs - windowMs;
    let count = 0;
    for (let index = eventTimes.length - 1; index >= 0; index -= 1) {
      if (eventTimes[index] < cutoff) break;
      count += 1;
    }
    return count;
  }

  function pruneEventTimes(eventTimes, windowMs = POLLING_WINDOW_MS, nowMs) {
    if (!Array.isArray(eventTimes) || !eventTimes.length) return [];
    if (!Number.isFinite(windowMs) || windowMs <= 0) return [...eventTimes];
    const endMs = Number.isFinite(nowMs) ? nowMs : eventTimes[eventTimes.length - 1];
    const cutoff = endMs - windowMs;
    let startIndex = 0;
    while (startIndex < eventTimes.length && eventTimes[startIndex] < cutoff) {
      startIndex += 1;
    }
    return startIndex > 0 ? eventTimes.slice(startIndex) : eventTimes;
  }

  function updatePeakHz(peakHz, currentHz) {
    return Math.max(peakHz, roundNumber(currentHz));
  }

  function computePollingRateHz(eventTimes, windowMs = POLLING_WINDOW_MS, nowMs) {
    const count = countEventsInWindow(eventTimes, windowMs, nowMs);
    if (!Number.isFinite(windowMs) || windowMs <= 0) return 0;
    return roundNumber((count * 1000) / windowMs);
  }

  function expandMovementSamples(event, nowMs = performance.now()) {
    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    const events = coalesced.length ? coalesced : [event];
    const baseTimeStamp = Number.isFinite(event.timeStamp) ? event.timeStamp : nowMs;

    return events
      .filter(shouldAcceptMovementSample)
      .map((movementEvent) => {
        const eventTimeStamp = Number.isFinite(movementEvent.timeStamp) ? movementEvent.timeStamp : baseTimeStamp;
        return {
          time: nowMs + (eventTimeStamp - baseTimeStamp),
          dx: Number.isFinite(movementEvent.movementX) ? movementEvent.movementX : 0,
          dy: Number.isFinite(movementEvent.movementY) ? movementEvent.movementY : 0,
          source: event.type,
        };
      });
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
      countEventsInWindow,
      pruneEventTimes,
      computePollingRateHz,
      updatePeakHz,
      expandMovementSamples,
      shouldAcceptMovementSample,
      createSessionState,
      POLLING_WINDOW_MS,
      TICK_INTERVAL_MS,
    };
    return;
  }

  const state = {
    running: false,
    eventTimes: [],
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
    state.eventTimes = [];
    state.activeSource = '';
    state.session = createSessionState();
    render();
  }

  function startStatsTimer() {
    stopStatsTimer();
    state.statsTimerId = window.setInterval(tickStats, getSampleWindowMs());
  }

  function stopStatsTimer() {
    if (!state.statsTimerId) return;
    window.clearInterval(state.statsTimerId);
    state.statsTimerId = 0;
  }

  function tickStats() {
    if (!state.running || !state.usingPointerLock) return;

    const windowMs = getSampleWindowMs();
    const nowMs = performance.now();
    state.eventTimes = pruneEventTimes(state.eventTimes, windowMs, nowMs);
    const currentHz = computePollingRateHz(state.eventTimes, windowMs, nowMs);

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

      if (state.eventTimes.length) {
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

    const acceptedSamples = expandMovementSamples(event, performance.now());
    if (!acceptedSamples.length) return;

    acceptedSamples.forEach((sample) => {
      state.eventTimes.push(sample.time);
    });
    state.session.totalEventCount += acceptedSamples.length;
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
    countEventsInWindow,
    pruneEventTimes,
    computePollingRateHz,
    updatePeakHz,
    expandMovementSamples,
    shouldAcceptMovementSample,
    createSessionState,
    POLLING_WINDOW_MS,
    TICK_INTERVAL_MS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
