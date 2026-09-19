"""
BioPrint Biometrics Engine - Comprehensive Test Suite
Validates mathematical calculations, baseline compilations, bot heuristics,
and verification latency benchmarks.
"""

import time
import math
from backend.models import (
    KeystrokeEvent,
    MouseEvent,
    MotorTargetEvent,
    StroopTrialEvent,
    EnrollmentSample,
)
from backend.biometrics import BiometricsEngine, SIGMA_MIN_FLOOR


def generate_mock_keystrokes(passphrase: str, base_dwell=90.0, base_flight=110.0, jitter=5.0):
    """Generates synthetic human-like keystroke events with realistic timing."""
    events = []
    current_time = 100.0
    for i, char in enumerate(passphrase):
        dwell = base_dwell + (jitter * math.sin(i * 1.3))
        down_time = current_time
        up_time = down_time + dwell
        events.append(KeystrokeEvent(key=char, down_time=down_time, up_time=up_time))
        # advance time by dwell + flight
        flight = base_flight + (jitter * math.cos(i * 0.9))
        current_time = up_time + flight
    return events


def generate_curved_mouse_trajectory(start=(100, 200), end=(500, 600), steps=30, duration_ms=450.0):
    """Generates human-like cursor trajectory with natural curvature and micro-jitter."""
    events = []
    t_step = duration_ms / float(steps)
    start_x, start_y = start
    end_x, end_y = end

    for i in range(steps + 1):
        progress = i / float(steps)
        # Bell-shaped velocity profile (smooth acceleration and deceleration)
        smooth_progress = 0.5 * (1.0 - math.cos(progress * math.pi))

        # Add lateral curvature arc
        arc_offset = 35.0 * math.sin(progress * math.pi)
        # Add slight natural micro-jitter
        jitter_x = 0.8 * math.sin(i * 2.7)
        jitter_y = 0.8 * math.cos(i * 3.1)

        x = start_x + (end_x - start_x) * smooth_progress - (arc_offset * 0.4) + jitter_x
        y = start_y + (end_y - start_y) * smooth_progress + (arc_offset * 0.8) + jitter_y
        t = 50.0 + (i * t_step)
        events.append(MouseEvent(x=x, y=y, t=t, is_trusted=True))

    return events


def test_baseline_and_verification():
    print("[TEST 1] Testing Baseline Compilation & Legitimate Verification...")
    passphrase = "bioprint secure"

    # 1. Build 4 enrollment samples with normal variance
    samples = []
    for idx in range(4):
        ks = generate_mock_keystrokes(passphrase, base_dwell=95.0 + idx * 2.0, base_flight=115.0 - idx * 1.5, jitter=4.0)
        mouse = generate_curved_mouse_trajectory(steps=25, duration_ms=420.0 + idx * 15.0)
        motor_targets = [
            MotorTargetEvent(target_id=1, start_t=0, click_t=310 + idx * 10, distance=250, width=50),
            MotorTargetEvent(target_id=2, start_t=350, click_t=740 + idx * 8, distance=380, width=40),
            MotorTargetEvent(target_id=3, start_t=780, click_t=1090 + idx * 12, distance=180, width=60)
        ]
        stroop = [
            StroopTrialEvent(word="RED", font_color="BLUE", selected_color="BLUE", reaction_time_ms=520 + idx * 10, is_correct=True),
            StroopTrialEvent(word="GREEN", font_color="YELLOW", selected_color="YELLOW", reaction_time_ms=490 + idx * 15, is_correct=True)
        ]
        samples.append(EnrollmentSample(
            sample_index=idx,
            keystrokes=ks,
            mouse_events=mouse,
            motor_targets=motor_targets,
            stroop_trials=stroop
        ))

    key_base, motor_base, cog_base = BiometricsEngine.compile_baseline(samples)

    # Validate standard deviation floor
    for key, stats in key_base["dwell"].items():
        assert stats["std"] >= SIGMA_MIN_FLOOR, f"Sigma floor violated for key {key}: {stats['std']} < {SIGMA_MIN_FLOOR}"
    for trans, stats in key_base["flight"].items():
        assert stats["std"] >= SIGMA_MIN_FLOOR, f"Sigma floor violated for flight {trans}: {stats['std']} < {SIGMA_MIN_FLOOR}"

    print(f" -> Enrolled {len(key_base['dwell'])} keys, {len(key_base['flight'])} transitions.")
    print(f" -> Motor Fitts's fit: MT = {motor_base['fitts_a']} + {motor_base['fitts_b']} * ID")

    # 2. Verify with legitimate sample
    legit_ks = generate_mock_keystrokes(passphrase, base_dwell=96.0, base_flight=114.0, jitter=4.5)
    legit_mouse = generate_curved_mouse_trajectory(steps=28, duration_ms=435.0)
    baseline_profile = {
        "keystroke_baseline": key_base,
        "motor_baseline": motor_base,
        "cognitive_baseline": cog_base
    }

    resp = BiometricsEngine.verify(
        keystrokes=legit_ks,
        mouse_events=legit_mouse,
        baseline_profile=baseline_profile
    )

    print(f" -> Legit response: Authenticated={resp.authenticated}, Score={resp.confidence_score}, Latency={resp.latency_ms}ms")
    assert resp.authenticated is True, f"Legitimate user was rejected! Score: {resp.confidence_score}"
    assert resp.confidence_score >= 70.0, f"Expected score >= 70, got {resp.confidence_score}"
    assert resp.latency_ms < 50.0, f"Verification exceeded 50ms latency: {resp.latency_ms}ms"
    print(" -> PASS: Legitimate user authenticated successfully.\n")


def test_impostor_keystroke_rejection():
    print("[TEST 2] Testing Impostor Keystroke Cadence Rejection...")
    passphrase = "bioprint secure"

    # Enrolled baseline
    samples = [
        EnrollmentSample(
            sample_index=0,
            keystrokes=generate_mock_keystrokes(passphrase, base_dwell=90.0, base_flight=110.0, jitter=2.0)
        ),
        EnrollmentSample(
            sample_index=1,
            keystrokes=generate_mock_keystrokes(passphrase, base_dwell=92.0, base_flight=112.0, jitter=2.0)
        )
    ]
    key_base, motor_base, cog_base = BiometricsEngine.compile_baseline(samples)
    baseline_profile = {
        "keystroke_baseline": key_base,
        "motor_baseline": motor_base,
        "cognitive_baseline": cog_base
    }

    # Impostor who types with vastly different flight cadence (e.g. hunt-and-peck: 350ms flight times)
    impostor_ks = generate_mock_keystrokes(passphrase, base_dwell=180.0, base_flight=340.0, jitter=40.0)
    resp = BiometricsEngine.verify(
        keystrokes=impostor_ks,
        mouse_events=[],
        baseline_profile=baseline_profile
    )

    print(f" -> Impostor response: Authenticated={resp.authenticated}, Score={resp.confidence_score}")
    print(f" -> Reasons: {resp.explainability_reasons[:2]}")

    assert resp.authenticated is False, "Impostor was erroneously authenticated!"
    assert any("deviation" in r.lower() or "anomaly" in r.lower() or "cadence" in r.lower() for r in resp.explainability_reasons), "Missing explainability for cadence anomaly!"
    print(" -> PASS: Impostor rejected with clear diagnostic explainability.\n")


def test_bot_detection_heuristics():
    print("[TEST 3] Testing Bot Detection Heuristics...")
    baseline_profile = {
        "keystroke_baseline": {"dwell": {}, "flight": {}},
        "motor_baseline": {"mean_velocity": 400.0, "mean_acceleration": 1500.0, "mean_tortuosity": 1.15},
        "cognitive_baseline": {"mean_reaction_ms": 500.0}
    }

    # A) Untrusted event injection (isTrusted = False)
    untrusted_mouse = [
        MouseEvent(x=100 + i * 10, y=200 + i * 10, t=100 + i * 20, is_trusted=False)
        for i in range(10)
    ]
    resp_untrusted = BiometricsEngine.verify([], untrusted_mouse, baseline_profile)
    assert resp_untrusted.signals.bot_detected is True
    assert resp_untrusted.authenticated is False
    assert any("isTrusted" in r for r in resp_untrusted.explainability_reasons)
    print(" -> PASS: Untrusted DOM event flagged bot successfully.")

    # B) Perfectly linear mouse trajectory with zero micro-jitter
    linear_mouse = [
        MouseEvent(x=100.0 + i * 15.0, y=200.0 + i * 15.0, t=100.0 + i * 20.0, is_trusted=True)
        for i in range(15)
    ]
    resp_linear = BiometricsEngine.verify([], linear_mouse, baseline_profile)
    assert resp_linear.signals.bot_detected is True
    assert any("linear" in r.lower() for r in resp_linear.explainability_reasons)
    print(" -> PASS: Perfectly linear synthetic mouse flagged bot successfully.")

    # C) Impossible keypress dwell (<10ms)
    fast_ks = [
        KeystrokeEvent(key="a", down_time=100.0, up_time=103.0),  # 3ms dwell!
        KeystrokeEvent(key="b", down_time=150.0, up_time=154.0),
    ]
    resp_fast = BiometricsEngine.verify(fast_ks, [], baseline_profile)
    assert resp_fast.signals.bot_detected is True
    assert any("dwell" in r.lower() and "<10ms" in r for r in resp_fast.explainability_reasons)
    print(" -> PASS: Impossible keypress latency (<10ms) flagged bot successfully.\n")


def test_latency_benchmark():
    print("[TEST 4] Benchmarking Verification Execution Latency (<50ms)...")
    passphrase = "bioprint authentication engine benchmark"
    samples = [
        EnrollmentSample(
            sample_index=0,
            keystrokes=generate_mock_keystrokes(passphrase)
        ),
        EnrollmentSample(
            sample_index=1,
            keystrokes=generate_mock_keystrokes(passphrase)
        )
    ]
    key_base, motor_base, cog_base = BiometricsEngine.compile_baseline(samples)
    baseline_profile = {
        "keystroke_baseline": key_base,
        "motor_baseline": motor_base,
        "cognitive_baseline": cog_base
    }

    test_ks = generate_mock_keystrokes(passphrase)
    test_mouse = generate_curved_mouse_trajectory(steps=50, duration_ms=400.0)

    # Run 50 iterations to test statistical performance
    latencies = []
    for _ in range(50):
        t0 = time.perf_counter()
        resp = BiometricsEngine.verify(test_ks, test_mouse, baseline_profile)
        lat = (time.perf_counter() - t0) * 1000.0
        latencies.append(lat)

    mean_lat = sum(latencies) / len(latencies)
    max_lat = max(latencies)
    print(f" -> 50 trials: Mean Latency = {mean_lat:.2f}ms, Max Latency = {max_lat:.2f}ms")
    assert mean_lat < 25.0, f"Mean latency exceeded 25ms: {mean_lat:.2f}ms"
    assert max_lat < 50.0, f"Max latency exceeded 50ms: {max_lat:.2f}ms"
    print(" -> PASS: Latency benchmark well within <50ms constraint.\n")


if __name__ == "__main__":
    print("=== RUNNING BIOPRINT BIOMETRICS VERIFICATION TESTS ===")
    test_baseline_and_verification()
    test_impostor_keystroke_rejection()
    test_bot_detection_heuristics()
    test_latency_benchmark()
    print("=== ALL BIOPRINT BACKEND UNIT TESTS PASSED SUCCESSFULLY! ===")
