# BioPrint: Hybrid Behavioral Biometric Authentication Engine

BioPrint is a continuous, zero-friction behavioral biometric authentication engine designed for sub-50ms verification. It models individual neuromuscular keystroke dynamics, drag-and-drop gesture kinematics (trajectory directness, velocity, drop drift, hold duration), cursor kinematics (velocity, acceleration, jerk, tortuosity), Fitts's Law target acquisition curves, and browser bot automation integrity heuristics.

---

## Architecture Overview

The system consists of three decoupled components:

```
BioPrint/
├── backend/       # FastAPI server, biometrics math engine, and SQLite database
├── extension/     # Chrome Manifest V3 extension sentinel (silent capture & interception)
└── web/           # Zero-framework Vanilla HTML5/CSS3/JavaScript client application
```

---

## Interactive "Shape-in-the-Hole" Drag & Drop Architecture

BioPrint features an interactive neuromuscular challenge that replaces traditional static aim targets with high-entropy drag-and-drop dynamics:
1. **Enrollment Phase (Multi-Shape Arena)**: A 3-shape matching challenge (Circle, Square, Triangle) dropped into matching target outline slots. Gathers multi-path trajectory samples, velocity profiles, and precision docking metrics with a live canvas trajectory overlay.
2. **Testing / Login Phase (Drag-to-Unlock Key)**: A single draggable "Security Token / Key" that acts as the submission action when dropped into the matching vault hole, triggering instant sub-50ms behavioral verification (`POST /api/authenticate`).
3. **Cross-Device Telemetry via Pointer Events**: Uses native Pointer Events (`pointerdown`, `pointermove`, `pointerup` with `setPointerCapture`) across desktop mouse, trackpad, and touchscreen surfaces, extracting:
   * **Initial Drag Latency ($T_{\text{latency}}$)**: Delay between grasp (`pointerdown`) and initial movement $>3\text{px}$.
   * **Drag Velocity & Acceleration ($\mu_v, \sigma_v, a$)**: Mean and variance of cursor speed across the drag path.
   * **Trajectory Directness Ratio ($R = \frac{D_{\text{euclidean}}}{L_{\text{path}}}$)**: Tortuosity ratio ($\le 1.0$), capturing natural human arcs vs. robotic straight lines.
   * **Drop Micro-Drift ($\Delta_{\text{drift}} = \sqrt{(x - x_0)^2 + (y - y_0)^2}$)**: Euclidean distance between final release coordinate and slot centroid.
   * **Hold Duration ($T_{\text{hold}} = T_{\text{drop}} - T_{\text{start}}$)**: Total grasp-to-release duration.

---

## Detailed File-by-File Breakdown

### 1. `backend/` (Telemetry & Biometrics Processing Engine)

* **[`backend/app.py`](file:///d:/Code/Root36/backend/app.py)**
  * The main FastAPI application server.
  * Configures Cross-Origin Resource Sharing (CORS) for local web clients and browser extensions.
  * Mounts the `web/` directory at `/` to serve the web application directly.
  * Exposes the REST API endpoints:
    * `GET /api/health` — Returns service status and engine version.
    * `POST /api/enroll` — Compiles 3–5 multi-sample calibration telemetry vectors (including drag-and-drop baseline distributions), enforces standard deviation floors ($\sigma_{\min} = 15\text{ms}$), and persists user profiles in SQLite.
    * `POST /api/authenticate` & `POST /api/verify` — Evaluates single login vectors with drag gestures and/or keystrokes in $<50\text{ms}$, checks bot heuristics, computes $Z$-score deviations against baseline, logs audit records, and returns authentication verdicts.
    * `GET /api/users` — Lists enrolled usernames, sample counts, and timestamps.
    * `GET /api/user/{user_id}/baseline` — Returns complete profile distributions ($\mu, \sigma$) for visualization.
    * `POST /api/reset` — Clears users, profiles, and audit records for fresh demonstrations.

* **[`backend/biometrics.py`](file:///d:/Code/Root36/backend/biometrics.py)**
  * The core scientific and mathematical engine.
  * **Baseline Compilation (`compile_baseline`)**:
    * Extracts individual key dwell times ($T_{\text{dwell}} = T_{\text{up}} - T_{\text{down}}$) and transition flight times ($T_{\text{flight}} = T_{\text{down}, i+1} - T_{\text{up}, i}$).
    * Enforces standard deviation floors ($\sigma_{\min} = 15\text{ms}$) to prevent division-by-zero on consistent typists.
    * Compiles drag dynamics distributions ($\mu, \sigma$) for mean velocity, trajectory directness ratio, drop micro-drift, hold duration, and initial drag latency.
    * Computes mouse velocity, acceleration, jerk, and tortuosity distributions, plus Fitts's Law linear regression ($MT = a + b \cdot ID$).
  * **Bot Heuristic Detection (`detect_bot_anomalies`)**:
    * Synthetic event detection via DOM `isTrusted == False`.
    * Instant drag teleportation detection ($T_{\text{hold}} < 15\text{ms}$ or $<3$ trajectory samples across $>50\text{px}$).
    * Impossible keypress dwell times ($<10\text{ms}$).
    * Robotic cadence check (dwell variance $\sigma < 0.8\text{ms}$).
    * Linear trajectory detection (lateral micro-jitter $\sigma < 0.15\text{px}$).
  * **Keystroke Deviation Matcher (`evaluate_keystroke_dynamics`)**:
    * Computes transition $Z$-scores ($Z_i = \frac{|T_i - \mu_i|}{\sigma_i}$) and composite score:
      $$\text{Score}_{\text{keystroke}} = 100 \cdot \exp\left(-\frac{\bar{Z}}{2}\right)$$
    * Highlights any transition where $Z_i > 2.5\sigma$ in human-readable explainability diagnostics.
  * **Drag Dynamics Matcher (`evaluate_drag_dynamics`)**:
    * Computes feature-wise $Z$-scores for velocity, directness ratio, drop drift, hold duration, and initial latency:
      $$\text{Score}_{\text{drag}} = 100 \cdot \exp\left(-\frac{\bar{Z}_{\text{drag}}}{3.0}\right)$$
  * **Motor Kinematics Matcher (`evaluate_motor_kinematics`)**:
    * Computes path tortuosity ($\frac{\text{Length}}{\text{Displacement}}$), velocity, acceleration, and jerk.
    * Validates approach time against Fitts's Law ($MT = a + b \log_2(2D/W)$).
  * **Decision Fusion (`verify`)**:
    * Dynamically balances weights depending on modalities present:
      * When drag gestures are provided: Keystroke Dynamics ($50\%$), Drag Dynamics ($35\%$), Motor Kinematics ($15\%$).
      * Legacy/fallback mode: Keystroke Dynamics ($60\%$), Motor Kinematics ($40\%$).
    * Access is granted if composite score $\ge 70.0\%$. Bot detections immediately zero the score.

* **[`backend/database.py`](file:///d:/Code/Root36/backend/database.py)**
  * SQLite database engine setup using SQLAlchemy.
  * Configures thread-safe connections with `check_same_thread: False`.
  * Manages database sessions with the `get_db()` dependency and creates tables on initialization (`init_db()`).

* **[`backend/models.py`](file:///d:/Code/Root36/backend/models.py)**
  * **SQLAlchemy ORM Records**:
    * `UserRecord` — User identifier, passphrase, sample count, and timestamps.
    * `BaselineProfileRecord` — Serialized JSON distributions for keystroke, motor, and cognitive profiles.
    * `VerificationLogRecord` — Immutable audit trail of every verification attempt (verdict, confidence score, latency, and reasons).
  * **Pydantic Validation Schemas**:
    * `KeystrokeEvent`, `MouseEvent`, `MotorTargetEvent`, `DragGestureEvent`, `StroopTrialEvent`.
    * `EnrollmentSample`, `EnrollmentRequest`, `EnrollmentResponse`, `VerificationRequest`, `VerificationResponse`, `SignalsBreakdown`.

* **[`backend/test_biometrics.py`](file:///d:/Code/Root36/backend/test_biometrics.py)**
  * Comprehensive test suite validating:
    * Baseline compilation and standard deviation floors.
    * Multi-shape drag enrollment baseline compilation.
    * Legitimate single-shape token verification ($\ge 70\%$ confidence, $<50\text{ms}$ latency).
    * Bot detection heuristics (instant drag teleportation, untrusted events, linear collinear cursor, $<10\text{ms}$ dwell).
    * Impostor cadence rejection and explainability narrative generation.
    * Latency benchmarks across 50 iterations ($<0.5\text{ms}$ mean latency).

* **[`backend/requirements.txt`](file:///d:/Code/Root36/backend/requirements.txt)**
  * Python package dependencies: `fastapi`, `uvicorn`, `pydantic`, `numpy`, `scipy`, `scikit-learn`, and `sqlalchemy`.

---

### 2. `extension/` (Chrome Manifest V3 Sentinel)

* **[`extension/manifest.json`](file:///d:/Code/Root36/extension/manifest.json)**
  * Declares Chrome extension metadata, Manifest V3 format, and icon definitions.
  * Permissions: `activeTab`, `scripting`, `storage`.
  * Host permissions restricted to `http://localhost:*/*` and `http://127.0.0.1:*/*`.
  * Registers `background.js` as the service worker and injects `content.js` into local development tabs.

* **[`extension/background.js`](file:///d:/Code/Root36/extension/background.js)**
  * Background service worker managing extension badge status (`ON`, `OK`, `BLK`).
  * Proxies API communication between content scripts/popups and the FastAPI backend.

* **[`extension/content.js`](file:///d:/Code/Root36/extension/content.js)**
  * Injected directly into protected pages.
  * **Passive microsecond telemetry listeners**: Captures `keydown`, `keyup`, `mousemove`, `pointerdown`, `pointermove`, and `pointerup` using `performance.now()` with `{ capture: true, passive: true }` so DOM rendering is never blocked.
  * **Synthetic Drag Detection**: Inspects pointer events for `isTrusted === false` and impossible instant drag teleportation (`hold_duration < 15ms`).
  * **Floating Guard Badge**: Displays a discrete bottom-right HUD badge indicating active protection and live telemetry counters.
  * **Capture-Phase Interception**: Intercepts form submissions and drag drop completions in the capture phase (`useCapture = true`), bundles telemetry, calls `/api/authenticate`, and permits submission or triggers an in-page explainability security modal.

* **[`extension/popup.html`](file:///d:/Code/Root36/extension/popup.html) & [`extension/popup.js`](file:///d:/Code/Root36/extension/popup.js)**
  * The toolbar popup interface.
  * Displays real-time engine connectivity, daemon port (`127.0.0.1:8000`), active heuristic modules, live drag telemetry metrics (directness ratio, drop drift accuracy), and provides an interactive "Ping BioPrint Daemon" button.

* **[`extension/icon[16|48|128].png`](file:///d:/Code/Root36/extension/)**
  * Brand iconography for the browser toolbar and extension management page.

---

### 3. `web/` (Client Application Interface)

* **[`web/index.html`](file:///d:/Code/Root36/web/index.html)**
  * Dual-view semantic HTML5 interface:
    * **View 1: Calibration & Enrollment Suite (<45s)**
      * *Probe 1*: Interactive Multi-Shape Drag Arena (Circle, Square, Triangle docks and target outline slots) with live trajectory overlay canvas and real-time neuromuscular HUD metrics.
      * *Probe 2*: Stroop cognitive interference test.
      * *Probe 3*: Keystroke rhythm cadence enrollment with live token stream.
    * **View 2: Authentication Terminal**
      * Protected login form with username, passphrase, and Single-Shape "Drag-to-Unlock" Security Token drop zone.
      * Dropping the token into the matching vault hole triggers instant biometric authentication (`POST /api/authenticate`).
      * Passphrase helper: `bioprint secure authentication`.
      * Interactive Attack Simulator:
        * Legitimate Token Drag & Cadence
        * Cadence Impostor Drag
        * Linear Bot Drag
        * Teleportation Bot Drag
        * Untrusted DOM Drag
    * **Real-time Verification Feedback Modal**
      * Sticky verdict banner, confidence gauge, signal match bars (Keystroke Rhythm, Drag Dynamics, Motor Kinematics), trajectory preview canvas, and diagnostic explainability list.

* **[`web/app.js`](file:///d:/Code/Root36/web/app.js)**
  * Main frontend application controller:
    * Coordinates navigation between Calibration and Authentication views.
    * Implements `initShapeDragEnrollment()` using Pointer Events with `setPointerCapture`, live trajectory canvas rendering, slot collision detection, snap-in translation, HUD stats, and transition to Stroop probe.
    * Implements `initLoginDragSubmission()` measuring token drag telemetry, snapping to vault hole, and executing `POST /api/authenticate`.
    * Handles 3-trial typing cadence capture and submits baselines to `/api/enroll`.
    * Disables Enter-key submission on the passphrase input to guarantee motor/drag telemetry collection.
    * Runs attack simulations with real-time baseline matching.

* **[`web/style.css`](file:///d:/Code/Root36/web/style.css)**
  * Cyberpunk glassmorphism design system:
    * Palette: Dark background (`#070B14`), Neon Cyan (`#00F0FF`), Emerald (`#10B981`), Crimson (`#EF4444`), and Amber (`#F59E0B`).
    * Typography: **Outfit** (headings), **Plus Jakarta Sans** (body), **JetBrains Mono** (telemetry values).
    * Glassmorphic drag docks, pulsing outline targets, and snap-in animations (`@keyframes slot-snap`, `@keyframes shake-invalid`).
    * Bounded modal with scrollable body (`overflow-y: auto`) and custom scrollbars.

---

## Quick-Start Instructions

### 1. Start Backend Server
```bash
py -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --reload
```
The client UI will be available at: **http://127.0.0.1:8000/**

### 2. Load the Chrome Extension
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Toggle **Developer mode** in the top right.
3. Click **Load unpacked** and select the `extension/` directory.
4. Visit `http://127.0.0.1:8000/` — the floating **BioPrint Sentinel** badge will appear in the bottom-right corner.

### 3. Run the Unit Test Suite
```bash
py -m backend.test_biometrics
```
