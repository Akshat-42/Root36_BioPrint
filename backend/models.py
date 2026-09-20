"""
BioPrint Behavioral Authentication Engine (V2) - Data Models
SQLAlchemy ORM models for database persistence and Pydantic schemas for API validation.
"""

from datetime import datetime
from typing import List, Optional, Dict, Any
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from pydantic import BaseModel, Field

from backend.database import Base


# =====================================================================
# SQLAlchemy Database Models
# =====================================================================

class UserRecord(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(64), unique=True, index=True, nullable=False)
    password_hash = Column(String(256), nullable=False)  # Argon2id / bcrypt salted hash
    sample_count = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    baseline = relationship("BaselineProfileRecord", back_populates="user", uselist=False, cascade="all, delete-orphan")
    verification_logs = relationship("VerificationLogRecord", back_populates="user", cascade="all, delete-orphan")


class BaselineProfileRecord(Base):
    __tablename__ = "baseline_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(64), ForeignKey("users.user_id"), unique=True, index=True, nullable=False)
    typing_baseline_json = Column(Text, nullable=False)   # Serialized QWERTY typing distributions (R_hand, clusters, etc.)
    motor_baseline_json = Column(Text, nullable=False)    # Serialized motor distributions (tortuosity, docking, etc.)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("UserRecord", back_populates="baseline")


class VerificationLogRecord(Base):
    __tablename__ = "verification_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(64), ForeignKey("users.user_id"), index=True, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)
    authenticated = Column(Boolean, nullable=False)
    password_valid = Column(Boolean, default=False)
    confidence_score = Column(Float, nullable=False)
    latency_ms = Column(Float, nullable=False)
    signals_json = Column(Text, nullable=False)
    reasons_json = Column(Text, nullable=False)

    user = relationship("UserRecord", back_populates="verification_logs")


# =====================================================================
# Pydantic Request & Response Schemas
# =====================================================================

class KeystrokeEvent(BaseModel):
    key: str
    code: Optional[str] = None
    down_time: float = Field(..., description="Timestamp of keydown in milliseconds (performance.now)")
    up_time: float = Field(..., description="Timestamp of keyup in milliseconds (performance.now)")
    is_trusted: bool = Field(default=True, description="DOM event.isTrusted property")


class MouseEvent(BaseModel):
    x: float
    y: float
    t: float = Field(..., description="Timestamp in milliseconds")
    is_trusted: bool = Field(default=True, description="DOM event.isTrusted property")


class DragGestureEvent(BaseModel):
    shape_type: str = Field(default="token", description="Shape type (circle, square, triangle, token)")
    start_time: float = Field(..., description="Timestamp of pointerdown")
    drop_time: float = Field(..., description="Timestamp of pointerup")
    initial_drag_latency: float = Field(default=0.0, description="Time to pointerdown (ms)")
    hold_duration: float = Field(default=0.0, description="Duration held while dragging (ms)")
    docking_latency: float = Field(default=0.0, description="Dwell time inside target hole before release (ms)")
    drag_velocity_mean: float = Field(default=0.0, description="Mean velocity px/s")
    drag_velocity_std: float = Field(default=0.0, description="Velocity standard deviation px/s")
    trajectory_directness_ratio: float = Field(default=1.0, description="Euclidean distance / Path length (0.0 - 1.0)")
    tortuosity: float = Field(default=1.0, description="Path length / Euclidean distance (>= 1.0)")
    drop_drift_offset: float = Field(default=0.0, description="Radial distance from target hole center (px)")
    target_slot_id: Optional[str] = None
    track_notch_x: Optional[float] = Field(default=None, description="X coordinate of track notch (px)")
    track_notch_y: Optional[float] = Field(default=None, description="Y offset of track notch (px)")
    saccadic_dip_ratio: Optional[float] = Field(default=None, description="Ratio of min velocity at notch to approach peak")
    saccadic_pause_ms: Optional[float] = Field(default=None, description="Pause duration within notch alignment well (ms)")
    tremor_8_12hz_ratio: Optional[float] = Field(default=None, description="Spectral power ratio in 8-12 Hz tremor band")
    tremor_peak_freq: Optional[float] = Field(default=None, description="Dominant tremor frequency peak (Hz)")
    tremor_rms_jitter: Optional[float] = Field(default=None, description="RMS lateral micro-jitter amplitude (px)")
    trajectory: List[MouseEvent] = Field(default_factory=list)


class TypingSessionTelemetry(BaseModel):
    keystrokes: List[KeystrokeEvent] = Field(default_factory=list)
    wpm: float = Field(default=0.0)
    accuracy: float = Field(default=100.0)
    backspace_count: int = Field(default=0)
    duration_ms: float = Field(default=0.0)


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1)
    confirm_password: str = Field(..., min_length=1)
    password_keystrokes: List[KeystrokeEvent] = Field(default_factory=list, description="Keystrokes captured while entering password")
    typing_telemetry: TypingSessionTelemetry
    shape_telemetry: List[DragGestureEvent] = Field(..., min_length=1)


class RegisterResponse(BaseModel):
    success: bool
    user_id: str
    message: str
    baseline_summary: Dict[str, Any]


class BrowserIntegrity(BaseModel):
    is_webdriver: bool = Field(default=False)
    user_agent: str = Field(default="")
    screen_width: int = Field(default=0)
    screen_height: int = Field(default=0)


class VerificationRequest(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = ""
    password_keystrokes: List[KeystrokeEvent] = Field(default_factory=list, description="Keystrokes captured from password input")
    pangram_keystrokes: List[KeystrokeEvent] = Field(default_factory=list, description="Keystrokes captured from pangram input")
    token_drag: Optional[DragGestureEvent] = None
    mouse_events: List[MouseEvent] = Field(default_factory=list)
    browser_integrity: Optional[BrowserIntegrity] = None

    # Backwards compatibility / aliases:
    user_id: Optional[str] = None
    keystrokes: List[KeystrokeEvent] = Field(default_factory=list)
    drag_gesture: Optional[DragGestureEvent] = None
    drag_gestures: List[DragGestureEvent] = Field(default_factory=list)


class SignalsBreakdown(BaseModel):
    bot_detected: bool
    password_valid: bool
    keystroke_rhythm_match: float
    motor_kinematics_match: float
    drag_dynamics_match: float = 100.0


class VerificationResponse(BaseModel):
    authenticated: bool
    confidence_score: float
    latency_ms: float
    signals: SignalsBreakdown
    explainability_reasons: List[str]
    details: Optional[Dict[str, Any]] = None


# Backward-compatibility aliases
EnrollmentRequest = RegisterRequest
EnrollmentResponse = RegisterResponse

