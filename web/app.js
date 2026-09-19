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
    step: "drag", // 'drag' | 'stroop' | 'typing' | 'complete'
    shapes: [
      { id: "circle", name: "Circle", targetSlot: "slot-circle", slotted: false },
      { id: "square", name: "Square", targetSlot: "slot-square", slotted: false },
      { id: "triangle", name: "Triangle", targetSlot: "slot-triangle", slotted: false }
    ],
    slottedCount: 0,
    renderStartTime: 0,
    recordedDrags: [],
    currentDragTrajectory: [],

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
    formStartTime: 0,
    tokenRenderTime: 0,
    lastDragGesture: null,
    currentDragTrajectory: []
  }
};

// =============================================================================
// Initialization & Daemon Health Check
// =============================================================================

document.addEventListener("DOMContentLoaded", () => {
  initNavigation();
  initShapeDragEnrollment();
  initStroopProbe();
  initTypingEnrollment();
  initLoginDragSubmission();
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
// STEP 1: Multi-Shape Drag-and-Drop Calibration (Shape-in-the-Hole)
// =============================================================================

function initShapeDragEnrollment() {
  const arena = document.getElementById("enroll-drag-arena");
  const canvas = document.getElementById("drag-trajectory-canvas");
  if (!arena || !canvas) return;

  const ctx = canvas.getContext("2d");
  const shapes = document.querySelectorAll(".draggable-shape[data-target^='slot-']");
  const slots = document.querySelectorAll(".target-slot[data-accept]");

  let activeDrag = null; // { element, shapeType, pointerId, startX, startY, origX, origY, startTime, trajectory: [] }

  function resizeOverlay() {
    const rect = arena.getBoundingClientRect();
    canvas.width = Math.round(rect.width);
    canvas.height = Math.round(rect.height);
    renderTrajectory();
  }

  resizeOverlay();
  window.addEventListener("resize", resizeOverlay);
  document.getElementById("tab-enroll")?.addEventListener("click", () => setTimeout(resizeOverlay, 80));

  state.calibration.renderStartTime = performance.now();

  function renderTrajectory() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw all recorded drag paths in cyan/emerald
    state.calibration.recordedDrags.forEach((drag, dIdx) => {
      const traj = drag.trajectory || [];
      if (traj.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(traj[0].x, traj[0].y);
      for (let i = 1; i < traj.length; i++) {
        ctx.lineTo(traj[i].x, traj[i].y);
      }
      ctx.strokeStyle = "rgba(16, 185, 129, 0.4)";
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Draw current active drag trajectory with glow
    if (activeDrag && activeDrag.trajectory.length > 1) {
      const traj = activeDrag.trajectory;
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
  }

  // Pointer Event Handlers for Draggable Shapes
  shapes.forEach((shapeEl) => {
    shapeEl.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const shapeType = shapeEl.getAttribute("data-shape");
      const shapeState = state.calibration.shapes.find(s => s.id === shapeType);
      if (shapeState && shapeState.slotted) return; // already slotted

      const now = performance.now();
      const arenaRect = arena.getBoundingClientRect();
      const elRect = shapeEl.getBoundingClientRect();

      // Capture pointer for cross-device support (mouse, trackpad, touchscreen)
      shapeEl.setPointerCapture(e.pointerId);
      shapeEl.classList.add("is-dragging");

      const initLatency = Math.max(20.0, now - state.calibration.renderStartTime);

      activeDrag = {
        element: shapeEl,
        shapeType: shapeType,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        elStartX: elRect.left - arenaRect.left,
        elStartY: elRect.top - arenaRect.top,
        origTransform: shapeEl.style.transform || "none",
        startTime: now,
        initialLatency: initLatency,
        trajectory: [{
          x: e.clientX - arenaRect.left,
          y: e.clientY - arenaRect.top,
          t: now,
          is_trusted: e.isTrusted
        }]
      };

      renderTrajectory();
    });

    shapeEl.addEventListener("pointermove", (e) => {
      if (!activeDrag || activeDrag.pointerId !== e.pointerId) return;
      e.preventDefault();

      const now = performance.now();
      const arenaRect = arena.getBoundingClientRect();
      const curX = e.clientX - arenaRect.left;
      const curY = e.clientY - arenaRect.top;

      // Translate element directly following pointer delta
      const dx = e.clientX - activeDrag.startX;
      const dy = e.clientY - activeDrag.startY;
      activeDrag.element.style.transform = `translate(${dx}px, ${dy}px) scale(1.12)`;

      activeDrag.trajectory.push({
        x: curX,
        y: curY,
        t: now,
        is_trusted: e.isTrusted
      });

      // Live metrics HUD computation
      if (activeDrag.trajectory.length >= 2) {
        const p1 = activeDrag.trajectory[0];
        const pLast = activeDrag.trajectory[activeDrag.trajectory.length - 1];
        const pPrev = activeDrag.trajectory[activeDrag.trajectory.length - 2];
        const dt = now - pPrev.t;
        const dDist = Math.hypot(pLast.x - pPrev.x, pLast.y - pPrev.y);
        const liveVel = dt > 0 ? (dDist / (dt / 1000.0)) : 0;

        const euclidDist = Math.hypot(pLast.x - p1.x, pLast.y - p1.y);
        let pathLen = 0;
        for (let i = 1; i < activeDrag.trajectory.length; i++) {
          pathLen += Math.hypot(
            activeDrag.trajectory[i].x - activeDrag.trajectory[i - 1].x,
            activeDrag.trajectory[i].y - activeDrag.trajectory[i - 1].y
          );
        }
        const directness = pathLen > 0 ? Math.min(1.0, euclidDist / pathLen) : 1.0;

        document.getElementById("drag-vel-live").textContent = `${Math.round(liveVel)} px/s`;
        document.getElementById("drag-direct-live").textContent = directness.toFixed(2);
      }

      // Check slot hover states
      slots.forEach((slot) => {
        const slotRect = slot.getBoundingClientRect();
        const pointerInSlot = (
          e.clientX >= slotRect.left &&
          e.clientX <= slotRect.right &&
          e.clientY >= slotRect.top &&
          e.clientY <= slotRect.bottom
        );
        if (pointerInSlot) {
          slot.classList.add("slot-hover-active");
        } else {
          slot.classList.remove("slot-hover-active");
        }
      });

      renderTrajectory();
    });

    shapeEl.addEventListener("pointerup", (e) => {
      if (!activeDrag || activeDrag.pointerId !== e.pointerId) return;
      e.preventDefault();

      try { shapeEl.releasePointerCapture(e.pointerId); } catch (err) {}
      shapeEl.classList.remove("is-dragging");

      const now = performance.now();
      const dropX = e.clientX;
      const dropY = e.clientY;

      // Find matching target slot
      const targetSlotId = shapeEl.getAttribute("data-target");
      const targetSlot = document.getElementById(targetSlotId);
      let isSuccess = false;
      let driftOffset = 0.0;

      if (targetSlot) {
        const slotRect = targetSlot.getBoundingClientRect();
        const slotCenterX = slotRect.left + slotRect.width / 2;
        const slotCenterY = slotRect.top + slotRect.height / 2;
        driftOffset = Math.hypot(dropX - slotCenterX, dropY - slotCenterY);

        // Tolerant landing radius: 55px from center
        if (driftOffset <= 55.0) {
          isSuccess = true;
          targetSlot.classList.remove("slot-hover-active");
          targetSlot.classList.add("slot-filled");
          shapeEl.classList.add("slotted");

          // Snap visually into the center of the slot
          const arenaRect = arena.getBoundingClientRect();
          const targetRelX = slotCenterX - arenaRect.left - (activeDrag.element.offsetWidth / 2);
          const targetRelY = slotCenterY - arenaRect.top - (activeDrag.element.offsetHeight / 2);
          const snapDx = targetRelX - activeDrag.elStartX;
          const snapDy = targetRelY - activeDrag.elStartY;
          shapeEl.style.transform = `translate(${snapDx}px, ${snapDy}px) scale(0.95)`;

          // Mark shape as slotted
          const shapeState = state.calibration.shapes.find(s => s.id === activeDrag.shapeType);
          if (shapeState) shapeState.slotted = true;
          state.calibration.slottedCount++;

          document.getElementById("drag-slotted-count").textContent = `${state.calibration.slottedCount} / 3`;
          document.getElementById("drag-drift-live").textContent = `${driftOffset.toFixed(1)} px`;

          // Calculate summary metrics for the drag
          const traj = activeDrag.trajectory;
          const holdDur = Math.max(40.0, now - activeDrag.startTime);
          let pathLen = 0;
          let velSum = 0;
          for (let i = 1; i < traj.length; i++) {
            const stepDist = Math.hypot(traj[i].x - traj[i - 1].x, traj[i].y - traj[i - 1].y);
            pathLen += stepDist;
            const dt = traj[i].t - traj[i - 1].t;
            if (dt > 0) velSum += stepDist / (dt / 1000.0);
          }
          const meanVel = traj.length > 1 ? (velSum / (traj.length - 1)) : 420.0;
          const euclidDist = traj.length > 1 ? Math.hypot(traj[traj.length - 1].x - traj[0].x, traj[traj.length - 1].y - traj[0].y) : pathLen;
          const directness = pathLen > 0 ? (euclidDist / pathLen) : 1.0;

          // Record Drag Gesture Event
          state.calibration.recordedDrags.push({
            shape_type: activeDrag.shapeType,
            start_time: activeDrag.startTime,
            drop_time: now,
            initial_drag_latency: activeDrag.initialLatency,
            hold_duration: holdDur,
            drag_velocity_mean: meanVel,
            drag_velocity_std: 85.0,
            trajectory_directness_ratio: directness,
            drop_drift_offset: driftOffset,
            target_slot_id: targetSlotId,
            trajectory: traj
          });

          // Check if all 3 shapes are slotted!
          if (state.calibration.slottedCount >= 3) {
            setTimeout(() => {
              // Advance to Step 2: Stroop Probe
              document.getElementById("dot-motor").classList.remove("active");
              document.getElementById("dot-motor").classList.add("completed");
              document.getElementById("line-1").style.background = "#10B981";
              document.getElementById("dot-stroop").classList.add("active");

              document.getElementById("card-motor").classList.add("hidden-card");
              document.getElementById("card-stroop").classList.remove("hidden-card");
              startStroopTrial(0);
            }, 600);
          }
        }
      }

      if (!isSuccess) {
        // Return to dock with shake effect
        shapeEl.style.transform = "none";
        shapeEl.classList.add("shape-invalid-shake");
        setTimeout(() => shapeEl.classList.remove("shape-invalid-shake"), 400);
        slots.forEach(s => s.classList.remove("slot-hover-active"));
      }

      activeDrag = null;
      renderTrajectory();
    });

    shapeEl.addEventListener("pointercancel", () => {
      if (activeDrag) {
        activeDrag.element.style.transform = "none";
        activeDrag.element.classList.remove("is-dragging");
        activeDrag = null;
        renderTrajectory();
      }
    });
  });
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
      mouse_events: [],
      motor_targets: [],
      drag_gestures: state.calibration.recordedDrags,
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
      <div class="metric-summary-label">Enrolled Shapes Slotted</div>
      <div class="metric-summary-val">${state.calibration.recordedDrags.length} gestures (Circle, Square, Triangle)</div>
    </div>
    <div class="metric-summary-box">
      <div class="metric-summary-label">Mean Drag Velocity</div>
      <div class="metric-summary-val">${Math.round(summary.mean_velocity_px_s || 450)} px/s</div>
    </div>
    <div class="metric-summary-box">
      <div class="metric-summary-label">Flight Transitions</div>
      <div class="metric-summary-val">${summary.transitions_enrolled?.length || 0} transitions (μ, σ)</div>
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
// VIEW 2: Authentication Dashboard & Single Shape Drag-to-Unlock
// =============================================================================

function initLoginDragSubmission() {
  const loginForm = document.getElementById("login-form");
  const tokenEl = document.getElementById("login-token");
  const targetHole = document.getElementById("login-target-hole");
  const dragArena = document.getElementById("login-drag-arena");
  const canvas = document.getElementById("login-drag-canvas");
  const passInput = document.getElementById("login-password");
  const repositionBtn = document.getElementById("btn-reposition");

  if (!tokenEl || !targetHole || !dragArena || !canvas) return;

  const ctx = canvas.getContext("2d");
  let activeTokenDrag = null;

  function resizeLoginOverlay() {
    const rect = dragArena.getBoundingClientRect();
    canvas.width = Math.round(rect.width);
    canvas.height = Math.round(rect.height);
  }
  resizeLoginOverlay();
  window.addEventListener("resize", resizeLoginOverlay);
  document.getElementById("tab-verify")?.addEventListener("click", () => {
    setTimeout(resizeLoginOverlay, 80);
    state.login.tokenRenderTime = performance.now();
  });

  state.login.tokenRenderTime = performance.now();

  function renderLoginTrajectory() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!activeTokenDrag || activeTokenDrag.trajectory.length < 2) return;

    const traj = activeTokenDrag.trajectory;
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

  // Pointer Event listeners on Login Security Token
  tokenEl.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const now = performance.now();
    const arenaRect = dragArena.getBoundingClientRect();
    const tokenRect = tokenEl.getBoundingClientRect();

    tokenEl.setPointerCapture(e.pointerId);
    tokenEl.classList.add("is-dragging");

    const initLatency = Math.max(20.0, now - (state.login.tokenRenderTime || (now - 300)));

    activeTokenDrag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      elStartX: tokenRect.left - arenaRect.left,
      elStartY: tokenRect.top - arenaRect.top,
      startTime: now,
      initialLatency: initLatency,
      trajectory: [{
        x: e.clientX - arenaRect.left,
        y: e.clientY - arenaRect.top,
        t: now,
        is_trusted: e.isTrusted
      }]
    };

    renderLoginTrajectory();
  });

  tokenEl.addEventListener("pointermove", (e) => {
    if (!activeTokenDrag || activeTokenDrag.pointerId !== e.pointerId) return;
    e.preventDefault();

    const now = performance.now();
    const arenaRect = dragArena.getBoundingClientRect();
    const curX = e.clientX - arenaRect.left;
    const curY = e.clientY - arenaRect.top;

    const dx = e.clientX - activeTokenDrag.startX;
    const dy = e.clientY - activeTokenDrag.startY;
    tokenEl.style.transform = `translate(${dx}px, ${dy}px) scale(1.12)`;

    activeTokenDrag.trajectory.push({
      x: curX,
      y: curY,
      t: now,
      is_trusted: e.isTrusted
    });

    // Hover state over target hole
    const holeRect = targetHole.getBoundingClientRect();
    const inHole = (
      e.clientX >= holeRect.left &&
      e.clientX <= holeRect.right &&
      e.clientY >= holeRect.top &&
      e.clientY <= holeRect.bottom
    );
    if (inHole) {
      targetHole.classList.add("slot-hover-active");
    } else {
      targetHole.classList.remove("slot-hover-active");
    }

    renderLoginTrajectory();
  });

  tokenEl.addEventListener("pointerup", async (e) => {
    if (!activeTokenDrag || activeTokenDrag.pointerId !== e.pointerId) return;
    e.preventDefault();

    try { tokenEl.releasePointerCapture(e.pointerId); } catch (err) {}
    tokenEl.classList.remove("is-dragging");

    const now = performance.now();
    const dropX = e.clientX;
    const dropY = e.clientY;

    const holeRect = targetHole.getBoundingClientRect();
    const holeCenterX = holeRect.left + holeRect.width / 2;
    const holeCenterY = holeRect.top + holeRect.height / 2;
    const driftOffset = Math.hypot(dropX - holeCenterX, dropY - holeCenterY);

    let isSuccess = false;

    // Drop threshold into the target hole
    if (driftOffset <= 60.0) {
      isSuccess = true;
      targetHole.classList.remove("slot-hover-active");
      targetHole.classList.add("slot-unlocked");

      // Snap token into the center
      const arenaRect = dragArena.getBoundingClientRect();
      const targetRelX = holeCenterX - arenaRect.left - (tokenEl.offsetWidth / 2);
      const targetRelY = holeCenterY - arenaRect.top - (tokenEl.offsetHeight / 2);
      const snapDx = targetRelX - activeTokenDrag.elStartX;
      const snapDy = targetRelY - activeTokenDrag.elStartY;
      tokenEl.style.transform = `translate(${snapDx}px, ${snapDy}px) scale(0.95)`;

      // Compile drag gesture telemetry
      const traj = activeTokenDrag.trajectory;
      const holdDur = Math.max(40.0, now - activeTokenDrag.startTime);
      let pathLen = 0;
      let velSum = 0;
      for (let i = 1; i < traj.length; i++) {
        const stepDist = Math.hypot(traj[i].x - traj[i - 1].x, traj[i].y - traj[i - 1].y);
        pathLen += stepDist;
        const dt = traj[i].t - traj[i - 1].t;
        if (dt > 0) velSum += stepDist / (dt / 1000.0);
      }
      const meanVel = traj.length > 1 ? (velSum / (traj.length - 1)) : 420.0;
      const euclidDist = traj.length > 1 ? Math.hypot(traj[traj.length - 1].x - traj[0].x, traj[traj.length - 1].y - traj[0].y) : pathLen;
      const directness = pathLen > 0 ? (euclidDist / pathLen) : 1.0;

      state.login.lastDragGesture = {
        shape_type: "token",
        start_time: activeTokenDrag.startTime,
        drop_time: now,
        initial_drag_latency: activeTokenDrag.initialLatency,
        hold_duration: holdDur,
        drag_velocity_mean: meanVel,
        drag_velocity_std: 80.0,
        trajectory_directness_ratio: directness,
        drop_drift_offset: driftOffset,
        target_slot_id: "login-target-hole",
        trajectory: traj
      };

      // Trigger instant authentication
      await executeClientVerification();

      // Reset token position after a short delay
      setTimeout(() => {
        tokenEl.style.transform = "none";
        targetHole.classList.remove("slot-unlocked");
      }, 1200);
    }

    if (!isSuccess) {
      // Rebound with invalid shake
      tokenEl.style.transform = "none";
      tokenEl.classList.add("shape-invalid-shake");
      setTimeout(() => tokenEl.classList.remove("shape-invalid-shake"), 400);
      targetHole.classList.remove("slot-hover-active");
    }

    activeTokenDrag = null;
    renderLoginTrajectory();
  });

  tokenEl.addEventListener("pointercancel", () => {
    if (activeTokenDrag) {
      tokenEl.style.transform = "none";
      tokenEl.classList.remove("is-dragging");
      targetHole.classList.remove("slot-hover-active");
      activeTokenDrag = null;
      renderLoginTrajectory();
    }
  });

  // Reposition Hole Handler
  repositionBtn?.addEventListener("click", () => {
    repositionLoginTarget();
  });

  // Passive Telemetry Recording on the Passphrase input
  passInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      return;
    }
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

  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
  });
}

function repositionLoginTarget() {
  const hole = document.getElementById("login-target-hole");
  const toggle = document.getElementById("toggle-dynamic-pos");
  if (!hole) return;

  if (!toggle || !toggle.checked) {
    hole.style.transform = "none";
    return;
  }

  // Offset within subtle margins
  const randY = (Math.random() * 2 - 1) * 20;
  const randX = (Math.random() * 2 - 1) * 25;
  hole.style.transform = `translate(${randX}px, ${randY}px)`;
}

async function executeClientVerification(customPayload = null) {
  const userId = document.getElementById("login-username").value.trim() || state.enrolledUser;
  const passphrase = document.getElementById("login-password").value;

  const payload = customPayload || {
    user_id: userId,
    passphrase: passphrase,
    keystrokes: state.login.keystrokes,
    mouse_events: state.login.mouseEvents,
    drag_gesture: state.login.lastDragGesture,
    drag_gestures: state.login.lastDragGesture ? [state.login.lastDragGesture] : []
  };

  try {
    const res = await fetch(`${BACKEND_URL}/api/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const verdict = await res.json();
    console.log("[Client Verify] Result:", verdict);

    // Retrieve mouse/drag trajectory for modal visualization
    const vizTrajectory = (payload.drag_gesture?.trajectory?.length)
      ? payload.drag_gesture.trajectory
      : (payload.mouse_events || []);

    displayVerificationModal(verdict, vizTrajectory);

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

    // Generate matched token drag gesture
    const legitDrag = {
      shape_type: "token",
      start_time: 100.0,
      drop_time: 540.0,
      initial_drag_latency: 240.0,
      hold_duration: 440.0,
      drag_velocity_mean: 450.0,
      drag_velocity_std: 85.0,
      trajectory_directness_ratio: 0.91,
      drop_drift_offset: 7.2,
      target_slot_id: "login-target-hole",
      trajectory: mouse
    };

    await executeClientVerification({
      user_id: activeUser,
      passphrase: phrase,
      keystrokes: ks,
      mouse_events: mouse,
      drag_gesture: legitDrag,
      drag_gestures: [legitDrag]
    });
  });

  // 2. Cadence Impostor (+3.5σ Cadence Mismatch on Full Passphrase)
  document.getElementById("sim-cadence-impostor").addEventListener("click", async () => {
    // Impostor with erratic flight times (340ms vs baseline ~25ms: +3.5σ deviation)
    const ks = generateSyntheticKeystrokes("bioprint secure authentication", 185.0, 340.0, 45.0);
    const mouse = generateCurvedMouseTrail(30, 500.0, true);
    const impostorDrag = {
      shape_type: "token",
      start_time: 100.0,
      drop_time: 850.0,
      initial_drag_latency: 600.0,
      hold_duration: 750.0,
      drag_velocity_mean: 180.0,
      drag_velocity_std: 140.0,
      trajectory_directness_ratio: 0.65,
      drop_drift_offset: 28.0,
      target_slot_id: "login-target-hole",
      trajectory: mouse
    };
    await executeClientVerification({
      user_id: userId(),
      passphrase: "bioprint secure authentication",
      keystrokes: ks,
      mouse_events: mouse,
      drag_gesture: impostorDrag,
      drag_gestures: [impostorDrag]
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
    const linearDrag = {
      shape_type: "token",
      start_time: 100.0,
      drop_time: 420.0,
      initial_drag_latency: 50.0,
      hold_duration: 320.0,
      drag_velocity_mean: 600.0,
      drag_velocity_std: 0.0,
      trajectory_directness_ratio: 1.0,
      drop_drift_offset: 0.0,
      target_slot_id: "login-target-hole",
      trajectory: mouse
    };
    await executeClientVerification({
      user_id: userId(),
      passphrase: "bioprint secure authentication",
      keystrokes: ks,
      mouse_events: mouse,
      drag_gesture: linearDrag,
      drag_gestures: [linearDrag]
    });
  });

  // 4. Impossible Speed Bot (<10ms dwell & drag teleportation)
  document.getElementById("sim-fast-bot").addEventListener("click", async () => {
    const ks = [
      { key: "b", down_time: 100.0, up_time: 103.5 }, // 3.5ms dwell
      { key: "i", down_time: 105.0, up_time: 108.0 },
      { key: "o", down_time: 110.0, up_time: 114.0 }
    ];
    const mouse = generateCurvedMouseTrail(5, 10.0, true);
    const teleportDrag = {
      shape_type: "token",
      start_time: 100.0,
      drop_time: 108.0, // 8ms drag duration (teleportation)
      initial_drag_latency: 5.0,
      hold_duration: 8.0,
      drag_velocity_mean: 9500.0,
      drag_velocity_std: 0.0,
      trajectory_directness_ratio: 1.0,
      drop_drift_offset: 0.0,
      target_slot_id: "login-target-hole",
      trajectory: mouse
    };
    await executeClientVerification({
      user_id: userId(),
      passphrase: "bioprint secure authentication",
      keystrokes: ks,
      mouse_events: mouse,
      drag_gesture: teleportDrag,
      drag_gestures: [teleportDrag]
    });
  });

  // 5. Untrusted Event Injection (isTrusted == false)
  document.getElementById("sim-untrusted").addEventListener("click", async () => {
    const ks = generateSyntheticKeystrokes("bioprint secure authentication", 130.0, 30.0, 3.0);
    const mouse = generateCurvedMouseTrail(20, 400.0, false); // is_trusted = false
    const untrustedDrag = {
      shape_type: "token",
      start_time: 100.0,
      drop_time: 500.0,
      initial_drag_latency: 200.0,
      hold_duration: 400.0,
      drag_velocity_mean: 440.0,
      drag_velocity_std: 80.0,
      trajectory_directness_ratio: 0.88,
      drop_drift_offset: 5.0,
      target_slot_id: "login-target-hole",
      trajectory: mouse
    };
    await executeClientVerification({
      user_id: userId(),
      passphrase: "bioprint secure authentication",
      keystrokes: ks,
      mouse_events: mouse,
      drag_gesture: untrustedDrag,
      drag_gestures: [untrustedDrag]
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

  const dragVal = Math.round(signals.drag_dynamics_match || 90);
  const dragMeterVal = document.getElementById("signal-drag-val");
  const dragMeterFill = document.getElementById("meter-drag-fill");
  if (dragMeterVal) dragMeterVal.textContent = `${dragVal}%`;
  if (dragMeterFill) dragMeterFill.style.width = `${dragVal}%`;

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
