# BioPrint: Hybrid Behavioral Biometric Authentication Engine

BioPrint: is a multi-modal behavioral biometric authentication engine engineered for sub-50ms continuous verification. It couples cryptographic **Argon2id salted password hashing** with **universal touch-typing dynamics** and **psychomotor kinematics**, eliminating static passphrases while delivering explainable anomaly detection ($>2.5\sigma$ deviations) under a strict **$\ge 70.0\%$ pass threshold**.

---

## Key Capabilities

1. **Cryptographic Security Layer**:
   - Master password with double confirmation and **Argon2id salted hashing** (`argon2-cffi`).
   - Plaintext passwords are never stored.
   - Instant cryptographic rejection on invalid credentials before biometric evaluation.

2. **Dynamic "Saccade & Track" Shape Calibration**:
   - Multi-lane guided calibration tracks (Circle, Triangle, Square) featuring visual alignment detour notches (Notch UP / Notch DOWN).
   - Measures ocular-motor saccadic pauses (foveal visual verification deceleration dip), macro-velocity curves ($v_{\text{macro}} = L / \Delta t$), path tortuosity ($\tau = \frac{L_{\text{actual}}}{D_{\text{straight}}} \ge 1.0$), docking release dwell latency ($T_{\text{dock}}$), drop drift offset, and 8–12 Hz physiological involuntary micro-tremor.

3. **Monkeytype-Style Dynamic Typing Calibration**:
   - 15-second dynamic English text stream with active character and word highlighting.
   - Full backspace correction support across character and word boundaries.
   - Extracts universal psychomotor features:
     - **QWERTY Hand-Switch Ratio ($R_{\text{hand}} = \frac{\bar{T}_{\text{cross}}}{\bar{T}_{\text{same}}}$)**: skilled touch typists exhibit $R_{\text{hand}} \approx 0.50 - 0.75$, while hunt-and-peck typists or bots have $R_{\text{hand}} \ge 1.0$.
     - **Key Cluster Dwell Matrix**: Dwell distributions for vowels, top, home, and bottom rows.
     - **Spacebar Saccade Latency ($T_{\text{space}}$)**: Word boundary cognitive transition delay.
     - **Inter-Keystroke Interval Entropy ($CV = \frac{\sigma}{\mu}$)**: Neuromuscular rhythmic variance.
     - **Error Dynamics**: Backspace frequency and typo recovery delay.

4. **Authentication Gateway & Scaled Saccade & Track Slider**:
   - Centered login gateway with master password keystroke timing and verification pangram typing (*"Quick foxes jump over lazy brown dogs"*).
   - Full-scale **Dynamic Saccade & Track Verification Slider** ($520\text{px} \times 130\text{px}$) with an aligned detour notch rail, toggleable detour geometry, and live velocity/pause/tremor HUD.
   - Sub-50ms execution latency with itemized explainability diagnostics ($Z > 2.5\sigma$).

5. **Diagnostic Benchmark & Impostor Attack Suite**:
   - Built-in attack simulator testing 6 distinct real-world attack vectors against the $\ge 70.0\%$ pass threshold:
     - **Legitimate User Auth**: Matching password + touch-typing cadence & saccade pause ($\ge 70\%$).
     - **Leaked Password + Cadence Impostor**: Correct password, but hunt-and-peck typing ($R_{\text{hand}} > 1.25$).
     - **Invalid Password Credential**: Immediate cryptographic rejection ($0\%$).
     - **Linear Zero-Jitter Cursor Bot**: Collinear synthetic mouse path without natural micro-jitter.
     - **Instant Drag Teleportation**: Zero intermediate pointer events ($<15\text{ms}$ hold duration).
     - **Untrusted Script Injection**: Synthetic DOM event dispatch (`event.isTrusted === false`).

6. **Dedicated Access Granted Dashboard**:
   - Authenticated session handoff via `sessionStorage`.
   - Comprehensive telemetry comparison table, signal score breakdown, and collapsible explainability audit log.

---

## Architecture Overview

BioPrint V2 uses a decoupled client-server architecture:

```
Root36/
├── backend/                  # FastAPI REST server, Argon2id crypto, biometrics engine, SQLite DB
│   ├── app.py                # FastAPI application, REST endpoints, and static asset serving
│   ├── biometrics.py         # Baseline modeling, Z-score math, bot heuristics, Argon2id hashing
│   ├── database.py           # SQLAlchemy SQLite engine & session management
│   ├── models.py             # Pydantic schemas & SQLAlchemy ORM models
│   ├── requirements.txt      # Python dependencies
│   └── test_biometrics.py    # Automated test suite (8 verification test cases)
├── web/                      # Multi-page client application
│   ├── index.html            # Centered Login Gateway & Security Benchmark Simulator
│   ├── signup.html           # 3-Step Registration & Calibration Wizard
│   ├── dashboard.html        # Access Granted Dashboard & Telemetry Audit View
│   ├── app.js                # Frontend controller, drag kinematics, Monkeytype engine, API client
│   └── style.css             # Minimalist responsive design system
├── extension/                # Optional Chrome Manifest V3 extension sentinel
│   ├── manifest.json         # Manifest V3 configuration
│   ├── background.js         # Background service worker & badge management
│   ├── content.js            # Passive microsecond telemetry listener & capture-phase interceptor
│   └── popup.html / popup.js # Toolbar popup connectivity monitor
└── bioprint.db               # Persistent SQLite database storing enrolled profiles and audit logs
```

---

## Technical Specifications & Mathematical Models

### 1. Argon2id Password Hashing
Passwords are salted with a 16-byte cryptographically secure random salt and hashed using Argon2id (`argon2-cffi`):
$$\text{Hash} = \text{Argon2id}(P, S, \text{time\_cost}=2, \text{memory\_cost}=65536, \text{parallelism}=1)$$

### 2. Keystroke Dynamics Matching
Keystroke transitions are evaluated against the enrolled user's baseline distributions ($\mu_i, \sigma_i$ with standard deviation floor $\sigma_{\min} = 15\text{ms}$):
$$Z_i = \frac{|T_i - \mu_i|}{\sigma_i}$$
$$\text{Score}_{\text{keystroke}} = 100 \cdot \exp\left(-\frac{\bar{Z}}{2}\right)$$

### 3. Saccade & Track Kinematics Matching
Evaluates macro-velocity, saccadic pause deceleration dip ratio at the notch ($D_{\text{dip}} = 1 - \frac{v_{\text{notch}}}{v_{\text{approach}}}$), path tortuosity ($\tau$), drop drift offset, and docking release dwell latency ($T_{\text{dock}}$):
$$\text{Score}_{\text{drag}} = 100 \cdot \exp\left(-\frac{\bar{Z}_{\text{drag}}}{3.0}\right)$$

### 4. 8–12 Hz Physiological Tremor Verification
Extracts spectral power in the 8–12 Hz band from the high-frequency lateral displacement stream using Fast Fourier Transform (FFT) or Welch's power spectral density to detect human neuromuscular grip micro-tremor and reject linear cursor bots:
$$P_{\text{tremor}} = \int_{8\,\text{Hz}}^{12\,\text{Hz}} S_{yy}(f)\,df > 0.05$$

### 5. Multi-Factor Decision Fusion
$$\text{Composite Score} = 0.50 \cdot \text{Score}_{\text{keystroke}} + 0.35 \cdot \text{Score}_{\text{drag}} + 0.15 \cdot \text{Score}_{\text{motor}}$$
- **Authentication Threshold**: $\ge 70.0\%$
- **Bot Detection**: Any detected bot heuristic (`isTrusted === false`, linear path with lateral $\sigma < 0.15\text{px}$, teleportation with $T_{\text{hold}} < 15\text{ms}$) immediately forces the composite score to $0.0\%$.

---

## Installation & Setup Guide

### Prerequisites
- **Python**: Version 3.10 or higher.
- **pip**: Python package manager.
- **Web Browser**: Google Chrome, Microsoft Edge, or Mozilla Firefox (modern browser with Pointer Events and Canvas support).

---

### Step 1: Clone or Navigate to the Project

```bash
cd d:/Code/Root36
```

---

### Step 2: Set Up a Python Virtual Environment

It is recommended to run BioPrint within an isolated virtual environment:

**On Windows (PowerShell / Command Prompt):**
```powershell
python -m venv venv
.\venv\Scripts\activate
```

**On Linux / macOS:**
```bash
python3 -m venv venv
source venv/bin/activate
```

---

### Step 3: Install Required Dependencies

Install the backend Python dependencies using `pip`:

```bash
pip install -r backend/requirements.txt
```

#### Core Dependencies Overview:
| Package | Purpose |
|---|---|
| `fastapi` | High-performance asynchronous REST API framework |
| `uvicorn` | ASGI web server implementation |
| `pydantic` | Data validation and payload schema enforcement |
| `numpy` / `scipy` | Mathematical modeling, FFT tremor analysis, and statistics |
| `scikit-learn` | Dimensionality analysis and baseline regression |
| `sqlalchemy` | SQLite database ORM and session persistence |
| `argon2-cffi` | Cryptographic Argon2id password hashing algorithm |

---

### Step 4: Run the Automated Test Suite

Verify that the biometrics math engine, bot heuristics, and Argon2id hashing pass all test assertions:

```bash
python -m backend.test_biometrics
```

Expected output:
```
=== RUNNING BIOPRINT V2 BIOMETRICS TESTS ===
[TEST 1] Testing Argon2id Salted Password Hashing... -> PASS
[TEST 2] Testing Universal Typing Feature Extraction (QWERTY Ergonomics)... -> PASS
[TEST 3] Testing Scrambled Shape Docking Kinematics... -> PASS
[TEST 4] Testing Full Enrollment, Salted Hash & Verification Pipeline (<50ms)... -> PASS
[TEST 5] Benchmarking Verification Latency (50 iterations)... -> PASS (<2ms)
[TEST 6] Testing Impostor Password Cadence Rejection & Digram Diagnostics... -> PASS
[TEST 7] Testing Zero Keystrokes Rejection... -> PASS
[TEST 8] Testing Saccadic Notch Pause & 8-12 Hz Physiological Grip Tremor... -> PASS
=== ALL BIOPRINT V2 BACKEND TESTS PASSED SUCCESSFULLY! ===
```

---

### Step 5: Start the BioPrint Backend Server

Launch the Uvicorn ASGI server:

```bash
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --reload
```

The server automatically initializes the SQLite schema (`bioprint.db`) and serves both the REST API and the static web frontend.

---

### Step 6: Access the Web Application

Open your browser and navigate to:

- **Login Gateway**: [http://127.0.0.1:8000/](http://127.0.0.1:8000/) (or `http://127.0.0.1:8000/index.html`)
- **Account Registration & Calibration**: [http://127.0.0.1:8000/signup.html](http://127.0.0.1:8000/signup.html)
- **Access Granted Dashboard**: [http://127.0.0.1:8000/dashboard.html](http://127.0.0.1:8000/dashboard.html)

---

### Step 7 (Optional): Load the Chrome Extension Sentinel

The optional browser extension acts as a passive microsecond sentinel capturing pointer telemetry and verifying DOM event trust.

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** using the toggle switch in the top-right corner.
3. Click **Load unpacked** in the top-left corner.
4. Select the `extension/` directory within this project.
5. Navigate to `http://127.0.0.1:8000/` — the floating **BioPrint Sentinel** badge will appear in the bottom-right corner.

---

## User Flow & Testing Instructions

### 1. Register a New Account & Baseline Profile
1. On the Login Gateway (`http://127.0.0.1:8000/`), click **Create an Account & Calibrate** (or go directly to `signup.html`).
2. **Step 1: Account Credentials**: Enter a username and master password (minimum 6 characters).
3. **Step 2: Saccade & Track Shape Calibration**: Drag each of the 3 shapes (Circle, Triangle, Square) across its track through the detour notch into its matching target slot.
4. **Step 3: Monkeytype Typing Calibration**: Type the 15-word dynamic English stream naturally for 15 seconds. Use backspace to correct mistakes or return to previous words if needed.
5. **Completion**: Review your compiled baseline distributions and click **Proceed to Login Gateway →**.

### 2. Authenticate Identity
1. On `index.html`, enter your username and master password.
2. Type the verification pangram: *"Quick foxes jump over lazy brown dogs"*.
3. Drag the **SLIDE** token along the track through the detour notch to the **UNLOCK** dock.
4. The verification modal will display your authentication verdict ($<50\text{ms}$), confidence score ($\ge 70.0\%$), and signal breakdown.
5. Click **Enter Granted Dashboard →** to view your verified session telemetry.

### 3. Run the Security & Impostor Simulator
On the login page, scroll to the **Security & Impostor Simulator** grid and test how the engine handles attacks:
- Click **Legitimate User Auth** $\rightarrow$ verifies with $\ge 70.0\%$ confidence.
- Click **Leaked Password + Cadence Impostor** $\rightarrow$ rejected due to abnormal cadence and key dwell deviations ($>2.5\sigma$).
- Click **Invalid Password Credential** $\rightarrow$ rejected immediately ($0\%$).
- Click **Linear Zero-Jitter Cursor Bot** $\rightarrow$ rejected (zero physiological micro-jitter detected).
- Click **Instant Drag Teleportation** $\rightarrow$ rejected ($<15\text{ms}$ hold duration).
- Click **Untrusted Script Injection** $\rightarrow$ rejected (`isTrusted === false`).

---

## REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health status and engine version |
| `POST` | `/api/register` | Registers a user, hashes password with Argon2id, and compiles baseline |
| `POST` | `/api/verify` | Evaluates login credentials, keystroke cadence, and drag kinematics ($<50\text{ms}$) |
| `GET` | `/api/users` | Lists enrolled user accounts and sample counts |
| `GET` | `/api/user/{user_id}/baseline` | Retrieves compiled biometric baseline distributions for a user |
| `POST` | `/api/reset` | Resets all registered user accounts and baseline data |

