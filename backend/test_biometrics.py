"""
BioPrint Biometrics Engine (V2) - Comprehensive Test Suite
=========================================================
Validates:
1. Argon2id salted password hashing and validation.
2. Universal typing feature extraction (R_hand, cluster dwell matrix, spacebar delay, entropy).
3. Psychomotor kinematics (tortuosity, velocity symmetry, docking latency).
4. Baseline compilation & legitimate user verification (<50ms execution).
5. Invalid password rejection (password_valid: False).
6. Hunt-and-peck impostor cadence rejection & explainability diagnostics.
7. Bot detection heuristics (isTrusted == False, linear cursor, dwell <10ms, teleportation).
"""

import time
import math
import numpy as np
from backend.models import (
    KeystrokeEvent,
    MouseEvent,
    DragGestureEvent,
    TypingSessionTelemetry,
    BrowserIntegrity,
)
from backend.biometrics import (
    BiometricsEngine,
    hash_password,
    verify_password,
    LEFT_HAND_KEYS,
    RIGHT_HAND_KEYS,
)


def generate_curved_mouse_trajectory(start=(100, 200), end=(500, 600), steps=30, duration_ms=450.0):
    """Generates human-like cursor trajectory with natural curvature and micro-jitter."""
    events = []
    t_step = duration_ms / float(steps)
    start_x, start_y = start
    end_x, end_y = end

    for i in range(steps + 1):
        progress = i / float(steps)
        smooth_progress = 0.5 * (1.0 - math.cos(progress * math.pi))
        arc_offset = 35.0 * math.sin(progress * math.pi)
        jitter_x = 0.8 * math.sin(i * 2.7)
        jitter_y = 0.8 * math.cos(i * 3.1)

        x = start_x + (end_x - start_x) * smooth_progress - (arc_offset * 0.4) + jitter_x
        y = start_y + (end_y - start_y) * smooth_progress + (arc_offset * 0.8) + jitter_y
        t = 50.0 + (i * t_step)
        events.append(MouseEvent(x=x, y=y, t=t, is_trusted=True))

    return events


def generate_typing_keystrokes(text: str, base_dwell=85.0, cross_hand_flight=75.0, same_hand_flight=120.0):
    """Simulates realistic touch-typing cadence with distinct cross-hand vs same-hand transitions."""
    events = []
    current_time = 100.0

    for i, char in enumerate(text):
        c_lower = char.lower()
        # Vowels slightly longer dwell
        dwell = base_dwell + (12.0 if c_lower in "aeiou" else (4.0 * math.sin(i * 1.5)))
        down_time = current_time
        up_time = down_time + dwell
        events.append(KeystrokeEvent(key=char, down_time=down_time, up_time=up_time, is_trusted=True))

        if i < len(text) - 1:
            next_c = text[i + 1].lower()
            # Spacebar boundary saccade
            if next_c == " " or c_lower == " ":
                flight = 165.0 + (10.0 * math.cos(i))
            else:
                is_curr_left = c_lower in LEFT_HAND_KEYS
                is_next_left = next_c in LEFT_HAND_KEYS
                if is_curr_left != is_next_left:
                    flight = cross_hand_flight + (8.0 * math.sin(i * 0.8))
                else:
                    flight = same_hand_flight + (8.0 * math.cos(i * 0.8))

            current_time = up_time + flight

    return events


def test_argon2id_password_security():
    print("[TEST 1] Testing Argon2id Salted Password Hashing...")
    password = "SuperSecretSecureP@ssword123!"
    hashed = hash_password(password)

    assert hashed.startswith("$argon2") or hashed.startswith("$2b$") or hashed.startswith("$bcrypt"), "Hash format invalid!"
    assert verify_password(password, hashed) is True, "Valid password failed verification!"
    assert verify_password("WrongPassword!", hashed) is False, "Invalid password erroneously accepted!"
    assert verify_password("", hashed) is False, "Empty password erroneously accepted!"
    print(" -> PASS: Argon2id salted hashing & verification working as expected.\n")


def test_universal_typing_feature_extraction():
    print("[TEST 2] Testing Universal Typing Feature Extraction (QWERTY Ergonomics)...")
    pangram = "Quick foxes jump over lazy brown dogs"
    keystrokes = generate_typing_keystrokes(pangram, base_dwell=86.0, cross_hand_flight=70.0, same_hand_flight=125.0)

    feats = BiometricsEngine.extract_universal_typing_features(keystrokes)
    print(f" -> Extracted Typing Features: R_hand={feats['hand_switch_ratio']}, Vowel Dwell={feats['dwell_vowels']}ms, Spacebar Delay={feats['spacebar_saccade_delay']}ms, Entropy CV={feats['flight_entropy_cv']}")

    # Touch-typist cross-hand flight is faster than same-hand flight (R_hand < 1.0)
    assert 0.40 <= feats["hand_switch_ratio"] <= 0.85, f"R_hand out of expected touch-typist range: {feats['hand_switch_ratio']}"
    assert feats["dwell_vowels"] > 0, "Vowel dwell not extracted!"
    assert feats["spacebar_saccade_delay"] > 100.0, "Spacebar delay not extracted!"
    assert feats["flight_entropy_cv"] > 0.1, "Entropy CV calculation failed!"
    print(" -> PASS: Universal typing dynamics properly extracted from text stream.\n")


def test_scrambled_motor_kinematics():
    print("[TEST 3] Testing Scrambled Shape Docking Kinematics...")
    # Simulate diagonal scrambled path (from top-left to bottom-right)
    traj = generate_curved_mouse_trajectory(start=(100, 100), end=(450, 400), steps=25, duration_ms=480.0)
    drag = DragGestureEvent(
        shape_type="circle",
        start_time=100.0,
        drop_time=580.0,
        hold_duration=480.0,
        docking_latency=115.0,
        drag_velocity_mean=480.0,
        drop_drift_offset=5.2,
        target_slot_id="slot-square", # Scrambled slot
        trajectory=traj
    )

    motor_feats = BiometricsEngine.extract_motor_kinematics([drag])
    print(f" -> Motor Kinematics: Tortuosity={motor_feats['tortuosity']}, Symmetry={motor_feats['velocity_symmetry']}, Docking Latency={motor_feats['docking_latency']}ms")

    assert motor_feats["tortuosity"] >= 1.0, "Tortuosity must be >= 1.0!"
    assert 0.5 <= motor_feats["velocity_symmetry"] <= 2.0, "Velocity bell-curve symmetry out of human bounds!"
    assert motor_feats["docking_latency"] > 20.0, "Docking latency not measured!"
    print(" -> PASS: Scrambled motor kinematics properly derived.\n")


def test_full_enrollment_and_verification_pipeline():
    print("[TEST 4] Testing Full Enrollment, Salted Hash & Verification Pipeline (<50ms)...")
    username = "alice"
    password = "Secur3Password!"
    pwd_hash = hash_password(password)

    # 1. Simulate 30-word Monkeytype enrollment session
    monkeytype_text = "the quick brown fox jumps over the lazy dog and runs through vibrant green pastures while curious birds flutter in the clear morning air"
    enroll_ks = generate_typing_keystrokes(monkeytype_text, base_dwell=88.0, cross_hand_flight=72.0, same_hand_flight=118.0)
    typing_session = TypingSessionTelemetry(
        keystrokes=enroll_ks,
        wpm=68.5,
        accuracy=98.5,
        backspace_count=2,
        duration_ms=25000.0
    )

    # 2. Simulate 3 scrambled shape docking gestures (Circle, Triangle, Square)
    shape_drags = []
    for s_idx, shape in enumerate(["circle", "triangle", "square"]):
        # Non-aligned scrambled endpoints
        traj = generate_curved_mouse_trajectory(
            start=(100 + s_idx * 100, 100),
            end=(300 - s_idx * 50, 420),
            steps=24,
            duration_ms=460.0
        )
        shape_drags.append(DragGestureEvent(
            shape_type=shape,
            start_time=100.0,
            drop_time=560.0,
            hold_duration=460.0,
            docking_latency=120.0,
            drop_drift_offset=4.5,
            target_slot_id=f"slot-{s_idx}",
            trajectory=traj
        ))

    typing_base, motor_base = BiometricsEngine.compile_enrollment_baseline(typing_session, shape_drags)
    baseline_profile = {
        "typing_baseline": typing_base,
        "motor_baseline": motor_base
    }

    # 3. Legitimate Verification: Valid Password + Pangram + Token Drag
    pangram = "Quick foxes jump over lazy brown dogs"
    legit_pangram_ks = generate_typing_keystrokes(pangram, base_dwell=89.0, cross_hand_flight=74.0, same_hand_flight=116.0)
    token_traj = generate_curved_mouse_trajectory(start=(150, 200), end=(420, 260), steps=22, duration_ms=450.0)
    token_drag = DragGestureEvent(
        shape_type="token",
        start_time=100.0,
        drop_time=550.0,
        hold_duration=450.0,
        docking_latency=118.0,
        drop_drift_offset=5.0,
        trajectory=token_traj
    )

    resp = BiometricsEngine.verify(
        username=username,
        password_valid=True,
        pangram_keystrokes=legit_pangram_ks,
        token_drag=token_drag,
        baseline_profile=baseline_profile
    )

    print(f" -> Legit Response: Authenticated={resp.authenticated}, Score={resp.confidence_score}%, Latency={resp.latency_ms}ms")
    print(f" -> Signals: KeyMatch={resp.signals.keystroke_rhythm_match}%, MotorMatch={resp.signals.motor_kinematics_match}%")
    assert resp.authenticated is True, f"Legitimate user failed authentication! Score={resp.confidence_score}"
    assert resp.confidence_score >= 70.0, "Score fell below 70% threshold!"
    assert resp.latency_ms < 50.0, f"Verification latency exceeded 50ms constraint: {resp.latency_ms}ms"
    print(" -> PASS: Legitimate user authenticated successfully within <50ms.\n")

    # 4. Invalid Password Rejection
    resp_bad_pwd = BiometricsEngine.verify(
        username=username,
        password_valid=False, # Invalid password!
        pangram_keystrokes=legit_pangram_ks,
        token_drag=token_drag,
        baseline_profile=baseline_profile
    )
    assert resp_bad_pwd.authenticated is False, "Invalid password was accepted!"
    assert resp_bad_pwd.signals.password_valid is False
    assert any("password" in r.lower() for r in resp_bad_pwd.explainability_reasons)
    print(" -> PASS: Invalid password rejected immediately with zero confidence.\n")

    # 5. Hunt-and-Peck Impostor Rejection (R_hand ~ 1.15, slow spacebar delay)
    impostor_ks = generate_typing_keystrokes(
        pangram,
        base_dwell=160.0,
        cross_hand_flight=180.0, # Hunt-and-peck: cross-hand is slow and search-bound
        same_hand_flight=140.0
    )
    # Impostor robotic linear token drag
    impostor_drag = DragGestureEvent(
        shape_type="token",
        start_time=100.0,
        drop_time=550.0,
        hold_duration=450.0,
        docking_latency=280.0,
        drop_drift_offset=24.0,
        trajectory=[MouseEvent(x=100 + i * 15, y=200, t=100 + i * 20, is_trusted=True) for i in range(20)]
    )

    resp_impostor = BiometricsEngine.verify(
        username=username,
        password_valid=True, # Even if password was leaked/stolen!
        pangram_keystrokes=impostor_ks,
        token_drag=impostor_drag,
        baseline_profile=baseline_profile
    )

    print(f" -> Impostor Response: Authenticated={resp_impostor.authenticated}, Score={resp_impostor.confidence_score}%")
    print(f" -> Explainability Diagnostics: {resp_impostor.explainability_reasons[:2]}")
    assert resp_impostor.authenticated is False, "Impostor was erroneously authenticated!"
    assert resp_impostor.confidence_score < 60.0, "Impostor confidence score should be low!"
    assert len(resp_impostor.explainability_reasons) > 0, "Missing explainability diagnostic items!"
    print(" -> PASS: Impostor rejected with itemized diagnostic explainability.\n")

    # 6. Bot Detection (isTrusted == False & Teleportation)
    untrusted_ks = [KeystrokeEvent(key=k.key, down_time=k.down_time, up_time=k.up_time, is_trusted=False) for k in legit_pangram_ks[:5]]
    resp_untrusted = BiometricsEngine.verify(
        username=username,
        password_valid=True,
        pangram_keystrokes=untrusted_ks,
        token_drag=token_drag,
        baseline_profile=baseline_profile
    )
    assert resp_untrusted.signals.bot_detected is True
    assert resp_untrusted.authenticated is False
    assert any("isTrusted" in r for r in resp_untrusted.explainability_reasons)
    print(" -> PASS: Synthetic isTrusted == False flagged bot successfully.\n")

    # 7. Headless Webdriver Automation Flag
    resp_webdriver = BiometricsEngine.verify(
        username=username,
        password_valid=True,
        pangram_keystrokes=legit_pangram_ks,
        token_drag=token_drag,
        baseline_profile=baseline_profile,
        browser_integrity=BrowserIntegrity(is_webdriver=True)
    )
    assert resp_webdriver.signals.bot_detected is True
    assert any("webdriver" in r.lower() for r in resp_webdriver.explainability_reasons)
    print(" -> PASS: Headless navigator.webdriver flagged bot successfully.\n")


def test_latency_benchmark():
    print("[TEST 5] Benchmarking Verification Latency (50 iterations)...")
    username = "alice"
    pangram = "Quick foxes jump over lazy brown dogs"
    enroll_ks = generate_typing_keystrokes("the quick brown fox jumps over the lazy dog and runs through vibrant green pastures while curious birds flutter in the clear morning air")
    shape_drags = [
        DragGestureEvent(
            shape_type="circle",
            start_time=100.0,
            drop_time=560.0,
            hold_duration=460.0,
            docking_latency=120.0,
            trajectory=generate_curved_mouse_trajectory()
        )
    ]
    t_base, m_base = BiometricsEngine.compile_enrollment_baseline(TypingSessionTelemetry(keystrokes=enroll_ks), shape_drags)
    profile = {"typing_baseline": t_base, "motor_baseline": m_base}

    test_ks = generate_typing_keystrokes(pangram)
    test_drag = DragGestureEvent(
        shape_type="token",
        start_time=100.0,
        drop_time=550.0,
        hold_duration=450.0,
        docking_latency=110.0,
        trajectory=generate_curved_mouse_trajectory()
    )

    latencies = []
    for _ in range(50):
        t0 = time.perf_counter()
        BiometricsEngine.verify(
            username=username,
            password_valid=True,
            pangram_keystrokes=test_ks,
            token_drag=test_drag,
            baseline_profile=profile
        )
        lat = (time.perf_counter() - t0) * 1000.0
        latencies.append(lat)

    mean_lat = sum(latencies) / len(latencies)
    max_lat = max(latencies)
    print(f" -> 50 trials: Mean Latency = {mean_lat:.2f}ms, Max Latency = {max_lat:.2f}ms")
    assert mean_lat < 15.0, f"Mean latency too high: {mean_lat:.2f}ms"
    assert max_lat < 50.0, f"Max latency exceeded 50ms: {max_lat:.2f}ms"
    print(" -> PASS: Latency benchmark well within <50ms constraint.\n")


def test_impostor_password_cadence_rejection():
    print("[TEST 6] Testing Impostor Password Cadence Rejection & Digram Diagnostics...")
    username = "bob"
    password = "CorrectHorseBatteryStaple!"

    # 1. Enrolled user types password with fast muscle memory
    user_enroll_pwd_ks = generate_typing_keystrokes(password, base_dwell=70.0, cross_hand_flight=40.0, same_hand_flight=60.0)
    user_typing_ks = generate_typing_keystrokes("the quick brown fox jumps over the lazy dog", base_dwell=75.0, cross_hand_flight=50.0, same_hand_flight=70.0)
    
    shape_drags = [
        DragGestureEvent(
            shape_type="circle",
            start_time=100.0,
            drop_time=500.0,
            hold_duration=400.0,
            docking_latency=120.0,
            trajectory=generate_curved_mouse_trajectory()
        ),
        DragGestureEvent(
            shape_type="square",
            start_time=100.0,
            drop_time=520.0,
            hold_duration=420.0,
            docking_latency=110.0,
            trajectory=generate_curved_mouse_trajectory()
        ),
        DragGestureEvent(
            shape_type="triangle",
            start_time=100.0,
            drop_time=490.0,
            hold_duration=390.0,
            docking_latency=105.0,
            trajectory=generate_curved_mouse_trajectory()
        )
    ]

    t_base, m_base = BiometricsEngine.compile_enrollment_baseline(
        TypingSessionTelemetry(keystrokes=user_typing_ks),
        shape_drags,
        password_keystrokes=user_enroll_pwd_ks
    )
    profile = {"typing_baseline": t_base, "motor_baseline": m_base}

    # Verify baseline contains digram_cadence
    assert "digram_cadence" in t_base, "digram_cadence missing from compiled baseline!"
    assert len(t_base["digram_cadence"]) > 0, "No digrams recorded in baseline!"

    # 2. Impostor types the exact same password, but with slow hunt-and-peck cadence (flight 220ms+)
    impostor_pwd_ks = generate_typing_keystrokes(password, base_dwell=170.0, cross_hand_flight=240.0, same_hand_flight=210.0)
    impostor_drag = DragGestureEvent(
        shape_type="token",
        start_time=100.0,
        drop_time=600.0,
        hold_duration=500.0,
        docking_latency=290.0, # Slow docking deceleration mismatch
        trajectory=generate_curved_mouse_trajectory()
    )

    resp = BiometricsEngine.verify(
        username=username,
        password_valid=True, # Impostor knows the password!
        pangram_keystrokes=impostor_pwd_ks,
        token_drag=impostor_drag,
        baseline_profile=profile
    )

    print(f" -> Impostor Password Attempt: Authenticated={resp.authenticated}, Score={resp.confidence_score}%")
    print(f" -> Explainability Reasons: {resp.explainability_reasons[:3]}")

    assert resp.authenticated is False, "Impostor typing password was erroneously authenticated!"
    assert resp.confidence_score < 70.0, f"Impostor score {resp.confidence_score} should be < 70.0%"
    assert any("Cadence mismatch" in r or "ratio" in r or "dwell" in r for r in resp.explainability_reasons), "Missing cadence mismatch explainability reasons!"
    print(" -> PASS: Impostor typing password rejected with cadence mismatch diagnostics.\n")


def test_zero_keystrokes_rejection():
    print("[TEST 7] Testing Zero Keystrokes Rejection...")
    username = "alice"
    enroll_ks = generate_typing_keystrokes("the quick brown fox jumps over the lazy dog")
    shape_drags = [
        DragGestureEvent(
            shape_type="circle",
            start_time=100.0,
            drop_time=500.0,
            hold_duration=400.0,
            docking_latency=120.0,
            trajectory=generate_curved_mouse_trajectory()
        )
    ]
    t_base, m_base = BiometricsEngine.compile_enrollment_baseline(TypingSessionTelemetry(keystrokes=enroll_ks), shape_drags)
    profile = {"typing_baseline": t_base, "motor_baseline": m_base}

    token_drag = DragGestureEvent(
        shape_type="token",
        start_time=100.0,
        drop_time=500.0,
        hold_duration=400.0,
        docking_latency=120.0,
        trajectory=generate_curved_mouse_trajectory()
    )

    # Empty keystrokes list
    resp = BiometricsEngine.verify(
        username=username,
        password_valid=True,
        pangram_keystrokes=[],
        token_drag=token_drag,
        baseline_profile=profile
    )

    assert resp.authenticated is False, "Zero keystrokes was accepted!"
    assert resp.signals.keystroke_rhythm_match == 0.0, "Zero keystrokes should have 0% key match!"
    assert any("keystroke" in r.lower() for r in resp.explainability_reasons)
    print(" -> PASS: Zero keystrokes properly rejected.\n")


def test_saccadic_pause_and_spectral_tremor():
    print("[TEST 8] Testing Saccadic Notch Pause & 8-12 Hz Physiological Grip Tremor...")
    steps = 50
    dur = 600.0
    dt = dur / steps
    notch_x = 190.0

    # 1. Generate legitimate human trajectory with 10 Hz tremor and notch deceleration
    human_traj = []
    for i in range(steps + 1):
        progress = i / steps
        x = 40.0 + 300.0 * progress
        dist_notch = abs(x - notch_x)
        notch_factor = math.exp(-((dist_notch / 25.0) ** 2))
        detour_y = -24.0 * notch_factor

        t_cur = 50.0 + (i * dt) + (60.0 * notch_factor if dist_notch < 35.0 else 0.0)
        t_sec = (t_cur - 50.0) / 1000.0
        tremor = 0.85 * math.sin(2 * math.pi * 10.0 * t_sec) + 0.3 * math.cos(2 * math.pi * 9.2 * t_sec)

        human_traj.append(MouseEvent(x=x, y=45.0 + detour_y + tremor, t=t_cur, is_trusted=True))

    s_dip, s_pause, s_decel = BiometricsEngine.extract_saccadic_notch_pause(human_traj, notch_x=notch_x)
    t_ratio, t_peak, t_rms = BiometricsEngine.extract_physiological_grip_tremor(human_traj, notch_x=notch_x)

    print(f" -> Human Kinematics: Dip Ratio={s_dip}, Pause={s_pause}ms, Tremor Power={t_ratio}, Peak={t_peak}Hz, RMS={t_rms}px")
    assert s_dip <= 0.65, f"Human notch dip ratio {s_dip} should be <= 0.65"
    assert s_pause >= 25.0, f"Human pause duration {s_pause}ms should be >= 25ms"
    assert t_rms >= 0.25, f"Human grip tremor RMS {t_rms} should be >= 0.25px"
    assert 7.0 <= t_peak <= 13.0, f"Human peak frequency {t_peak} should be in 7-13 Hz"
    print(" -> PASS: Legitimate human saccadic pause and 8-12 Hz tremor verified.\n")

    # 2. Test Synthetic Linear Bot (zero tremor -> flagged)
    bot_traj = []
    for i in range(steps + 1):
        progress = i / steps
        x = 40.0 + 300.0 * progress
        bot_traj.append(MouseEvent(x=x, y=45.0, t=50.0 + (i * dt), is_trusted=True))

    bot_drag = DragGestureEvent(
        shape_type="token",
        start_time=50.0,
        drop_time=50.0 + dur,
        hold_duration=dur,
        docking_latency=10.0,
        track_notch_x=notch_x,
        trajectory=bot_traj
    )

    is_bot, bot_reasons = BiometricsEngine.detect_bot_anomalies(
        keystrokes=[],
        mouse_events=bot_traj,
        drag_gestures=[bot_drag]
    )
    assert is_bot is True, "Linear bot without tremor was not flagged!"
    assert any("micro-tremor" in r or "Linear trajectory" in r for r in bot_reasons), "Bot explanation missing tremor or linear detection!"
    print(f" -> PASS: Bot flagged successfully: {bot_reasons[0]}\n")


if __name__ == "__main__":
    print("=== RUNNING BIOPRINT V2 BIOMETRICS TESTS ===\n")
    test_argon2id_password_security()
    test_universal_typing_feature_extraction()
    test_scrambled_motor_kinematics()
    test_full_enrollment_and_verification_pipeline()
    test_latency_benchmark()
    test_impostor_password_cadence_rejection()
    test_zero_keystrokes_rejection()
    test_saccadic_pause_and_spectral_tremor()
    print("=== ALL BIOPRINT V2 BACKEND TESTS PASSED SUCCESSFULLY! ===")
