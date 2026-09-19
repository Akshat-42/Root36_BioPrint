"""
BioPrint Behavioral Authentication Engine - Data Models
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
    passphrase = Column(String(256), nullable=True)
    sample_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    baseline = relationship("BaselineProfileRecord", back_populates="user", uselist=False, cascade="all, delete-orphan")
    verification_logs = relationship("VerificationLogRecord", back_populates="user", cascade="all, delete-orphan")


class BaselineProfileRecord(Base):
    __tablename__ = "baseline_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(64), ForeignKey("users.user_id"), unique=True, index=True, nullable=False)
    keystroke_baseline_json = Column(Text, nullable=False)   # Serialized dict of dwell/flight distributions
    motor_baseline_json = Column(Text, nullable=False)       # Serialized velocity, jerk, Fitts's params
    cognitive_baseline_json = Column(Text, nullable=False)   # Serialized Stroop metrics
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("UserRecord", back_populates="baseline")


class VerificationLogRecord(Base):
    __tablename__ = "verification_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(64), ForeignKey("users.user_id"), index=True, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)
    authenticated = Column(Boolean, nullable=False)
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
    down_time: float = Field(..., description="Timestamp of keydown in milliseconds (performance.now)")
    up_time: float = Field(..., description="Timestamp of keyup in milliseconds (performance.now)")


class MouseEvent(BaseModel):
    x: float
    y: float
    t: float = Field(..., description="Timestamp in milliseconds")
    is_trusted: bool = Field(default=True, description="DOM event.isTrusted property")


class MotorTargetEvent(BaseModel):
    target_id: int
    start_t: float
    click_t: float
    distance: float
    width: float
    overshoot: float = 0.0
    trajectory: List[MouseEvent] = Field(default_factory=list)


class StroopTrialEvent(BaseModel):
    word: str
    font_color: str
    selected_color: str
    reaction_time_ms: float
    is_correct: bool


class EnrollmentSample(BaseModel):
    sample_index: int
    keystrokes: List[KeystrokeEvent]
    mouse_events: List[MouseEvent] = Field(default_factory=list)
    motor_targets: List[MotorTargetEvent] = Field(default_factory=list)
    stroop_trials: List[StroopTrialEvent] = Field(default_factory=list)


class EnrollmentRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)
    passphrase: Optional[str] = ""
    samples: List[EnrollmentSample] = Field(..., min_length=1)


class EnrollmentResponse(BaseModel):
    success: bool
    user_id: str
    message: str
    sample_count: int
    baseline_summary: Dict[str, Any]


class VerificationRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)
    passphrase: Optional[str] = ""
    keystrokes: List[KeystrokeEvent] = Field(default_factory=list)
    mouse_events: List[MouseEvent] = Field(default_factory=list)
    button_context: Optional[Dict[str, Any]] = None  # target coordinates, dimensions


class SignalsBreakdown(BaseModel):
    bot_detected: bool
    keystroke_rhythm_match: float
    motor_kinematics_match: float
    cognitive_delay_match: float


class VerificationResponse(BaseModel):
    authenticated: bool
    confidence_score: float
    latency_ms: float
    signals: SignalsBreakdown
    explainability_reasons: List[str]
    details: Optional[Dict[str, Any]] = None
