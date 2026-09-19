"""
BioPrint Behavioral Biometric Authentication (V2) - FastAPI Application Server
=============================================================================
RESTful API for secure user registration (Argon2id salted hashing), universal
behavioral baseline modeling, real-time verification (<50ms), and explainability reporting.
v2.0.0
"""

import json
import os
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from backend.database import get_db, init_db
from backend.models import (
    UserRecord,
    BaselineProfileRecord,
    VerificationLogRecord,
    RegisterRequest,
    RegisterResponse,
    VerificationRequest,
    VerificationResponse,
    SignalsBreakdown,
    EnrollmentRequest,
    EnrollmentResponse,
)
from backend.biometrics import BiometricsEngine, hash_password, verify_password

app = FastAPI(
    title="BioPrint Behavioral Authentication Engine (V2)",
    description="Multi-modal behavioral biometric engine measuring universal keystroke dynamics, psychomotor kinematics, and bot integrity with Argon2id salted hashing.",
    version="2.0.0"
)

# Enable CORS for local client and browser extensions
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize DB tables and schema
init_db()


@app.on_event("startup")
def on_startup():
    """Initializes SQLite schema on application startup."""
    init_db()


@app.get("/api/health", summary="Health Check")
def health_check():
    """Health status and telemetry engine status."""
    return {
        "status": "online",
        "service": "BioPrint Behavioral Engine (V2)",
        "version": "2.0.0"
    }


# =============================================================================
# User Registration & Biometric Enrollment (V2)
# =============================================================================

@app.post("/api/register", response_model=RegisterResponse, summary="Register User with Behavioral Baseline")
def register_user(request: RegisterRequest, db: Session = Depends(get_db)):
    """
    Registers a new user with double password confirmation, hashes the password
    using Argon2id with a unique salt, compiles universal typing and motor
    baseline distributions, and saves the record in SQLite.
    """
    if request.password != request.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password and confirmation password do not match."
        )

    if len(request.password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 6 characters in length."
        )

    if not request.typing_telemetry or len(request.typing_telemetry.keystrokes) < 15:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Insufficient typing calibration telemetry. Complete the 30-word typing test."
        )

    if not request.shape_telemetry or len(request.shape_telemetry) < 3:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Insufficient motor calibration. Slot all 3 scrambled shapes to calibrate kinematics."
        )

    # Compile baseline distributions
    typing_base, motor_base = BiometricsEngine.compile_enrollment_baseline(
        request.typing_telemetry,
        request.shape_telemetry,
        password_keystrokes=request.password_keystrokes
    )

    # Secure salted hash (Argon2id)
    hashed_pwd = hash_password(request.password)

    # Check if user already exists
    user = db.query(UserRecord).filter(UserRecord.user_id == request.username).first()
    if not user:
        user = UserRecord(
            user_id=request.username,
            password_hash=hashed_pwd,
            sample_count=1
        )
        db.add(user)
        db.flush()
    else:
        user.password_hash = hashed_pwd
        user.sample_count += 1

    # Upsert baseline profile
    baseline = db.query(BaselineProfileRecord).filter(BaselineProfileRecord.user_id == request.username).first()
    if not baseline:
        baseline = BaselineProfileRecord(
            user_id=request.username,
            typing_baseline_json=json.dumps(typing_base),
            motor_baseline_json=json.dumps(motor_base),
            keystroke_baseline_json=json.dumps(typing_base)
        )
        db.add(baseline)
    else:
        baseline.typing_baseline_json = json.dumps(typing_base)
        baseline.motor_baseline_json = json.dumps(motor_base)
        baseline.keystroke_baseline_json = json.dumps(typing_base)

    db.commit()

    return RegisterResponse(
        success=True,
        user_id=request.username,
        message="User successfully registered with Argon2id salted credentials and behavioral biometric profile.",
        baseline_summary={
            "wpm": typing_base.get("wpm", 0),
            "accuracy": typing_base.get("accuracy", 100),
            "hand_switch_ratio": typing_base.get("hand_switch_ratio_mean", 0.65),
            "spacebar_delay_ms": typing_base.get("spacebar_saccade_delay_mean", 160),
            "tortuosity": motor_base.get("tortuosity_mean", 1.25),
            "docking_latency_ms": motor_base.get("docking_latency_mean", 110),
            "shapes_calibrated": len(request.shape_telemetry)
        }
    )


# =============================================================================
# Behavioral Authentication & Verification (<50ms)
# =============================================================================

@app.post("/api/verify", response_model=VerificationResponse, summary="Verify Password & Behavioral Biometrics")
@app.post("/api/authenticate", response_model=VerificationResponse, summary="Authenticate via Token Drag & Pangram")
def verify_user(request: VerificationRequest, db: Session = Depends(get_db)):
    """
    Evaluates password and behavioral telemetry against enrolled baseline:
    1. Verifies Argon2id salted password hash first. If invalid -> immediate 401/denied.
    2. Runs bot heuristics (isTrusted, webdriver, linear mouse, teleportation).
    3. Computes universal typing dynamics Z-scores from pangram.
    4. Computes psychomotor kinematics Z-scores from token drag.
    5. Returns composite confidence score with sub-50ms latency and diagnostic explainability.
    """
    username = request.username or request.user_id or "alice"
    password = request.password if request.password != "" else (request.passphrase or "")

    user = db.query(UserRecord).filter(UserRecord.user_id == username).first()
    if not user or not user.baseline:
        # User not enrolled
        return VerificationResponse(
            authenticated=False,
            confidence_score=0.0,
            latency_ms=1.2,
            signals=SignalsBreakdown(
                bot_detected=False,
                password_valid=False,
                keystroke_rhythm_match=0.0,
                motor_kinematics_match=0.0,
                drag_dynamics_match=0.0
            ),
            explainability_reasons=[
                f"User '{username}' does not exist or has no enrolled biometric profile."
            ]
        )

    # 1. Cryptographic Password Hash Verification (Argon2id/bcrypt)
    password_valid = False
    if user.password_hash:
        password_valid = verify_password(password, user.password_hash)
    elif user.passphrase and user.passphrase == password:
        password_valid = True

    # Reconstruct baseline dictionary
    typing_base = {}
    motor_base = {}
    if user.baseline.typing_baseline_json:
        try:
            typing_base = json.loads(user.baseline.typing_baseline_json)
        except Exception:
            pass
    if not typing_base and user.baseline.keystroke_baseline_json:
        try:
            typing_base = json.loads(user.baseline.keystroke_baseline_json)
        except Exception:
            pass

    if user.baseline.motor_baseline_json:
        try:
            motor_base = json.loads(user.baseline.motor_baseline_json)
        except Exception:
            pass

    baseline_profile = {
        "typing_baseline": typing_base,
        "motor_baseline": motor_base
    }

    # Consolidate keystroke stream (password_keystrokes + pangram_keystrokes + legacy keystrokes)
    keystrokes = []
    if request.password_keystrokes:
        keystrokes.extend(request.password_keystrokes)
    if request.pangram_keystrokes:
        keystrokes.extend(request.pangram_keystrokes)
    if not keystrokes and request.keystrokes:
        keystrokes.extend(request.keystrokes)

    # Consolidate token drag gesture
    token_drag = request.token_drag or request.drag_gesture
    if not token_drag and request.drag_gestures:
        token_drag = request.drag_gestures[0]

    # Run verification pipeline
    verdict = BiometricsEngine.verify(
        username=username,
        password_valid=password_valid,
        pangram_keystrokes=keystrokes,
        token_drag=token_drag,
        baseline_profile=baseline_profile,
        mouse_events=request.mouse_events,
        browser_integrity=request.browser_integrity
    )

    # Persist audit record in background
    try:
        log = VerificationLogRecord(
            user_id=username,
            authenticated=verdict.authenticated,
            password_valid=verdict.signals.password_valid,
            confidence_score=verdict.confidence_score,
            latency_ms=verdict.latency_ms,
            signals_json=json.dumps(verdict.signals.model_dump()),
            reasons_json=json.dumps(verdict.explainability_reasons)
        )
        db.add(log)
        db.commit()
    except Exception as e:
        db.rollback()

    return verdict


# =============================================================================
# Administrative & Utility Endpoints
# =============================================================================

@app.get("/api/users", summary="List Enrolled Users")
def list_users(db: Session = Depends(get_db)):
    """Lists enrolled user IDs and profile timestamps."""
    users = db.query(UserRecord).all()
    results = []
    for u in users:
        results.append({
            "user_id": u.user_id,
            "sample_count": u.sample_count,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "has_baseline": u.baseline is not None
        })
    return {"users": results}


@app.get("/api/user/{user_id}/baseline", summary="Get User Baseline Profile")
def get_user_baseline(user_id: str, db: Session = Depends(get_db)):
    """Retrieves full baseline details for visualization."""
    user = db.query(UserRecord).filter(UserRecord.user_id == user_id).first()
    if not user or not user.baseline:
        raise HTTPException(status_code=404, detail="User or baseline not found")

    typing_b = {}
    motor_b = {}
    if user.baseline.typing_baseline_json:
        try:
            typing_b = json.loads(user.baseline.typing_baseline_json)
        except Exception:
            pass
    if user.baseline.motor_baseline_json:
        try:
            motor_b = json.loads(user.baseline.motor_baseline_json)
        except Exception:
            pass

    return {
        "user_id": user.user_id,
        "sample_count": user.sample_count,
        "typing_baseline": typing_b,
        "motor_baseline": motor_b
    }


@app.post("/api/reset", summary="Reset Demo Database")
def reset_database(db: Session = Depends(get_db)):
    """Clears all users, baselines, and logs for demo purposes."""
    db.query(VerificationLogRecord).delete()
    db.query(BaselineProfileRecord).delete()
    db.query(UserRecord).delete()
    db.commit()
    return {"success": True, "message": "BioPrint database cleared."}


# Mount the web client directory to serve UI directly at root
web_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web")
if os.path.exists(web_dir):
    app.mount("/", StaticFiles(directory=web_dir, html=True), name="web")
