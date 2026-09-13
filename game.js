/* SnakeChase — Canvas game logic (web / PWA) */
(function () {
  'use strict';

  // ---------- DOM ----------
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const hudScore = document.getElementById('hud-score');
  const hudLevel = document.getElementById('hud-level');
  const hudLives = document.getElementById('hud-lives');
  const hudClear = document.getElementById('hud-clear');
  const hudTime = document.getElementById('hud-time');
  const pauseBtn = document.getElementById('pause-btn');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlaySub = document.getElementById('overlay-sub');
  const bestEl = document.getElementById('best');
  const overlayBtn = document.getElementById('overlay-btn');
  const joyBase = document.getElementById('joy-base');
  const joyThumb = document.getElementById('joy-thumb');
  const joystick = document.getElementById('joystick');

  // ---------- Game state ----------
  const state = {
    phase: 'menu', // menu | playing | paused | levelComplete | gameOver
    score: 0,
    level: 1,
    lives: 3,
    timeRemaining: 0,
    eatenThisLevel: 0,
    bestScore: 0,
    snake: [],          // array of {x,y}
    snakeHeading: { x: 0, y: -1 },
    snakeDirection: { x: 0, y: -1 },
    pathHistory: [],
    rats: [],
    holes: [],
    particles: [],
    popups: [],
    config: null,
    ratSpawnBudget: 0,
    comboCount: 0,
    comboTimer: 0,
    fieldW: 1000,
    fieldH: 800,
    joyVector: { x: 0, y: 0 },
    lastTime: 0,
  };

  // ---------- Level config ----------
  function levelConfig(level) {
    const l = level;
    return {
      ratsToSpawn: 8 + l * 2,
      maxActiveRats: Math.min(3 + l, 12),
      holesCount: Math.min(1 + l, 6),
      snakeSpeed: 180 + l * 12,
      ratSpeed: 90 + l * 8,
      ratSpawnInterval: Math.max(1.6 - l * 0.08, 0.5),
      targetEaten: 6 + l * 2,
      timeLimit: 60 + l * 4,
    };
  }

  // ---------- Helpers ----------
  function norm(v) {
    const len = Math.hypot(v.x, v.y);
    if (len < 0.0001) return { x: 0, y: 0 };
    return { x: v.x / len, y: v.y / len };
  }

  function resetLevel() {
    const c = levelConfig(state.level);
    state.config = c;
    state.rats = [];
    state.particles = [];
    state.popups = [];

    const cx = state.fieldW / 2;
    const cy = state.fieldH / 2;
    const step = c.snakeSpeed / 30;
    state.snakeHeading = { x: 0, y: -1 };
    state.snakeDirection = { x: 0, y: -1 };
    state.snake = [];
    for (let i = 0; i < 6; i++) {
      state.snake.push({ x: cx, y: cy + i * step });
    }
    state.pathHistory = state.snake.map(p => ({ x: p.x, y: p.y }));

    state.holes = [];
    for (let i = 0; i < c.holesCount; i++) {
      const angle = (i / c.holesCount) * Math.PI * 2;
      const radius = Math.min(state.fieldW, state.fieldH) * 0.32;
      state.holes.push({
        id: 'h' + Math.random().toString(36).slice(2, 10),
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        spawnTimer: i * 0.4 + 0.3,
      });
    }

    state.ratSpawnBudget = c.ratsToSpawn;
    state.eatenThisLevel = 0;
    state.comboCount = 0;
    state.comboTimer = 0;
    state.timeRemaining = c.timeLimit;
  }

  function startGame() {
    state.score = 0;
    state.level = 1;
    state.lives = 3;
    state.bestScore = Number(localStorage.getItem('snakechase.best') || 0);
    resetLevel();
    state.phase = 'playing';
    hideOverlay();
    updateHUD();
  }

  function nextLevel() {
    state.level += 1;
    resetLevel();
    state.phase = 'playing';
    hideOverlay();
  }

  function pauseGame() {
    if (state.phase !== 'playing') return;
    state.phase = 'paused';
    showOverlay('Paused', 'Tap Play to keep chasing!', 'Play', true);
  }

  function resumeGame() {
    if (state.phase !== 'paused') return;
    state.phase = 'playing';
    state.lastTime = 0;
    hideOverlay();
  }

  function loseLife(reason) {
    state.lives -= 1;
    if (state.lives <= 0) {
      state.phase = 'gameOver';
      if (state.score > state.bestScore) {
        state.bestScore = state.score;
        localStorage.setItem('snakechase.best', String(state.bestScore));
      }
      showOverlay('Game Over', 'Score: ' + state.score, 'Play Again', true);
    } else {
      resetLevel();
      state.popups.push(makePopup(reason.message, state.fieldW / 2, state.fieldH / 2, '#ff5555', 1.4));
      state.phase = 'playing';
    }
  }

  function eatRat(rat) {
    if (state.comboTimer > 0) state.comboCount += 1;
    else state.comboCount = 1;
    state.comboTimer = 1.2;

    const multiplier = Math.min(state.comboCount, 5);
    const points = 10 * multiplier;
    state.score += points;
    state.eatenThisLevel += 1;

    spawnEatParticles(rat.x, rat.y);
    state.popups.push(makePopup('+' + points, rat.x, rat.y, state.comboCount > 1 ? '#ff9f2e' : '#3ec26b', 1.0));

    growSnake();

    if (state.score > state.bestScore) {
      state.bestScore = state.score;
      localStorage.setItem('snakechase.best', String(state.bestScore));
    }

    updateHUD();

    if (state.eatenThisLevel >= state.config.targetEaten) {
      state.phase = 'levelComplete';
      showOverlay('Level ' + state.level + ' Clear!', 'Score: ' + state.score, 'Next Level', true);
    }
  }

  function growSnake() {
    const tail = state.snake[state.snake.length - 1];
    const back = norm({ x: -state.snakeDirection.x, y: -state.snakeDirection.y });
    const step = state.config.snakeSpeed / 30;
    for (let i = 0; i < 5; i++) {
      state.snake.push({ x: tail.x + back.x * step, y: tail.y + back.y * step });
    }
  }

  function makePopup(text, x, y, color, life) {
    return { text, x, y, life, maxLife: life, color };
  }

  function spawnEatParticles(x, y) {
    const colors = ['#ff8a3d', '#ff5555', '#ffd23e', '#ff7bb8'];
    for (let i = 0; i < 28; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 260;
      state.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.6,
        maxLife: 0.6,
        color: colors[(Math.random() * colors.length) | 0],
        size: 3 + Math.random() * 5,
      });
    }
  }

  // ---------- Update ----------
  function update(dt) {
    if (state.phase !== 'playing') return;
    dt = Math.min(dt, 0.05);

    if (state.comboTimer > 0) {
      state.comboTimer -= dt;
      if (state.comboTimer <= 0) state.comboCount = 0;
    }

    updateSnake(dt);
    updateRats(dt);
    updateHoles(dt);
    updateParticles(dt);
    updatePopups(dt);
    updateTimer(dt);
    checkCollisions();
  }

  function updateSnake(dt) {
    const c = state.config;
    const speed = c.snakeSpeed;
    const heading = state.snakeHeading;

    // Apply joystick direction when active.
    const jv = state.joyVector;
    if (Math.hypot(jv.x, jv.y) > 0.15) {
      const n = norm(jv);
      heading.x = n.x;
      heading.y = n.y;
    }

    let head = state.snake[0];
    let nx = head.x + heading.x * speed * dt;
    let ny = head.y + heading.y * speed * dt;

    const margin = 14;
    if (nx < margin) { nx = margin; heading.x = Math.abs(heading.x); }
    if (nx > state.fieldW - margin) { nx = state.fieldW - margin; heading.x = -Math.abs(heading.x); }
    if (ny < margin) { ny = margin; heading.y = Math.abs(heading.y); }
    if (ny > state.fieldH - margin) { ny = state.fieldH - margin; heading.y = -Math.abs(heading.y); }

    state.snakeDirection = norm(heading);

    const spacing = Math.max(speed * (1 / 30), 1);
    const lastPath = state.pathHistory[state.pathHistory.length - 1] || head;
    if (Math.hypot(nx - lastPath.x, ny - lastPath.y) >= spacing) {
      state.pathHistory.push({ x: nx, y: ny });
    }

    const needed = Math.floor((state.snake.length + 2) * (speed / 30 / spacing)) + 4;
    if (state.pathHistory.length > needed) {
      state.pathHistory.splice(0, state.pathHistory.length - needed);
    }

    buildBody({ x: nx, y: ny });
  }

  function buildBody(head) {
    const spacing = Math.max(state.config.snakeSpeed / 30, 1);
    const targetCount = Math.max(state.snake.length, 3);
    const segments = [{ x: head.x, y: head.y }];
    let prev = head;
    let covered = 0;
    for (let i = state.pathHistory.length - 1; i >= 0; i--) {
      const p = state.pathHistory[i];
      const dx = p.x - prev.x;
      const dy = p.y - prev.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.0001) continue;
      const dir = { x: dx / d, y: dy / d };
      let cursor = prev;
      let segLen = d;
      while (segLen > 0 && segments.length < targetCount) {
        const step = Math.min(segLen, spacing - covered);
        if (step <= 0) break;
        cursor = { x: cursor.x + dir.x * step, y: cursor.y + dir.y * step };
        covered += step;
        if (covered >= spacing - 0.001) {
          segments.push({ x: cursor.x, y: cursor.y });
          covered = 0;
        }
        segLen -= step;
      }
      prev = p;
      if (segments.length >= targetCount) break;
    }
    if (segments.length < targetCount) {
      const tailDir = norm({ x: -state.snakeDirection.x, y: -state.snakeDirection.y });
      while (segments.length < targetCount) {
        const last = segments[segments.length - 1];
        segments.push({ x: last.x + tailDir.x * spacing, y: last.y + tailDir.y * spacing });
      }
    }
    state.snake = segments.slice(0, targetCount);
  }

  function updateRats(dt) {
    const c = state.config;
    for (const rat of state.rats) {
      if (!rat.vx && !rat.vy) rat.vx = 1;
      rat.wanderTimer -= dt;
      if (rat.wanderTimer <= 0) {
        const angle = Math.random() * Math.PI * 2;
        rat.vx = Math.cos(angle) * c.ratSpeed;
        rat.vy = Math.sin(angle) * c.ratSpeed;
        rat.wanderTimer = 0.8 + Math.random() * 1.4;
      }
      let px = rat.x + rat.vx * dt;
      let py = rat.y + rat.vy * dt;
      const margin = 20;
      if (px < margin || px > state.fieldW - margin) { rat.vx *= -1; px = Math.min(Math.max(px, margin), state.fieldW - margin); }
      if (py < margin || py > state.fieldH - margin) { rat.vy *= -1; py = Math.min(Math.max(py, margin), state.fieldH - margin); }
      rat.x = px;
      rat.y = py;
    }
  }

  function updateHoles(dt) {
    if (state.ratSpawnBudget <= 0) return;
    const c = state.config;
    for (const hole of state.holes) {
      hole.spawnTimer -= dt;
      if (hole.spawnTimer <= 0 && state.rats.length < c.maxActiveRats) {
        spawnRat(hole);
        hole.spawnTimer = c.ratSpawnInterval;
        state.ratSpawnBudget -= 1;
      }
    }
  }

  function spawnRat(hole) {
    const angle = Math.random() * Math.PI * 2;
    const c = state.config;
    state.rats.push({
      x: hole.x,
      y: hole.y,
      vx: Math.cos(angle) * c.ratSpeed,
      vy: Math.sin(angle) * c.ratSpeed,
      wanderTimer: 0.6 + Math.random(),
    });
  }

  function updateParticles(dt) {
    for (const p of state.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
    }
    state.particles = state.particles.filter(p => p.life > 0);
  }

  function updatePopups(dt) {
    for (const p of state.popups) {
      p.life -= dt;
      p.y -= 40 * dt;
    }
    state.popups = state.popups.filter(p => p.life > 0);
  }

  function updateTimer(dt) {
    state.timeRemaining -= dt;
    if (state.timeRemaining <= 0) {
      loseLife({ message: "Time's up!" });
    }
  }

  function checkCollisions() {
    const head = state.snake[0];
    if (!head) return;
    const eatRadius = 22;
    for (let i = state.rats.length - 1; i >= 0; i--) {
      const rat = state.rats[i];
      if (Math.hypot(head.x - rat.x, head.y - rat.y) < eatRadius) {
        state.rats.splice(i, 1);
        eatRat(rat);
        if (state.phase !== 'playing') return;
      }
    }
  }

  // ---------- Drawing ----------
  function draw() {
    ctx.clearRect(0, 0, state.fieldW, state.fieldH);
    drawBackground();
    drawBoundary();
    drawHoles();
    drawSnake();
    drawRats();
    drawParticles();
    drawPopups();
  }

  function drawBackground() {
    const tile = 40;
    for (let row = 0; row <= Math.ceil(state.fieldH / tile); row++) {
      for (let col = 0; col <= Math.ceil(state.fieldW / tile); col++) {
        ctx.fillStyle = ((row + col) % 2 === 0) ? '#b3e399' : '#a8d98a';
        ctx.fillRect(col * tile, row * tile, tile, tile);
      }
    }
  }

  function drawBoundary() {
    ctx.strokeStyle = 'rgba(139, 90, 60, 0.5)';
    ctx.lineWidth = 6;
    roundRect(ctx, 3, 3, state.fieldW - 6, state.fieldH - 6, 16);
    ctx.stroke();
  }

  function drawHoles() {
    for (const hole of state.holes) {
      ctx.fillStyle = 'rgba(74, 52, 38, 0.9)';
      ctx.beginPath();
      ctx.ellipse(hole.x, hole.y, 20, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#7a5a44';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  function drawSnake() {
    const s = state.snake;
    if (s.length === 0) return;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Body
    ctx.beginPath();
    ctx.moveTo(s[s.length - 1].x, s[s.length - 1].y);
    for (let i = s.length - 2; i >= 0; i--) ctx.lineTo(s[i].x, s[i].y);
    ctx.strokeStyle = '#35b85c';
    ctx.lineWidth = 26;
    ctx.stroke();
    ctx.strokeStyle = '#6bdc85';
    ctx.lineWidth = 16;
    ctx.stroke();

    // Head
    const head = s[0];
    ctx.fillStyle = '#26a04f';
    ctx.beginPath();
    ctx.arc(head.x, head.y, 16, 0, Math.PI * 2);
    ctx.fill();

    const dir = state.snakeDirection;
    const perp = { x: -dir.y, y: dir.x };
    for (const side of [1, -1]) {
      const ex = head.x + dir.x * 8 + perp.x * side * 7;
      const ey = head.y + dir.y * 8 + perp.y * side * 7;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ex, ey, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(ex, ey, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawRats() {
    for (const rat of state.rats) {
      // Body
      ctx.fillStyle = '#9f735b';
      ctx.beginPath();
      ctx.ellipse(rat.x, rat.y, 11, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      // Head
      ctx.fillStyle = '#ac8068';
      ctx.beginPath();
      ctx.arc(rat.x - 7, rat.y, 7, 0, Math.PI * 2);
      ctx.fill();
      // Ears
      ctx.fillStyle = '#94624d';
      ctx.beginPath();
      ctx.arc(rat.x - 9, rat.y - 8, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(rat.x - 4, rat.y - 8, 4, 0, Math.PI * 2);
      ctx.fill();
      // Eye
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(rat.x - 9, rat.y - 1, 1.8, 0, Math.PI * 2);
      ctx.fill();
      // Tail
      ctx.strokeStyle = '#c18d70';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(rat.x + 11, rat.y);
      ctx.quadraticCurveTo(rat.x + 18, rat.y - 4, rat.x + 20, rat.y + 6);
      ctx.stroke();
    }
  }

  function drawParticles() {
    for (const p of state.particles) {
      const alpha = Math.max(p.life / p.maxLife, 0);
      const radius = p.size * (0.5 + 0.5 * alpha);
      ctx.fillStyle = hexToRgba(p.color, alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPopups() {
    for (const p of state.popups) {
      const alpha = Math.max(p.life / p.maxLife, 0);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.font = '900 30px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, p.y);
      ctx.globalAlpha = 1;
    }
  }

  // ---------- Canvas sizing ----------
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.fieldW = w;
    state.fieldH = h;
    // Re-clamp existing entities to the new size.
    for (const rat of state.rats) {
      rat.x = Math.min(Math.max(rat.x, 20), state.fieldW - 20);
      rat.y = Math.min(Math.max(rat.y, 20), state.fieldH - 20);
    }
  }

  // ---------- HUD & overlays ----------
  function updateHUD() {
    hudScore.textContent = state.score;
    hudLevel.textContent = state.level;
    hudLives.textContent = state.lives;
    hudClear.textContent = Math.max(state.config ? state.config.targetEaten - state.eatenThisLevel : 0, 0);
    hudTime.textContent = Math.max(Math.ceil(state.timeRemaining), 0);
    hudTime.style.color = state.timeRemaining < 10 ? '#d9534f' : '';
  }

  function showOverlay(title, sub, btnText, showBest) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlayBtn.textContent = btnText;
    if (showBest && state.bestScore > 0) {
      bestEl.textContent = 'Best Score: ' + state.bestScore;
      bestEl.classList.remove('hidden');
    } else {
      bestEl.classList.add('hidden');
    }
    overlay.classList.remove('hidden');
    overlayHelpVisible(title);
  }

  function overlayHelpVisible(title) {
    const help = document.querySelector('.help');
    if (title === 'SnakeChase') help.style.display = 'block';
    else help.style.display = 'none';
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  // ---------- Joystick (floating) ----------
  // The joystick appears wherever the player touches the board and follows the
  // finger anywhere on screen. Touches are captured on the whole document so
  // the finger never "loses" the control by drifting off a small region.
  let joyActive = false;
  let joyCenter = null;
  let joyPointerId = null;
  const joyMaxDrag = 90 - 35;   // (base radius) - (thumb radius)

  function applyJoy(dx, dy) {
    let mag = Math.hypot(dx, dy);
    if (mag > joyMaxDrag) {
      dx = dx / mag * joyMaxDrag;
      dy = dy / mag * joyMaxDrag;
      mag = joyMaxDrag;
    }
    joyThumb.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    const nx = dx / joyMaxDrag;
    const ny = dy / joyMaxDrag;
    state.joyVector = { x: nx, y: ny };
  }

  function joyStart(x, y) {
    if (state.phase !== 'playing') return;
    joyActive = true;
    joyCenter = { x: x, y: y };
    joystick.classList.add('active');
    joyBase.style.left = x + 'px';
    joyBase.style.top = y + 'px';
    applyJoy(0, 0);
  }

  function joyMove(x, y) {
    if (!joyActive || !joyCenter) return;
    applyJoy(x - joyCenter.x, y - joyCenter.y);
  }

  function joyEnd() {
    joyActive = false;
    joyCenter = null;
    joyPointerId = null;
    joystick.classList.remove('active');
    joyThumb.style.transform = 'translate(0,0)';
    state.joyVector = { x: 0, y: 0 };
  }

  // ---- Touch handlers ----
  document.addEventListener('touchstart', function (e) {
    // Ignore touches that land on interactive buttons/menus.
    if (e.target.closest('button, .overlay')) return;
    const t = e.touches[0];
    joyPointerId = t.identifier;
    e.preventDefault();
    joyStart(t.clientX, t.clientY);
  }, { passive: false });
  document.addEventListener('touchmove', function (e) {
    if (!joyActive) return;
    e.preventDefault();
    const t = e.touches[0];
    if (t.identifier !== joyPointerId) return;
    joyMove(t.clientX, t.clientY);
  }, { passive: false });
  document.addEventListener('touchend', function (e) {
    if (!joyActive) return;
    for (const t of e.changedTouches) {
      if (t.identifier === joyPointerId) { joyEnd(); break; }
    }
  }, { passive: false });
  document.addEventListener('touchcancel', function (e) {
    if (joyActive) joyEnd();
  }, { passive: false });

  // ---- Mouse fallback for desktop testing ----
  document.addEventListener('mousedown', function (e) {
    if (e.target.closest('button, .overlay')) return;
    joyStart(e.clientX, e.clientY);
  });
  document.addEventListener('mousemove', function (e) { if (joyActive) joyMove(e.clientX, e.clientY); });
  document.addEventListener('mouseup', function () { if (joyActive) joyEnd(); });

  // ---------- Buttons ----------
  pauseBtn.addEventListener('click', function () {
    if (state.phase === 'playing') pauseGame();
    else if (state.phase === 'paused') resumeGame();
  });
  overlayBtn.addEventListener('click', function () {
    if (state.phase === 'menu' || state.phase === 'gameOver') startGame();
    else if (state.phase === 'levelComplete') nextLevel();
    else if (state.phase === 'paused') resumeGame();
  });

  // ---------- Main loop ----------
  let rafId = null;
  function loop() {
    rafId = requestAnimationFrame(loop);
    const now = performance.now() / 1000;
    if (state.lastTime === 0) state.lastTime = now;
    const dt = now - state.lastTime;
    state.lastTime = now;
    update(dt);
    draw();
    if (state.phase === 'playing') updateHUD();
  }

  function boot() {
    state.bestScore = Number(localStorage.getItem('snakechase.best') || 0);
    resize();
    resetLevel();
    state.phase = 'menu';
    draw();
    overlay.classList.remove('hidden');
    showOverlay('SnakeChase', 'Chase the rats. Grow the snake!', 'Play', true);
    window.addEventListener('resize', resize);
    if (rafId === null) loop();
    registerServiceWorker();
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      // Service workers require a secure context (https or localhost).
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    }
  }

  // ---------- Utils ----------
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  boot();
})();
