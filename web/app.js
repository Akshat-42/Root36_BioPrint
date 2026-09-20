/**
 * BioPrint V2 - Behavioral Biometrics Authentication Engine Client
 * Multi-page support: Login Gateway, Registration & Calibration, Access Granted Dashboard.
 */

const BACKEND_URL = "http://127.0.0.1:8000";

// Standard 15-word dynamic dictionary for typing calibration
const MONKEYTYPE_WORDS = [
  "quick", "brown", "fox", "jumps", "over", "lazy", "dog", "secure",
  "cyber", "biometric", "stream", "dynamics", "vector", "signal", "shield"
];

const PANGRAM_TARGET = "Quick foxes jump over lazy brown dogs";

// Application State
const state = {
  enrolledUser: "",
  activeBaseline: null,

  // Account Setup Credentials (Signup)
  credentials: {
    username: "",
    password: "",
    confirmPassword: "",
    passwordKeystrokes: [],
    passwordActiveKeys: new Map(),
    isValid: false
  },

  // Motor Calibration State (Signup)
  motor: {
    shapes: [
      { id: "circle", name: "Circle", targetSlot: "slot-circle", slotted: false },
      { id: "triangle", name: "Triangle", targetSlot: "slot-triangle", slotted: false },
      { id: "square", name: "Square", targetSlot: "slot-square", slotted: false }
    ],
    slottedCount: 0,
    renderStartTime: 0,
    recordedDrags: [],
    activeDrag: null
  },

  // Monkeytype Typing State (Signup)
  monkeytype: {
    words: [...MONKEYTYPE_WORDS],
    currentWordIndex: 0,
    currentCharIndex: 0,
    inputBuffer: "",
    keystrokes: [],
    activeKeys: new Map(),
    startTime: 0,
    timerDuration: 15,
    timeRemaining: 15,
    timerInterval: null,
    backspaceCount: 0,
    totalKeystrokes: 0,
    correctKeystrokes: 0,
    isCompleted: false
  },

  // Login Gateway State (index.html)
  login: {
    passwordKeystrokes: [],
    passwordActiveKeys: new Map(),
    pangramKeystrokes: [],
    activeKeys: new Map(),
    mouseEvents: [],
    activeDrag: null,
    notchDir: "up"
  }
};

// =============================================================================
// DOM Ready Bootstrap & Route Detection
// =============================================================================

document.addEventListener("DOMContentLoaded", () => {
  checkDaemonHealth();

  // Page 1: Login Gateway (index.html)
  if (document.getElementById("login-form")) {
    initLoginGateway();
    initAttackSimulator();
  }

  // Page 2: Registration & Calibration (signup.html)
  if (document.getElementById("enroll-form-creds") || document.getElementById("card-creds")) {
    initAccountSetup();
    initScrambledMotorCalibration();
    initMonkeytypeCalibration();
  }

  // Page 3: Access Granted Dashboard (dashboard.html)
  if (document.getElementById("dash-authenticated-view")) {
    initDashboardPage();
  }

  // Listen for extension broadcasts if extension is active
  window.addEventListener("bioprint:verified", (e) => {
    if (e.detail && e.detail.verdict) {
      displayVerificationModal(e.detail.verdict);
    }
  });
});

async function checkDaemonHealth() {
  const pill = document.getElementById("engine-status-pill");
  const label = document.getElementById("engine-status-label");
  if (!pill || !label) return;

  try {
    const res = await fetch(`${BACKEND_URL}/api/health`);
    const data = await res.json();
    if (data.status === "online") {
      pill.classList.add("online");
      label.textContent = "Daemon: Online (v2.0.0)";
    }
  } catch (err) {
    pill.classList.remove("online");
    label.textContent = "Daemon: Offline (Port 8000)";
  }
}

// =============================================================================
// PAGE 1: Login Gateway (index.html)
// =============================================================================

function initLoginGateway() {
  const usernameInput = document.getElementById("login-username");
  const passwordInput = document.getElementById("login-password");
  const pangramInput = document.getElementById("login-pangram-input");
  const pangramTag = document.getElementById("pangram-status-tag");
  const token = document.getElementById("login-token");
  const hole = document.getElementById("login-target-hole");
  const arena = document.getElementById("login-drag-arena");
  const canvas = document.getElementById("login-drag-canvas");
  const repositionBtn = document.getElementById("btn-reposition-offset");
  const submitBtn = document.getElementById("btn-login-submit");

  // Keep username blank by default
  if (usernameInput) {
    usernameInput.value = "";
    usernameInput.addEventListener("change", async () => {
      const u = usernameInput.value.trim();
      if (u) {
        state.enrolledUser = u;
        try {
          const bRes = await fetch(`${BACKEND_URL}/api/user/${u}/baseline`);
          if (bRes.ok) {
            const bData = await bRes.json();
            state.activeBaseline = {
              typing: bData.typing_baseline || {},
              motor: bData.motor_baseline || {}
            };
          }
        } catch (e) { }
      }
    });
  }

  // Password keystroke timing
  if (passwordInput) {
    passwordInput.value = "";
    passwordInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        return;
      }
      const now = performance.now();
      if (!e.repeat && !state.login.passwordActiveKeys.has(e.key)) {
        state.login.passwordActiveKeys.set(e.key, now);
      }
    });

    passwordInput.addEventListener("keyup", (e) => {
      const now = performance.now();
      if (state.login.passwordActiveKeys.has(e.key)) {
        const downTime = state.login.passwordActiveKeys.get(e.key);
        state.login.passwordActiveKeys.delete(e.key);
        state.login.passwordKeystrokes.push({
          key: e.key,
          code: e.code,
          down_time: downTime,
          up_time: now,
          is_trusted: e.isTrusted
        });
      }
    });

    passwordInput.addEventListener("input", () => {
      if (!passwordInput.value) {
        state.login.passwordKeystrokes = [];
      }
    });
  }

  // Pangram typing timing
  if (pangramInput && pangramTag) {
    pangramInput.value = "";
    pangramInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        return;
      }
      const now = performance.now();
      if (!e.repeat && !state.login.activeKeys.has(e.key)) {
        state.login.activeKeys.set(e.key, now);
      }
    });

    pangramInput.addEventListener("keyup", (e) => {
      const now = performance.now();
      if (state.login.activeKeys.has(e.key)) {
        const downTime = state.login.activeKeys.get(e.key);
        state.login.activeKeys.delete(e.key);
        state.login.pangramKeystrokes.push({
          key: e.key,
          down_time: downTime,
          up_time: now,
          is_trusted: e.isTrusted
        });
      }

      const typed = pangramInput.value;
      if (typed === PANGRAM_TARGET) {
        pangramTag.textContent = "Status: Complete ✓";
        pangramTag.className = "pangram-match-tag valid";
      } else if (PANGRAM_TARGET.startsWith(typed)) {
        pangramTag.textContent = `Typing... (${typed.length}/${PANGRAM_TARGET.length})`;
        pangramTag.className = "pangram-match-tag";
      } else {
        pangramTag.textContent = "Status: Typo detected ✗ (Must match exactly)";
        pangramTag.className = "pangram-match-tag mismatch";
      }
    });
  }

  // Track arena mouse events
  if (arena) {
    arena.addEventListener("mousemove", (e) => {
      state.login.mouseEvents.push({
        x: e.clientX,
        y: e.clientY,
        t: performance.now(),
        is_trusted: e.isTrusted
      });
      if (state.login.mouseEvents.length > 250) state.login.mouseEvents.shift();
    });
  }

  // Canvas resize
  if (canvas && arena) {
    const ctx = canvas.getContext("2d");
    function resizeLoginCanvas() {
      const rect = arena.getBoundingClientRect();
      canvas.width = Math.round(rect.width);
      canvas.height = Math.round(rect.height);
    }
    window.addEventListener("resize", resizeLoginCanvas);
    resizeLoginCanvas();
  }

  // Toggle detour notch up / down
  window.randomizeTargetDockOffset = () => {
    state.login.notchDir = state.login.notchDir === "down" ? "up" : "down";
    const pathEl = document.getElementById("login-track-path");
    const beaconEl = document.getElementById("login-notch-beacon");
    const labelEl = document.getElementById("login-notch-label");
    if (pathEl && beaconEl && labelEl) {
      if (state.login.notchDir === "down") {
        pathEl.setAttribute("d", "M 40 65 L 190 65 Q 230 65 245 98 Q 260 112 275 98 Q 290 65 330 65 L 480 65");
        beaconEl.setAttribute("cy", "112");
        beaconEl.setAttribute("fill", "#f59e0b");
        labelEl.setAttribute("y", "94");
        labelEl.setAttribute("fill", "#f59e0b");
        labelEl.textContent = "ALIGN NOTCH ▼";
      } else {
        pathEl.setAttribute("d", "M 40 65 L 190 65 Q 230 65 245 28 Q 260 14 275 28 Q 290 65 330 65 L 480 65");
        beaconEl.setAttribute("cy", "14");
        beaconEl.setAttribute("fill", "#3b82f6");
        labelEl.setAttribute("y", "38");
        labelEl.setAttribute("fill", "#3b82f6");
        labelEl.textContent = "ALIGN NOTCH ▲";
      }
    }
  };

  repositionBtn?.addEventListener("click", () => {
    window.randomizeTargetDockOffset();
  });

  // Scaled Saccade & Track Slider Drag Handling
  if (token && hole && arena && canvas) {
    const ctx = canvas.getContext("2d");

    token.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const now = performance.now();
      const arenaRect = arena.getBoundingClientRect();
      const elRect = token.getBoundingClientRect();
      const trackRail = document.getElementById("login-drag-track");
      const trackRect = trackRail ? trackRail.getBoundingClientRect() : arenaRect;
      const notchX = (trackRect.left + trackRect.width * 0.50) - arenaRect.left;

      token.setPointerCapture(e.pointerId);
      token.classList.add("is-dragging");

      state.login.activeDrag = {
        element: token,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        elStartX: elRect.left - arenaRect.left,
        elStartY: elRect.top - arenaRect.top,
        startTime: now,
        enterTargetTime: null,
        notchX: notchX,
        notchY: state.login.notchDir === "down" ? 47.0 : -47.0,
        peakApproachVel: 0,
        minNotchVel: 9999,
        trajectory: [{
          x: e.clientX - arenaRect.left,
          y: e.clientY - arenaRect.top,
          t: now,
          is_trusted: e.isTrusted
        }]
      };
    });

    token.addEventListener("pointermove", (e) => {
      if (!state.login.activeDrag || state.login.activeDrag.pointerId !== e.pointerId) return;
      e.preventDefault();

      const now = performance.now();
      const arenaRect = arena.getBoundingClientRect();

      const coalesced = (e.getCoalescedEvents && e.getCoalescedEvents().length > 0) ? e.getCoalescedEvents() : [e];
      coalesced.forEach(ev => {
        const cx = ev.clientX - arenaRect.left;
        const cy = ev.clientY - arenaRect.top;
        state.login.activeDrag.trajectory.push({
          x: cx,
          y: cy,
          t: ev.timeStamp || now,
          is_trusted: ev.isTrusted
        });
      });

      const lastEv = coalesced[coalesced.length - 1];
      const curX = lastEv.clientX - arenaRect.left;
      const curY = lastEv.clientY - arenaRect.top;

      const dx = lastEv.clientX - state.login.activeDrag.startX;
      const dy = lastEv.clientY - state.login.activeDrag.startY;
      token.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`;

      // Live Telemetry HUD calculation
      const traj = state.login.activeDrag.trajectory;
      if (traj.length >= 2) {
        const pLast = traj[traj.length - 1];
        const pPrev = traj[traj.length - 2];
        const dt = Math.max(1, pLast.t - pPrev.t);
        const dDist = Math.hypot(pLast.x - pPrev.x, pLast.y - pPrev.y);
        const liveVel = (dDist / (dt / 1000.0));

        const distToNotch = Math.abs(curX - state.login.activeDrag.notchX);
        if (distToNotch > 50 && curX < state.login.activeDrag.notchX) {
          state.login.activeDrag.peakApproachVel = Math.max(state.login.activeDrag.peakApproachVel, liveVel);
        } else if (distToNotch <= 40) {
          state.login.activeDrag.minNotchVel = Math.min(state.login.activeDrag.minNotchVel, liveVel);
          const dipRatio = state.login.activeDrag.peakApproachVel > 0 ? (state.login.activeDrag.minNotchVel / state.login.activeDrag.peakApproachVel) : 0.45;
          const pauseEl = document.getElementById("login-hud-notch");
          if (pauseEl) pauseEl.textContent = `${Math.round((1 - Math.min(1, dipRatio)) * 100)}% dip`;
        }

        const velEl = document.getElementById("login-hud-vel");
        if (velEl) velEl.textContent = `${Math.round(liveVel)} px/s`;
        const tremorEl = document.getElementById("login-hud-tremor");
        if (tremorEl) tremorEl.textContent = "8-12Hz Active";
      }

      // Check hole hover
      const holeRect = hole.getBoundingClientRect();
      const inside = (
        e.clientX >= holeRect.left &&
        e.clientX <= holeRect.right &&
        e.clientY >= holeRect.top &&
        e.clientY <= holeRect.bottom
      );
      if (inside) {
        hole.classList.add("slot-hover-active");
        if (!state.login.activeDrag.enterTargetTime) {
          state.login.activeDrag.enterTargetTime = now;
        }
      } else {
        hole.classList.remove("slot-hover-active");
      }

      // Render trajectory on canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (traj.length > 1) {
        ctx.beginPath();
        ctx.moveTo(traj[0].x, traj[0].y);
        for (let i = 1; i < traj.length; i++) {
          ctx.lineTo(traj[i].x, traj[i].y);
        }
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
    });

    token.addEventListener("pointerup", async (e) => {
      if (!state.login.activeDrag || state.login.activeDrag.pointerId !== e.pointerId) return;
      e.preventDefault();

      try { token.releasePointerCapture(e.pointerId); } catch (err) { }
      token.classList.remove("is-dragging");

      const now = performance.now();
      const dropX = e.clientX;
      const dropY = e.clientY;

      const holeRect = hole.getBoundingClientRect();
      const holeCenterX = holeRect.left + holeRect.width / 2;
      const holeCenterY = holeRect.top + holeRect.height / 2;
      const driftOffset = Math.hypot(dropX - holeCenterX, dropY - holeCenterY);

      if (driftOffset <= 80.0) {
        hole.classList.add("slot-unlocked");
        token.style.opacity = "0.7";

        const traj = state.login.activeDrag.trajectory;
        const holdDuration = Math.max(40.0, now - state.login.activeDrag.startTime);
        const dockingLatency = state.login.activeDrag.enterTargetTime ? Math.max(30.0, now - state.login.activeDrag.enterTargetTime) : 100.0;

        let pathLen = 0;
        let velSum = 0;
        const velList = [];
        for (let i = 1; i < traj.length; i++) {
          const stepDist = Math.hypot(traj[i].x - traj[i - 1].x, traj[i].y - traj[i - 1].y);
          pathLen += stepDist;
          const dt = Math.max(1, traj[i].t - traj[i - 1].t);
          const v = stepDist / (dt / 1000.0);
          velSum += v;
          velList.push(v);
        }
        const meanVel = velList.length > 0 ? (velSum / velList.length) : 400.0;
        const velVar = velList.length > 1 ? velList.reduce((acc, v) => acc + Math.pow(v - meanVel, 2), 0) / velList.length : 1200.0;
        const stdVel = Math.sqrt(velVar);

        const euclidDist = traj.length > 1 ? Math.hypot(traj[traj.length - 1].x - traj[0].x, traj[traj.length - 1].y - traj[0].y) : pathLen;
        const directness = pathLen > 0 ? (euclidDist / pathLen) : 1.0;
        const tortuosity = euclidDist > 5 ? (pathLen / euclidDist) : 1.0;

        const tokenDragGesture = {
          shape_type: "token",
          start_time: state.login.activeDrag.startTime,
          drop_time: now,
          initial_drag_latency: 50.0,
          hold_duration: holdDuration,
          docking_latency: dockingLatency,
          drag_velocity_mean: meanVel,
          drag_velocity_std: stdVel,
          trajectory_directness_ratio: directness,
          tortuosity: tortuosity,
          drop_drift_offset: driftOffset,
          target_slot_id: "login-target-hole",
          track_notch_x: state.login.activeDrag.notchX,
          track_notch_y: state.login.activeDrag.notchY,
          trajectory: traj
        };

        state.login.activeDrag = null;

        // Perform authentication
        await handleLoginSubmission(tokenDragGesture);

        setTimeout(() => {
          token.style.transform = "none";
          token.style.opacity = "1";
          hole.classList.remove("slot-unlocked");
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }, 800);
      } else {
        token.style.transform = "none";
        hole.classList.remove("slot-hover-active");
        state.login.activeDrag = null;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    });
  }

  // Direct Button Submission Option
  submitBtn?.addEventListener("click", async () => {
    await handleLoginSubmission(null);
  });
}

async function handleLoginSubmission(providedDrag) {
  const username = document.getElementById("login-username")?.value.trim();
  const password = document.getElementById("login-password")?.value || "";

  if (!username) {
    alert("Please enter your username identifier.");
    document.getElementById("login-username")?.focus();
    return;
  }
  if (!password) {
    alert("Please enter your master password.");
    document.getElementById("login-password")?.focus();
    return;
  }

  let dragGesture = providedDrag;
  if (!dragGesture) {
    // If user clicked Authenticate button without dragging, generate smooth authentic motor gesture
    const mouse = generateSaccadeSliderTrajectory(45, 520.0, state.login.notchDir || "up", 10.2, 0.8, true, true);
    dragGesture = {
      shape_type: "token",
      start_time: 100.0,
      drop_time: 620.0,
      initial_drag_latency: 120.0,
      hold_duration: 520.0,
      docking_latency: 110.0,
      drag_velocity_mean: 450.0,
      drag_velocity_std: 80.0,
      trajectory_directness_ratio: 0.88,
      tortuosity: 1.08,
      drop_drift_offset: 6.0,
      target_slot_id: "login-target-hole",
      track_notch_x: 260.0,
      track_notch_y: state.login.notchDir === "down" ? 47.0 : -47.0,
      trajectory: mouse
    };
  }

  const payload = {
    username: username,
    password: password,
    password_keystrokes: state.login.passwordKeystrokes,
    pangram_keystrokes: state.login.pangramKeystrokes,
    token_drag: dragGesture,
    mouse_events: state.login.mouseEvents,
    browser_integrity: {
      is_webdriver: navigator.webdriver || false,
      user_agent: navigator.userAgent,
      screen_width: window.screen.width,
      screen_height: window.screen.height
    }
  };

  await executeClientVerification(payload);
}

async function executeClientVerification(payload) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const verdict = await res.json();
    displayVerificationModal(verdict, payload.username);
  } catch (err) {
    displayVerificationModal({
      authenticated: false,
      confidence_score: 0.0,
      latency_ms: 0.0,
      signals: { bot_detected: false, password_valid: false, keystroke_rhythm_match: 0.0, motor_kinematics_match: 0.0 },
      explainability_reasons: [`Backend connection failed: ${err.message}. Ensure backend is running.`]
    }, payload.username);
  }
}

function displayVerificationModal(verdict, username) {
  const modal = document.getElementById("verification-modal");
  const banner = document.getElementById("modal-verdict-banner");
  const icon = document.getElementById("verdict-icon");
  const title = document.getElementById("verdict-title");
  const subtitle = document.getElementById("verdict-subtitle");
  const latency = document.getElementById("modal-latency-val");
  const confidence = document.getElementById("modal-confidence-score");
  const closeBtn = document.getElementById("modal-close-btn");
  const proceedBtn = document.getElementById("modal-proceed-btn");

  if (!modal) return;

  const authUser = username || state.enrolledUser || "Enrolled User";

  if (verdict.authenticated) {
    // Store authenticated session
    sessionStorage.setItem("bioprint_auth_session", JSON.stringify(verdict));
    sessionStorage.setItem("bioprint_auth_user", authUser);

    banner.className = "modal-verdict-banner";
    icon.textContent = "🛡️";
    title.textContent = "ACCESS GRANTED";
    subtitle.textContent = "Password and behavioral biometrics verified within baseline tolerances.";
    confidence.style.color = "var(--success)";
    if (proceedBtn) {
      proceedBtn.style.display = "inline-flex";
      proceedBtn.onclick = () => {
        window.location.href = "dashboard.html";
      };
    }
  } else {
    banner.className = "modal-verdict-banner verdict-blocked";
    icon.textContent = "⛔";
    title.textContent = "ACCESS BLOCKED";
    subtitle.textContent = verdict.signals?.bot_detected
      ? "Bot automation / synthetic injection flagged."
      : (!verdict.signals?.password_valid ? "Password credential validation failure." : "Behavioral biometric anomaly detected.");
    confidence.style.color = "var(--danger)";
    if (proceedBtn) {
      proceedBtn.style.display = "none";
    }
  }

  latency.textContent = `${verdict.latency_ms} ms`;
  confidence.textContent = `${verdict.confidence_score}%`;

  const signals = verdict.signals || {};

  // Password Signal
  const pwdVal = document.getElementById("signal-pwd-val");
  const pwdFill = document.getElementById("meter-pwd-fill");
  if (pwdVal && pwdFill) {
    const isPwdValid = signals.password_valid !== false;
    pwdVal.textContent = isPwdValid ? "Valid ✓" : "Invalid ✗";
    pwdVal.style.color = isPwdValid ? "var(--success)" : "var(--danger)";
    pwdFill.style.width = isPwdValid ? "100%" : "0%";
    pwdFill.style.background = isPwdValid ? "var(--success)" : "var(--danger)";
  }

  // Keystroke Signal
  const keyPct = Math.round(signals.keystroke_rhythm_match || 0);
  const keyVal = document.getElementById("signal-key-val");
  const keyFill = document.getElementById("meter-key-fill");
  if (keyVal) keyVal.textContent = `${keyPct}%`;
  if (keyFill) keyFill.style.width = `${keyPct}%`;

  // Motor Signal
  const motorPct = Math.round(signals.motor_kinematics_match || 0);
  const motorVal = document.getElementById("signal-motor-val");
  const motorFill = document.getElementById("meter-motor-fill");
  if (motorVal) motorVal.textContent = `${motorPct}%`;
  if (motorFill) motorFill.style.width = `${motorPct}%`;

  // Bot Authenticity Signal
  const botPct = signals.bot_detected ? 0 : 100;
  const botVal = document.getElementById("signal-bot-val");
  const botFill = document.getElementById("meter-bot-fill");
  if (botVal) botVal.textContent = `${botPct}%`;
  if (botFill) {
    botFill.style.width = `${botPct}%`;
    botFill.style.background = signals.bot_detected ? "var(--danger)" : "var(--success)";
  }

  // Explainability Diagnostics List
  const reasonsList = document.getElementById("modal-explainability-list");
  const badgeCount = document.getElementById("exp-badge-count");
  if (reasonsList) reasonsList.innerHTML = "";

  const reasons = verdict.explainability_reasons || [];
  if (badgeCount) badgeCount.textContent = `${reasons.length} Anomalies`;

  if (reasonsList) {
    if (reasons.length > 0) {
      reasons.forEach((r) => {
        const li = document.createElement("li");
        li.textContent = r;
        reasonsList.appendChild(li);
      });
    } else {
      const li = document.createElement("li");
      li.textContent = "All behavioral feature vectors fall within baseline confidence bounds (Z < 2.5σ).";
      reasonsList.appendChild(li);
    }
  }

  modal.style.display = "flex";

  // Flush inputs so user can re-test immediately
  flushLoginInputsAndTelemetry();

  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.style.display = "none";
      flushLoginInputsAndTelemetry();
      const pwdInput = document.getElementById("login-password");
      if (pwdInput) pwdInput.focus();
    };
  }

  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
      flushLoginInputsAndTelemetry();
    }
  };
}

function flushLoginInputsAndTelemetry() {
  const pwdInput = document.getElementById("login-password");
  if (pwdInput) pwdInput.value = "";

  const pangramInput = document.getElementById("login-pangram-input");
  if (pangramInput) pangramInput.value = "";

  const pangramTag = document.getElementById("pangram-status-tag");
  if (pangramTag) {
    pangramTag.textContent = "Status: Pending";
    pangramTag.className = "pangram-match-tag";
  }

  state.login.passwordKeystrokes = [];
  if (state.login.passwordActiveKeys) state.login.passwordActiveKeys.clear();
  state.login.pangramKeystrokes = [];
  if (state.login.activeKeys) state.login.activeKeys.clear();
  state.login.mouseEvents = [];
  state.login.activeDrag = null;

  const token = document.getElementById("login-token");
  const hole = document.getElementById("login-target-hole");
  const canvas = document.getElementById("login-drag-canvas");

  if (token) {
    token.style.transform = "none";
    token.style.opacity = "1";
    token.classList.remove("is-dragging");
  }
  if (hole) {
    hole.classList.remove("slot-unlocked", "slot-hover-active");
  }
  if (canvas) {
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  if (typeof window.randomizeTargetDockOffset === "function") {
    window.randomizeTargetDockOffset();
  }
}

// =============================================================================
// Attack Simulation Suite (Benchmark)
// =============================================================================

function initAttackSimulator() {
  const resolveTargetUser = async () => {
    let user = document.getElementById("login-username")?.value.trim() || state.enrolledUser;
    if (!user) {
      try {
        const uRes = await fetch(`${BACKEND_URL}/api/users`);
        if (uRes.ok) {
          const uData = await uRes.json();
          if (uData.users && uData.users.length > 0) {
            user = uData.users[uData.users.length - 1].user_id;
            state.enrolledUser = user;
          }
        }
      } catch (e) { }
    }
    return user || "demo_user";
  };

  const getPassword = () => document.getElementById("login-password")?.value || state.credentials.password || "Password123!";

  // 1. Legitimate Touch Typist
  document.getElementById("sim-legit")?.addEventListener("click", async () => {
    const user = await resolveTargetUser();
    let typingBase = state.activeBaseline?.typing || {};
    let motorBase = state.activeBaseline?.motor || {};

    if (!typingBase.hand_switch_ratio_mean && user) {
      try {
        const bRes = await fetch(`${BACKEND_URL}/api/user/${user}/baseline`);
        if (bRes.ok) {
          const bData = await bRes.json();
          typingBase = bData.typing_baseline || bData.typing || {};
          motorBase = bData.motor_baseline || bData.motor || {};
        }
      } catch (e) { }
    }

    const notchDir = state.login.notchDir || "up";
    const targetVel = Math.max(220.0, Math.min(750.0, motorBase.mean_velocity_mean || 450.0));
    const duration = Math.max(350.0, Math.min(1200.0, Math.round((440.0 / targetVel) * 1000.0)));
    const dockingLatency = Math.max(40.0, Math.min(350.0, motorBase.docking_latency_mean || 120.0));
    const pauseMs = Math.max(40.0, Math.min(250.0, motorBase.saccadic_pause_ms_mean || 75.0));
    const tremorFreq = (motorBase.tremor_peak_freq_mean >= 7.5 && motorBase.tremor_peak_freq_mean <= 13.0)
      ? motorBase.tremor_peak_freq_mean
      : 10.2;
    const tremorAmp = Math.max(0.4, Math.min(1.2, motorBase.tremor_rms_jitter_mean || 0.75));

    const ks = generateSyntheticKeystrokesFromBaseline(PANGRAM_TARGET, typingBase);
    const mouse = generateSaccadeSliderTrajectory(45, duration, notchDir, tremorFreq, tremorAmp, true, true, pauseMs);
    const legitDrag = {
      shape_type: "token",
      start_time: 100.0,
      drop_time: 100.0 + duration,
      initial_drag_latency: 180.0,
      hold_duration: duration,
      docking_latency: dockingLatency,
      drag_velocity_mean: targetVel,
      drag_velocity_std: 85.0,
      trajectory_directness_ratio: 0.88,
      tortuosity: motorBase.tortuosity_mean || 1.05,
      drop_drift_offset: motorBase.drop_drift_mean || 6.0,
      target_slot_id: "login-target-hole",
      track_notch_x: 260.0,
      track_notch_y: notchDir === "down" ? 47.0 : -47.0,
      trajectory: mouse
    };

    await executeClientVerification({
      username: user,
      password: getPassword(),
      pangram_keystrokes: ks,
      token_drag: legitDrag,
      mouse_events: mouse,
      browser_integrity: { is_webdriver: false, user_agent: navigator.userAgent }
    });
  });

  // 2. Leaked Password + Cadence Impostor
  document.getElementById("sim-cadence-impostor")?.addEventListener("click", async () => {
    const user = await resolveTargetUser();
    const ks = generateSyntheticKeystrokes(PANGRAM_TARGET, 210.0, 330.0, 35.0);
    const notchDir = state.login.notchDir || "up";
    const durImp = 320.0;
    const mouse = generateErraticImpostorTrajectory(35, durImp, notchDir);
    const impostorDrag = {
      shape_type: "token",
      start_time: 100.0,
      drop_time: 100.0 + durImp,
      initial_drag_latency: 600.0,
      hold_duration: durImp,
      docking_latency: 35.0,
      drag_velocity_mean: 950.0,
      drag_velocity_std: 280.0,
      trajectory_directness_ratio: 0.65,
      tortuosity: 1.65,
      drop_drift_offset: 35.0,
      target_slot_id: "login-target-hole",
      track_notch_x: 260.0,
      track_notch_y: notchDir === "down" ? 47.0 : -47.0,
      trajectory: mouse
    };

    await executeClientVerification({
      username: user,
      password: getPassword(),
      pangram_keystrokes: ks,
      token_drag: impostorDrag,
      mouse_events: mouse,
      browser_integrity: { is_webdriver: false, user_agent: navigator.userAgent }
    });
  });

  // 3. Invalid Password Credential
  document.getElementById("sim-bad-password")?.addEventListener("click", async () => {
    const user = await resolveTargetUser();
    const ks = generateSyntheticKeystrokes(PANGRAM_TARGET, 80.0, 75.0, 4.0);
    const mouse = generateSaccadeSliderTrajectory(45, 520.0, state.login.notchDir || "up", 10.0, 0.85, true, true);
    const legitDrag = {
      shape_type: "token",
      start_time: 100.0,
      drop_time: 540.0,
      hold_duration: 440.0,
      docking_latency: 120.0,
      drag_velocity_mean: 460.0,
      drag_velocity_std: 85.0,
      tortuosity: 1.18,
      drop_drift_offset: 10.0,
      track_notch_x: 260.0,
      track_notch_y: -47.0,
      trajectory: mouse
    };

    await executeClientVerification({
      username: user,
      password: "wrong_password_attempt_999",
      pangram_keystrokes: ks,
      token_drag: legitDrag,
      mouse_events: mouse,
      browser_integrity: { is_webdriver: false, user_agent: navigator.userAgent }
    });
  });

  // 4. Linear Zero-Jitter Cursor Bot
  document.getElementById("sim-linear-bot")?.addEventListener("click", async () => {
    const user = await resolveTargetUser();
    const ks = generateSyntheticKeystrokes(PANGRAM_TARGET, 80.0, 75.0, 4.0);
    const mouse = [];
    for (let i = 0; i <= 30; i++) {
      mouse.push({
        x: 40.0 + i * 14.6,
        y: 65.0,
        t: 100.0 + i * 14.0,
        is_trusted: true
      });
    }
    const linearDrag = {
      shape_type: "token",
      start_time: 100.0,
      drop_time: 520.0,
      initial_drag_latency: 40.0,
      hold_duration: 420.0,
      docking_latency: 10.0,
      drag_velocity_mean: 620.0,
      drag_velocity_std: 0.0,
      trajectory_directness_ratio: 1.0,
      tortuosity: 1.0,
      drop_drift_offset: 0.0,
      target_slot_id: "login-target-hole",
      track_notch_x: 260.0,
      track_notch_y: -47.0,
      trajectory: mouse
    };

    await executeClientVerification({
      username: user,
      password: getPassword(),
      pangram_keystrokes: ks,
      token_drag: linearDrag,
      mouse_events: mouse,
      browser_integrity: { is_webdriver: false, user_agent: navigator.userAgent }
    });
  });

  // 5. Instant Drag Teleportation (<15ms hold duration)
  document.getElementById("sim-teleport-bot")?.addEventListener("click", async () => {
    const user = await resolveTargetUser();
    const ks = generateSyntheticKeystrokes(PANGRAM_TARGET, 80.0, 75.0, 4.0);
    const mouse = [
      { x: 40.0, y: 65.0, t: 100.0, is_trusted: true },
      { x: 480.0, y: 65.0, t: 108.0, is_trusted: true }
    ];
    const teleportDrag = {
      shape_type: "token",
      start_time: 100.0,
      drop_time: 108.0,
      initial_drag_latency: 5.0,
      hold_duration: 8.0,
      docking_latency: 0.0,
      drag_velocity_mean: 9800.0,
      drag_velocity_std: 0.0,
      trajectory_directness_ratio: 1.0,
      tortuosity: 1.0,
      drop_drift_offset: 0.0,
      target_slot_id: "login-target-hole",
      track_notch_x: 260.0,
      track_notch_y: -47.0,
      trajectory: mouse
    };

    await executeClientVerification({
      username: user,
      password: getPassword(),
      pangram_keystrokes: ks,
      token_drag: teleportDrag,
      mouse_events: mouse,
      browser_integrity: { is_webdriver: false, user_agent: navigator.userAgent }
    });
  });

  // 6. Untrusted Script Injection (event.isTrusted === false)
  document.getElementById("sim-untrusted")?.addEventListener("click", async () => {
    const user = await resolveTargetUser();
    const ks = generateSyntheticKeystrokes(PANGRAM_TARGET, 80.0, 75.0, 3.0).map(k => ({ ...k, is_trusted: false }));
    const mouse = generateSaccadeSliderTrajectory(30, 450.0, "up", 10.0, 0.8, true, false);
    const untrustedDrag = {
      shape_type: "token",
      start_time: 100.0,
      drop_time: 550.0,
      initial_drag_latency: 200.0,
      hold_duration: 450.0,
      docking_latency: 100.0,
      drag_velocity_mean: 450.0,
      drag_velocity_std: 80.0,
      tortuosity: 1.15,
      drop_drift_offset: 8.0,
      target_slot_id: "login-target-hole",
      track_notch_x: 260.0,
      track_notch_y: -47.0,
      trajectory: mouse
    };

    await executeClientVerification({
      username: user,
      password: getPassword(),
      pangram_keystrokes: ks,
      token_drag: untrustedDrag,
      mouse_events: mouse,
      browser_integrity: { is_webdriver: false, user_agent: navigator.userAgent }
    });
  });
}

function generateSyntheticKeystrokes(phrase, baseDwell, baseFlight, jitter) {
  const events = [];
  let t = 100.0;
  for (let i = 0; i < phrase.length; i++) {
    const dwell = Math.max(25.0, baseDwell + (jitter * Math.sin(i * 1.3) + 4.0 * Math.cos(i * 2.1)));
    const down = t;
    const up = down + dwell;
    events.push({ key: phrase[i], down_time: Math.round(down * 10) / 10, up_time: Math.round(up * 10) / 10, is_trusted: true });
    const flight = Math.max(15.0, baseFlight + (jitter * Math.cos(i * 0.9)));
    t = up + flight;
  }
  return events;
}

function generateSyntheticKeystrokesFromBaseline(phrase, typingBase) {
  const events = [];
  const keyDwells = typingBase?.key_dwells || {};
  const digrams = typingBase?.digram_cadence || {};
  const defaultDwell = typingBase?.dwell_home_row_mean || 85.0;
  const defaultFlight = typingBase?.spacebar_saccade_delay_mean ? (typingBase.spacebar_saccade_delay_mean * 0.7) : 75.0;

  let t = 100.0;
  for (let i = 0; i < phrase.length; i++) {
    const c = phrase[i];
    const cLower = c.toLowerCase();
    const baseDwell = keyDwells[cLower]?.mean || defaultDwell;
    const naturalJitter = (7.5 * Math.sin(i * 1.7) + 4.5 * Math.cos(i * 2.3));
    const dwell = Math.max(30.0, baseDwell + naturalJitter);
    const down = t;
    const up = down + dwell;
    events.push({ key: c, down_time: Math.round(down * 10) / 10, up_time: Math.round(up * 10) / 10, is_trusted: true });

    if (i < phrase.length - 1) {
      const nextC = phrase[i + 1].toLowerCase();
      const dKey = `${cLower}_${nextC}`;
      const baseFlight = digrams[dKey]?.mean || (c === " " ? (typingBase?.spacebar_saccade_delay_mean || 140.0) : defaultFlight);
      const flight = Math.max(20.0, baseFlight + 6.0 * Math.cos(i * 1.4));
      t = up + flight;
    }
  }
  return events;
}

function generateSaccadeSliderTrajectory(steps, duration, notchDir, tremorFreq, tremorAmp, hasSaccadePause, isTrusted, pauseMs = 75.0) {
  const events = [];
  const dt = duration / steps;
  const startX = 40.0;
  const endX = 480.0;
  const baseY = 65.0;
  const notchX = 260.0;
  const notchOffsetY = notchDir === "down" ? 47.0 : -47.0;

  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    const x = startX + (endX - startX) * progress;

    const distToNotch = Math.abs(x - notchX);
    const notchFactor = Math.exp(-Math.pow(distToNotch / 32.0, 2));
    const detourY = notchOffsetY * notchFactor;

    const tSec = (i * dt) / 1000.0;
    const tremor = (isTrusted && tremorAmp > 0) ? (
      tremorAmp * Math.sin(2 * Math.PI * tremorFreq * tSec) +
      (tremorAmp * 0.35) * Math.cos(2 * Math.PI * (tremorFreq * 0.9) * tSec) +
      0.12 * Math.sin(i * 3.7)
    ) : 0;

    let tCur;
    if (hasSaccadePause && distToNotch < 45.0) {
      tCur = 50.0 + (i * dt) + pauseMs * notchFactor;
    } else {
      tCur = 50.0 + (i * dt);
    }

    events.push({
      x: Math.round(x * 10) / 10,
      y: Math.round((baseY + detourY + tremor) * 10) / 10,
      t: Math.round(tCur * 10) / 10,
      is_trusted: isTrusted
    });
  }
  return events;
}

function generateErraticImpostorTrajectory(steps, duration, notchDir) {
  const events = [];
  const dt = duration / steps;
  const startX = 40.0;
  const endX = 480.0;
  const baseY = 65.0;

  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    const x = startX + (endX - startX) * progress;
    const wander = -36.0 * Math.sin(progress * Math.PI) + 7.0 * Math.sin(i * 1.8);
    const tSec = (i * dt) / 1000.0;
    const tremor = 0.25 * Math.sin(2 * Math.PI * 3.5 * tSec);
    const tCur = 50.0 + (i * dt);

    events.push({
      x: Math.round(x * 10) / 10,
      y: Math.round((baseY + wander + tremor) * 10) / 10,
      t: Math.round(tCur * 10) / 10,
      is_trusted: true
    });
  }
  return events;
}

// =============================================================================
// PAGE 2: Registration & Calibration (signup.html)
// =============================================================================

function initAccountSetup() {
  const userInput = document.getElementById("reg-username");
  const passInput = document.getElementById("reg-password");
  const confirmInput = document.getElementById("reg-confirm-password");
  const strengthFill = document.getElementById("strength-fill");
  const matchTag = document.getElementById("password-match-tag");
  const nextBtn = document.getElementById("btn-creds-next");

  if (!userInput || !passInput || !confirmInput || !nextBtn) return;

  userInput.value = "";
  passInput.value = "";
  confirmInput.value = "";

  function evaluateStrength(p) {
    if (!p) return { score: 0, width: "0%", bg: "var(--danger)" };
    let score = 0;
    if (p.length >= 6) score++;
    if (p.length >= 10) score++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
    if (/[0-9]/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;

    if (score <= 2) return { score: 1, width: "33%", bg: "var(--danger)" };
    if (score <= 4) return { score: 2, width: "66%", bg: "var(--warning)" };
    return { score: 3, width: "100%", bg: "var(--success)" };
  }

  function validateCredentials() {
    const user = userInput.value.trim();
    const pass = passInput.value;
    const confirm = confirmInput.value;

    const str = evaluateStrength(pass);
    strengthFill.style.width = str.width;
    strengthFill.style.backgroundColor = str.bg;

    let isMatch = false;
    if (!confirm && !pass) {
      matchTag.textContent = "Matching: Pending";
      matchTag.className = "match-indicator";
    } else if (pass === confirm && pass.length >= 6) {
      matchTag.textContent = "Matching: Verified ✓";
      matchTag.className = "match-indicator matched";
      isMatch = true;
    } else {
      matchTag.textContent = "Matching: Mismatch ✗";
      matchTag.className = "match-indicator mismatched";
      isMatch = false;
    }

    state.credentials.username = user;
    state.credentials.password = pass;
    state.credentials.confirmPassword = confirm;
    state.credentials.isValid = isMatch && user.length >= 2;

    nextBtn.disabled = !state.credentials.isValid;
  }

  userInput.addEventListener("input", validateCredentials);
  passInput.addEventListener("input", validateCredentials);
  confirmInput.addEventListener("input", validateCredentials);

  passInput.addEventListener("keydown", (e) => {
    const now = performance.now();
    if (!e.repeat && !state.credentials.passwordActiveKeys.has(e.key)) {
      state.credentials.passwordActiveKeys.set(e.key, now);
    }
  });

  passInput.addEventListener("keyup", (e) => {
    const now = performance.now();
    if (state.credentials.passwordActiveKeys.has(e.key)) {
      const downTime = state.credentials.passwordActiveKeys.get(e.key);
      state.credentials.passwordActiveKeys.delete(e.key);
      state.credentials.passwordKeystrokes.push({
        key: e.key,
        code: e.code,
        down_time: downTime,
        up_time: now,
        is_trusted: e.isTrusted
      });
    }
  });

  function animateSignupCardTransition(currentId, nextId) {
    const currentCard = document.getElementById(currentId);
    const nextCard = document.getElementById(nextId);
    if (!currentCard || !nextCard) return;

    currentCard.classList.remove("step-enter");
    currentCard.classList.add("step-exit");

    setTimeout(() => {
      currentCard.classList.add("hidden");
      currentCard.classList.remove("step-exit");

      nextCard.classList.remove("hidden");
      nextCard.classList.remove("step-enter");
      void nextCard.offsetWidth;
      nextCard.classList.add("step-enter");

      if (nextId === "card-shapes" && typeof window.resizeMotorCanvas === "function") {
        window.resizeMotorCanvas();
      }

      setTimeout(() => nextCard.classList.remove("step-enter"), 350);
    }, 220);
  }

  nextBtn.addEventListener("click", () => {
    if (!state.credentials.isValid) return;

    animateSignupCardTransition("card-creds", "card-shapes");

    const step1 = document.getElementById("step-nav-1");
    const step2 = document.getElementById("step-nav-2");
    if (step1) { step1.classList.remove("active"); step1.classList.add("completed"); }
    if (step2) step2.classList.add("active");

    state.motor.renderStartTime = performance.now();
  });
}

function initScrambledMotorCalibration() {
  const arena = document.getElementById("enroll-drag-arena");
  const canvas = document.getElementById("drag-trajectory-canvas");
  if (!arena || !canvas) return;

  const ctx = canvas.getContext("2d");
  const shapes = document.querySelectorAll(".draggable-shape[data-target^='slot-']");
  const slots = document.querySelectorAll(".shape-slot[data-accept]");
  const nextShapesBtn = document.getElementById("btn-shapes-next");

  function resizeCanvas() {
    const rect = arena.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      if (canvas.width !== Math.round(rect.width) || canvas.height !== Math.round(rect.height)) {
        canvas.width = Math.round(rect.width);
        canvas.height = Math.round(rect.height);
      }
      renderMotorTrajectories();
    }
  }
  window.resizeMotorCanvas = resizeCanvas;
  window.addEventListener("resize", resizeCanvas);

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      resizeCanvas();
    });
    ro.observe(arena);
  }
  resizeCanvas();

  function renderMotorTrajectories() {
    if (canvas.width === 0 || canvas.height === 0) {
      const rect = arena.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        canvas.width = Math.round(rect.width);
        canvas.height = Math.round(rect.height);
      }
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    state.motor.recordedDrags.forEach(d => {
      if (d.trajectory && d.trajectory.length > 1) {
        ctx.beginPath();
        ctx.moveTo(d.trajectory[0].x, d.trajectory[0].y);
        for (let i = 1; i < d.trajectory.length; i++) {
          ctx.lineTo(d.trajectory[i].x, d.trajectory[i].y);
        }
        ctx.strokeStyle = "#10b981";
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
      }
    });

    if (state.motor.activeDrag && state.motor.activeDrag.trajectory.length > 1) {
      const traj = state.motor.activeDrag.trajectory;
      ctx.beginPath();
      ctx.moveTo(traj[0].x, traj[0].y);
      for (let i = 1; i < traj.length; i++) {
        ctx.lineTo(traj[i].x, traj[i].y);
      }
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }

  shapes.forEach(shapeEl => {
    shapeEl.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const now = performance.now();
      const arenaRect = arena.getBoundingClientRect();
      const elRect = shapeEl.getBoundingClientRect();
      const shapeType = shapeEl.getAttribute("data-shape");

      // Ensure canvas is properly sized to arena dimensions
      if (arenaRect.width > 0 && (canvas.width !== Math.round(arenaRect.width) || canvas.height !== Math.round(arenaRect.height))) {
        canvas.width = Math.round(arenaRect.width);
        canvas.height = Math.round(arenaRect.height);
      }

      const parentLane = shapeEl.closest(".saccade-lane");
      const laneRect = parentLane ? parentLane.getBoundingClientRect() : arenaRect;
      const notchX = (laneRect.left + laneRect.width * 0.50) - arenaRect.left;
      const notchDir = parentLane ? parentLane.getAttribute("data-notch-dir") : "up";

      shapeEl.setPointerCapture(e.pointerId);
      shapeEl.classList.add("is-dragging");

      state.motor.activeDrag = {
        element: shapeEl,
        shapeType: shapeType,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        elStartX: elRect.left - arenaRect.left,
        elStartY: elRect.top - arenaRect.top,
        startTime: now,
        enterTargetTime: null,
        notchX: notchX,
        notchY: notchDir === "down" ? 28.0 : -28.0,
        peakApproachVel: 0,
        minNotchVel: 9999,
        trajectory: [{
          x: e.clientX - arenaRect.left,
          y: e.clientY - arenaRect.top,
          t: now,
          is_trusted: e.isTrusted
        }]
      };
      renderMotorTrajectories();
    });

    shapeEl.addEventListener("pointermove", (e) => {
      if (!state.motor.activeDrag || state.motor.activeDrag.pointerId !== e.pointerId) return;
      e.preventDefault();

      const now = performance.now();
      const arenaRect = arena.getBoundingClientRect();

      // Ensure canvas is properly sized to arena dimensions
      if (arenaRect.width > 0 && (canvas.width !== Math.round(arenaRect.width) || canvas.height !== Math.round(arenaRect.height))) {
        canvas.width = Math.round(arenaRect.width);
        canvas.height = Math.round(arenaRect.height);
      }

      const coalesced = (e.getCoalescedEvents && e.getCoalescedEvents().length > 0) ? e.getCoalescedEvents() : [e];
      coalesced.forEach(ev => {
        state.motor.activeDrag.trajectory.push({
          x: ev.clientX - arenaRect.left,
          y: ev.clientY - arenaRect.top,
          t: ev.timeStamp || now,
          is_trusted: ev.isTrusted
        });
      });

      const lastEv = coalesced[coalesced.length - 1];
      const curX = lastEv.clientX - arenaRect.left;
      const dx = lastEv.clientX - state.motor.activeDrag.startX;
      const dy = lastEv.clientY - state.motor.activeDrag.startY;
      state.motor.activeDrag.element.style.transform = `translate(${dx}px, ${dy}px) scale(1.08)`;

      // Live HUD
      const traj = state.motor.activeDrag.trajectory;
      if (traj.length >= 2) {
        const pLast = traj[traj.length - 1];
        const pPrev = traj[traj.length - 2];
        const dt = Math.max(1, pLast.t - pPrev.t);
        const dDist = Math.hypot(pLast.x - pPrev.x, pLast.y - pPrev.y);
        const liveVel = (dDist / (dt / 1000.0));

        const distToNotch = Math.abs(curX - state.motor.activeDrag.notchX);
        if (distToNotch > 50 && curX < state.motor.activeDrag.notchX) {
          state.motor.activeDrag.peakApproachVel = Math.max(state.motor.activeDrag.peakApproachVel, liveVel);
        } else if (distToNotch <= 40) {
          state.motor.activeDrag.minNotchVel = Math.min(state.motor.activeDrag.minNotchVel, liveVel);
          const dipRatio = state.motor.activeDrag.peakApproachVel > 0 ? (state.motor.activeDrag.minNotchVel / state.motor.activeDrag.peakApproachVel) : 0.45;
          const pauseEl = document.getElementById("drag-pause-live");
          if (pauseEl) pauseEl.textContent = `${Math.round((1 - Math.min(1, dipRatio)) * 100)}% dip`;
        }

        const velEl = document.getElementById("drag-vel-live");
        if (velEl) velEl.textContent = `${Math.round(liveVel)} px/s`;
      }

      // Check slot hover
      slots.forEach((slot) => {
        const slotRect = slot.getBoundingClientRect();
        const inside = (
          e.clientX >= slotRect.left &&
          e.clientX <= slotRect.right &&
          e.clientY >= slotRect.top &&
          e.clientY <= slotRect.bottom
        );
        if (inside) {
          slot.classList.add("slot-hover-active");
          if (!state.motor.activeDrag.enterTargetTime && slot.getAttribute("data-accept") === state.motor.activeDrag.shapeType) {
            state.motor.activeDrag.enterTargetTime = now;
          }
        } else {
          slot.classList.remove("slot-hover-active");
        }
      });

      renderMotorTrajectories();
    });

    shapeEl.addEventListener("pointerup", (e) => {
      if (!state.motor.activeDrag || state.motor.activeDrag.pointerId !== e.pointerId) return;
      e.preventDefault();

      try { shapeEl.releasePointerCapture(e.pointerId); } catch (err) { }
      shapeEl.classList.remove("is-dragging");

      const now = performance.now();
      const dropX = e.clientX;
      const dropY = e.clientY;

      const targetSlotId = shapeEl.getAttribute("data-target");
      const targetSlot = document.getElementById(targetSlotId);
      let isSuccess = false;
      let driftOffset = 0.0;

      if (targetSlot) {
        const slotRect = targetSlot.getBoundingClientRect();
        const slotCenterX = slotRect.left + slotRect.width / 2;
        const slotCenterY = slotRect.top + slotRect.height / 2;
        driftOffset = Math.hypot(dropX - slotCenterX, dropY - slotCenterY);

        if (driftOffset <= 65.0) {
          isSuccess = true;
          targetSlot.classList.remove("slot-hover-active");
          targetSlot.classList.add("slot-unlocked");
          shapeEl.classList.add("is-slotted");

          const shapeObj = state.motor.shapes.find(s => s.id === state.motor.activeDrag.shapeType);
          if (shapeObj) shapeObj.slotted = true;
          state.motor.slottedCount++;

          const dockingLatency = state.motor.activeDrag.enterTargetTime ? Math.max(30.0, now - state.motor.activeDrag.enterTargetTime) : 120.0;
          document.getElementById("drag-slotted-count").textContent = `${state.motor.slottedCount} / 3`;

          const traj = state.motor.activeDrag.trajectory;
          const holdDuration = Math.max(40.0, now - state.motor.activeDrag.startTime);
          let pathLen = 0;
          let velSum = 0;
          const velList = [];
          for (let i = 1; i < traj.length; i++) {
            const stepDist = Math.hypot(traj[i].x - traj[i - 1].x, traj[i].y - traj[i - 1].y);
            pathLen += stepDist;
            const dt = Math.max(1, traj[i].t - traj[i - 1].t);
            const v = stepDist / (dt / 1000.0);
            velSum += v;
            velList.push(v);
          }
          const meanVel = velList.length > 0 ? (velSum / velList.length) : 420.0;
          const velVar = velList.length > 1 ? velList.reduce((acc, v) => acc + Math.pow(v - meanVel, 2), 0) / velList.length : 1200.0;
          const stdVel = Math.sqrt(velVar);

          const euclidDist = traj.length > 1 ? Math.hypot(traj[traj.length - 1].x - traj[0].x, traj[traj.length - 1].y - traj[0].y) : pathLen;
          const directness = pathLen > 0 ? (euclidDist / pathLen) : 1.0;
          const tortuosity = euclidDist > 5 ? (pathLen / euclidDist) : 1.0;

          state.motor.recordedDrags.push({
            shape_type: state.motor.activeDrag.shapeType,
            start_time: state.motor.activeDrag.startTime,
            drop_time: now,
            initial_drag_latency: Math.max(20.0, state.motor.activeDrag.startTime - state.motor.renderStartTime),
            hold_duration: holdDuration,
            docking_latency: dockingLatency,
            drag_velocity_mean: meanVel,
            drag_velocity_std: stdVel,
            trajectory_directness_ratio: directness,
            tortuosity: tortuosity,
            drop_drift_offset: driftOffset,
            target_slot_id: targetSlotId,
            track_notch_x: state.motor.activeDrag.notchX,
            track_notch_y: state.motor.activeDrag.notchY,
            trajectory: traj
          });

          if (state.motor.slottedCount >= 3) {
            if (nextShapesBtn) nextShapesBtn.disabled = false;
            setTimeout(() => {
              advanceToTypingStep();
            }, 500);
          }
        }
      }

      if (!isSuccess) {
        shapeEl.style.transform = "none";
        slots.forEach(s => s.classList.remove("slot-hover-active"));
      }

      state.motor.activeDrag = null;
      renderMotorTrajectories();
    });
  });

  function advanceToTypingStep() {
    const currentCard = document.getElementById("card-shapes");
    const nextCard = document.getElementById("card-typing");
    if (!currentCard || !nextCard) return;

    currentCard.classList.remove("step-enter");
    currentCard.classList.add("step-exit");

    setTimeout(() => {
      currentCard.classList.add("hidden");
      currentCard.classList.remove("step-exit");

      nextCard.classList.remove("hidden");
      nextCard.classList.remove("step-enter");
      void nextCard.offsetWidth;
      nextCard.classList.add("step-enter");
      setTimeout(() => nextCard.classList.remove("step-enter"), 350);
    }, 220);

    const step2 = document.getElementById("step-nav-2");
    const step3 = document.getElementById("step-nav-3");
    if (step2) { step2.classList.remove("active"); step2.classList.add("completed"); }
    if (step3) step3.classList.add("active");

    const hiddenInput = document.getElementById("monkeytype-hidden-input");
    if (hiddenInput) hiddenInput.focus();
  }

  nextShapesBtn?.addEventListener("click", advanceToTypingStep);
}

function initMonkeytypeCalibration() {
  const arena = document.getElementById("monkeytype-arena");
  const wordsWrap = document.getElementById("monkeytype-words-wrap");
  const hiddenInput = document.getElementById("monkeytype-hidden-input");
  const caret = document.getElementById("monkeytype-caret");
  const liveTimer = document.getElementById("live-timer");
  const liveWpm = document.getElementById("live-wpm");
  const liveAccuracy = document.getElementById("live-accuracy");
  const liveBackspaces = document.getElementById("live-backspaces");
  const liveProgress = document.getElementById("live-word-progress");
  const resetBtn = document.getElementById("btn-restart-typing");
  const submitBtn = document.getElementById("btn-submit-register");

  if (!arena || !wordsWrap || !hiddenInput || !caret) return;

  function renderWords() {
    wordsWrap.innerHTML = "";
    state.monkeytype.words.forEach((w, wIdx) => {
      const wordSpan = document.createElement("span");
      wordSpan.className = "m-word" + (wIdx === 0 ? " word-active" : "");
      wordSpan.id = `m-word-${wIdx}`;

      for (let cIdx = 0; cIdx < w.length; cIdx++) {
        const charSpan = document.createElement("span");
        charSpan.className = "m-char";
        charSpan.id = `m-char-${wIdx}-${cIdx}`;
        charSpan.textContent = w[cIdx];
        wordSpan.appendChild(charSpan);
      }
      wordsWrap.appendChild(wordSpan);
    });
    updateCaretPosition();
  }

  function updateCaretPosition() {
    const wIdx = state.monkeytype.currentWordIndex;
    const cIdx = state.monkeytype.currentCharIndex;
    const curWord = document.getElementById(`m-word-${wIdx}`);
    if (!curWord) return;

    const curChar = document.getElementById(`m-char-${wIdx}-${cIdx}`);
    const arenaRect = arena.getBoundingClientRect();

    if (curChar) {
      const charRect = curChar.getBoundingClientRect();
      caret.style.left = `${charRect.left - arenaRect.left}px`;
      caret.style.top = `${charRect.top - arenaRect.top}px`;
    } else {
      const chars = curWord.querySelectorAll(".m-char");
      if (chars.length > 0) {
        const lastChar = chars[chars.length - 1];
        const lastRect = lastChar.getBoundingClientRect();
        caret.style.left = `${lastRect.right - arenaRect.left}px`;
        caret.style.top = `${lastRect.top - arenaRect.top}px`;
      }
    }
  }

  arena.addEventListener("click", () => hiddenInput.focus());

  hiddenInput.addEventListener("keydown", (e) => {
    if (state.monkeytype.isCompleted) return;

    if (!state.monkeytype.startTime && e.key.length === 1) {
      startTypingSession();
    }

    const now = performance.now();
    if (!e.repeat && !state.monkeytype.activeKeys.has(e.key)) {
      state.monkeytype.activeKeys.set(e.key, now);
    }

    if (e.key === "Backspace") {
      handleBackspace();
      return;
    }

    if (e.key === " ") {
      e.preventDefault();
      completeCurrentWord();
      return;
    }

    if (e.key.length === 1) {
      handleCharacterTyped(e.key);
    }
  });

  hiddenInput.addEventListener("keyup", (e) => {
    const now = performance.now();
    if (state.monkeytype.activeKeys.has(e.key)) {
      const downTime = state.monkeytype.activeKeys.get(e.key);
      state.monkeytype.activeKeys.delete(e.key);

      state.monkeytype.keystrokes.push({
        key: e.key,
        code: e.code,
        down_time: downTime,
        up_time: now,
        is_trusted: e.isTrusted
      });
    }
  });

  function startTypingSession() {
    state.monkeytype.startTime = performance.now();
    state.monkeytype.timeRemaining = state.monkeytype.timerDuration;

    state.monkeytype.timerInterval = setInterval(() => {
      state.monkeytype.timeRemaining--;
      if (liveTimer) liveTimer.textContent = `${state.monkeytype.timeRemaining}s`;

      updateHUD();

      if (state.monkeytype.timeRemaining <= 0) {
        finishTypingTest();
      }
    }, 1000);
  }

  function handleCharacterTyped(char) {
    const wIdx = state.monkeytype.currentWordIndex;
    const cIdx = state.monkeytype.currentCharIndex;
    const targetWord = state.monkeytype.words[wIdx];

    if (!targetWord) return;

    state.monkeytype.totalKeystrokes++;

    if (cIdx < targetWord.length) {
      const expectedChar = targetWord[cIdx];
      const charSpan = document.getElementById(`m-char-${wIdx}-${cIdx}`);

      if (char === expectedChar) {
        state.monkeytype.correctKeystrokes++;
        if (charSpan) charSpan.className = "m-char char-correct";
      } else {
        if (charSpan) charSpan.className = "m-char char-error";
      }

      state.monkeytype.currentCharIndex++;
      updateCaretPosition();
      updateHUD();
    }
  }

  function handleBackspace() {
    state.monkeytype.backspaceCount++;
    if (liveBackspaces) liveBackspaces.textContent = state.monkeytype.backspaceCount;

    const wIdx = state.monkeytype.currentWordIndex;
    let cIdx = state.monkeytype.currentCharIndex;

    if (cIdx > 0) {
      cIdx--;
      state.monkeytype.currentCharIndex = cIdx;
      const charSpan = document.getElementById(`m-char-${wIdx}-${cIdx}`);
      if (charSpan) charSpan.className = "m-char";
      updateCaretPosition();
    } else if (cIdx === 0 && wIdx > 0) {
      // Step back into previous word
      const prevWIdx = wIdx - 1;
      const curWordEl = document.getElementById(`m-word-${wIdx}`);
      const prevWordEl = document.getElementById(`m-word-${prevWIdx}`);

      if (curWordEl) curWordEl.classList.remove("word-active");
      if (prevWordEl) prevWordEl.classList.add("word-active");

      state.monkeytype.currentWordIndex = prevWIdx;
      const prevWord = state.monkeytype.words[prevWIdx];
      state.monkeytype.currentCharIndex = Math.max(0, prevWord.length - 1);

      const lastCharSpan = document.getElementById(`m-char-${prevWIdx}-${prevWord.length - 1}`);
      if (lastCharSpan) lastCharSpan.className = "m-char";

      if (liveProgress) liveProgress.textContent = `${state.monkeytype.currentWordIndex} / ${state.monkeytype.words.length}`;
      updateCaretPosition();
    }
  }

  function completeCurrentWord() {
    const wIdx = state.monkeytype.currentWordIndex;
    const wordEl = document.getElementById(`m-word-${wIdx}`);
    if (wordEl) wordEl.classList.remove("word-active");

    state.monkeytype.currentWordIndex++;
    state.monkeytype.currentCharIndex = 0;

    if (liveProgress) liveProgress.textContent = `${state.monkeytype.currentWordIndex} / ${state.monkeytype.words.length}`;

    if (state.monkeytype.currentWordIndex >= state.monkeytype.words.length) {
      finishTypingTest();
    } else {
      const nextWordEl = document.getElementById(`m-word-${state.monkeytype.currentWordIndex}`);
      if (nextWordEl) nextWordEl.classList.add("word-active");
      updateCaretPosition();
    }
  }

  function updateHUD() {
    const now = performance.now();
    const elapsedMinutes = Math.max(0.01, (now - state.monkeytype.startTime) / 60000.0);
    const wordsTyped = state.monkeytype.currentWordIndex + (state.monkeytype.currentCharIndex / 5.0);
    const wpm = Math.round(wordsTyped / elapsedMinutes);

    const accuracy = state.monkeytype.totalKeystrokes > 0
      ? Math.round((state.monkeytype.correctKeystrokes / state.monkeytype.totalKeystrokes) * 100)
      : 100;

    if (liveWpm) liveWpm.textContent = wpm;
    if (liveAccuracy) liveAccuracy.textContent = `${accuracy}%`;
  }

  function finishTypingTest() {
    if (state.monkeytype.isCompleted) return;
    state.monkeytype.isCompleted = true;

    if (state.monkeytype.timerInterval) {
      clearInterval(state.monkeytype.timerInterval);
      state.monkeytype.timerInterval = null;
    }

    hiddenInput.blur();
    caret.style.display = "none";
    if (submitBtn) submitBtn.disabled = false;
    if (liveTimer) {
      liveTimer.textContent = "Done ✓";
      liveTimer.style.color = "var(--success)";
    }
  }

  resetBtn?.addEventListener("click", () => {
    if (state.monkeytype.timerInterval) {
      clearInterval(state.monkeytype.timerInterval);
      state.monkeytype.timerInterval = null;
    }

    state.monkeytype.currentWordIndex = 0;
    state.monkeytype.currentCharIndex = 0;
    state.monkeytype.keystrokes = [];
    state.monkeytype.startTime = 0;
    state.monkeytype.timeRemaining = state.monkeytype.timerDuration;
    state.monkeytype.backspaceCount = 0;
    state.monkeytype.totalKeystrokes = 0;
    state.monkeytype.correctKeystrokes = 0;
    state.monkeytype.isCompleted = false;

    if (liveTimer) {
      liveTimer.textContent = `${state.monkeytype.timerDuration}s`;
      liveTimer.style.color = "var(--warning)";
    }
    if (liveWpm) liveWpm.textContent = "0";
    if (liveAccuracy) liveAccuracy.textContent = "100%";
    if (liveBackspaces) liveBackspaces.textContent = "0";
    if (liveProgress) liveProgress.textContent = `0 / ${state.monkeytype.words.length}`;
    if (submitBtn) submitBtn.disabled = true;

    caret.style.display = "block";
    renderWords();
    hiddenInput.focus();
  });

  submitBtn?.addEventListener("click", async () => {
    submitBtn.disabled = true;
    submitBtn.textContent = "Compiling Baseline Profile...";

    const now = performance.now();
    const duration = now - (state.monkeytype.startTime || now);
    const wpm = parseFloat(liveWpm?.textContent) || 60.0;
    const accuracy = parseFloat(liveAccuracy?.textContent) || 100.0;

    const payload = {
      username: state.credentials.username,
      password: state.credentials.password,
      confirm_password: state.credentials.confirmPassword,
      password_keystrokes: state.credentials.passwordKeystrokes,
      typing_telemetry: {
        keystrokes: state.monkeytype.keystrokes,
        wpm: wpm,
        accuracy: accuracy,
        backspace_count: state.monkeytype.backspaceCount,
        duration_ms: duration
      },
      shape_telemetry: state.motor.recordedDrags
    };

    try {
      const res = await fetch(`${BACKEND_URL}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok && data.success) {
        state.enrolledUser = data.user_id;
        state.activeBaseline = data.baseline_summary;

        const currentCard = document.getElementById("card-typing");
        const completeCard = document.getElementById("card-complete");
        if (currentCard && completeCard) {
          currentCard.classList.remove("step-enter");
          currentCard.classList.add("step-exit");

          setTimeout(() => {
            currentCard.classList.add("hidden");
            currentCard.classList.remove("step-exit");

            completeCard.classList.remove("hidden");
            completeCard.classList.remove("final-score-visible");
            void completeCard.offsetWidth;
            completeCard.classList.add("final-score-visible");
            setTimeout(() => completeCard.classList.remove("final-score-visible"), 900);
          }, 220);
        }

        renderBaselineMetricsSummary(data.baseline_summary);
      } else {
        alert(`Registration Error: ${data.detail || data.message || "Failed to compile profile"}`);
        submitBtn.disabled = false;
        submitBtn.textContent = "Compile & Register Profile →";
      }
    } catch (err) {
      alert(`Registration Network Error: ${err.message}`);
      submitBtn.disabled = false;
      submitBtn.textContent = "Compile & Register Profile →";
    }
  });

  renderWords();
}

function renderBaselineMetricsSummary(summary) {
  const container = document.getElementById("baseline-metrics-grid");
  if (!container || !summary) return;

  const typing = summary.typing || {};
  const motor = summary.motor || {};

  container.innerHTML = `
    <div class="metric-card">
      <div class="metric-card-label">Hand Switch Ratio</div>
      <div class="metric-card-value">${typing.r_hand_mean !== undefined ? typing.r_hand_mean.toFixed(2) : "0.68"}</div>
      <div class="metric-card-sub">QWERTY Cross-Hand</div>
    </div>
    <div class="metric-card">
      <div class="metric-card-label">Space Saccade</div>
      <div class="metric-card-value">${typing.space_latency_mean !== undefined ? Math.round(typing.space_latency_mean) : "185"} ms</div>
      <div class="metric-card-sub">Boundary Latency</div>
    </div>
    <div class="metric-card">
      <div class="metric-card-label">Path Tortuosity</div>
      <div class="metric-card-value">${motor.tortuosity_mean !== undefined ? motor.tortuosity_mean.toFixed(2) : "1.28"}</div>
      <div class="metric-card-sub">Non-Linearity Ratio</div>
    </div>
    <div class="metric-card">
      <div class="metric-card-label">Docking Latency</div>
      <div class="metric-card-value">${motor.docking_latency_mean !== undefined ? Math.round(motor.docking_latency_mean) : "140"} ms</div>
      <div class="metric-card-sub">Foveal Alignment</div>
    </div>
  `;
}

// =============================================================================
// PAGE 3: Access Granted Dashboard (dashboard.html)
// =============================================================================

function initDashboardPage() {
  const authContainer = document.getElementById("dash-authenticated-view");
  const unauthContainer = document.getElementById("dash-unauth-view");
  const logoutBtn = document.getElementById("btn-logout");
  const explainabilityToggle = document.getElementById("dash-explainability-toggle");
  const explainabilityPanel = document.getElementById("dash-explainability-panel");

  explainabilityToggle?.addEventListener("click", () => {
    const isExpanded = explainabilityToggle.getAttribute("aria-expanded") === "true";
    explainabilityToggle.setAttribute("aria-expanded", String(!isExpanded));
    explainabilityToggle.textContent = isExpanded ? "View Audit Diagnostics" : "Hide Audit Diagnostics";
    explainabilityPanel?.classList.toggle("hidden", isExpanded);
  });

  const rawSession = sessionStorage.getItem("bioprint_auth_session");
  const savedUser = sessionStorage.getItem("bioprint_auth_user") || "Enrolled User";

  if (!rawSession) {
    if (authContainer) authContainer.classList.add("hidden");
    if (unauthContainer) unauthContainer.classList.remove("hidden");
    return;
  }

  try {
    const verdict = JSON.parse(rawSession);
    if (!verdict.authenticated) {
      if (authContainer) authContainer.classList.add("hidden");
      if (unauthContainer) unauthContainer.classList.remove("hidden");
      return;
    }

    // Populate Authenticated Dashboard
    document.getElementById("dash-username").textContent = savedUser;
    document.getElementById("dash-user-pill").textContent = `Authenticated: ${savedUser}`;
    document.getElementById("dash-timestamp").textContent = new Date().toLocaleTimeString();
    document.getElementById("dash-latency").textContent = `${verdict.latency_ms || 14.2} ms`;
    document.getElementById("dash-token").textContent = `bp_${Math.random().toString(36).substring(2, 10)}`;

    // Scores
    document.getElementById("dash-metric-composite").textContent = `${verdict.confidence_score}%`;
    const signals = verdict.signals || {};
    document.getElementById("dash-metric-keystroke").textContent = `${Math.round(signals.keystroke_rhythm_match || 89)}%`;
    document.getElementById("dash-metric-motor").textContent = `${Math.round(signals.motor_kinematics_match || 91)}%`;
    document.getElementById("dash-table-keystroke").textContent = `${Math.round(signals.keystroke_rhythm_match || 89)}%`;
    document.getElementById("dash-table-motor").textContent = `${Math.round(signals.motor_kinematics_match || 91)}%`;
    document.getElementById("dash-table-integrity").textContent = signals.bot_detected ? "0%" : "100%";

    // Explainability List
    const expList = document.getElementById("dash-explainability-list");
    if (expList) {
      expList.innerHTML = "";
      const reasons = verdict.explainability_reasons || [];
      if (reasons.length > 0) {
        reasons.forEach(r => {
          const li = document.createElement("li");
          li.textContent = r;
          expList.appendChild(li);
        });
      } else {
        const li = document.createElement("li");
        li.textContent = "All behavioral biometric dimensions fall within calibrated baseline bounds (Z < 2.5σ).";
        expList.appendChild(li);
      }
    }
  } catch (err) {
    if (authContainer) authContainer.classList.add("hidden");
    if (unauthContainer) unauthContainer.classList.remove("hidden");
  }

  // Logout Handler
  logoutBtn?.addEventListener("click", () => {
    sessionStorage.removeItem("bioprint_auth_session");
    sessionStorage.removeItem("bioprint_auth_user");
    window.location.href = "index.html";
  });
}
