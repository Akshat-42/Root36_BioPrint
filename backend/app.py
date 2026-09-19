"""
BioPrint Behavioral Biometric Authentication - FastAPI Application Server
========================================================================
RESTful API for behavioral telemetry enrollment, real-time verification,
and explainability reporting.
"""

import json
from typing import List, Dict, Any
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from backend.database import get_db, init_db
from backend.models import (
    UserRecord,
    BaselineProfileRecord,
    VerificationLogRecord,
    EnrollmentRequest,
    EnrollmentResponse,
    VerificationRequest,
    VerificationResponse,
)
from backend.biometrics import BiometricsEngine

app = FastAPI(
    title="BioPrint Behavioral Authentication Engine",
    description="Multi-modal behavioral biometric engine measuring keystroke dynamics, mouse kinematics, and bot integrity.",
    version="1.0.0"
)

# Enable CORS for local client and browser extensions
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Initialize DB tables
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
        "service": "BioPrint Behavioral Engine",
        "version": "1.0.0"
    }


@app.post("/api/enroll", response_model=EnrollmentResponse, summary="Enroll Biometric Baseline")
def enroll_user(request: EnrollmentRequest, db: Session = Depends(get_db)):
    """
    Accepts 3-5 enrollment telemetry trials (keystrokes, motor targets, Stroop cognitive probes),
    computes mean and standard deviation baseline distributions with a 15ms floor,
    and persists the profile in SQLite.
    """
    if len(request.samples) < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least 1 calibration sample (recommended 3-5) is required for enrollment."
        )

    # Compile baseline distributions
    key_base, motor_base, cog_base = BiometricsEngine.compile_baseline(request.samples)

    # Check if user already exists
    user = db.query(UserRecord).filter(UserRecord.user_id == request.user_id).first()
    if not user:
        user = UserRecord(
            user_id=request.user_id,
            passphrase=request.passphrase or "",
            sample_count=len(request.samples)
        )
        db.add(user)
        db.flush()
    else:
        user.passphrase = request.passphrase or user.passphrase
        user.sample_count += len(request.samples)

    # Upsert baseline profile
    baseline = db.query(BaselineProfileRecord).filter(BaselineProfileRecord.user_id == request.user_id).first()
    if not baseline:
        baseline = BaselineProfileRecord(
            user_id=request.user_id,
            keystroke_baseline_json=json.dumps(key_base),
            motor_baseline_json=json.dumps(motor_base),
            cognitive_baseline_json=json.dumps(cog_base)
        )
        db.add(baseline)
    else:
        baseline.keystroke_baseline_json = json.dumps(key_base)
        baseline.motor_baseline_json = json.dumps(motor_base)
        baseline.cognitive_baseline_json = json.dumps(cog_base)

    db.commit()

    return EnrollmentResponse(
        success=True,
        user_id=request.user_id,
        message=f"Biometric baseline successfully compiled across {len(request.samples)} trials.",
        sample_count=len(request.samples),
        baseline_summary={
            "dwell_keys_enrolled": list(key_base["dwell"].keys()),
            "transitions_enrolled": list(key_base["flight"].keys()),
            "mean_velocity_px_s": motor_base["mean_velocity"],
            "mean_tortuosity": motor_base["mean_tortuosity"],
            "fitts_law_fit": f"MT = {motor_base['fitts_a']} + {motor_base['fitts_b']} * ID",
            "drag_dynamics": motor_base.get("drag_dynamics", {}),
            "stroop_mean_reaction_ms": cog_base["mean_reaction_ms"]
        }
    )


@app.post("/api/authenticate", response_model=VerificationResponse, summary="Authenticate via Drag-and-Drop & Keystroke Biometrics")
@app.post("/api/verify", response_model=VerificationResponse, summary="Verify Behavioral Biometrics")
def verify_login(request: VerificationRequest, db: Session = Depends(get_db)):
    """
    Evaluates a single login interaction vector (drag gesture and/or keystrokes)
    against the user's enrolled baseline.
    Executes bot heuristics, transition Z-scores, drag kinematics, and returns
    an authentication verdict with sub-50ms latency and diagnostic explainability.
    """
    user = db.query(UserRecord).filter(UserRecord.user_id == request.user_id).first()
    if not user or not user.baseline:
        # User not enrolled
        return VerificationResponse(
            authenticated=False,
            confidence_score=0.0,
            latency_ms=1.5,
            signals={
                "bot_detected": False,
                "keystroke_rhythm_match": 0.0,
                "motor_kinematics_match": 0.0,
                "drag_dynamics_match": 0.0,
                "cognitive_delay_match": 0.0
            },
            explainability_reasons=[
                f"User '{request.user_id}' has no enrolled biometric baseline in BioPrint engine."
            ]
        )

    # Reconstruct baseline dictionary
    baseline_profile = {
        "keystroke_baseline": json.loads(user.baseline.keystroke_baseline_json),
        "motor_baseline": json.loads(user.baseline.motor_baseline_json),
        "cognitive_baseline": json.loads(user.baseline.cognitive_baseline_json)
    }

    # Consolidate single drag_gesture or list of drag_gestures without duplicates
    drags = []
    seen_drags = set()
    for d in (request.drag_gestures or []):
        key = (d.shape_type, round(d.start_time, 2), round(d.drop_time, 2))
        if key not in seen_drags:
            seen_drags.add(key)
            drags.append(d)
    if request.drag_gesture:
        key = (request.drag_gesture.shape_type, round(request.drag_gesture.start_time, 2), round(request.drag_gesture.drop_time, 2))
        if key not in seen_drags:
            seen_drags.add(key)
            drags.append(request.drag_gesture)

    # Run verification pipeline
    verdict = BiometricsEngine.verify(
        keystrokes=request.keystrokes,
        mouse_events=request.mouse_events,
        baseline_profile=baseline_profile,
        button_context=request.button_context,
        drag_gestures=drags
    )

    # Persist audit record in background
    log = VerificationLogRecord(
        user_id=request.user_id,
        authenticated=verdict.authenticated,
        confidence_score=verdict.confidence_score,
        latency_ms=verdict.latency_ms,
        signals_json=json.dumps(verdict.signals.model_dump()),
        reasons_json=json.dumps(verdict.explainability_reasons)
    )
    db.add(log)
    db.commit()

    return verdict


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

    return {
        "user_id": user.user_id,
        "sample_count": user.sample_count,
        "keystroke_baseline": json.loads(user.baseline.keystroke_baseline_json),
        "motor_baseline": json.loads(user.baseline.motor_baseline_json),
        "cognitive_baseline": json.loads(user.baseline.cognitive_baseline_json)
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
import os
from fastapi.staticfiles import StaticFiles

web_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web")
if os.path.exists(web_dir):
    app.mount("/", StaticFiles(directory=web_dir, html=True), name="web")

