/**
 * BioPrint Behavioral Biometric Authentication - Client Application
 * =================================================================
 * Dual-view application:
 * 1. Motor & Cognitive Calibration Suite (<45s baseline establishment)
 * 2. Real-time Authentication Dashboard with Attack Simulation & Explainability
 */

const BACKEND_URL = "http://127.0.0.1:8000";

// Global App State
const state = {
  currentView: "enroll-view",
  enrolledUser: "alice",
  activeBaseline: null,

  // Calibration State
  calibration: {
    step: "motor", // 'motor' | 'stroop' | 'typing' | 'complete'
    motorTargets: [
      { id: 1, x: 140, y: 170, radius: 28 },
      { id: 2, x: 680, y: 90,  radius: 20 },
      { id: 3, x: 420, y: 260, radius: 24 }
    ],
    currentTargetIdx: 0,
    targetStartTime: 0,
    recordedTargets: [],
    mouseTrail: [],

    // Stroop State
    stroopTrials: [
      { word: "RED", fontColor: "BLUE", cssColor: "#3B82F6", targetColor: "BLUE" },
      { word: "GREEN", fontColor: "YELLOW", cssColor: "#F59E0B", targetColor: "YELLOW" }
    ],
    currentStroopIdx: 0,
    stroopStartTime: 0,
    recordedStroop: [],

    // Typing State
    passphrase: "bioprint secure authentication",
    currentTrial: 1,
    maxTrials: 3,
    recordedTrials: [],
    currentKeystrokes: [],
    activeKeys: new Map()
  },

  // Login Telemetry State
  login: {
    keystrokes: [],
    mouseEvents: [],
    activeKeys: new Map(),
    targetContext: null,
    formStartTime: 0,
    clickStep: 0,
    firstClickTime: 0,
    firstClickPos: null
  }
};

// =============================================================================
// Initialization & Daemon Health Check
// =============================================================================

document.addEventListener("DOMContentLoaded", () => {
  initNavigation();
  initMotorCalibration();
  initStroopProbe();
  initTypingEnrollment();
  initLoginDashboard();
  initAttackSimulator();
  checkDaemonHealth();

  // Listen for extension verification broadcasts
  window.addEventListener("bioprint:verified", (e) => {
    console.log("[Host App] Received bioprint:verified event from extension:", e.detail);
    if (e.detail && e.detail.verdict) {
      displayVerificationModal(e.detail.verdict, e.detail.payload?.mouse_events || []);
    }
  });
});

async function checkDaemonHealth() {
  const pill = document.getElementById("engine-status-pill");
  const label = document.getElementById("engine-status-label");

  try {
    const res = await fetch(`${BACKEND_URL}/api/health`);
    const data = await res.json();
    if (data.status === "online") {
      pill.classList.add("online");
      label.textContent = "Daemon: Online (v1.0.0)";
    }
  } catch (err) {
    pill.classList.remove("online");
    label.textContent = "Daemon: Offline (Port 8000)";
  }
}

// =============================================================================
// View Navigation
// =============================================================================

function initNavigation() {
  const tabEnroll = document.getElementById("tab-enroll");
  const tabVerify = document.getElementById("tab-verify");
  const enrollView = document.getElementById("enroll-view");
  const verifyView = document.getElementById("verify-view");

  tabEnroll.addEventListener("click", () => {
    tabEnroll.classList.add("active");
    tabVerify.classList.remove("active");
    enrollView.classList.add("active-panel");
    verifyView.classList.remove("active-panel");
    state.currentView = "enroll-view";
  });

  tabVerify.addEventListener("click", () => {
    tabVerify.classList.add("active");
    tabEnroll.classList.remove("active");
    verifyView.classList.add("active-panel");
    enrollView.classList.remove("active-panel");
    state.currentView = "verify-view";
    repositionLoginTarget();
  });

  document.getElementById("btn-proceed-login")?.addEventListener("click", () => {
    tabVerify.click();
  });
}

// =============================================================================
// STEP 1: Motor Kinematics & Fitts's Law Probe
// =============================================================================

function initMotorCalibration() {
  const canvas = document.getElementById("motor-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const promptOverlay = document.getElementById("motor-prompt-overlay");

  let isCollecting = false;
  let lastX = 0, lastY = 0;
  let hitEffects = []; // Visual ripple effects on target hit

  function updateTargets() {
    const w = canvas.width || 840;
    const h = canvas.height || 340;
    state.calibration.motorTargets = [
      { id: 1, x: Math.round(w * 0.18), y: Math.round(h * 0.50), radius: 28 },
      { id: 2, x: Math.round(w * 0.82), y: Math.round(h * 0.30), radius: 22 },
      { id: 3, x: Math.round(w * 0.50), y: Math.round(h * 0.74), radius: 25 }
    ];
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width > 0 ? rect.width : (canvas.parentElement?.clientWidth || 840);
    const h = rect.height > 0 ? rect.height : 340;
    canvas.width = Math.round(w);
    canvas.height = Math.round(h);
    updateTargets();
    renderStage();
  }

  // Initial resize and listeners
  resizeCanvas();
  setTimeout(resizeCanvas, 100);
  window.addEventListener("resize", resizeCanvas);

  function renderStage() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw subtle coordinate grid
    ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Draw Trajectory Trail
    if (state.calibration.mouseTrail.length > 1) {
      ctx.beginPath();
      ctx.moveTo(state.calibration.mouseTrail[0].x, state.calibration.mouseTrail[0].y);
      for (let i = 1; i < state.calibration.mouseTrail.length; i++) {
        ctx.lineTo(state.calibration.mouseTrail[i].x, state.calibration.mouseTrail[i].y);
      }
      ctx.strokeStyle = "rgba(0, 240, 255, 0.65)";
      ctx.lineWidth = 2.5;
      ctx.shadowColor = "#00F0FF";
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Draw Hit Ripples
    hitEffects.forEach((eff) => {
      ctx.beginPath();
      ctx.arc(eff.x, eff.y, eff.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(16, 185, 129, ${eff.opacity})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      eff.r += 2;
      eff.opacity -= 0.05;
    });
    hitEffects = hitEffects.filter((eff) => eff.opacity > 0);

    // Draw Current Target
    const target = state.calibration.motorTargets[state.calibration.currentTargetIdx];
    if (target) {
      // Outer pulse ring
      ctx.beginPath();
      ctx.arc(target.x, target.y, target.radius + 8, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0, 240, 255, 0.4)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Inner target circle
      ctx.beginPath();
      ctx.arc(target.x, target.y, target.radius, 0, Math.PI * 2);
      const gradient = ctx.createRadialGradient(target.x, target.y, 2, target.x, target.y, target.radius);
      gradient.addColorStop(0, "#00F0FF");
      gradient.addColorStop(1, "rgba(0, 150, 255, 0.75)");
      ctx.fillStyle = gradient;
      ctx.shadowColor = "#00F0FF";
      ctx.shadowBlur = 16;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Target Label
      ctx.fillStyle = "#070B14";
      ctx.font = "bold 13px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`T${target.id}`, target.x, target.y);
    }
  }

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const now = performance.now();

    // Hover cursor feedback over target
    const target = state.calibration.motorTargets[state.calibration.currentTargetIdx];
    if (target) {
      const dist = Math.hypot(x - target.x, y - target.y);
      canvas.style.cursor = dist <= target.radius + 12 ? "pointer" : "crosshair";
    }

    // Always capture mouse trail once calibration is mounted
    state.calibration.mouseTrail.push({ x, y, t: now, is_trusted: e.isTrusted });
    if (state.calibration.mouseTrail.length > 300) {
      state.calibration.mouseTrail.shift();
    }

    if (!state.calibration.targetStartTime) {
      state.calibration.targetStartTime = now;
    }

    // Compute live velocity HUD
    const dt = now - (state.calibration.mouseTrail[state.calibration.mouseTrail.length - 2]?.t || (now - 16));
    const dist = Math.hypot(x - lastX, y - lastY);
    const vel = dt > 0 ? (dist / (dt / 1000.0)) : 0;

    const velElem = document.getElementById("motor-vel-live");
    if (velElem) velElem.textContent = `${Math.round(vel)} px/s`;

    lastX = x;
    lastY = y;
    renderStage();
  });

  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;
    const now = performance.now();

    const target = state.calibration.motorTargets[state.calibration.currentTargetIdx];
    if (!target) return;

    const distFromCenter = Math.hypot(clickX - target.x, clickY - target.y);

    // Generous hit tolerance (+12px) for frictionless user feedback
    if (distFromCenter <= target.radius + 12) {
      // Hit registered!
      if (!isCollecting) {
        isCollecting = true;
        if (promptOverlay) {
          promptOverlay.style.opacity = "0";
          setTimeout(() => { promptOverlay.style.display = "none"; }, 300);
        }
      }

      // Visual hit feedback
      hitEffects.push({ x: target.x, y: target.y, r: target.radius, opacity: 1.0 });

      const startTime = state.calibration.targetStartTime || (now - 350);
      const movementTime = Math.max(50.0, now - startTime);

      const prevX = state.calibration.currentTargetIdx === 0
        ? (canvas.width * 0.05)
        : state.calibration.motorTargets[state.calibration.currentTargetIdx - 1].x;
      const prevY = state.calibration.currentTargetIdx === 0
        ? (canvas.height * 0.05)
        : state.calibration.motorTargets[state.calibration.currentTargetIdx - 1].y;

      const targetDist = Math.hypot(target.x - prevX, target.y - prevY);
      const targetWidth = target.radius * 2;
      const indexDiff = Math.log2((2.0 * Math.max(10, targetDist)) / targetWidth);

      state.calibration.recordedTargets.push({
        target_id: target.id,
        start_t: startTime,
        click_t: now,
        distance: targetDist,
        width: targetWidth,
        overshoot: distFromCenter,
        trajectory: state.calibration.mouseTrail.slice(-50)
      });

      // Update live HUD
      document.getElementById("motor-id-live").textContent = `${indexDiff.toFixed(2)} bits`;
      document.getElementById("motor-tort-live").textContent = (1.05 + (distFromCenter / 50)).toFixed(2);

      state.calibration.currentTargetIdx++;
      state.calibration.targetStartTime = performance.now();

      if (state.calibration.currentTargetIdx < state.calibration.motorTargets.length) {
        document.getElementById("motor-target-idx").textContent = `${state.calibration.currentTargetIdx + 1} / 3`;
        renderStage();
      } else {
        // Motor test complete -> advance to Stroop
        document.getElementById("dot-motor").classList.remove("active");
        document.getElementById("dot-motor").classList.add("completed");
        document.getElementById("line-1").style.background = "#10B981";
        document.getElementById("dot-stroop").classList.add("active");

        document.getElementById("card-motor").classList.add("hidden-card");
        document.getElementById("card-stroop").classList.remove("hidden-card");
        startStroopTrial(0);
      }
    }
  });

  // Also re-render on tab switches
  document.getElementById("tab-enroll")?.addEventListener("click", () => {
    setTimeout(resizeCanvas, 50);
  });

  renderStage();
}

// =============================================================================
// STEP 2: Cognitive Interference (Stroop) Probe
// =============================================================================

function initStroopProbe() {
  const buttons = document.querySelectorAll(".stroop-btn");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const selectedColor = btn.getAttribute("data-color");
      const currentTrial = state.calibration.stroopTrials[state.calibration.currentStroopIdx];
      if (!currentTrial) return;

      const reactionTime = performance.now() - state.calibration.stroopStartTime;
      const isCorrect = selectedColor === currentTrial.targetColor;

      state.calibration.recordedStroop.push({
        word: currentTrial.word,
        font_color: currentTrial.fontColor,
        selected_color: selectedColor,
        reaction_time_ms: reactionTime,
        is_correct: isCorrect
      });

      state.calibration.currentStroopIdx++;

      if (state.calibration.currentStroopIdx < state.calibration.stroopTrials.length) {
        startStroopTrial(state.calibration.currentStroopIdx);
      } else {
        // Stroop complete -> advance to typing rhythm
        document.getElementById("dot-stroop").classList.remove("active");
        document.getElementById("dot-stroop").classList.add("completed");
        document.getElementById("line-2").style.background = "#10B981";
        document.getElementById("dot-typing").classList.add("active");

        document.getElementById("card-stroop").classList.add("hidden-card");
        document.getElementById("card-typing").classList.remove("hidden-card");
        document.getElementById("enroll-typing-input").focus();
      }
    });
  });
}

function startStroopTrial(idx) {
  const trial = state.calibration.stroopTrials[idx];
  const wordElem = document.getElementById("stroop-stimulus-word");
  const trialElem = document.getElementById("stroop-trial-idx");

  trialElem.textContent = `${idx + 1} / ${state.calibration.stroopTrials.length}`;
  wordElem.textContent = trial.word;
  wordElem.style.color = trial.cssColor;
  wordElem.style.textShadow = `0 0 25px ${trial.cssColor}`;

  state.calibration.stroopStartTime = performance.now();

  // Reaction stopwatch
  const timerElem = document.getElementById("stroop-timer");
  const timerInterval = setInterval(() => {
    if (state.calibration.currentStroopIdx !== idx) {
      clearInterval(timerInterval);
      return;
    }
    const elapsed = Math.round(performance.now() - state.calibration.stroopStartTime);
    timerElem.textContent = `${elapsed} ms`;
  }, 30);
}

// =============================================================================
// STEP 3: Keystroke Rhythm Enrollment
// =============================================================================

function initTypingEnrollment() {
  const input = document.getElementById("enroll-typing-input");
  const cadenceStream = document.getElementById("cadence-stream");
  const trialCountElem = document.getElementById("typing-trial-count");
  const submitBtn = document.getElementById("btn-submit-enroll");
  const resetBtn = document.getElementById("btn-reset-enroll");

  input.addEventListener("keydown", (e) => {
    const now = performance.now();
    if (!e.repeat && !state.calibration.activeKeys.has(e.key)) {
      state.calibration.activeKeys.set(e.key, now);
    }
  });

  input.addEventListener("keyup", (e) => {
    const now = performance.now();
    if (state.calibration.activeKeys.has(e.key)) {
      const downTime = state.calibration.activeKeys.get(e.key);
      state.calibration.activeKeys.delete(e.key);
      const dwell = now - downTime;

      const ksEvent = {
        key: e.key,
        down_time: downTime,
        up_time: now
      };
      state.calibration.currentKeystrokes.push(ksEvent);

      // Render Token in Cadence Stream
      appendCadenceToken(e.key, dwell);
    }

    // Handle Trial Submission on Enter or Complete Match
    if (e.key === "Enter" || input.value.trim().toLowerCase() === state.calibration.passphrase.toLowerCase()) {
      e.preventDefault();
      saveTypingTrial();
    }
  });

  function appendCadenceToken(key, dwell) {
    if (cadenceStream.querySelector(".cadence-placeholder")) {
      cadenceStream.innerHTML = "";
    }
    const token = document.createElement("div");
    token.className = "cadence-token";
    token.innerHTML = `
      <span class="token-key">${key === " " ? "␣" : key}</span>
      <span class="token-dwell">${Math.round(dwell)}ms</span>
    `;
    cadenceStream.appendChild(token);
    cadenceStream.scrollLeft = cadenceStream.scrollWidth;
  }

  function saveTypingTrial() {
    if (state.calibration.currentKeystrokes.length < 5) return;

    state.calibration.recordedTrials.push([...state.calibration.currentKeystrokes]);
    state.calibration.currentKeystrokes = [];
    input.value = "";

    if (state.calibration.currentTrial < state.calibration.maxTrials) {
      state.calibration.currentTrial++;
      trialCountElem.textContent = state.calibration.currentTrial;
      cadenceStream.innerHTML = `<div class="cadence-placeholder">Trial ${state.calibration.currentTrial - 1} saved! Type phrase again for Trial ${state.calibration.currentTrial}...</div>`;
    } else {
      // All 3 trials completed
      trialCountElem.textContent = "3 (Ready)";
      input.disabled = true;
      submitBtn.disabled = false;
      cadenceStream.innerHTML = `<div class="cadence-placeholder" style="color: #10B981;">✓ All 3 typing trials captured! Click 'Compile & Lock Biometric Signature' to complete enrollment.</div>`;
    }
  }

  submitBtn.addEventListener("click", async () => {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span>Compiling Baseline...</span>`;

    // Construct multi-sample telemetry payload
    const samples = state.calibration.recordedTrials.map((ksList, idx) => ({
      sample_index: idx,
      keystrokes: ksList,
      mouse_events: state.calibration.mouseTrail,
      motor_targets: state.calibration.recordedTargets,
      stroop_trials: state.calibration.recordedStroop
    }));

    const payload = {
      user_id: state.enrolledUser,
      passphrase: state.calibration.passphrase,
      samples: samples
    };

    try {
      const response = await fetch(`${BACKEND_URL}/api/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      console.log("[BioPrint] Enrolled successfully:", data);

      state.activeBaseline = data.baseline_summary;
      renderEnrollmentComplete(data);
    } catch (err) {
      alert(`Enrollment failed: ${err.message}. Make sure the backend server is running.`);
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Compile & Lock Biometric Signature</span><span class="btn-arrow">→</span>`;
    }
  });

  resetBtn.addEventListener("click", () => {
    window.location.reload();
  });
}

function renderEnrollmentComplete(data) {
  document.getElementById("card-typing").classList.add("hidden-card");
  const compCard = document.getElementById("card-complete");
  compCard.classList.remove("hidden-card");

  document.getElementById("dot-typing").classList.remove("active");
  document.getElementById("dot-typing").classList.add("completed");

  const grid = document.getElementById("baseline-metrics-grid");
  const summary = data.baseline_summary || {};

  grid.innerHTML = `
    <div class="metric-summary-box">
      <div class="metric-summary-label">Enrolled Dwell Keys</div>
      <div class="metric-summary-val">${summary.dwell_keys_enrolled?.length || 0} keys (σ ≥ 15ms)</div>
    </div>
    <div class="metric-summary-box">
      <div class="metric-summary-label">Flight Transitions</div>
      <div class="metric-summary-val">${summary.transitions_enrolled?.length || 0} transitions (μ, σ)</div>
    </div>
    <div class="metric-summary-box">
      <div class="metric-summary-label">Fitts's Law Model</div>
      <div class="metric-summary-val">${summary.fitts_law_fit || "MT = a + b*ID"}</div>
    </div>
    <div class="metric-summary-box">
      <div class="metric-summary-label">Mean Stroop Hesitation</div>
      <div class="metric-summary-val">${Math.round(summary.stroop_mean_reaction_ms || 520)} ms</div>
    </div>
  `;

  // Update active profile in View 2
  document.getElementById("active-user-display").textContent = `User: ${data.user_id} (Enrolled)`;
  document.getElementById("active-profile-status").textContent = `Baseline: Locked (${data.sample_count} trials)`;
}

// =============================================================================
// VIEW 2: Authentication Dashboard & Login Telemetry
// =============================================================================

function initLoginDashboard() {
  const loginForm = document.getElementById("login-form");
  const loginBtn = document.getElementById("login-btn");
  const userInput = document.getElementById("login-username");
  const passInput = document.getElementById("login-password");
  const repositionBtn = document.getElementById("btn-reposition");

  repositionBtn.addEventListener("click", repositionLoginTarget);

  // Passive Telemetry Recording on the Login View
  passInput.addEventListener("keydown", (e) => {
    const now = performance.now();
    if (!state.login.formStartTime) state.login.formStartTime = now;
    if (!e.repeat && !state.login.activeKeys.has(e.key)) {
      state.login.activeKeys.set(e.key, now);
    }
  });

  passInput.addEventListener("keyup", (e) => {
    const now = performance.now();
    if (state.login.activeKeys.has(e.key)) {
      const downTime = state.login.activeKeys.get(e.key);
      state.login.activeKeys.delete(e.key);
      state.login.keystrokes.push({
        key: e.key,
        down_time: downTime,
        up_time: now
      });
    }
  });

  window.addEventListener("mousemove", (e) => {
    if (state.currentView === "verify-view") {
      state.login.mouseEvents.push({
        x: e.clientX,
        y: e.clientY,
        t: performance.now(),
        is_trusted: e.isTrusted
      });
      if (state.login.mouseEvents.length > 250) {
        state.login.mouseEvents.shift();
      }
    }
  });

  // Direct login verification handler with 2-Click confirmation support
  loginBtn.addEventListener("click", async (e) => {
    e.preventDefault();

    const twoClickEnabled = document.getElementById("toggle-two-click")?.checked;

    if (twoClickEnabled && state.login.clickStep === 0) {
      // Step 1: Arm Verification
      state.login.clickStep = 1;
      state.login.firstClickTime = performance.now();
      const rect = loginBtn.getBoundingClientRect();
      state.login.firstClickPos = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

      loginBtn.classList.add("btn-armed");
      loginBtn.innerHTML = `
        <span class="btn-icon">⚡</span>
        <span class="btn-text">Confirm Signature (Click 2/2)</span>
      `;

      // Slightly shift the target if dynamic positioning is active to measure inter-target motor transit
      if (document.getElementById("toggle-dynamic-pos")?.checked) {
        repositionLoginTarget();
      }
      return;
    }

    // Step 2 or single-click verification:
    if (state.login.clickStep === 1) {
      const transitTime = performance.now() - state.login.firstClickTime;
      const rect2 = loginBtn.getBoundingClientRect();
      const secondPos = { x: rect2.left + rect2.width / 2, y: rect2.top + rect2.height / 2 };
      const transitDist = Math.hypot(secondPos.x - state.login.firstClickPos.x, secondPos.y - state.login.firstClickPos.y);

      state.login.targetContext = {
        target_distance: Math.max(80.0, transitDist),
        target_width: rect2.width,
        movement_time_ms: Math.max(100.0, transitTime),
        login_hesitation_ms: Math.min(2000, performance.now() - (state.login.formStartTime || (performance.now() - 400)))
      };
    }

    // Reset button UI
    state.login.clickStep = 0;
    loginBtn.classList.remove("btn-armed");
    loginBtn.innerHTML = `
      <span class="btn-icon">🔒</span>
      <span class="btn-text">Sign In (Guarded)</span>
    `;

    await executeClientVerification();
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginBtn.click();
  });
}

function repositionLoginTarget() {
  const arena = document.getElementById("target-button-arena");
  const btn = document.getElementById("login-btn");
  const toggle = document.getElementById("toggle-dynamic-pos");

  if (!toggle.checked) {
    btn.style.transform = "none";
    return;
  }

  // Random offset inside arena bounds
  const arenaRect = arena.getBoundingClientRect();
  const maxOffsetX = (arenaRect.width / 2) - 100;
  const maxOffsetY = 30;

  const randX = (Math.random() * 2 - 1) * maxOffsetX;
  const randY = (Math.random() * 2 - 1) * maxOffsetY;

  btn.style.transform = `translate(${randX}px, ${randY}px)`;
}

async function executeClientVerification(customPayload = null) {
  const userId = document.getElementById("login-username").value.trim() || state.enrolledUser;
  const passphrase = document.getElementById("login-password").value;
  const btn = document.getElementById("login-btn");
  const rect = btn.getBoundingClientRect();

  const defaultButtonContext = {
    button_x: rect.left,
    button_y: rect.top,
    target_width: rect.width,
    target_distance: Math.hypot(rect.left - (state.login.mouseEvents[0]?.x || 0), rect.top - (state.login.mouseEvents[0]?.y || 0)),
    movement_time_ms: performance.now() - (state.login.mouseEvents[0]?.t || (performance.now() - 400)),
    login_hesitation_ms: Math.min(2000, performance.now() - (state.login.formStartTime || performance.now() - 500))
  };

  const buttonContext = state.login.targetContext || defaultButtonContext;
  state.login.targetContext = null;

  const payload = customPayload || {
    user_id: userId,
    passphrase: passphrase,
    keystrokes: state.login.keystrokes,
    mouse_events: state.login.mouseEvents,
    button_context: buttonContext
  };

  try {
    const res = await fetch(`${BACKEND_URL}/api/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const verdict = await res.json();
    console.log("[Client Verify] Result:", verdict);

    displayVerificationModal(verdict, payload.mouse_events);

    // Reset login buffer for next trial
    state.login.keystrokes = [];
    state.login.mouseEvents = [];
    state.login.formStartTime = 0;
  } catch (err) {
    alert(`Verification failed: ${err.message}. Ensure backend is running.`);
  }
}

// =============================================================================
// Attack Vector Simulation Suite (Judges Playground)
// =============================================================================

function initAttackSimulator() {
  const userId = () => document.getElementById("login-username").value.trim() || state.enrolledUser;

  // 1. Natural Human Cadence Simulation (Matches Enrolled Baseline)
  document.getElementById("sim-legit").addEventListener("click", async () => {
    const activeUser = userId();
    const phrase = "bioprint secure authentication";
    let ks = [];
    let mouse = [];
    let targetDist = 250;
    let mvTime = 400;

    try {
      const baseRes = await fetch(`${BACKEND_URL}/api/user/${activeUser}/baseline`);
      if (baseRes.ok) {
        const baseData = await baseRes.json();
        const kb = baseData.keystroke_baseline;
        const mb = baseData.motor_baseline;

        let t = 100.0;
        for (let i = 0; i < phrase.length; i++) {
          const ch = phrase[i].toLowerCase();
          const dwellMean = kb?.dwell?.[ch]?.mean || 135.0;
          const dwellStd = kb?.dwell?.[ch]?.std || 18.0;
          // Very tight natural human timing matching baseline within 0.25 sigma
          const dwell = dwellMean + ((Math.sin(i * 1.7) * 0.25) * dwellStd);
          const down = t;
          const up = down + dwell;
          ks.push({ key: phrase[i], down_time: down, up_time: up });

          if (i < phrase.length - 1) {
            const trans = `${ch}->${phrase[i + 1].toLowerCase()}`;
            const flightMean = kb?.flight?.[trans]?.mean || 25.0;
            const flightStd = kb?.flight?.[trans]?.std || 20.0;
            const flight = flightMean + ((Math.cos(i * 1.3) * 0.25) * flightStd);
            t = up + flight;
          }
        }

        const baseVel = mb?.mean_velocity || 550.0;
        mvTime = Math.max(300, Math.round((350.0 / Math.max(100, baseVel)) * 1000.0));
        mouse = generateCurvedMouseTrail(30, mvTime, true);
      }
    } catch (e) {
      console.warn("Could not load baseline for simulation:", e);
    }

    if (!ks.length) {
      ks = generateSyntheticKeystrokes(phrase, 135.0, 30.0, 5.0);
      mouse = generateCurvedMouseTrail(30, 420.0, true);
    }

    await executeClientVerification({
      user_id: activeUser,
      passphrase: phrase,
      keystrokes: ks,
      mouse_events: mouse,
      button_context: { target_distance: targetDist, target_width: 140, movement_time_ms: mvTime }
    });
  });

  // 2. Cadence Impostor (+3.5σ Cadence Mismatch on Full Passphrase)
  document.getElementById("sim-cadence-impostor").addEventListener("click", async () => {
    // Impostor with erratic flight times (340ms vs baseline ~25ms: +3.5σ deviation)
    const ks = generateSyntheticKeystrokes("bioprint secure authentication", 185.0, 340.0, 45.0);
    const mouse = generateCurvedMouseTrail(30, 500.0, true);
    await executeClientVerification({
      user_id: userId(),
      passphrase: "bioprint secure authentication",
      keystrokes: ks,
      mouse_events: mouse,
      button_context: { target_distance: 250, target_width: 140, movement_time_ms: 500 }
    });
  });

  // 3. Linear Cursor Bot (0 micro-jitter)
  document.getElementById("sim-linear-bot").addEventListener("click", async () => {
    const ks = generateSyntheticKeystrokes("bioprint secure authentication", 130.0, 30.0, 4.0);
    // Perfectly linear collinear trajectory with 0 jitter
    const mouse = [];
    for (let i = 0; i <= 20; i++) {
      mouse.push({
        x: 100.0 + i * 20.0,
        y: 200.0 + i * 15.0,
        t: 100.0 + i * 16.0,
        is_trusted: true
      });
    }
    await executeClientVerification({
      user_id: userId(),
      passphrase: "bioprint secure authentication",
      keystrokes: ks,
      mouse_events: mouse,
      button_context: { target_distance: 300, target_width: 140, movement_time_ms: 320 }
    });
  });

  // 4. Impossible Speed Bot (<10ms dwell)
  document.getElementById("sim-fast-bot").addEventListener("click", async () => {
    const ks = [
      { key: "b", down_time: 100.0, up_time: 103.5 }, // 3.5ms dwell
      { key: "i", down_time: 105.0, up_time: 108.0 },
      { key: "o", down_time: 110.0, up_time: 114.0 }
    ];
    const mouse = generateCurvedMouseTrail(15, 300.0, true);
    await executeClientVerification({
      user_id: userId(),
      passphrase: "bioprint secure authentication",
      keystrokes: ks,
      mouse_events: mouse,
      button_context: { target_distance: 200, target_width: 140, movement_time_ms: 250 }
    });
  });

  // 5. Untrusted Event Injection (isTrusted == false)
  document.getElementById("sim-untrusted").addEventListener("click", async () => {
    const ks = generateSyntheticKeystrokes("bioprint secure authentication", 130.0, 30.0, 3.0);
    const mouse = generateCurvedMouseTrail(20, 400.0, false); // is_trusted = false
    await executeClientVerification({
      user_id: userId(),
      passphrase: "bioprint secure authentication",
      keystrokes: ks,
      mouse_events: mouse,
      button_context: { target_distance: 250, target_width: 140, movement_time_ms: 400 }
    });
  });
}

function generateSyntheticKeystrokes(phrase, baseDwell, baseFlight, jitter) {
  const events = [];
  let t = 100.0;
  for (let i = 0; i < phrase.length; i++) {
    const dwell = baseDwell + (jitter * Math.sin(i * 1.3));
    const down = t;
    const up = down + dwell;
    events.push({ key: phrase[i], down_time: down, up_time: up });
    const flight = baseFlight + (jitter * Math.cos(i * 0.9));
    t = up + flight;
  }
  return events;
}

function generateCurvedMouseTrail(steps, duration, isTrusted) {
  const events = [];
  const dt = duration / steps;
  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    const smooth = 0.5 * (1.0 - Math.cos(progress * Math.PI));
    const arc = 35.0 * Math.sin(progress * Math.PI);
    const jitterX = isTrusted ? 0.9 * Math.sin(i * 2.7) : 0;
    const jitterY = isTrusted ? 0.9 * Math.cos(i * 3.1) : 0;

    events.push({
      x: 100 + (450 * smooth) - (arc * 0.4) + jitterX,
      y: 200 + (350 * smooth) + (arc * 0.8) + jitterY,
      t: 50.0 + (i * dt),
      is_trusted: isTrusted
    });
  }
  return events;
}

// =============================================================================
// Real-Time Verification Modal & Explainability Renderer
// =============================================================================

function displayVerificationModal(verdict, mouseEvents = []) {
  const modal = document.getElementById("verification-modal");
  const banner = document.getElementById("modal-verdict-banner");
  const icon = document.getElementById("verdict-icon");
  const title = document.getElementById("verdict-title");
  const subtitle = document.getElementById("verdict-subtitle");
  const latency = document.getElementById("modal-latency-val");
  const confidence = document.getElementById("modal-confidence-score");
  const closeBtn = document.getElementById("btn-close-modal");

  // Format verdict display
  if (verdict.authenticated) {
    banner.className = "modal-verdict-banner";
    icon.textContent = "🛡️";
    title.textContent = "ACCESS GRANTED";
    subtitle.textContent = "Behavioral biometric signature matches enrolled baseline (Z < 2.5σ).";
    confidence.style.color = "#10B981";
  } else {
    banner.className = "modal-verdict-banner verdict-blocked";
    icon.textContent = "⛔";
    title.textContent = "ACCESS BLOCKED";
    subtitle.textContent = verdict.signals?.bot_detected
      ? "Bot / Script automation signature flagged."
      : "Behavioral anomaly detected (Impostor cadence or motor deviation).";
    confidence.style.color = "#EF4444";
  }

  latency.textContent = `${verdict.latency_ms} ms`;
  confidence.textContent = `${verdict.confidence_score}%`;

  // Signal Meters
  const signals = verdict.signals || {};
  document.getElementById("signal-key-val").textContent = `${Math.round(signals.keystroke_rhythm_match || 0)}%`;
  document.getElementById("meter-key-fill").style.width = `${Math.round(signals.keystroke_rhythm_match || 0)}%`;

  document.getElementById("signal-motor-val").textContent = `${Math.round(signals.motor_kinematics_match || 0)}%`;
  document.getElementById("meter-motor-fill").style.width = `${Math.round(signals.motor_kinematics_match || 0)}%`;

  document.getElementById("signal-cog-val").textContent = `${Math.round(signals.cognitive_delay_match || 0)}%`;
  document.getElementById("meter-cog-fill").style.width = `${Math.round(signals.cognitive_delay_match || 0)}%`;

  const botVal = signals.bot_detected ? 0 : 100;
  document.getElementById("signal-bot-val").textContent = `${botVal}%`;
  document.getElementById("meter-bot-fill").style.width = `${botVal}%`;
  document.getElementById("meter-bot-fill").style.background = signals.bot_detected ? "#EF4444" : "#10B981";

  // Explainability List
  const reasonsList = document.getElementById("modal-explainability-list");
  reasonsList.innerHTML = "";
  if (verdict.explainability_reasons && verdict.explainability_reasons.length > 0) {
    verdict.explainability_reasons.forEach((r) => {
      const li = document.createElement("li");
      li.textContent = r;
      reasonsList.appendChild(li);
    });
  } else {
    const li = document.createElement("li");
    li.textContent = "All behavioral vectors fall within baseline confidence bounds.";
    reasonsList.appendChild(li);
  }

  // Draw Trajectory Canvas
  drawTrajectoryCanvas(mouseEvents);

  modal.style.display = "flex";
  closeBtn.onclick = () => {
    modal.style.display = "none";
  };
}

function drawTrajectoryCanvas(mouseEvents) {
  const canvas = document.getElementById("modal-trajectory-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!mouseEvents || mouseEvents.length < 2) {
    ctx.fillStyle = "#64748B";
    ctx.font = "12px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("Keystroke-only interaction vector (No cursor telemetry)", canvas.width / 2, canvas.height / 2);
    return;
  }

  // Scale coordinates to fit canvas
  const xs = mouseEvents.map((m) => m.x);
  const ys = mouseEvents.map((m) => m.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  const rangeX = Math.max(20, maxX - minX);
  const rangeY = Math.max(20, maxY - minY);

  function mapX(val) {
    return 30 + ((val - minX) / rangeX) * (canvas.width - 60);
  }
  function mapY(val) {
    return 20 + ((val - minY) / rangeY) * (canvas.height - 40);
  }

  // Draw trajectory path
  ctx.beginPath();
  ctx.moveTo(mapX(mouseEvents[0].x), mapY(mouseEvents[0].y));
  for (let i = 1; i < mouseEvents.length; i++) {
    ctx.lineTo(mapX(mouseEvents[i].x), mapY(mouseEvents[i].y));
  }
  ctx.strokeStyle = "#00F0FF";
  ctx.lineWidth = 2;
  ctx.shadowColor = "#00F0FF";
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Draw start and end points
  ctx.beginPath();
  ctx.arc(mapX(mouseEvents[0].x), mapY(mouseEvents[0].y), 5, 0, Math.PI * 2);
  ctx.fillStyle = "#3B82F6";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(mapX(mouseEvents[mouseEvents.length - 1].x), mapY(mouseEvents[mouseEvents.length - 1].y), 6, 0, Math.PI * 2);
  ctx.fillStyle = "#10B981";
  ctx.fill();
}
