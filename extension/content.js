/**
 * BioPrint Behavioral Biometric Sentinel - Content Script (Native Vanilla JS)
 * =========================================================================
 * Silently captures microsecond telemetry using performance.now(),
 * checks event.isTrusted, injects a floating guard badge, and intercepts
 * form submissions in the capture phase to run biometric verification.
 */

(function () {
  console.log("[BioPrint Sentinel] Injected into active tab:", window.location.href);

  const BACKEND_URL = "http://127.0.0.1:8000";

  // Telemetry state buffers
  const telemetry = {
    keystrokes: [],         // Array of { key, down_time, up_time }
    mouseEvents: [],        // Array of { x, y, t, is_trusted }
    dragGestures: [],       // Array of DragGestureEvent
    activeKeys: new Map(),  // Active keydown tracking: key -> down_time
    lastActivityTime: performance.now(),
    loginButtonContext: null
  };

  // ---------------------------------------------------------------------------
  // 1. Passive Microsecond Event Listeners
  // ---------------------------------------------------------------------------

  // Keystroke dynamics capture
  window.addEventListener(
    "keydown",
    (e) => {
      const now = performance.now();
      telemetry.lastActivityTime = now;

      // Ignore repeated keydowns when a key is held down
      if (!e.repeat && !telemetry.activeKeys.has(e.key)) {
        telemetry.activeKeys.set(e.key, {
          down_time: now,
          is_trusted: e.isTrusted
        });
      }
      updateBadgeStats();
    },
    { capture: true, passive: true }
  );

  window.addEventListener(
    "keyup",
    (e) => {
      const now = performance.now();
      telemetry.lastActivityTime = now;

      if (telemetry.activeKeys.has(e.key)) {
        const entry = telemetry.activeKeys.get(e.key);
        telemetry.activeKeys.delete(e.key);

        telemetry.keystrokes.push({
          key: e.key,
          down_time: entry.down_time,
          up_time: now,
          is_trusted: e.isTrusted && entry.is_trusted
        });

        // Cap buffer to last 150 keystrokes to maintain peak performance
        if (telemetry.keystrokes.length > 150) {
          telemetry.keystrokes.shift();
        }
      }
      updateBadgeStats();
    },
    { capture: true, passive: true }
  );

  // Mouse and Pointer kinematics capture (sampled at high fidelity)
  let lastMouseSample = 0;
  window.addEventListener(
    "mousemove",
    (e) => {
      const now = performance.now();
      if (now - lastMouseSample >= 8.0) {
        lastMouseSample = now;
        telemetry.mouseEvents.push({
          x: e.clientX,
          y: e.clientY,
          t: now,
          is_trusted: e.isTrusted
        });

        if (telemetry.mouseEvents.length > 300) {
          telemetry.mouseEvents.shift();
        }
        updateBadgeStats();
      }
    },
    { capture: true, passive: true }
  );

  // Pointer Events capture for drag gestures and cross-device interaction
  let activePointerDrag = null;
  window.addEventListener(
    "pointerdown",
    (e) => {
      const now = performance.now();
      activePointerDrag = {
        pointerId: e.pointerId,
        startTime: now,
        is_trusted: e.isTrusted,
        trajectory: [{ x: e.clientX, y: e.clientY, t: now, is_trusted: e.isTrusted }]
      };
    },
    { capture: true, passive: true }
  );

  window.addEventListener(
    "pointermove",
    (e) => {
      if (!activePointerDrag || activePointerDrag.pointerId !== e.pointerId) return;
      const now = performance.now();
      activePointerDrag.trajectory.push({
        x: e.clientX,
        y: e.clientY,
        t: now,
        is_trusted: e.isTrusted
      });
      // Also sync to mouseEvents buffer
      telemetry.mouseEvents.push({
        x: e.clientX,
        y: e.clientY,
        t: now,
        is_trusted: e.isTrusted
      });
      if (telemetry.mouseEvents.length > 300) telemetry.mouseEvents.shift();
    },
    { capture: true, passive: true }
  );

  window.addEventListener(
    "pointerup",
    (e) => {
      if (activePointerDrag && activePointerDrag.pointerId === e.pointerId) {
        const now = performance.now();
        const traj = activePointerDrag.trajectory;
        traj.push({ x: e.clientX, y: e.clientY, t: now, is_trusted: e.isTrusted });
        const holdDuration = Math.max(10.0, now - activePointerDrag.startTime);

        // Calculate path metrics
        let pathLen = 0;
        let velSum = 0;
        for (let i = 1; i < traj.length; i++) {
          const stepDist = Math.hypot(traj[i].x - traj[i - 1].x, traj[i].y - traj[i - 1].y);
          pathLen += stepDist;
          const dt = traj[i].t - traj[i - 1].t;
          if (dt > 0) velSum += stepDist / (dt / 1000.0);
        }
        const meanVel = traj.length > 1 ? (velSum / (traj.length - 1)) : 0;
        const euclidDist = traj.length > 1 ? Math.hypot(traj[traj.length - 1].x - traj[0].x, traj[traj.length - 1].y - traj[0].y) : pathLen;
        const directness = pathLen > 0 ? (euclidDist / pathLen) : 1.0;

        const gesture = {
          shape_type: "pointer_drag",
          start_time: activePointerDrag.startTime,
          drop_time: now,
          initial_drag_latency: 50.0,
          hold_duration: holdDuration,
          drag_velocity_mean: meanVel,
          drag_velocity_std: 70.0,
          trajectory_directness_ratio: directness,
          drop_drift_offset: 5.0,
          target_slot_id: "slot",
          trajectory: traj
        };

        telemetry.dragGestures.push(gesture);
        if (telemetry.dragGestures.length > 10) telemetry.dragGestures.shift();

        // Check for synthetic teleportation or untrusted flag
        if (!e.isTrusted || !activePointerDrag.is_trusted) {
          console.warn("[BioPrint Sentinel] Synthetic Pointer drag flagged: isTrusted is false.");
        } else if (holdDuration < 15.0 && pathLen > 50.0) {
          console.warn("[BioPrint Sentinel] Synthetic Drag flagged: Impossible instant teleportation.");
        }

        activePointerDrag = null;
      }
    },
    { capture: true, passive: true }
  );

  // ---------------------------------------------------------------------------
  // 2. Injected Discreet Guard Badge
  // ---------------------------------------------------------------------------

  function injectGuardBadge() {
    if (document.getElementById("bioprint-ext-guard-badge")) return;

    const badge = document.createElement("div");
    badge.id = "bioprint-ext-guard-badge";
    badge.innerHTML = `
      <style>
        #bioprint-ext-guard-badge {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 16px;
          background: rgba(10, 15, 29, 0.85);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(0, 240, 255, 0.35);
          border-radius: 9999px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4), 0 0 15px rgba(0, 240, 255, 0.2);
          color: #E2E8F0;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          user-select: none;
        }
        #bioprint-ext-guard-badge:hover {
          transform: translateY(-2px);
          border-color: rgba(0, 240, 255, 0.7);
          box-shadow: 0 6px 25px rgba(0, 0, 0, 0.5), 0 0 20px rgba(0, 240, 255, 0.4);
        }
        .bioprint-pulse-ring {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #00F0FF;
          position: relative;
        }
        .bioprint-pulse-ring::after {
          content: "";
          position: absolute;
          width: 100%;
          height: 100%;
          top: 0;
          left: 0;
          border-radius: 50%;
          background: #00F0FF;
          animation: bioprint-pulse 2s infinite ease-out;
        }
        @keyframes bioprint-pulse {
          0% { transform: scale(1); opacity: 0.8; }
          100% { transform: scale(3); opacity: 0; }
        }
        .bioprint-badge-title {
          letter-spacing: 0.5px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .bioprint-tag {
          background: rgba(0, 240, 255, 0.15);
          color: #00F0FF;
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 4px;
          text-transform: uppercase;
          font-weight: 700;
        }
        #bioprint-badge-stats {
          font-size: 11px;
          color: #94A3B8;
          display: none;
          margin-left: 4px;
          border-left: 1px solid rgba(255,255,255,0.15);
          padding-left: 8px;
        }
        #bioprint-ext-guard-badge:hover #bioprint-badge-stats {
          display: inline-block;
        }
      </style>
      <div class="bioprint-pulse-ring"></div>
      <div class="bioprint-badge-title">
        <span>BioPrint Sentinel</span>
        <span class="bioprint-tag">Guarded</span>
      </div>
      <div id="bioprint-badge-stats">
        Keys: <span id="bp-stat-keys">0</span> | Cursor: <span id="bp-stat-pts">0</span>
      </div>
    `;

    document.body.appendChild(badge);
  }

  function updateBadgeStats() {
    const kElem = document.getElementById("bp-stat-keys");
    const mElem = document.getElementById("bp-stat-pts");
    if (kElem) kElem.textContent = telemetry.keystrokes.length;
    if (mElem) mElem.textContent = telemetry.mouseEvents.length;
  }

  // ---------------------------------------------------------------------------
  // 3. Capture-Phase Form Submission Interception
  // ---------------------------------------------------------------------------

  function interceptSubmissions() {
    // Intercept submit events in capture phase
    document.addEventListener(
      "submit",
      async (e) => {
        // Look for login forms or targets
        const form = e.target;
        if (form && (form.id === "login-form" || form.classList.contains("bioprint-guard") || form.querySelector("input[type='password']"))) {
          e.preventDefault();
          e.stopImmediatePropagation();
          await executeVerification(form);
        }
      },
      true // capture phase
    );

    // Also intercept clicks on sign-in buttons directly
    document.addEventListener(
      "click",
      async (e) => {
        const btn = e.target.closest("#login-btn, [data-bioprint-submit]");
        if (btn) {
          const form = btn.closest("form") || document.getElementById("login-form");
          if (form) {
            e.preventDefault();
            e.stopImmediatePropagation();
            // Record button context
            const rect = btn.getBoundingClientRect();
            telemetry.loginButtonContext = {
              target_distance: Math.hypot(rect.left + rect.width / 2 - (telemetry.mouseEvents[0]?.x || 0), rect.top + rect.height / 2 - (telemetry.mouseEvents[0]?.y || 0)),
              target_width: rect.width,
              button_x: rect.left,
              button_y: rect.top,
              movement_time_ms: performance.now() - (telemetry.mouseEvents[0]?.t || (performance.now() - 500))
            };
            await executeVerification(form);
          }
        }
      },
      true // capture phase
    );
  }

  // ---------------------------------------------------------------------------
  // 4. Verification Dispatcher & Explainability Modal
  // ---------------------------------------------------------------------------

  async function executeVerification(form) {
    // Extract credentials from form fields
    const userInput = form.querySelector("#username, input[name='username'], input[type='text']");
    const passInput = form.querySelector("#password, input[name='password'], input[type='password']");
    const userId = userInput ? userInput.value.trim() : "anonymous";
    const passphrase = passInput ? passInput.value : "";

    const payload = {
      user_id: userId,
      passphrase: passphrase,
      keystrokes: telemetry.keystrokes,
      mouse_events: telemetry.mouseEvents,
      button_context: telemetry.loginButtonContext,
      drag_gestures: telemetry.dragGestures,
      drag_gesture: telemetry.dragGestures.length > 0 ? telemetry.dragGestures[telemetry.dragGestures.length - 1] : null
    };

    console.log("[BioPrint Sentinel] Telemetry bundle prepared:", {
      user: userId,
      keystrokes: payload.keystrokes.length,
      mouseEvents: payload.mouse_events.length,
      dragGestures: payload.drag_gestures.length
    });

    // Provide visual pulse on badge
    const badge = document.getElementById("bioprint-ext-guard-badge");
    if (badge) {
      badge.style.borderColor = "#F59E0B";
      const tag = badge.querySelector(".bioprint-tag");
      if (tag) {
        tag.textContent = "Verifying...";
        tag.style.color = "#F59E0B";
      }
    }

    try {
      // Call backend authenticate endpoint
      const response = await fetch(`${BACKEND_URL}/api/authenticate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const verdict = await response.json();
      console.log("[BioPrint Sentinel] Verification response:", verdict);

      // Dispatch custom event to notify host webpage
      window.dispatchEvent(
        new CustomEvent("bioprint:verified", {
          detail: { verdict, payload }
        })
      );

      // Reset badge style
      if (badge) {
        const tag = badge.querySelector(".bioprint-tag");
        if (verdict.authenticated) {
          badge.style.borderColor = "#10B981";
          if (tag) {
            tag.textContent = "Granted";
            tag.style.color = "#10B981";
          }
        } else {
          badge.style.borderColor = "#EF4444";
          if (tag) {
            tag.textContent = "Blocked";
            tag.style.color = "#EF4444";
          }
        }
      }

      // Display blocked modal if access was denied
      if (!verdict.authenticated) {
        showSecurityAlertModal(verdict);
      } else {
        showAccessGrantedToast(verdict);
      }
    } catch (err) {
      console.error("[BioPrint Sentinel] Verification error:", err);
      showSecurityAlertModal({
        authenticated: false,
        confidence_score: 0,
        latency_ms: 0,
        signals: { bot_detected: false, keystroke_rhythm_match: 0, motor_kinematics_match: 0, cognitive_delay_match: 0 },
        explainability_reasons: [`Backend connection failed (${err.message}). Ensure BioPrint server is running on port 8000.`]
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 5. In-Page Explainability & Security Modals
  // ---------------------------------------------------------------------------

  function showSecurityAlertModal(verdict) {
    const existing = document.getElementById("bioprint-security-modal");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.id = "bioprint-security-modal";
    modal.innerHTML = `
      <style>
        #bioprint-security-modal {
          position: fixed;
          inset: 0;
          z-index: 1000000;
          background: rgba(4, 7, 15, 0.82);
          backdrop-filter: blur(14px);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          animation: bioprint-fade-in 0.2s ease-out;
        }
        @keyframes bioprint-fade-in {
          from { opacity: 0; } to { opacity: 1; }
        }
        .bioprint-modal-card {
          width: 90%;
          max-width: 560px;
          max-height: 88vh;
          overflow-y: auto;
          background: #0D1322;
          border: 1px solid rgba(239, 68, 68, 0.5);
          border-radius: 16px;
          padding: 28px;
          box-shadow: 0 10px 40px rgba(239, 68, 68, 0.2), 0 0 20px rgba(0, 0, 0, 0.8);
          color: #E2E8F0;
        }
        .bioprint-modal-header {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          padding-bottom: 16px;
        }
        .bioprint-alert-icon {
          width: 44px;
          height: 44px;
          border-radius: 10px;
          background: rgba(239, 68, 68, 0.15);
          color: #EF4444;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          border: 1px solid rgba(239, 68, 68, 0.3);
        }
        .bioprint-modal-title h2 {
          margin: 0;
          font-size: 20px;
          font-weight: 700;
          color: #F87171;
          letter-spacing: 0.5px;
        }
        .bioprint-modal-title p {
          margin: 4px 0 0;
          font-size: 13px;
          color: #94A3B8;
        }
        .bioprint-stats-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          margin-bottom: 20px;
        }
        .bioprint-stat-box {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 10px;
          padding: 12px;
          text-align: center;
        }
        .bioprint-stat-label {
          font-size: 11px;
          color: #94A3B8;
          text-transform: uppercase;
          margin-bottom: 4px;
        }
        .bioprint-stat-val {
          font-size: 18px;
          font-weight: 700;
          font-family: monospace;
        }
        .bioprint-reasons-panel {
          background: rgba(239, 68, 68, 0.05);
          border: 1px solid rgba(239, 68, 68, 0.2);
          border-radius: 10px;
          padding: 14px;
          margin-bottom: 24px;
          max-height: 180px;
          overflow-y: auto;
        }
        .bioprint-reasons-title {
          font-size: 12px;
          font-weight: 700;
          color: #FCA5A5;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
        }
        .bioprint-reasons-list {
          margin: 0;
          padding-left: 18px;
          font-size: 13px;
          color: #CBD5E1;
          line-height: 1.5;
        }
        .bioprint-reasons-list li {
          margin-bottom: 6px;
        }
        .bioprint-btn-dismiss {
          width: 100%;
          padding: 12px;
          background: #1E293B;
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #E2E8F0;
          font-weight: 600;
          font-size: 14px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .bioprint-btn-dismiss:hover {
          background: #334155;
          color: #FFFFFF;
        }
      </style>
      <div class="bioprint-modal-card">
        <div class="bioprint-modal-header">
          <div class="bioprint-alert-icon">⚠</div>
          <div class="bioprint-modal-title">
            <h2>ACCESS BLOCKED - BEHAVIORAL MISMATCH</h2>
            <p>BioPrint Sentinel intercepted signature anomaly / automated script.</p>
          </div>
        </div>

        <div class="bioprint-stats-grid">
          <div class="bioprint-stat-box">
            <div class="bioprint-stat-label">Confidence</div>
            <div class="bioprint-stat-val" style="color: #EF4444;">${verdict.confidence_score}%</div>
          </div>
          <div class="bioprint-stat-box">
            <div class="bioprint-stat-label">Latency</div>
            <div class="bioprint-stat-val" style="color: #00F0FF;">${verdict.latency_ms} ms</div>
          </div>
          <div class="bioprint-stat-box">
            <div class="bioprint-stat-label">Bot Detected</div>
            <div class="bioprint-stat-val" style="color: ${verdict.signals?.bot_detected ? '#EF4444' : '#10B981'};">
              ${verdict.signals?.bot_detected ? "YES" : "NO"}
            </div>
          </div>
        </div>

        <div class="bioprint-reasons-panel">
          <div class="bioprint-reasons-title">Explainability Diagnostic Breakdown:</div>
          <ul class="bioprint-reasons-list">
            ${verdict.explainability_reasons.map((r) => `<li>${r}</li>`).join("")}
          </ul>
        </div>

        <button id="bioprint-dismiss-btn" class="bioprint-btn-dismiss">Dismiss Security Alert</button>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById("bioprint-dismiss-btn").onclick = () => modal.remove();
  }

  function showAccessGrantedToast(verdict) {
    const toast = document.createElement("div");
    toast.innerHTML = `
      <style>
        #bioprint-success-toast {
          position: fixed;
          top: 24px;
          right: 24px;
          z-index: 1000000;
          background: rgba(10, 25, 20, 0.9);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(16, 185, 129, 0.6);
          box-shadow: 0 8px 30px rgba(16, 185, 129, 0.25);
          border-radius: 12px;
          padding: 14px 20px;
          display: flex;
          align-items: center;
          gap: 12px;
          color: #E2E8F0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          animation: bioprint-slide-in 0.3s ease-out;
        }
        @keyframes bioprint-slide-in {
          from { transform: translateY(-20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      </style>
      <div id="bioprint-success-toast">
        <span style="font-size: 20px; color: #10B981;">✓</span>
        <div>
          <div style="font-weight: 700; font-size: 14px; color: #10B981;">BIOPRINT ACCESS GRANTED</div>
          <div style="font-size: 12px; color: #94A3B8;">Confidence: ${verdict.confidence_score}% | Latency: ${verdict.latency_ms}ms</div>
        </div>
      </div>
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // ---------------------------------------------------------------------------
  // 6. Bootstrap Sentinel
  // ---------------------------------------------------------------------------

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      injectGuardBadge();
      interceptSubmissions();
    });
  } else {
    injectGuardBadge();
    interceptSubmissions();
  }
})();
