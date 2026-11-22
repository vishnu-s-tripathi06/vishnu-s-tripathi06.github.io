/**
 * Coding Activity — interactive 3D GitHub / LeetCode calendar.
 *
 * The module is deliberately dependency-light: Three.js is imported lazily the
 * first time the section approaches the viewport. Data comes from the JSON
 * files maintained by scripts/fetch-*-activity.mjs. A 2D DOM fallback is used
 * when WebGL (or the Three.js module) is unavailable.
 */

(function () {
  'use strict';

  const section = document.getElementById('activity');
  if (!section) return;

  const DATA_URLS = {
    github: 'data/github-activity.json',
    leetcode: 'data/leetcode-activity.json',
  };

  const PLATFORM_META = {
    github: {
      name: 'GitHub',
      unit: 'contributions',
      caption: 'Public GitHub contributions over the last 12 months.',
      pending:
        'The first automated sync has not completed yet. This calendar will fill in after the next scheduled update.',
      unavailable:
        'The GitHub activity file could not be loaded. The rest of the portfolio is unaffected.',
      profile: 'https://github.com/vishnu-s-tripathi06',
      profileLabel: 'GitHub profile ↗',
    },
    leetcode: {
      name: 'LeetCode',
      unit: 'submissions',
      caption:
        'LeetCode submissions over the last 12 months. Counts are submissions, not unique problems solved.',
      pending:
        'The first automated sync has not completed yet. This calendar will fill in after the next scheduled update.',
      unavailable:
        'The LeetCode activity file could not be loaded. The rest of the portfolio is unaffected.',
      profile: 'https://leetcode.com/u/vishnu-s-tripathi06/',
      profileLabel: 'LeetCode profile ↗',
    },
  };

  const STATUS_ICONS = {
    loading: '<i class="fa-solid fa-circle-notch" aria-hidden="true"></i>',
    pending: '<i class="fa-solid fa-hourglass-half" aria-hidden="true"></i>',
    error: '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>',
  };

  const els = {
    toggleButtons: Array.from(section.querySelectorAll('[data-platform]')),
    total: document.getElementById('activity-total'),
    totalLabel: document.getElementById('activity-total-label'),
    activeDays: document.getElementById('activity-active-days'),
    range: document.getElementById('activity-range'),
    caption: document.getElementById('activity-caption'),
    stage: document.getElementById('activity-stage'),
    canvas: document.getElementById('activity-canvas'),
    fallback: document.getElementById('activity-fallback'),
    status: document.getElementById('activity-status'),
    statusIcon: document.getElementById('activity-status-icon'),
    statusTitle: document.getElementById('activity-status-title'),
    statusText: document.getElementById('activity-status-text'),
    statusRetry: document.getElementById('activity-status-retry'),
    tooltip: document.getElementById('activity-tooltip'),
    tooltipDate: document.getElementById('activity-tooltip-date'),
    tooltipCount: document.getElementById('activity-tooltip-count'),
    tooltipUnit: document.getElementById('activity-tooltip-unit'),
    legend: document.getElementById('activity-legend'),
    summary: document.getElementById('activity-summary'),
    live: document.getElementById('activity-live'),
    profile: document.getElementById('activity-profile-link'),
  };

  const state = {
    platform: 'leetcode',
    datasets: { github: null, leetcode: null },
    started: false,
    visualReady: false,
    visualMode: null,
    scene: null,
    fallback: null,
    visible: false,
    reduceMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };

  const numberFormatter = new Intl.NumberFormat();
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const rangeFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const monthFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  // -------------------------------------------------------------------------
  // Small helpers
  // -------------------------------------------------------------------------

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function formatNumber(value) {
    return numberFormatter.format(value);
  }

  function toUtcDate(dateString) {
    return new Date(`${dateString}T00:00:00.000Z`);
  }

  function formatDate(dateString) {
    const date = toUtcDate(dateString);
    return Number.isNaN(date.getTime()) ? dateString : dateFormatter.format(date);
  }

  function formatRange(start, end) {
    if (!start || !end) return '—';
    return `${rangeFormatter.format(toUtcDate(start))} – ${rangeFormatter.format(
      toUtcDate(end)
    )}`;
  }

  function formatMonth(monthKey) {
    return monthFormatter.format(toUtcDate(`${monthKey}-01`));
  }

  function isValidDateString(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const date = toUtcDate(value);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function isDarkTheme() {
    // script.js removes the attribute for light mode, so the attribute is the
    // authoritative signal for this site.
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function readPalette() {
    const styles = getComputedStyle(section);
    const palette = [];
    for (let index = 0; index < 5; index += 1) {
      palette.push(styles.getPropertyValue(`--activity-l${index}`).trim() || '#0071e3');
    }
    return palette;
  }

  function readAccent() {
    return (
      getComputedStyle(section).getPropertyValue('--activity-accent').trim() ||
      '#0071e3'
    );
  }

  function makeElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  }

  function announce(message) {
    if (!els.live) return;
    els.live.textContent = message;
  }

  function hideTooltip() {
    if (els.tooltip) els.tooltip.classList.remove('is-visible');
  }

  // -------------------------------------------------------------------------
  // Data loading / validation
  // -------------------------------------------------------------------------

  async function loadDataset(platform) {
    try {
      const response = await fetch(DATA_URLS[platform], { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const raw = await response.json();
      return normalizeDataset(raw, platform);
    } catch (error) {
      console.warn(`Could not load ${platform} activity:`, error);
      return { status: 'error', platform, days: [], total: 0, activeDays: 0 };
    }
  }

  function normalizeDataset(raw, platform) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('activity data is not an object');
    }
    if (raw.platform !== platform) {
      throw new Error('activity data belongs to another platform');
    }

    const unit =
      typeof raw.unit === 'string' && raw.unit.trim()
        ? raw.unit.trim()
        : PLATFORM_META[platform].unit;

    if (raw.status === 'pending') {
      const range =
        raw.range &&
        isValidDateString(raw.range.start) &&
        isValidDateString(raw.range.end)
          ? { start: raw.range.start, end: raw.range.end }
          : null;

      return {
        status: 'pending',
        platform,
        unit,
        generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : null,
        range,
        total: 0,
        activeDays: 0,
        days: [],
      };
    }

    if (raw.status !== 'ok') {
      throw new Error('activity data has an unknown status');
    }
    if (!Array.isArray(raw.days) || raw.days.length < 300) {
      throw new Error('activity data is missing its day records');
    }

    const days = raw.days
      .map((day, index) => {
        if (!day || typeof day !== 'object' || Array.isArray(day)) {
          throw new Error(`day ${index} is not an object`);
        }
        if (!isValidDateString(day.date)) {
          throw new Error(`day ${index} has an invalid date`);
        }
        if (!Number.isInteger(day.count) || day.count < 0) {
          throw new Error(`day ${index} has an invalid count`);
        }
        return { date: day.date, count: day.count };
      })
      .sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));

    for (let index = 1; index < days.length; index += 1) {
      if (days[index].date === days[index - 1].date) {
        throw new Error(`duplicate date ${days[index].date}`);
      }
    }

    const total = days.reduce((sum, day) => sum + day.count, 0);
    const activeDays = days.filter((day) => day.count > 0).length;

    return {
      status: 'ok',
      platform,
      unit,
      generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : null,
      range: { start: days[0].date, end: days[days.length - 1].date },
      total,
      activeDays,
      days,
    };
  }

  function buildCells(dataset) {
    const startWeekday = toUtcDate(dataset.days[0].date).getUTCDay();
    const columns =
      Math.floor((dataset.days.length - 1 + startWeekday) / 7) + 1;

    const cells = dataset.days.map((day, index) => ({
      date: day.date,
      count: day.count,
      index,
      week: Math.floor((index + startWeekday) / 7),
      row: (index + startWeekday) % 7,
    }));

    return { cells, columns, startWeekday };
  }

  function scaleMaximum(cells) {
    const counts = cells
      .map((cell) => cell.count)
      .filter((count) => count > 0)
      .sort((left, right) => left - right);

    if (counts.length === 0) return 1;
    const index = Math.min(counts.length - 1, Math.floor(counts.length * 0.95));
    return Math.max(1, counts[index]);
  }

  function levelFor(count, maximum) {
    if (count <= 0) return 0;
    const normalized = Math.min(1, Math.pow(count / maximum, 0.6));
    return Math.min(4, 1 + Math.floor(normalized * 4));
  }

  function heightFor(count, maximum) {
    if (count <= 0) return 0.055;
    const normalized = Math.min(1, Math.pow(count / maximum, 0.62));
    return 0.18 + normalized * 2.35;
  }

  function longestStreak(days) {
    let longest = 0;
    let current = 0;
    for (const day of days) {
      if (day.count > 0) {
        current += 1;
        if (current > longest) longest = current;
      } else {
        current = 0;
      }
    }
    return longest;
  }

  // -------------------------------------------------------------------------
  // Stats, text summary, toggle, status
  // -------------------------------------------------------------------------

  function updateStats(dataset) {
    const meta = PLATFORM_META[state.platform];
    els.totalLabel.textContent = dataset?.unit || meta.unit;

    if (dataset && dataset.status === 'ok') {
      els.total.textContent = formatNumber(dataset.total);
      els.activeDays.textContent = formatNumber(dataset.activeDays);
      els.range.textContent = formatRange(dataset.range.start, dataset.range.end);
      return;
    }

    els.total.textContent = '—';
    els.activeDays.textContent = '—';
    els.range.textContent =
      dataset?.status === 'pending' ? 'Awaiting first sync' : 'Unavailable';
  }

  function renderTextSummary(dataset) {
    if (!els.summary) return;
    const meta = PLATFORM_META[state.platform];
    els.summary.textContent = '';

    if (!dataset || dataset.status !== 'ok') {
      els.summary.appendChild(
        makeElement(
          'p',
          'activity-summary-text',
          dataset?.status === 'pending'
            ? `${meta.name} activity is still pending.`
            : `${meta.name} activity is currently unavailable.`
        )
      );
      return;
    }

    const peak = dataset.days.reduce(
      (best, day) => (day.count > best.count ? day : best),
      dataset.days[0]
    );
    const streak = longestStreak(dataset.days);

    let sentence =
      `${meta.name}: ${formatNumber(dataset.total)} ${dataset.unit} across ` +
      `${formatNumber(dataset.activeDays)} active days.`;
    if (streak > 1) sentence += ` Longest streak: ${streak} days.`;
    if (peak.count > 0) {
      sentence += ` Peak day: ${formatDate(peak.date)} with ${formatNumber(
        peak.count
      )} ${dataset.unit}.`;
    }

    els.summary.appendChild(makeElement('p', 'activity-summary-text', sentence));

    const months = new Map();
    for (const day of dataset.days) {
      const key = day.date.slice(0, 7);
      const entry = months.get(key) || { total: 0, activeDays: 0 };
      entry.total += day.count;
      if (day.count > 0) entry.activeDays += 1;
      months.set(key, entry);
    }

    const table = makeElement('table', 'activity-month-table');
    const caption = makeElement(
      'caption',
      'activity-sr-only',
      `Monthly ${meta.name} ${dataset.unit}`
    );
    table.appendChild(caption);

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.appendChild(makeElement('th', null, 'Month'));
    headRow.appendChild(makeElement('th', null, meta.unit === 'contributions' ? 'Contributions' : 'Submissions'));
    headRow.appendChild(makeElement('th', null, 'Active days'));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const [key, entry] of months) {
      const row = document.createElement('tr');
      row.appendChild(makeElement('th', null, formatMonth(key)));
      row.lastChild.setAttribute('scope', 'row');
      row.appendChild(makeElement('td', null, formatNumber(entry.total)));
      row.appendChild(makeElement('td', null, formatNumber(entry.activeDays)));
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    els.summary.appendChild(table);
  }

  function updateToggle() {
    for (const button of els.toggleButtons) {
      const active = button.dataset.platform === state.platform;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  function updateCanvasLabel(dataset) {
    const meta = PLATFORM_META[state.platform];
    if (dataset && dataset.status === 'ok') {
      els.canvas.setAttribute(
        'aria-label',
        `Interactive 3D ${meta.name} calendar: ${formatNumber(
          dataset.total
        )} ${dataset.unit} across ${formatNumber(
          dataset.activeDays
        )} active days. Use the arrow keys to inspect individual days.`
      );
    } else {
      els.canvas.setAttribute(
        'aria-label',
        `${meta.name} activity is not available. Use the platform toggle or the text summary.`
      );
    }
  }

  function showStatus(kind, dataset) {
    const meta = PLATFORM_META[state.platform];
    els.status.hidden = false;
    els.status.dataset.kind = kind;
    els.statusIcon.innerHTML = STATUS_ICONS[kind] || STATUS_ICONS.pending;

    if (kind === 'loading') {
      els.statusTitle.textContent = 'Loading activity';
      els.statusText.textContent = 'Preparing the calendar…';
      els.statusRetry.hidden = true;
    } else if (kind === 'pending') {
      els.statusTitle.textContent = `${meta.name} is pending`;
      let text = meta.pending;
      const other = state.platform === 'github' ? 'leetcode' : 'github';
      if (state.datasets[other]?.status === 'ok') {
        text += ` ${PLATFORM_META[other].name} activity is available from the toggle above.`;
      }
      els.statusText.textContent = text;
      els.statusRetry.hidden = true;
    } else {
      els.statusTitle.textContent = `${meta.name} is unavailable`;
      els.statusText.textContent = meta.unavailable;
      els.statusRetry.hidden = false;
    }

    els.stage.classList.add('has-status');
    els.legend.hidden = true;
    hideTooltip();
    if (state.scene) state.scene.clearDataset();
    if (state.fallback) state.fallback.clear();
  }

  function hideStatus() {
    els.status.hidden = true;
    els.status.removeAttribute('data-kind');
    els.stage.classList.remove('has-status');
    els.legend.hidden = false;
  }

  function updatePlatformUI() {
    const meta = PLATFORM_META[state.platform];
    const dataset = state.datasets[state.platform];

    section.dataset.platform = state.platform;
    updateToggle();
    els.caption.textContent = meta.caption;
    els.profile.href = meta.profile;
    els.profile.textContent = meta.profileLabel;

    updateStats(dataset);
    renderTextSummary(dataset);
    updateCanvasLabel(dataset);

    if (!state.visualReady) {
      showStatus('loading');
      return;
    }

    if (dataset && dataset.status === 'ok') {
      hideStatus();
      if (state.scene) {
        // Un-hide before measuring: the canvas must have a layout box when the
        // renderer sizes itself.
        els.canvas.hidden = false;
        els.fallback.hidden = true;
        state.scene.setDataset(dataset);
      } else if (state.fallback) {
        els.canvas.hidden = true;
        els.fallback.hidden = false;
        state.fallback.render(dataset);
      } else {
        // Still initialising (Three.js imports are async): keep the loading
        // overlay until the visual is ready, then re-render this platform.
        showStatus('loading');
      }
      return;
    }

    showStatus(dataset?.status === 'pending' ? 'pending' : 'error');
  }

  function setPlatform(platform) {
    if (!PLATFORM_META[platform] || platform === state.platform) return;
    state.platform = platform;
    updatePlatformUI();

    const dataset = state.datasets[platform];
    if (dataset?.status === 'ok') {
      announce(
        `${PLATFORM_META[platform].name} activity selected: ${formatNumber(
          dataset.total
        )} ${dataset.unit} across ${formatNumber(dataset.activeDays)} active days.`
      );
    } else {
      announce(
        `${PLATFORM_META[platform].name} activity is ${
          dataset?.status === 'pending' ? 'pending' : 'unavailable'
        }.`
      );
    }
  }

  async function retryCurrentPlatform() {
    const platform = state.platform;
    els.statusRetry.disabled = true;
    els.statusRetry.textContent = 'Retrying…';

    const dataset = await loadDataset(platform);
    state.datasets[platform] = dataset;

    els.statusRetry.disabled = false;
    els.statusRetry.textContent = 'Try again';

    if (dataset.status === 'ok' && !state.visualMode) {
      await ensureVisual();
    }
    updatePlatformUI();
  }

  // -------------------------------------------------------------------------
  // 3D visualization
  // -------------------------------------------------------------------------

  function canUseWebGL() {
    try {
      const testCanvas = document.createElement('canvas');
      return Boolean(
        window.WebGLRenderingContext &&
          (testCanvas.getContext('webgl2') || testCanvas.getContext('webgl'))
      );
    } catch {
      return false;
    }
  }

  async function init3D() {
    if (!canUseWebGL()) {
      throw new Error('WebGL is not available');
    }

    const [THREE, orbitModule, roundedModule] = await Promise.all([
      import('./vendor/three/three.module.js'),
      import('./vendor/three/OrbitControls.js'),
      import('./vendor/three/RoundedBoxGeometry.js'),
    ]);

    const { OrbitControls } = orbitModule;
    const { RoundedBoxGeometry } = roundedModule;

    const renderer = new THREE.WebGLRenderer({
      canvas: els.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 600);
    const controls = new OrbitControls(camera, els.canvas);
    controls.enableDamping = !state.reduceMotion;
    controls.dampingFactor = 0.065;
    controls.enablePan = false;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.7;
    controls.minPolarAngle = 0.12;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.zoomToCursor = true;
    controls.target.set(0, 0.6, 0);

    const hemisphere = new THREE.HemisphereLight(0xffffff, 0xdbe4f3, 2.5);
    scene.add(hemisphere);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.7);
    keyLight.position.set(-16, 30, 20);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -34;
    keyLight.shadow.camera.right = 34;
    keyLight.shadow.camera.top = 20;
    keyLight.shadow.camera.bottom = -20;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 100;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    keyLight.shadow.camera.updateProjectionMatrix();
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xdfe9ff, 1.05);
    fillLight.position.set(24, 12, -18);
    scene.add(fillLight);

    const cyanLight = new THREE.PointLight(0x00f0ff, 0, 120, 1.8);
    cyanLight.position.set(-24, 14, 10);
    scene.add(cyanLight);

    const magentaLight = new THREE.PointLight(0xff007f, 0, 120, 1.8);
    magentaLight.position.set(24, 12, -10);
    scene.add(magentaLight);

    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 26),
      new THREE.ShadowMaterial({
        color: 0x000000,
        opacity: 0.16,
        transparent: true,
        depthWrite: false,
      })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -0.02;
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);

    const glowTexture = (() => {
      const size = 256;
      const glowCanvas = document.createElement('canvas');
      glowCanvas.width = size;
      glowCanvas.height = size;
      const context = glowCanvas.getContext('2d');
      const gradient = context.createRadialGradient(
        size / 2,
        size / 2,
        0,
        size / 2,
        size / 2,
        size / 2
      );
      gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
      gradient.addColorStop(0.45, 'rgba(255,255,255,0.35)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
      const texture = new THREE.CanvasTexture(glowCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    })();

    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 22),
      new THREE.MeshBasicMaterial({
        map: glowTexture,
        color: 0x0071e3,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        blending: THREE.NormalBlending,
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -0.03;
    scene.add(glow);

    const MAX_BLOCKS = 400;
    const geometry = new RoundedBoxGeometry(0.82, 1, 0.82, 2, 0.09);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.38,
      metalness: 0.15,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_BLOCKS);
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.visible = false;

    const initialColor = new THREE.Color(0xffffff);
    for (let index = 0; index < MAX_BLOCKS; index += 1) {
      mesh.setColorAt(index, initialColor);
    }
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);

    const outlineGeometry = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(0.84, 1, 0.84)
    );
    const selectedMaterial = new THREE.LineBasicMaterial({
      color: 0x0071e3,
      transparent: true,
      opacity: 0.95,
    });
    const hoverMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
    });
    const selectedOutline = new THREE.LineSegments(outlineGeometry, selectedMaterial);
    const hoverOutline = new THREE.LineSegments(outlineGeometry, hoverMaterial);
    selectedOutline.visible = false;
    hoverOutline.visible = false;
    selectedOutline.renderOrder = 2;
    hoverOutline.renderOrder = 2;
    scene.add(selectedOutline, hoverOutline);

    const dummy = new THREE.Object3D();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    let active = null;
    let maximum = 1;
    let currentHeights = [];
    let targetHeights = [];
    let animation = null;
    let hoverIndex = -1;
    let selectedIndex = -1;
    let activeTooltipIndex = -1;
    let pointerDown = null;
    let rafId = null;
    let pendingFrame = false;
    let dragging = false;
    let hasFitted = false;
    let resizeFrame = null;

    function updateMatrices() {
      if (!active) return;

      for (let index = 0; index < active.cells.length; index += 1) {
        const cell = active.cells[index];
        const height = Math.max(currentHeights[index] ?? 0.055, 0.001);
        dummy.position.set(
          cell.week - (active.columns - 1) / 2,
          height / 2,
          cell.row - 3
        );
        dummy.scale.set(1, height, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    function applyColors() {
      if (!active) return;
      const palette = readPalette().map((color) => new THREE.Color(color));
      for (let index = 0; index < active.cells.length; index += 1) {
        mesh.setColorAt(
          index,
          palette[levelFor(active.cells[index].count, maximum)]
        );
      }
      mesh.instanceColor.needsUpdate = true;
    }

    function placeOutline(outline, index) {
      if (!active || index < 0 || index >= active.cells.length) return;
      const cell = active.cells[index];
      const height = Math.max(currentHeights[index] ?? 0.055, 0.06);
      outline.position.set(
        cell.week - (active.columns - 1) / 2,
        height / 2,
        cell.row - 3
      );
      outline.scale.set(1.035, height * 1.02 + 0.02, 1.035);
    }

    function updateOutlines() {
      const hasActive = Boolean(active);
      selectedOutline.visible = hasActive && selectedIndex >= 0;
      hoverOutline.visible =
        hasActive && hoverIndex >= 0 && hoverIndex !== selectedIndex;
      if (selectedOutline.visible) placeOutline(selectedOutline, selectedIndex);
      if (hoverOutline.visible) placeOutline(hoverOutline, hoverIndex);
    }

    function refreshOutlinePositions() {
      if (selectedOutline.visible) placeOutline(selectedOutline, selectedIndex);
      if (hoverOutline.visible) placeOutline(hoverOutline, hoverIndex);
    }

    function refreshTooltip() {
      const index = hoverIndex >= 0 ? hoverIndex : selectedIndex;
      if (index >= 0 && active) {
        showTooltip(index);
      } else {
        hideTooltip();
      }
    }

    function showTooltip(index) {
      if (!active || index < 0 || index >= active.cells.length) return;
      const cell = active.cells[index];
      const dataset = state.datasets[state.platform];
      const unit = dataset?.unit || PLATFORM_META[state.platform].unit;

      els.tooltipDate.textContent = formatDate(cell.date);
      els.tooltipCount.textContent = formatNumber(cell.count);
      els.tooltipUnit.textContent = unit;
      els.tooltip.classList.add('is-visible');
      activeTooltipIndex = index;
      positionTooltip(index);
    }

    function hideTooltip() {
      els.tooltip.classList.remove('is-visible');
      activeTooltipIndex = -1;
    }

    function positionTooltip(index) {
      if (!active || index < 0 || index >= active.cells.length) return;
      const cell = active.cells[index];
      const height = currentHeights[index] ?? 0.055;
      const projected = new THREE.Vector3(
        cell.week - (active.columns - 1) / 2,
        height + 0.12,
        cell.row - 3
      ).project(camera);

      const rect = els.stage.getBoundingClientRect();
      const left = (projected.x * 0.5 + 0.5) * rect.width;
      const top = (-projected.y * 0.5 + 0.5) * rect.height;
      const below = top < 74;
      const maxLeft = Math.max(70, rect.width - 70);

      els.tooltip.classList.toggle('is-below', below);
      els.tooltip.style.left = `${clamp(left, 70, maxLeft)}px`;
      els.tooltip.style.top = `${clamp(top, 10, rect.height - 10)}px`;
    }

    function announceDay(index) {
      if (!active || index < 0 || index >= active.cells.length) return;
      const cell = active.cells[index];
      const dataset = state.datasets[state.platform];
      const unit = dataset?.unit || PLATFORM_META[state.platform].unit;
      announce(`${formatDate(cell.date)}: ${formatNumber(cell.count)} ${unit}.`);
    }

    function selectIndex(index) {
      selectedIndex = index;
      hoverIndex = -1;
      updateOutlines();
      refreshTooltip();
      renderOnce();
      announceDay(index);
    }

    function clearSelection() {
      selectedIndex = -1;
      updateOutlines();
      refreshTooltip();
      renderOnce();
    }

    function setPointerFromEvent(event) {
      const rect = els.canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function pickIndex() {
      if (!active || !mesh.visible) return -1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(mesh, false);
      if (!hits.length) return -1;
      const instanceId = hits[0].instanceId;
      return instanceId !== undefined && instanceId < active.cells.length
        ? instanceId
        : -1;
    }

    function onPointerMove(event) {
      if (event.pointerType === 'touch' || !active) return;
      setPointerFromEvent(event);
      const index = pickIndex();
      if (index === hoverIndex) return;
      hoverIndex = index;
      updateOutlines();
      refreshTooltip();
      renderOnce();
    }

    function onPointerLeave() {
      if (!active) return;
      if (hoverIndex === -1) return;
      hoverIndex = -1;
      updateOutlines();
      refreshTooltip();
      renderOnce();
    }

    function onPointerDown(event) {
      pointerDown = { x: event.clientX, y: event.clientY };
    }

    function onPointerUp(event) {
      if (!pointerDown || !active) {
        pointerDown = null;
        return;
      }
      const distance = Math.hypot(
        event.clientX - pointerDown.x,
        event.clientY - pointerDown.y
      );
      pointerDown = null;
      if (distance > 8) return;

      setPointerFromEvent(event);
      const index = pickIndex();
      if (index >= 0) {
        selectIndex(index);
      } else {
        clearSelection();
      }
    }

    function onKeyDown(event) {
      if (!active) return;
      const key = event.key;
      let next = selectedIndex >= 0 ? selectedIndex : active.cells.length - 1;

      if (key === 'ArrowLeft') next -= 1;
      else if (key === 'ArrowRight') next += 1;
      else if (key === 'ArrowUp') next -= 7;
      else if (key === 'ArrowDown') next += 7;
      else if (key === 'Home') next = 0;
      else if (key === 'End') next = active.cells.length - 1;
      else return;

      event.preventDefault();
      next = clamp(next, 0, active.cells.length - 1);
      selectedIndex = next;
      hoverIndex = -1;
      updateOutlines();
      refreshTooltip();
      renderOnce();
      announceDay(next);
    }

    function onCanvasFocus() {
      if (!active || selectedIndex >= 0) return;
      selectedIndex = active.cells.length - 1;
      hoverIndex = -1;
      updateOutlines();
      refreshTooltip();
      renderOnce();
      announceDay(selectedIndex);
    }

    function requestRender() {
      startLoop();
    }

    function renderOnce() {
      requestRender();
    }

    function renderFrame() {
      rafId = null;
      pendingFrame = false;

      if (!state.visible || document.hidden) {
        // Parked off-screen; freeze the entrance animation instead of letting
        // it silently complete while nobody can see it.
        if (animation) {
          animation.start = performance.now() - animation.elapsed;
        }
        return;
      }

      if (animation) {
        const now = performance.now();
        const elapsed = now - animation.start;
        let finished = true;
        for (let index = 0; index < active.cells.length; index += 1) {
          const cell = active.cells[index];
          const local = clamp(
            (elapsed - cell.week * animation.stagger) / animation.duration,
            0,
            1
          );
          const eased = 1 - Math.pow(1 - local, 3);
          currentHeights[index] =
            animation.from[index] +
            (animation.to[index] - animation.from[index]) * eased;
          if (local < 1) finished = false;
        }
        updateMatrices();
        refreshOutlinePositions();
        if (finished) {
          currentHeights = animation.to.slice();
          animation = null;
          updateMatrices();
          refreshOutlinePositions();
        } else {
          animation.elapsed = elapsed;
        }
      }

      controls.update();
      if (activeTooltipIndex >= 0) positionTooltip(activeTooltipIndex);
      renderer.render(scene, camera);

      if (animation || dragging) startLoop();
    }

    // Render only when something changes: a dataset swap, a theme change, a
    // resize, an active camera drag / zoom / entrance animation, or a queued
    // hover update. A static scene costs nothing while it is on screen.
    function startLoop() {
      if (rafId !== null || pendingFrame || !state.visualReady || !state.visible) {
        return;
      }
      pendingFrame = true;
      rafId = requestAnimationFrame(renderFrame);
    }

    function stopLoop() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      pendingFrame = false;
    }

    function onControlsStart() {
      dragging = true;
    }

    function onControlsEnd() {
      dragging = false;
    }

    function fitCamera() {
      if (!active) return;
      const rect = els.stage.getBoundingClientRect();
      if (rect.width < 100) return;

      const aspect = Math.max(0.3, rect.width / Math.max(1, rect.height));
      const verticalFov = (camera.fov * Math.PI) / 180;
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
      const distanceToWidth =
        (active.columns / 2 + 1.2) / Math.tan(horizontalFov / 2);
      const distance = Math.max(distanceToWidth * 1.08, 24);

      camera.position.set(distance * 0.16, distance * 0.76, distance * 0.63);
      controls.target.set(0, 0.6, 0);
      controls.minDistance = Math.max(8, distance * 0.22);
      controls.maxDistance = distance * 2.4;
      controls.update();
      hasFitted = true;
    }

    function resize() {
      const rect = els.stage.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      // A zero-sized canvas (hidden behind a status overlay) makes the old
      // camera distance meaningless, so always refit when layout changes.
      fitCamera();
      renderOnce();
    }

    function applyTheme() {
      const dark = isDarkTheme();
      const accent = readAccent();

      selectedMaterial.color.set(accent);
      hoverMaterial.color.set(dark ? 0xffffff : 0x1d1d1f);

      hemisphere.color.set(dark ? 0xbfe9ff : 0xffffff);
      hemisphere.groundColor.set(dark ? 0x050608 : 0xdbe4f3);
      hemisphere.intensity = dark ? 1.7 : 2.5;

      keyLight.color.set(dark ? 0xdffaff : 0xffffff);
      keyLight.intensity = dark ? 2.3 : 2.7;
      keyLight.castShadow = !dark;

      fillLight.color.set(dark ? 0x7c3aed : 0xdfe9ff);
      fillLight.intensity = dark ? 0.9 : 1.05;

      cyanLight.intensity = dark ? 380 : 0;
      magentaLight.intensity = dark ? 380 : 0;

      renderer.toneMappingExposure = dark ? 1.15 : 1.02;
      renderer.shadowMap.enabled = !dark;
      material.needsUpdate = true;

      shadowPlane.visible = !dark;
      shadowPlane.material.opacity = dark ? 0 : 0.16;

      glow.material.color.set(accent);
      glow.material.opacity = dark ? 0.32 : 0.1;
      glow.material.blending = dark
        ? THREE.AdditiveBlending
        : THREE.NormalBlending;
      glow.material.needsUpdate = true;

      if (active) {
        applyColors();
        updateOutlines();
      }
      renderOnce();
    }

    function setDataset(dataset) {
      active = buildCells(dataset);
      maximum = scaleMaximum(active.cells);
      targetHeights = active.cells.map((cell) => heightFor(cell.count, maximum));

      if (currentHeights.length !== targetHeights.length) {
        currentHeights = targetHeights.map(() => 0.001);
      }

      mesh.count = active.cells.length;
      mesh.visible = true;
      applyColors();

      selectedIndex = -1;
      hoverIndex = -1;
      updateOutlines();
      hideTooltip();

      if (state.reduceMotion) {
        currentHeights = targetHeights.slice();
        animation = null;
        updateMatrices();
      } else {
        animation = {
          start: performance.now(),
          elapsed: 0,
          from: currentHeights.slice(),
          to: targetHeights.slice(),
          duration: 620,
          stagger: 5,
        };
        updateMatrices();
      }

      if (!hasFitted) fitCamera();
      startLoop();
      renderOnce();
    }

    function clearDataset() {
      active = null;
      mesh.visible = false;
      mesh.count = 0;
      selectedIndex = -1;
      hoverIndex = -1;
      animation = null;
      currentHeights = [];
      targetHeights = [];
      selectedOutline.visible = false;
      hoverOutline.visible = false;
      hideTooltip();
      stopLoop();
      renderOnce();
    }

    els.canvas.addEventListener('pointermove', onPointerMove, { passive: true });
    els.canvas.addEventListener('pointerleave', onPointerLeave);
    els.canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
    els.canvas.addEventListener('pointerup', onPointerUp);
    els.canvas.addEventListener('pointercancel', () => {
      pointerDown = null;
    });
    els.canvas.addEventListener('keydown', onKeyDown);
    els.canvas.addEventListener('focus', onCanvasFocus);

    controls.addEventListener('start', () => {
      dragging = true;
      startLoop();
    });
    controls.addEventListener('end', () => {
      dragging = false;
    });
    controls.addEventListener('change', () => {
      if (dragging) startLoop();
      else renderOnce();
    });

    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        resize();
      });
    });
    resizeObserver.observe(els.stage);

    const stageObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        state.visible = entry.isIntersecting;
        if (state.visible) startLoop();
        else stopLoop();
      },
      { threshold: 0.01 }
    );
    stageObserver.observe(els.stage);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopLoop();
      else if (state.visible) startLoop();
    });

    resize();
    applyTheme();

    state.scene = {
      setDataset,
      clearDataset,
      refreshTheme: applyTheme,
      startLoop,
      stopLoop,
    };
  }

  // -------------------------------------------------------------------------
  // 2D fallback
  // -------------------------------------------------------------------------

  function initFallback() {
    const grid = makeElement('div', 'activity-fallback-grid');
    grid.setAttribute('aria-hidden', 'true');
    els.fallback.textContent = '';
    els.fallback.appendChild(grid);
    els.fallback.hidden = false;
    els.canvas.hidden = true;

    let current = null;

    function fallbackLabel(dataset) {
      const meta = PLATFORM_META[state.platform];
      return `${meta.name} activity: ${formatNumber(dataset.total)} ${
        dataset.unit
      } across ${formatNumber(dataset.activeDays)} active days, ${formatRange(
        dataset.range.start,
        dataset.range.end
      )}.`;
    }

    function showTooltip(cell, event) {
      const dataset = current;
      if (!dataset) return;
      const rect = els.stage.getBoundingClientRect();
      els.tooltipDate.textContent = formatDate(cell.date);
      els.tooltipCount.textContent = formatNumber(cell.count);
      els.tooltipUnit.textContent = dataset.unit;
      els.tooltip.classList.remove('is-below');
      els.tooltip.classList.add('is-visible');
      els.tooltip.style.left = `${clamp(
        event.clientX - rect.left,
        70,
        Math.max(70, rect.width - 70)
      )}px`;
      els.tooltip.style.top = `${clamp(
        event.clientY - rect.top,
        10,
        rect.height - 10
      )}px`;
    }

    function cellFromEvent(event) {
      const target = event.target.closest('.activity-fallback-cell[data-index]');
      if (!target || !current) return null;
      const index = Number(target.dataset.index);
      if (!Number.isInteger(index) || index < 0 || index >= current.days.length) {
        return null;
      }
      return current.days[index];
    }

    grid.addEventListener('pointerover', (event) => {
      const cell = cellFromEvent(event);
      if (cell) showTooltip(cell, event);
    });
    grid.addEventListener('pointermove', (event) => {
      const cell = cellFromEvent(event);
      if (cell) showTooltip(cell, event);
    });
    grid.addEventListener('pointerleave', hideTooltip);
    grid.addEventListener('click', (event) => {
      const cell = cellFromEvent(event);
      if (cell) {
        showTooltip(cell, event);
        announce(
          `${formatDate(cell.date)}: ${formatNumber(cell.count)} ${current.unit}.`
        );
      } else {
        hideTooltip();
      }
    });

    function render(dataset) {
      current = dataset;
      const palette = readPalette();
      const maximum = scaleMaximum(
        dataset.days.map((day, index) => ({
          date: day.date,
          count: day.count,
          index,
        }))
      );
      const { cells, columns, startWeekday } = buildCells(dataset);

      grid.textContent = '';
      grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;

      for (let index = 0; index < startWeekday; index += 1) {
        const blank = makeElement('span', 'activity-fallback-cell is-blank');
        grid.appendChild(blank);
      }

      for (const cell of cells) {
        const cellElement = makeElement('span', 'activity-fallback-cell');
        cellElement.dataset.index = String(cell.index);
        cellElement.title = `${formatDate(cell.date)} — ${formatNumber(
          cell.count
        )} ${dataset.unit}`;

        const bar = makeElement('span', 'activity-fallback-bar');
        const level = levelFor(cell.count, maximum);
        const height =
          cell.count <= 0
            ? 6
            : Math.max(
                14,
                Math.min(100, Math.pow(cell.count / maximum, 0.62) * 100)
              );
        bar.style.height = `${height}%`;
        bar.style.background = palette[level];
        cellElement.appendChild(bar);
        grid.appendChild(cellElement);
      }

      els.fallback.setAttribute('aria-label', fallbackLabel(dataset));
      hideTooltip();
    }

    function clear() {
      current = null;
      grid.textContent = '';
      hideTooltip();
    }

    function refreshTheme() {
      if (current) render(current);
    }

    state.fallback = { render, clear, refreshTheme };
  }

  async function ensureVisual() {
    if (state.visualMode) return;

    try {
      await init3D();
      state.visualMode = '3d';
    } catch (error) {
      console.warn('3D activity calendar unavailable; using 2D fallback.', error);
      initFallback();
      state.visualMode = '2d';
    }
    state.visualReady = true;
    // The pending/error branches above deliberately skipped rendering because
    // the visual was not ready yet; paint whichever platform is selected now.
    updatePlatformUI();
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  async function start() {
    if (state.started) return;
    state.started = true;

    // Load both datasets first so the initial paint reflects real data instead
    // of a loading state that is immediately replaced.
    const [github, leetcode] = await Promise.all([
      loadDataset('github'),
      loadDataset('leetcode'),
    ]);
    state.datasets = { github, leetcode };

    updatePlatformUI();

    // Initialise the visualization whenever at least one dataset is usable, not
    // only when the initially selected platform is. Otherwise a pending GitHub
    // file would leave the canvas uninitialised until a manual platform switch.
    const anyAvailable = [github, leetcode].some(
      (dataset) => dataset.status === 'ok'
    );

    if (anyAvailable) {
      await ensureVisual();
    } else {
      state.visualReady = true;
      updatePlatformUI();
    }
  }

  for (const button of els.toggleButtons) {
    button.addEventListener('click', () => {
      setPlatform(button.dataset.platform);
    });
  }
  els.statusRetry.addEventListener('click', retryCurrentPlatform);

  const themeObserver = new MutationObserver(() => {
    if (state.scene) state.scene.refreshTheme();
    if (state.fallback) state.fallback.refreshTheme();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });

  if ('IntersectionObserver' in window) {
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          sectionObserver.disconnect();
          start();
        }
      },
      { rootMargin: '420px 0px' }
    );
    sectionObserver.observe(section);
  } else {
    start();
  }
})();
