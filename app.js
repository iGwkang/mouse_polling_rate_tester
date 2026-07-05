(function (globalScope) {
  const DEFAULT_SAMPLE_RETENTION_MS = 10000;
  const DEFAULT_SAMPLE_WINDOW_MS = 1000;

  function roundNumber(value, digits = 0) {
    if (!Number.isFinite(value)) return 0;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function clampSamples(samples, retentionMs = DEFAULT_SAMPLE_RETENTION_MS) {
    if (!Array.isArray(samples) || !samples.length) return [];
    if (!Number.isFinite(retentionMs) || retentionMs <= 0) return [...samples];
    const latestTime = samples[samples.length - 1].time;
    const cutoff = latestTime - retentionMs;
    return samples.filter((sample) => sample.time >= cutoff);
  }

  function computePollingStats(samples, options = {}) {
    const sampleWindowMs = Number.isFinite(options.sampleWindowMs)
      ? options.sampleWindowMs
      : DEFAULT_SAMPLE_WINDOW_MS;
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : undefined;
    const limited = clampSamples(samples, options.retentionMs);
    const eventCount = limited.length;
    const windowRates = buildSlidingWindowRates(limited, sampleWindowMs);
    const latestHz = computeSlidingWindowHz(limited, sampleWindowMs, nowMs);

    return {
      eventCount,
      validIntervals: eventCount,
      rejectedIntervals: 0,
      windowCount: windowRates.length,
      latestHz: roundNumber(latestHz),
      peakHz: roundNumber(windowRates.length ? Math.max(...windowRates) : 0),
      rates: windowRates,
    };
  }

  function buildWindowRates(samples, sampleWindowMs = DEFAULT_SAMPLE_WINDOW_MS) {
    if (!samples.length || sampleWindowMs <= 0) return [];
    const sorted = [...samples].sort((left, right) => left.time - right.time);
    const firstTime = sorted[0].time;
    const windows = new Map();

    sorted.forEach((sample) => {
      const windowIndex = Math.floor((sample.time - firstTime) / sampleWindowMs);
      windows.set(windowIndex, (windows.get(windowIndex) || 0) + 1);
    });

    return [...windows.keys()]
      .sort((left, right) => left - right)
      .map((windowIndex) => roundNumber((windows.get(windowIndex) * 1000) / sampleWindowMs));
  }

  function buildSlidingWindowRates(samples, sampleWindowMs = DEFAULT_SAMPLE_WINDOW_MS) {
    if (!samples.length || sampleWindowMs <= 0) return [];
    const sorted = [...samples].sort((left, right) => left.time - right.time);
    const rates = [];
    let startIndex = 0;

    for (let endIndex = 0; endIndex < sorted.length; endIndex += 1) {
      const endTime = sorted[endIndex].time;
      const startTime = endTime - sampleWindowMs;
      while (sorted[startIndex].time <= startTime && startIndex < endIndex) {
        startIndex += 1;
      }
      rates.push(((endIndex - startIndex + 1) * 1000) / sampleWindowMs);
    }

    return rates.map((rate) => roundNumber(rate));
  }

  function computeSlidingWindowHz(samples, sampleWindowMs = DEFAULT_SAMPLE_WINDOW_MS, nowMs) {
    if (!samples.length || sampleWindowMs <= 0) return 0;
    const endTime = Number.isFinite(nowMs) ? nowMs : samples[samples.length - 1].time;
    const startTime = endTime - sampleWindowMs;
    const count = samples.filter((sample) => sample.time > startTime && sample.time <= endTime).length;
    return (count * 1000) / sampleWindowMs;
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

  function shouldRefreshLatestReading(nowMs, lastRefreshMs, intervalMs) {
    return nowMs - lastRefreshMs >= intervalMs;
  }

  function createSessionCounters() {
    return {
      totalEventCount: 0,
      statPointCount: 0,
      peakHz: 0,
    };
  }

  function updateSessionCounters(counters, acceptedSampleCount) {
    const count = Number.isFinite(acceptedSampleCount) ? Math.max(0, Math.floor(acceptedSampleCount)) : 0;
    return {
      ...counters,
      totalEventCount: counters.totalEventCount + count,
      statPointCount: counters.statPointCount + count,
    };
  }

  function updateSessionPeak(counters, latestHz) {
    return {
      ...counters,
      peakHz: Math.max(counters.peakHz, roundNumber(latestHz)),
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      computePollingStats,
      buildWindowRates,
      buildSlidingWindowRates,
      computeSlidingWindowHz,
      createSessionCounters,
      expandMovementSamples,
      shouldAcceptMovementSample,
      shouldRefreshLatestReading,
      updateSessionCounters,
      updateSessionPeak,
    };
    return;
  }

  const state = {
    running: false,
    samples: [],
    usingPointerLock: false,
    eventName: 'mousemove',
    activeSource: '',
    frameId: 0,
    displayedLatestHz: 0,
    lastLatestRefreshMs: 0,
    latestRefreshIntervalMs: 250,
    counters: createSessionCounters(),
  };

  function getElements() {
    return {
      zone: document.querySelector('[data-test-zone]'),
      startButton: document.querySelector('[data-start]'),
      resetButton: document.querySelector('[data-reset]'),
      sampleLimit: document.querySelector('[data-sample-limit]'),
      status: document.querySelector('[data-status]'),
      source: document.querySelector('[data-source]'),
      support: document.querySelector('[data-support]'),
      latestHz: document.querySelector('[data-latest-hz]'),
      peakHz: document.querySelector('[data-peak-hz]'),
      eventCount: document.querySelector('[data-event-count]'),
      windowSize: document.querySelector('[data-window-size]'),
      windowCount: document.querySelector('[data-window-count]'),
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

  function resetSamples() {
    state.samples = [];
    state.displayedLatestHz = 0;
    state.lastLatestRefreshMs = 0;
    state.activeSource = '';
    state.counters = createSessionCounters();
    render();
  }

  function beginLockedTest() {
    const elements = getElements();
    if (document.pointerLockElement === elements.zone) {
      setRunning(false);
      return;
    }
    resetSamples();
    elements.status.textContent = '正在进入相对移动模式';
    requestPointerLock(elements.zone);
  }

  function onPointerLockChange() {
    const elements = getElements();
    state.usingPointerLock = document.pointerLockElement === elements.zone;
    elements.zone.classList.toggle('is-locked', state.usingPointerLock);
    if (state.usingPointerLock) {
      state.running = true;
      elements.startButton.textContent = '停止测试';
      elements.startButton.setAttribute('aria-pressed', 'true');
      elements.zone.classList.add('is-active');
      elements.status.textContent = '相对移动采样中';
    } else {
      state.running = false;
      elements.startButton.textContent = '开始测试';
      elements.startButton.setAttribute('aria-pressed', 'false');
      elements.zone.classList.remove('is-active');
      elements.status.textContent = state.samples.length > 1 ? '测试已结束' : '已暂停';
      render(true);
    }
  }

  function pushSample(event) {
    if (!state.running || !state.usingPointerLock) return;
    const dx = Number.isFinite(event.movementX) ? event.movementX : 0;
    const dy = Number.isFinite(event.movementY) ? event.movementY : 0;

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

    state.samples.push(...acceptedSamples);
    state.samples = clampSamples(state.samples, DEFAULT_SAMPLE_RETENTION_MS);
    state.counters = updateSessionCounters(state.counters, acceptedSamples.length);

    scheduleRender();
  }

  function scheduleRender() {
    if (state.frameId) return;
    state.frameId = requestAnimationFrame(() => {
      state.frameId = 0;
      render(false);
    });
  }

  function render(forceLatest = false) {
    const elements = getElements();
    const sampleWindowMs = Number(elements.sampleLimit.value);
    const nowMs = performance.now();
    const stats = computePollingStats(state.samples, { sampleWindowMs, nowMs });
    state.counters = updateSessionPeak(state.counters, Math.max(stats.latestHz, stats.peakHz));

    if (forceLatest || shouldRefreshLatestReading(nowMs, state.lastLatestRefreshMs, state.latestRefreshIntervalMs)) {
      state.displayedLatestHz = stats.latestHz;
      state.lastLatestRefreshMs = nowMs;
    }

    elements.source.textContent = state.activeSource || state.eventName;
    elements.support.textContent = describeSupport();
    elements.latestHz.textContent = formatHz(state.displayedLatestHz);
    elements.peakHz.textContent = formatHz(state.counters.peakHz);
    elements.eventCount.textContent = state.counters.totalEventCount.toLocaleString('zh-CN');
    elements.windowSize.textContent = formatSeconds(sampleWindowMs);
    elements.windowCount.textContent = state.counters.statPointCount.toLocaleString('zh-CN');
  }

  function bindApp() {
    const elements = getElements();
    state.eventName = detectEventName();

    elements.startButton.addEventListener('click', beginLockedTest);
    elements.resetButton.addEventListener('click', resetSamples);
    elements.sampleLimit.addEventListener('change', render);
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
    computePollingStats,
    buildWindowRates,
    buildSlidingWindowRates,
    computeSlidingWindowHz,
    createSessionCounters,
    expandMovementSamples,
    shouldAcceptMovementSample,
    shouldRefreshLatestReading,
    updateSessionCounters,
    updateSessionPeak,
  };
})(typeof window !== 'undefined' ? window : globalThis);
