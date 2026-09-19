/**
 * BioPrint Behavioral Biometric Authentication - Client Application (V2)
 * ======================================================================
 * Features:
 * 1. Account Setup with Argon2id salted hashing & password match indicators.
 * 2. Scrambled Shape-Matching Motor Calibration (Circle, Triangle, Square vs scrambled non-aligned slots).
 * 3. Monkeytype-Style 30-Word Dynamic Typing Calibration (WPM, Accuracy, Backspaces, Caret tracking).
 * 4. Authentication Terminal with Natural Identity Pangram & Dynamic 2D Offset Draggable Token Dock.
 * 5. Attack Simulation Suite with Sub-50ms Verification & Explainability Diagnostics.
 */

const BACKEND_URL = "http://127.0.0.1:8000";

// Standard 15-word dynamic dictionary for typing calibration
const MONKEYTYPE_WORDS = [
  "quick", "brown", "fox", "jumps", "over", "lazy", "dog", "secure",
  "cyber", "biometric", "stream", "dynamics", "vector", "signal", "shield"
];

const PANGRAM_TARGET = "Quick foxes jump over lazy brown dogs";

// Global App State
const state = {
  currentView: "enroll-view",
  enrolledUser: "alice",
  activeBaseline: null,

  // Account Setup Credentials
  credentials: {
    username: "alice",
    password: "",
    confirmPassword: "",
    passwordKeystrokes: [],
    passwordActiveKeys: new Map(),
    isValid: false
  },

  // Scrambled Motor Calibration State
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

  // Monkeytype-Style Typing State
  monkeytype: {
    words: [...MONKEYTYPE_WORDS],
    currentWordIndex: 0,
    currentCharIndex: 0,
    inputBuffer: "",
    keystrokes: [],
    activeKeys: new Map(), // key -> down_time
    startTime: 0,
    timerDuration: 15,
    timeRemaining: 15,
    timerInterval: null,
    backspaceCount: 0,
    totalKeystrokes: 0,
    correctKeystrokes: 0,
    isCompleted: false
  },

  // Authentication & Verification State
  login: {
    passwordKeystrokes: [],
    passwordActiveKeys: new Map(),
    pangramKeystrokes: [],
    activeKeys: new Map(),
    mouseEvents: [],
    activeDrag: null,
    recordedTokenDrag: null,
    offset: { x: 0, y: 0 }
  }
};

// =============================================================================
// DOM Ready Bootstrap & Health Check
// =============================================================================

document.addEventListener("DOMContentLoaded", () => {
  initNavigation();
  initAccountSetup();
  initScrambledMotorCalibration();
  initMonkeytypeCalibration();
  initLoginPangramAndDock();
  initAttackSimulator();
  checkDaemonHealth();
  syncEnrolledUsersFromDatabase();

  // Listen for Chrome extension verification broadcasts
  window.addEventListener("bioprint:verified", (e) => {
    console.log("[BioPrint Host] Received bioprint:verified from extension:", e.detail);
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
      syncEnrolledUsersFromDatabase();
    }
  } catch (err) {
    pill.classList.remove("online");
    label.textContent = "Daemon: Offline (Port 8000)";
  }
}

async function syncEnrolledUsersFromDatabase() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/users`);
    if (!res.ok) return;
    const data = await res.json();
    const users = data.users || [];
    if (users.length > 0) {
      // Prioritize existing state.enrolledUser if present, otherwise pick the latest registered user
      const existing = users.find(u => u.user_id === state.enrolledUser);
      const activeUser = existing ? existing.user_id : users[users.length - 1].user_id;
      state.enrolledUser = activeUser;

      const userDisplay = document.getElementById("active-user-display");
      if (userDisplay) {
        userDisplay.textContent = `User: ${activeUser} (Enrolled)`;
      }
      const loginUser = document.getElementById("login-username");
      if (loginUser) {
        loginUser.value = activeUser;
      }
      const profileStatus = document.getElementById("active-profile-status");
      if (profileStatus) {
        profileStatus.textContent = "Argon2id Salted: Persistent in DB";
      }

      // Fetch user baseline for client-side reference and simulation
      const bRes = await fetch(`${BACKEND_URL}/api/user/${activeUser}/baseline`);
      if (bRes.ok) {
        const bData = await bRes.json();
        state.activeBaseline = {
          typing: bData.typing_baseline || {},
          motor: bData.motor_baseline || {}
        };
      }
    }
  } catch (err) {
    console.warn("[BioPrint] Could not sync enrolled users from database:", err);
  }
}
window.syncEnrolledUsersFromDatabase = syncEnrolledUsersFromDatabase;

// =============================================================================
// Navigation Handling
// =============================================================================

function initNavigation() {
  const tabEnroll = document.getElementById("tab-enroll");
  const tabVerify = document.getElementById("tab-verify");
  const enrollView = document.getElementById("enroll-view");
  const verifyView = document.getElementById("verify-view");

  if (!tabEnroll || !tabVerify) return;

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
    randomizeTargetDockOffset();
  });

  document.getElementById("btn-proceed-login")?.addEventListener("click", () => {
    tabVerify.click();
  });
}

// =============================================================================
// STEP 1: Account Setup & Credentials Validation
// =============================================================================

function initAccountSetup() {
  const userInput = document.getElementById("reg-username");
  const passInput = document.getElementById("reg-password");
  const confirmInput = document.getElementById("reg-confirm-password");
  const strengthFill = document.getElementById("strength-fill");
  const matchTag = document.getElementById("password-match-tag");
  const nextBtn = document.getElementById("btn-creds-next");

  if (!userInput || !passInput || !confirmInput || !nextBtn) return;

  function evaluateStrength(p) {
    if (!p) return { score: 0, cls: "" };
    let score = 0;
    if (p.length >= 6) score++;
    if (p.length >= 10) score++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
    if (/[0-9]/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;

    if (score <= 2) return { score: 1, cls: "strength-weak" };
    if (score <= 4) return { score: 2, cls: "strength-medium" };
    return { score: 3, cls: "strength-strong" };
  }

  function validateCredentials() {
    const user = userInput.value.trim();
    const pass = passInput.value;
    const confirm = confirmInput.value;

    const str = evaluateStrength(pass);
    strengthFill.className = "strength-fill " + str.cls;

    let isMatch = false;
    if (!confirm && !pass) {
      matchTag.textContent = "Matching: Pending";
      matchTag.className = "match-indicator";
    } else if (pass === confirm && pass.length >= 6) {
      matchTag.textContent = "Matching: Verified ✓";
      matchTag.className = "match-indicator match-yes";
      isMatch = true;
    } else {
      matchTag.textContent = "Matching: Mismatch ✗";
      matchTag.className = "match-indicator match-no";
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

  nextBtn.addEventListener("click", () => {
    if (!state.credentials.isValid) return;

    // Switch to Step 2: Scrambled Motor Calibration
    document.getElementById("card-creds").classList.add("hidden-card");
    document.getElementById("card-shapes").classList.remove("hidden-card");

    document.getElementById("dot-creds").classList.remove("active");
    document.getElementById("dot-creds").classList.add("completed");
    document.getElementById("line-1").style.background = "#10B981";
    document.getElementById("dot-shapes").classList.add("active");

    state.motor.renderStartTime = performance.now();
    resizeMotorCanvas();
  });
}

// =============================================================================
// STEP 2: Scrambled Shape-Matching Motor Calibration
// =============================================================================

function initScrambledMotorCalibration() {
  const arena = document.getElementById("enroll-drag-arena");
  const canvas = document.getElementById("drag-trajectory-canvas");
  if (!arena || !canvas) return;

  const ctx = canvas.getContext("2d");
  const shapes = document.querySelectorAll(".draggable-shape[data-target^='slot-']");
  const slots = document.querySelectorAll(".target-slot[data-accept]");

  function resizeCanvas() {
    const rect = arena.getBoundingClientRect();
    canvas.width = Math.round(rect.width);
    canvas.height = Math.round(rect.height);
    renderMotorTrajectories();
  }

  window.resizeMotorCanvas = resizeCanvas;
  window.addEventListener("resize", resizeCanvas);

  function renderMotorTrajectories() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw previous completed drag gestures in emerald
    state.motor.recordedDrags.forEach((drag) => {
      const traj = drag.trajectory || [];
      if (traj.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(traj[0].x, traj[0].y);
      for (let i = 1; i < traj.length; i++) {
        ctx.lineTo(traj[i].x, traj[i].y);
      }
      ctx.strokeStyle = "rgba(16, 185, 129, 0.5)";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    });

    // Draw active dragging trajectory in vibrant cyan with outer glow
    if (state.motor.activeDrag && state.motor.activeDrag.trajectory.length > 1) {
      const traj = state.motor.activeDrag.trajectory;
      ctx.beginPath();
      ctx.moveTo(traj[0].x, traj[0].y);
      for (let i = 1; i < traj.length; i++) {
        ctx.lineTo(traj[i].x, traj[i].y);
      }
      ctx.strokeStyle = "#00F0FF";
      ctx.lineWidth = 3;
      ctx.shadowColor = "#00F0FF";
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  shapes.forEach((shapeEl) => {
    shapeEl.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const shapeType = shapeEl.getAttribute("data-shape");
      const shapeObj = state.motor.shapes.find(s => s.id === shapeType);
      if (shapeObj && shapeObj.slotted) return;

      const now = performance.now();
      const arenaRect = arena.getBoundingClientRect();
      const elRect = shapeEl.getBoundingClientRect();

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
      const curX = e.clientX - arenaRect.left;
      const curY = e.clientY - arenaRect.top;

      const dx = e.clientX - state.motor.activeDrag.startX;
      const dy = e.clientY - state.motor.activeDrag.startY;
      state.motor.activeDrag.element.style.transform = `translate(${dx}px, ${dy}px) scale(1.12)`;

      state.motor.activeDrag.trajectory.push({
        x: curX,
        y: curY,
        t: now,
        is_trusted: e.isTrusted
      });

      // Update Live Telemetry HUD (Velocity and Tortuosity)
      const traj = state.motor.activeDrag.trajectory;
      if (traj.length >= 2) {
        const p1 = traj[0];
        const pLast = traj[traj.length - 1];
        const pPrev = traj[traj.length - 2];
        const dt = now - pPrev.t;
        const dDist = Math.hypot(pLast.x - pPrev.x, pLast.y - pPrev.y);
        const liveVel = dt > 0 ? (dDist / (dt / 1000.0)) : 0;

        const euclidDist = Math.hypot(pLast.x - p1.x, pLast.y - p1.y);
        let pathLen = 0;
        for (let i = 1; i < traj.length; i++) {
          pathLen += Math.hypot(traj[i].x - traj[i - 1].x, traj[i].y - traj[i - 1].y);
        }
        const tortuosity = euclidDist > 5 ? (pathLen / euclidDist) : 1.0;

        document.getElementById("drag-vel-live").textContent = `${Math.round(liveVel)} px/s`;
        document.getElementById("drag-tort-live").textContent = tortuosity.toFixed(2);
      }

      // Check slot hover and docking entry timestamp
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

      try { shapeEl.releasePointerCapture(e.pointerId); } catch (err) {}
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

        // Tolerant landing radius: 55px
        if (driftOffset <= 55.0) {
          isSuccess = true;
          targetSlot.classList.remove("slot-hover-active");
          targetSlot.classList.add("slot-filled");
          shapeEl.classList.add("slotted");

          // Snap to target center
          const arenaRect = arena.getBoundingClientRect();
          const targetRelX = slotCenterX - arenaRect.left - (state.motor.activeDrag.element.offsetWidth / 2);
          const targetRelY = slotCenterY - arenaRect.top - (state.motor.activeDrag.element.offsetHeight / 2);
          const snapDx = targetRelX - state.motor.activeDrag.elStartX;
          const snapDy = targetRelY - state.motor.activeDrag.elStartY;
          shapeEl.style.transform = `translate(${snapDx}px, ${snapDy}px) scale(0.95)`;

          const shapeObj = state.motor.shapes.find(s => s.id === state.motor.activeDrag.shapeType);
          if (shapeObj) shapeObj.slotted = true;
          state.motor.slottedCount++;

          const dockingLatency = state.motor.activeDrag.enterTargetTime ? Math.max(30.0, now - state.motor.activeDrag.enterTargetTime) : 120.0;
          document.getElementById("drag-slotted-count").textContent = `${state.motor.slottedCount} / 3`;
          document.getElementById("drag-dock-live").textContent = `${Math.round(dockingLatency)} ms`;

          // Kinematic telemetry calculations
          const traj = state.motor.activeDrag.trajectory;
          const holdDuration = Math.max(40.0, now - state.motor.activeDrag.startTime);
          let pathLen = 0;
          let velSum = 0;
          const velList = [];
          for (let i = 1; i < traj.length; i++) {
            const stepDist = Math.hypot(traj[i].x - traj[i - 1].x, traj[i].y - traj[i - 1].y);
            pathLen += stepDist;
            const dt = traj[i].t - traj[i - 1].t;
            if (dt > 0) {
              const v = stepDist / (dt / 1000.0);
              velSum += v;
              velList.push(v);
            }
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
            trajectory: traj
          });

          // If all 3 shapes are slotted, advance to Step 3 (Monkeytype typing calibration)
          if (state.motor.slottedCount >= 3) {
            setTimeout(() => {
              document.getElementById("card-shapes").classList.add("hidden-card");
              document.getElementById("card-typing").classList.remove("hidden-card");

              document.getElementById("dot-shapes").classList.remove("active");
              document.getElementById("dot-shapes").classList.add("completed");
              document.getElementById("line-2").style.background = "#10B981";
              document.getElementById("dot-typing").classList.add("active");

              focusMonkeytypeInput();
            }, 600);
          }
        }
      }

      if (!isSuccess) {
        shapeEl.style.transform = "none";
        shapeEl.classList.add("shape-invalid-shake");
        setTimeout(() => shapeEl.classList.remove("shape-invalid-shake"), 400);
        slots.forEach(s => s.classList.remove("slot-hover-active"));
      }

      state.motor.activeDrag = null;
      renderMotorTrajectories();
    });

    shapeEl.addEventListener("pointercancel", () => {
      if (state.motor.activeDrag) {
        state.motor.activeDrag.element.style.transform = "none";
        state.motor.activeDrag.element.classList.remove("is-dragging");
        state.motor.activeDrag = null;
        renderMotorTrajectories();
      }
    });
  });
}

// =============================================================================
// STEP 3: Monkeytype-Style 30-Word Typing Calibration Engine
// =============================================================================

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
  const submitBtn = document.getElementById("btn-submit-register");
  const resetBtn = document.getElementById("btn-restart-typing");

  if (!arena || !wordsWrap || !hiddenInput) return;

  function renderWords() {
    wordsWrap.innerHTML = "";
    state.monkeytype.words.forEach((word, wIdx) => {
      const wordDiv = document.createElement("div");
      wordDiv.className = "m-word" + (wIdx === 0 ? " word-active" : "");
      wordDiv.id = `m-word-${wIdx}`;

      for (let cIdx = 0; cIdx < word.length; cIdx++) {
        const charSpan = document.createElement("span");
        charSpan.className = "m-char" + (wIdx === 0 && cIdx === 0 ? " char-active" : "");
        charSpan.id = `m-char-${wIdx}-${cIdx}`;
        charSpan.textContent = word[cIdx];
        wordDiv.appendChild(charSpan);
      }
      wordsWrap.appendChild(wordDiv);
    });

    updateCaretPosition();
  }

  function scrollArenaToActiveWord() {
    const wIdx = state.monkeytype.currentWordIndex;
    const curWordEl = document.getElementById(`m-word-${wIdx}`);
    if (curWordEl && arena) {
      const arenaRect = arena.getBoundingClientRect();
      const wordRect = curWordEl.getBoundingClientRect();
      if (wordRect.top < arenaRect.top + 8 || wordRect.bottom > arenaRect.bottom - 8) {
        curWordEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }

  function updateCaretPosition() {
    const wIdx = state.monkeytype.currentWordIndex;
    const cIdx = state.monkeytype.currentCharIndex;
    const curWord = state.monkeytype.words[wIdx];

    if (!curWord) return;

    let targetEl = document.getElementById(`m-char-${wIdx}-${cIdx}`);
    if (!targetEl) {
      // End of word: place after last char
      targetEl = document.getElementById(`m-char-${wIdx}-${curWord.length - 1}`);
      if (targetEl) {
        const arenaRect = arena.getBoundingClientRect();
        const rect = targetEl.getBoundingClientRect();
        caret.style.left = `${rect.right - arenaRect.left + 2}px`;
        caret.style.top = `${rect.top - arenaRect.top + 3}px`;
        scrollArenaToActiveWord();
        return;
      }
    }

    if (targetEl) {
      const arenaRect = arena.getBoundingClientRect();
      const rect = targetEl.getBoundingClientRect();
      caret.style.left = `${rect.left - arenaRect.left}px`;
      caret.style.top = `${rect.top - arenaRect.top + 3}px`;
      scrollArenaToActiveWord();
    }
  }

  window.focusMonkeytypeInput = () => {
    hiddenInput.focus();
    updateCaretPosition();
  };

  arena.addEventListener("click", () => {
    hiddenInput.focus();
  });

  function startTimer() {
    if (state.monkeytype.timerInterval) return;
    const timerStat = document.querySelector(".timer-stat");

    state.monkeytype.timerInterval = setInterval(() => {
      state.monkeytype.timeRemaining--;
      if (liveTimer) {
        liveTimer.textContent = `${state.monkeytype.timeRemaining}s`;
      }

      if (state.monkeytype.timeRemaining <= 5 && timerStat) {
        timerStat.classList.add("timer-warning");
      }

      updateHUD();

      if (state.monkeytype.timeRemaining <= 0) {
        clearInterval(state.monkeytype.timerInterval);
        state.monkeytype.timerInterval = null;
        finishTypingTest();
      }
    }, 1000);
  }

  // Track keydown microsecond timestamps
  hiddenInput.addEventListener("keydown", (e) => {
    if (state.monkeytype.isCompleted) return;

    const now = performance.now();
    if (!state.monkeytype.startTime) {
      state.monkeytype.startTime = now;
      startTimer();
    }

    if (!e.repeat && !state.monkeytype.activeKeys.has(e.key)) {
      state.monkeytype.activeKeys.set(e.key, now);
    }

    if (e.key === "Backspace") {
      state.monkeytype.backspaceCount++;
      liveBackspaces.textContent = state.monkeytype.backspaceCount;
      handleBackspace();
    }
  });

  // Track keyup microsecond timestamps
  hiddenInput.addEventListener("keyup", (e) => {
    const now = performance.now();
    if (state.monkeytype.activeKeys.has(e.key)) {
      const downTime = state.monkeytype.activeKeys.get(e.key);
      state.monkeytype.activeKeys.delete(e.key);

      state.monkeytype.keystrokes.push({
        key: e.key,
        down_time: downTime,
        up_time: now,
        is_trusted: e.isTrusted
      });
    }
  });

  // Handle character input
  hiddenInput.addEventListener("input", (e) => {
    if (state.monkeytype.isCompleted) return;

    const val = hiddenInput.value;
    hiddenInput.value = "";
    if (!val) return;

    for (let i = 0; i < val.length; i++) {
      const ch = val[i];
      handleCharInput(ch);
    }

    updateHUD();
    updateCaretPosition();
  });

  function handleCharInput(ch) {
    const wIdx = state.monkeytype.currentWordIndex;
    const cIdx = state.monkeytype.currentCharIndex;
    const targetWord = state.monkeytype.words[wIdx];

    if (ch === " ") {
      // Advance to next word
      if (cIdx > 0) {
        completeCurrentWord();
      }
      return;
    }

    state.monkeytype.totalKeystrokes++;

    if (cIdx < targetWord.length) {
      const expectedChar = targetWord[cIdx];
      const charSpan = document.getElementById(`m-char-${wIdx}-${cIdx}`);

      if (ch === expectedChar) {
        charSpan.className = "m-char char-correct";
        state.monkeytype.correctKeystrokes++;
      } else {
        charSpan.className = "m-char char-error";
        document.getElementById(`m-word-${wIdx}`)?.classList.add("word-error");
      }

      state.monkeytype.currentCharIndex++;
    }
  }

  function handleBackspace() {
    const wIdx = state.monkeytype.currentWordIndex;
    let cIdx = state.monkeytype.currentCharIndex;

    if (cIdx > 0) {
      // Step back inside current word
      cIdx--;
      state.monkeytype.currentCharIndex = cIdx;
      const charSpan = document.getElementById(`m-char-${wIdx}-${cIdx}`);
      if (charSpan) {
        charSpan.className = "m-char char-active";
      }

      // Check if word still has errors
      const curWordEl = document.getElementById(`m-word-${wIdx}`);
      if (curWordEl && curWordEl.querySelectorAll(".char-error").length === 0) {
        curWordEl.classList.remove("word-error");
      }

      updateCaretPosition();
    } else if (cIdx === 0 && wIdx > 0) {
      // Jump back to previous word!
      const prevWIdx = wIdx - 1;
      const curWordEl = document.getElementById(`m-word-${wIdx}`);
      const prevWordEl = document.getElementById(`m-word-${prevWIdx}`);

      if (curWordEl) {
        curWordEl.classList.remove("word-active");
        const chars = curWordEl.querySelectorAll(".m-char");
        chars.forEach(c => c.className = "m-char");
      }

      if (prevWordEl) {
        prevWordEl.classList.add("word-active");
      }

      state.monkeytype.currentWordIndex = prevWIdx;
      const prevWord = state.monkeytype.words[prevWIdx];

      // Move caret to last character and allow erasing it
      state.monkeytype.currentCharIndex = Math.max(0, prevWord.length - 1);
      const lastCharSpan = document.getElementById(`m-char-${prevWIdx}-${prevWord.length - 1}`);
      if (lastCharSpan) {
        lastCharSpan.className = "m-char char-active";
      }

      liveProgress.textContent = `${state.monkeytype.currentWordIndex} / ${state.monkeytype.words.length}`;
      updateCaretPosition();
    }
  }

  function completeCurrentWord() {
    const wIdx = state.monkeytype.currentWordIndex;
    const wordEl = document.getElementById(`m-word-${wIdx}`);
    if (wordEl) wordEl.classList.remove("word-active");

    state.monkeytype.currentWordIndex++;
    state.monkeytype.currentCharIndex = 0;

    liveProgress.textContent = `${state.monkeytype.currentWordIndex} / ${state.monkeytype.words.length}`;

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

    liveWpm.textContent = wpm;
    liveAccuracy.textContent = `${accuracy}%`;
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
    submitBtn.disabled = false;
    submitBtn.classList.add("btn-armed");

    if (liveTimer) {
      liveTimer.textContent = "Done ✓";
      liveTimer.style.color = "#10B981";
    }
    const timerStat = document.querySelector(".timer-stat");
    if (timerStat) timerStat.classList.remove("timer-warning");

    liveProgress.textContent = `${state.monkeytype.currentWordIndex} / ${state.monkeytype.words.length} ✓`;
  }

  resetBtn.addEventListener("click", () => {
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
      liveTimer.style.color = "#F59E0B";
    }
    const timerStat = document.querySelector(".timer-stat");
    if (timerStat) timerStat.classList.remove("timer-warning");

    liveWpm.textContent = "0";
    liveAccuracy.textContent = "100%";
    liveBackspaces.textContent = "0";
    liveProgress.textContent = `0 / ${state.monkeytype.words.length}`;
    submitBtn.disabled = true;
    submitBtn.classList.remove("btn-armed");
    caret.style.display = "block";

    renderWords();
    hiddenInput.focus();
  });

  // Final Registration Submission
  submitBtn.addEventListener("click", async () => {
    submitBtn.disabled = true;
    submitBtn.textContent = "Compiling Baseline...";

    const now = performance.now();
    const duration = now - (state.monkeytype.startTime || now);
    const wpm = parseFloat(liveWpm.textContent) || 60.0;
    const accuracy = parseFloat(liveAccuracy.textContent) || 100.0;

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

        // Render Registration Complete Card
        document.getElementById("card-typing").classList.add("hidden-card");
        document.getElementById("card-complete").classList.remove("hidden-card");

        renderBaselineMetricsSummary(data.baseline_summary);

        // Update Terminal View User Display
        const userDisplay = document.getElementById("active-user-display");
        if (userDisplay) userDisplay.textContent = `User: ${data.user_id} (Enrolled)`;
        const loginUser = document.getElementById("login-username");
        if (loginUser) loginUser.value = data.user_id;

        await syncEnrolledUsersFromDatabase();
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
    <div class="metric-summary-box">
      <div class="metric-summary-label">Cross-Hand Ratio (R_hand)</div>
      <div class="metric-summary-val">${typing.r_hand_mean !== undefined ? typing.r_hand_mean.toFixed(2) : "0.68"}</div>
    </div>
    <div class="metric-summary-box">
      <div class="metric-summary-label">Spacebar Saccade (T_space)</div>
      <div class="metric-summary-val">${typing.space_latency_mean !== undefined ? Math.round(typing.space_latency_mean) : "185"} ms</div>
    </div>
    <div class="metric-summary-box">
      <div class="metric-summary-label">Path Tortuosity (&tau;)</div>
      <div class="metric-summary-val">${motor.tortuosity_mean !== undefined ? motor.tortuosity_mean.toFixed(2) : "1.28"}</div>
    </div>
    <div class="metric-summary-box">
      <div class="metric-summary-label">Docking Latency (T_dock)</div>
      <div class="metric-summary-val">${motor.docking_latency_mean !== undefined ? Math.round(motor.docking_latency_mean) : "140"} ms</div>
    </div>
  `;
}

// =============================================================================
// VIEW 2: Authentication Terminal, Pangram & 2D Offset Target Dock
// =============================================================================

function initLoginPangramAndDock() {
  const pangramInput = document.getElementById("login-pangram-input");
  const pangramTag = document.getElementById("pangram-status-tag");
  const token = document.getElementById("login-token");
  const hole = document.getElementById("login-target-hole");
  const arena = document.getElementById("login-drag-arena");
  const canvas = document.getElementById("login-drag-canvas");
  const randomizeBtn = document.getElementById("btn-reposition-offset");

  if (!pangramInput || !token || !hole || !arena || !canvas) return;

  const ctx = canvas.getContext("2d");

  function resizeLoginCanvas() {
    const rect = arena.getBoundingClientRect();
    canvas.width = Math.round(rect.width);
    canvas.height = Math.round(rect.height);
  }
  window.addEventListener("resize", resizeLoginCanvas);
  resizeLoginCanvas();

  // Password input key tracking
  const passwordInput = document.getElementById("login-password");
  if (passwordInput) {
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

  // Username input tracking & dynamic database baseline sync
  const usernameInput = document.getElementById("login-username");
  if (usernameInput) {
    usernameInput.addEventListener("change", async () => {
      const u = usernameInput.value.trim();
      if (u) {
        state.enrolledUser = u;
        const userDisplay = document.getElementById("active-user-display");
        if (userDisplay) userDisplay.textContent = `User: ${u} (Active)`;
        try {
          const bRes = await fetch(`${BACKEND_URL}/api/user/${u}/baseline`);
          if (bRes.ok) {
            const bData = await bRes.json();
            state.activeBaseline = {
              typing: bData.typing_baseline || {},
              motor: bData.motor_baseline || {}
            };
            const profileStatus = document.getElementById("active-profile-status");
            if (profileStatus) profileStatus.textContent = "Argon2id Salted: Persistent in DB";
          }
        } catch (e) {}
      }
    });
  }

  // Pangram key tracking & status update
  pangramInput.addEventListener("keydown", (e) => {
    // Disable enter submission to prevent accidental bypass
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
      pangramTag.textContent = "Status: Typo detected ✗";
      pangramTag.className = "pangram-match-tag mismatch";
    }
  });

  // Track continuous mouse telemetry for login view
  arena.addEventListener("mousemove", (e) => {
    state.login.mouseEvents.push({
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
      is_trusted: e.isTrusted
    });
    if (state.login.mouseEvents.length > 250) state.login.mouseEvents.shift();
  });

  // Dynamic 2D Offset Randomizer
  window.randomizeTargetDockOffset = () => {
    const offsetX = Math.round((Math.random() - 0.5) * 160); // +/- 80px
    const offsetY = Math.round((Math.random() - 0.5) * 100); // +/- 50px
    state.login.offset = { x: offsetX, y: offsetY };
    hole.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
  };

  randomizeBtn?.addEventListener("click", () => {
    randomizeTargetDockOffset();
  });

  // Draggable Security Token Gesture Submission
  token.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const now = performance.now();
    const arenaRect = arena.getBoundingClientRect();
    const elRect = token.getBoundingClientRect();

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
    const curX = e.clientX - arenaRect.left;
    const curY = e.clientY - arenaRect.top;

    const dx = e.clientX - state.login.activeDrag.startX;
    const dy = e.clientY - state.login.activeDrag.startY;
    token.style.transform = `translate(${dx}px, ${dy}px) scale(1.12)`;

    state.login.activeDrag.trajectory.push({
      x: curX,
      y: curY,
      t: now,
      is_trusted: e.isTrusted
    });

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

    // Render live login drag trajectory on canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const traj = state.login.activeDrag.trajectory;
    if (traj.length > 1) {
      ctx.beginPath();
      ctx.moveTo(traj[0].x, traj[0].y);
      for (let i = 1; i < traj.length; i++) {
        ctx.lineTo(traj[i].x, traj[i].y);
      }
      ctx.strokeStyle = "#00F0FF";
      ctx.lineWidth = 3;
      ctx.shadowColor = "#00F0FF";
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  });

  token.addEventListener("pointerup", async (e) => {
    if (!state.login.activeDrag || state.login.activeDrag.pointerId !== e.pointerId) return;
    e.preventDefault();

    try { token.releasePointerCapture(e.pointerId); } catch (err) {}
    token.classList.remove("is-dragging");

    const now = performance.now();
    const dropX = e.clientX;
    const dropY = e.clientY;

    const holeRect = hole.getBoundingClientRect();
    const holeCenterX = holeRect.left + holeRect.width / 2;
    const holeCenterY = holeRect.top + holeRect.height / 2;
    const driftOffset = Math.hypot(dropX - holeCenterX, dropY - holeCenterY);

    if (driftOffset <= 60.0) {
      // Docking Success -> Trigger Behavioral Verification Submission
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
        const dt = traj[i].t - traj[i - 1].t;
        if (dt > 0) {
          const v = stepDist / (dt / 1000.0);
          velSum += v;
          velList.push(v);
        }
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
        trajectory: traj
      };

      state.login.activeDrag = null;

      // Submit verification payload!
      await executeClientVerification({
        username: document.getElementById("login-username")?.value.trim() || state.enrolledUser,
        password: document.getElementById("login-password")?.value || "",
        password_keystrokes: state.login.passwordKeystrokes,
        pangram_keystrokes: state.login.pangramKeystrokes,
        token_drag: tokenDragGesture,
        mouse_events: state.login.mouseEvents,
        browser_integrity: {
          is_webdriver: navigator.webdriver || false,
          user_agent: navigator.userAgent,
          screen_width: window.screen.width,
          screen_height: window.screen.height
        }
      });

      // Reset token position smoothly
      setTimeout(() => {
        token.style.transform = "none";
        token.style.opacity = "1";
        hole.classList.remove("slot-unlocked");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }, 800);
    } else {
      // Snap back on miss
      token.style.transform = "none";
      token.classList.add("shape-invalid-shake");
      setTimeout(() => token.classList.remove("shape-invalid-shake"), 400);
      hole.classList.remove("slot-hover-active");
      state.login.activeDrag = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  });
}

// =============================================================================
// Core Verification Executor & Explainability Modal
// =============================================================================

async function executeClientVerification(payload) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const verdict = await res.json();
    displayVerificationModal(verdict);
  } catch (err) {
    displayVerificationModal({
      authenticated: false,
      confidence_score: 0.0,
      latency_ms: 0.0,
      signals: { bot_detected: false, password_valid: false, keystroke_rhythm_match: 0.0, motor_kinematics_match: 0.0 },
      explainability_reasons: [`Backend connection failed: ${err.message}. Ensure backend is running.`]
    });
  }
}

// =============================================================================
// Login Info Flush & Reset Utility
// =============================================================================

function flushLoginInputsAndTelemetry() {
  // 1. Clear Master Password field
  const pwdInput = document.getElementById("login-password");
  if (pwdInput) {
    pwdInput.value = "";
  }

  // 2. Clear Pangram Input field & reset status tag
  const pangramInput = document.getElementById("login-pangram-input");
  if (pangramInput) {
    pangramInput.value = "";
  }
  const pangramTag = document.getElementById("pangram-status-tag");
  if (pangramTag) {
    pangramTag.textContent = "Status: Pending";
    pangramTag.className = "pangram-match-tag";
  }

  // 3. Clear all in-memory keystroke & motor buffers
  state.login.passwordKeystrokes = [];
  if (state.login.passwordActiveKeys) state.login.passwordActiveKeys.clear();
  state.login.pangramKeystrokes = [];
  if (state.login.activeKeys) state.login.activeKeys.clear();
  state.login.mouseEvents = [];
  state.login.activeDrag = null;
  state.login.recordedTokenDrag = null;

  // 4. Reset Draggable Token & Target Dock Hole UI
  const token = document.getElementById("login-token");
  const hole = document.getElementById("login-target-hole");
  const canvas = document.getElementById("login-drag-canvas");

  if (token) {
    token.style.transform = "none";
    token.style.opacity = "1";
    token.classList.remove("is-dragging", "shape-invalid-shake");
  }
  if (hole) {
    hole.classList.remove("slot-unlocked", "slot-hover-active");
  }
  if (canvas) {
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // 5. Randomize target dock offset for fresh test
  if (typeof window.randomizeTargetDockOffset === "function") {
    window.randomizeTargetDockOffset();
  }
}
window.flushLoginInputsAndTelemetry = flushLoginInputsAndTelemetry;

function displayVerificationModal(verdict) {
  const modal = document.getElementById("verification-modal");
  const banner = document.getElementById("modal-verdict-banner");
  const icon = document.getElementById("verdict-icon");
  const title = document.getElementById("verdict-title");
  const subtitle = document.getElementById("verdict-subtitle");
  const latency = document.getElementById("modal-latency-val");
  const confidence = document.getElementById("modal-confidence-score");
  const closeBtn = document.getElementById("modal-close-btn");

  if (!modal) return;

  if (verdict.authenticated) {
    banner.className = "modal-verdict-banner";
    icon.textContent = "🛡️";
    title.textContent = "ACCESS GRANTED";
    subtitle.textContent = "Argon2id password and behavioral biometrics verified within baseline tolerances.";
    confidence.style.color = "#10B981";
  } else {
    banner.className = "modal-verdict-banner verdict-blocked";
    icon.textContent = "⛔";
    title.textContent = "ACCESS BLOCKED";
    subtitle.textContent = verdict.signals?.bot_detected
      ? "Bot automation / synthetic injection flagged."
      : (!verdict.signals?.password_valid ? "Argon2id password validation failure." : "Behavioral biometric anomaly detected.");
    confidence.style.color = "#EF4444";
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
    pwdVal.style.color = isPwdValid ? "#10B981" : "#EF4444";
    pwdFill.style.width = isPwdValid ? "100%" : "0%";
    pwdFill.style.background = isPwdValid ? "#10B981" : "#EF4444";
  }

  // Keystroke Signal
  const keyPct = Math.round(signals.keystroke_rhythm_match || 0);
  document.getElementById("signal-key-val").textContent = `${keyPct}%`;
  document.getElementById("meter-key-fill").style.width = `${keyPct}%`;

  // Motor Signal
  const motorPct = Math.round(signals.motor_kinematics_match || 0);
  document.getElementById("signal-motor-val").textContent = `${motorPct}%`;
  document.getElementById("meter-motor-fill").style.width = `${motorPct}%`;

  // Bot Authenticity Signal
  const botPct = signals.bot_detected ? 0 : 100;
  document.getElementById("signal-bot-val").textContent = `${botPct}%`;
  document.getElementById("meter-bot-fill").style.width = `${botPct}%`;
  document.getElementById("meter-bot-fill").style.background = signals.bot_detected ? "#EF4444" : "#10B981";

  // Explainability Diagnostics List
  const reasonsList = document.getElementById("modal-explainability-list");
  const badgeCount = document.getElementById("exp-badge-count");
  reasonsList.innerHTML = "";

  const reasons = verdict.explainability_reasons || [];
  badgeCount.textContent = `${reasons.length} Anomalies`;

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

  // Display modal to user
  modal.style.display = "flex";

  // Immediately flush the login page info so it is clean for testing again
  flushLoginInputsAndTelemetry();

  closeBtn.onclick = () => {
    modal.style.display = "none";
    flushLoginInputsAndTelemetry();
    const pwdInput = document.getElementById("login-password");
    if (pwdInput) pwdInput.focus();
  };

  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
      flushLoginInputsAndTelemetry();
    }
  };
}

// =============================================================================
// Attack Simulation Suite
// =============================================================================

function initAttackSimulator() {
  const getActiveUser = () => document.getElementById("login-username")?.value.trim() || state.enrolledUser || "alice";
  const getPassword = () => document.getElementById("login-password")?.value || state.credentials.password || "Secret123!";

  // 1. Legitimate Touch Typist + Smooth Diagonal Motor Stroke
  document.getElementById("sim-legit")?.addEventListener("click", async () => {
    const user = getActiveUser();
    let typingBase = state.activeBaseline?.typing || {};
    let motorBase = state.activeBaseline?.motor || {};

    if (!typingBase.hand_switch_ratio_mean) {
      try {
        const bRes = await fetch(`${BACKEND_URL}/api/user/${user}/baseline`);
        if (bRes.ok) {
          const bData = await bRes.json();
          typingBase = bData.typing_baseline || bData.typing || {};
          motorBase = bData.motor_baseline || bData.motor || {};
        }
      } catch (e) {}
    }

    const dwellMean = typingBase.dwell_home_row_mean || 85.0;
    const flightMean = typingBase.spacebar_saccade_delay_mean ? (typingBase.spacebar_saccade_delay_mean * 0.7) : 75.0;
    const dragVel = motorBase.mean_velocity_mean || 500.0;
    const tortuosity = motorBase.tortuosity_mean || 1.18;
    const dockingLatency = motorBase.docking_latency_mean || 110.0;

    const ks = generateSyntheticKeystrokes(PANGRAM_TARGET, dwellMean, flightMean, 3.0);
    const mouse = generateCurvedMouseTrail(30, 420.0, true);
    const legitDrag = {
      shape_type: "token",
      start_time: 100.0,
      drop_time: 540.0,
      initial_drag_latency: 180.0,
      hold_duration: 440.0,
      docking_latency: dockingLatency,
      drag_velocity_mean: dragVel,
      drag_velocity_std: 85.0,
      trajectory_directness_ratio: 0.88,
      tortuosity: tortuosity,
      drop_drift_offset: 6.0,
      target_slot_id: "login-target-hole",
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

  // 2. Leaked Password + Cadence Impostor (Hunt-and-Peck R_hand > 1.25)
  document.getElementById("sim-cadence-impostor")?.addEventListener("click", async () => {
    // Erratic pauses and long dwell times characteristic of an impostor
    const ks = generateSyntheticKeystrokes(PANGRAM_TARGET, 190.0, 310.0, 45.0);
    const mouse = generateCurvedMouseTrail(30, 800.0, true);
    const impostorDrag = {
      shape_type: "token",
      start_time: 100.0,
      drop_time: 900.0,
      initial_drag_latency: 600.0,
      hold_duration: 800.0,
      docking_latency: 350.0,
      drag_velocity_mean: 190.0,
      drag_velocity_std: 140.0,
      trajectory_directness_ratio: 0.62,
      tortuosity: 2.85,
      drop_drift_offset: 28.0,
      target_slot_id: "login-target-hole",
      trajectory: mouse
    };

    await executeClientVerification({
      username: getActiveUser(),
      password: getPassword(),
      pangram_keystrokes: ks,
      token_drag: impostorDrag,
      mouse_events: mouse,
      browser_integrity: { is_webdriver: false, user_agent: navigator.userAgent }
    });
  });

  // 3. Invalid Password Hash (Wrong Password -> rejected immediately)
  document.getElementById("sim-bad-password")?.addEventListener("click", async () => {
    const ks = generateSyntheticKeystrokes(PANGRAM_TARGET, 80.0, 75.0, 4.0);
    const mouse = generateCurvedMouseTrail(30, 420.0, true);
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
      trajectory: mouse
    };

    await executeClientVerification({
      username: getActiveUser(),
      password: "wrong_password_attempt_999",
      pangram_keystrokes: ks,
      token_drag: legitDrag,
      mouse_events: mouse,
      browser_integrity: { is_webdriver: false, user_agent: navigator.userAgent }
    });
  });

  // 4. Linear Zero-Jitter Cursor Bot
  document.getElementById("sim-linear-bot")?.addEventListener("click", async () => {
    const ks = generateSyntheticKeystrokes(PANGRAM_TARGET, 80.0, 75.0, 4.0);
    const mouse = [];
    for (let i = 0; i <= 25; i++) {
      mouse.push({
        x: 100.0 + i * 18.0,
        y: 200.0 + i * 12.0,
        t: 100.0 + i * 16.0,
        is_trusted: true
      });
    }
    const linearDrag = {
      shape_type: "token",
      start_time: 100.0,
      drop_time: 500.0,
      initial_drag_latency: 40.0,
      hold_duration: 400.0,
      docking_latency: 10.0,
      drag_velocity_mean: 620.0,
      drag_velocity_std: 0.0,
      trajectory_directness_ratio: 1.0,
      tortuosity: 1.0,
      drop_drift_offset: 0.0,
      target_slot_id: "login-target-hole",
      trajectory: mouse
    };

    await executeClientVerification({
      username: getActiveUser(),
      password: getPassword(),
      pangram_keystrokes: ks,
      token_drag: linearDrag,
      mouse_events: mouse,
      browser_integrity: { is_webdriver: false, user_agent: navigator.userAgent }
    });
  });

  // 5. Instant Drag Teleportation (<15ms hold duration)
  document.getElementById("sim-teleport-bot")?.addEventListener("click", async () => {
    const ks = generateSyntheticKeystrokes(PANGRAM_TARGET, 80.0, 75.0, 4.0);
    const mouse = generateCurvedMouseTrail(5, 10.0, true);
    const teleportDrag = {
      shape_type: "token",
      start_time: 100.0,
      drop_time: 108.0, // 8ms hold duration
      initial_drag_latency: 5.0,
      hold_duration: 8.0,
      docking_latency: 0.0,
      drag_velocity_mean: 9800.0,
      drag_velocity_std: 0.0,
      trajectory_directness_ratio: 1.0,
      tortuosity: 1.0,
      drop_drift_offset: 0.0,
      target_slot_id: "login-target-hole",
      trajectory: mouse
    };

    await executeClientVerification({
      username: getActiveUser(),
      password: getPassword(),
      pangram_keystrokes: ks,
      token_drag: teleportDrag,
      mouse_events: mouse,
      browser_integrity: { is_webdriver: false, user_agent: navigator.userAgent }
    });
  });

  // 6. Untrusted Script Injection (event.isTrusted === false)
  document.getElementById("sim-untrusted")?.addEventListener("click", async () => {
    const ks = generateSyntheticKeystrokes(PANGRAM_TARGET, 80.0, 75.0, 3.0).map(k => ({ ...k, is_trusted: false }));
    const mouse = generateCurvedMouseTrail(20, 400.0, false);
    const untrustedDrag = {
      shape_type: "token",
      start_time: 100.0,
      drop_time: 500.0,
      initial_drag_latency: 200.0,
      hold_duration: 400.0,
      docking_latency: 100.0,
      drag_velocity_mean: 450.0,
      drag_velocity_std: 80.0,
      tortuosity: 1.15,
      drop_drift_offset: 8.0,
      target_slot_id: "login-target-hole",
      trajectory: mouse
    };

    await executeClientVerification({
      username: getActiveUser(),
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
    const dwell = Math.max(25.0, baseDwell + (jitter * Math.sin(i * 1.3)));
    const down = t;
    const up = down + dwell;
    events.push({ key: phrase[i], down_time: down, up_time: up, is_trusted: true });
    const flight = Math.max(15.0, baseFlight + (jitter * Math.cos(i * 0.9)));
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
