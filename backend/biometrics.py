"""
BioPrint Behavioral Biometrics Engine
=====================================
Statistical anomaly detection, keystroke dynamics (Z-score deviation matcher),
mouse kinematics, Fitts's Law modeling, and bot detection heuristics.
"""

import math
import time
from typing import List, Dict, Tuple, Any, Optional
import numpy as np

from backend.models import (
    KeystrokeEvent,
    MouseEvent,
    MotorTargetEvent,
    StroopTrialEvent,
    EnrollmentSample,
    SignalsBreakdown,
    VerificationResponse,
)

# Minimum standard deviation floor (milliseconds) to prevent zero-variance divisions
SIGMA_MIN_FLOOR = 15.0
# Decision threshold for granting authentication (0 - 100 scale)
CONFIDENCE_THRESHOLD = 70.0
# Outlier Z-score threshold for generating human-readable explainability
Z_SCORE_ANOMALY_THRESHOLD = 2.5


class BiometricsEngine:
    """
    Core biometrics computation engine performing:
    1. Baseline distribution modeling from calibration telemetry.
    2. Bot and synthetic telemetry heuristic detection.
    3. Keystroke transition Z-score deviation matching.
    4. Mouse kinematic profile extraction (velocity, acceleration, jerk, tortuosity).
    5. Fitts's Law motor signature calibration and verification.
    6. Diagnostic explainability narrative generation.
    """

    # -------------------------------------------------------------------------
    # Baseline Profile Compilation (Enrollment)
    # -------------------------------------------------------------------------

    @staticmethod
    def compile_baseline(samples: List[EnrollmentSample]) -> Tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any]]:
        """
        Compiles baseline distributions (means and standard deviations) across multiple enrollment trials.

        Returns:
            Tuple of (keystroke_baseline, motor_baseline, cognitive_baseline)
        """
        # 1. Keystroke Baselines
        dwell_pools: Dict[str, List[float]] = {}
        flight_pools: Dict[str, List[float]] = {}

        for sample in samples:
            ks = sample.keystrokes
            # Dwell time: T_dwell = T_up - T_down
            for k in ks:
                dwell = max(5.0, k.up_time - k.down_time)
                dwell_pools.setdefault(k.key.lower(), []).append(dwell)

            # Flight time: T_flight = T_down[i+1] - T_up[i] (or down-to-down if overlapping)
            for i in range(len(ks) - 1):
                transition = f"{ks[i].key.lower()}->{ks[i+1].key.lower()}"
                # Inter-key flight latency
                flight = ks[i + 1].down_time - ks[i].up_time
                flight_pools.setdefault(transition, []).append(flight)

        keystroke_baseline = {
            "dwell": {},
            "flight": {}
        }

        for key, vals in dwell_pools.items():
            mean_val = float(np.mean(vals))
            # Apply standard deviation floor
            std_val = float(max(SIGMA_MIN_FLOOR, np.std(vals, ddof=1 if len(vals) > 1 else 0)))
            keystroke_baseline["dwell"][key] = {
                "mean": round(mean_val, 2),
                "std": round(std_val, 2),
                "samples": len(vals)
            }

        for trans, vals in flight_pools.items():
            mean_val = float(np.mean(vals))
            std_val = float(max(SIGMA_MIN_FLOOR, np.std(vals, ddof=1 if len(vals) > 1 else 0)))
            keystroke_baseline["flight"][trans] = {
                "mean": round(mean_val, 2),
                "std": round(std_val, 2),
                "samples": len(vals)
            }

        # 2. Motor & Kinematics Baseline
        velocities = []
        accelerations = []
        jerks = []
        tortuosities = []
        fitts_data_id = []
        fitts_data_mt = []

        for sample in samples:
            # Analyze mouse events in the sample
            if len(sample.mouse_events) >= 3:
                kinematics = BiometricsEngine.compute_kinematics(sample.mouse_events)
                if kinematics["mean_velocity"] > 0:
                    velocities.append(kinematics["mean_velocity"])
                if kinematics["mean_acceleration"] > 0:
                    accelerations.append(kinematics["mean_acceleration"])
                if kinematics["mean_jerk"] > 0:
                    jerks.append(kinematics["mean_jerk"])
                if kinematics["tortuosity"] > 0:
                    tortuosities.append(kinematics["tortuosity"])

            # Analyze Fitts's Law calibration motor targets
            for target in sample.motor_targets:
                movement_time = max(20.0, target.click_t - target.start_t)
                distance = max(10.0, target.distance)
                width = max(10.0, target.width)
                # Fitts's Index of Difficulty: ID = log2(2D / W)
                index_of_difficulty = math.log2((2.0 * distance) / width)
                fitts_data_id.append(index_of_difficulty)
                fitts_data_mt.append(movement_time)

        # Fit Fitts's Law regression: MT = a + b * ID
        fitts_a = 150.0  # Default empirical intercept (ms)
        fitts_b = 85.0   # Default empirical slope (ms/bit)
        if len(fitts_data_id) >= 3:
            try:
                poly = np.polyfit(fitts_data_id, fitts_data_mt, 1)
                fitts_b = float(max(10.0, poly[0]))
                fitts_a = float(max(0.0, poly[1]))
            except Exception:
                pass

        motor_baseline = {
            "mean_velocity": float(np.mean(velocities)) if velocities else 450.0,
            "std_velocity": float(max(100.0, (np.mean(velocities) * 0.25) if velocities else 120.0, np.std(velocities, ddof=1 if len(velocities) > 1 else 0) if velocities else 0.0)),
            "mean_acceleration": float(np.mean(accelerations)) if accelerations else 1800.0,
            "std_acceleration": float(max(1200.0, (np.mean(accelerations) * 0.35) if accelerations else 400.0, np.std(accelerations, ddof=1 if len(accelerations) > 1 else 0) if accelerations else 0.0)),
            "mean_jerk": float(np.mean(jerks)) if jerks else 15000.0,
            "std_jerk": float(max(5000.0, (np.mean(jerks) * 0.30) if jerks else 3000.0, np.std(jerks, ddof=1 if len(jerks) > 1 else 0) if jerks else 0.0)),
            "mean_tortuosity": float(np.mean(tortuosities)) if tortuosities else 1.15,
            "std_tortuosity": float(max(0.20, (np.mean(tortuosities) * 0.20) if tortuosities else 0.15, np.std(tortuosities, ddof=1 if len(tortuosities) > 1 else 0) if tortuosities else 0.0)),
            "fitts_a": round(fitts_a, 2),
            "fitts_b": round(fitts_b, 2)
        }

        # 3. Cognitive (Stroop) Baseline
        stroop_reaction_times = []
        for sample in samples:
            for trial in sample.stroop_trials:
                if trial.is_correct and trial.reaction_time_ms > 100:
                    stroop_reaction_times.append(trial.reaction_time_ms)

        cognitive_baseline = {
            "mean_reaction_ms": float(np.mean(stroop_reaction_times)) if stroop_reaction_times else 550.0,
            "std_reaction_ms": float(max(30.0, np.std(stroop_reaction_times, ddof=1 if len(stroop_reaction_times) > 1 else 0))) if stroop_reaction_times else 85.0,
            "samples": len(stroop_reaction_times)
        }

        return keystroke_baseline, motor_baseline, cognitive_baseline

    # -------------------------------------------------------------------------
    # Bot & Automation Integrity Checks
    # -------------------------------------------------------------------------

    @staticmethod
    def detect_bot_anomalies(
        keystrokes: List[KeystrokeEvent],
        mouse_events: List[MouseEvent]
    ) -> Tuple[bool, List[str]]:
        """
        Evaluates low-level browser automation indicators:
        - `isTrusted == False` (synthetic JS dispatchEvent injection)
        - Zero micro-jitter linear trajectories (perfect collinearity or zero acceleration variance)
        - Impossible keypress dwell times (<10ms)
        - Unnatural robotic uniform pacing (dwell variance < 0.8ms)
        """
        reasons = []
        is_bot = False

        # 1. Inspect DOM isTrusted property
        for k in keystrokes:
            # In web clients, synthetic events often lack trust or are simulated
            pass

        for m in mouse_events:
            if not m.is_trusted:
                is_bot = True
                reasons.append("Synthetic event detected: DOM event.isTrusted is false (automation or script injection)")
                break

        # 2. Keypress temporal feasibility
        if keystrokes:
            dwells = []
            for k in keystrokes:
                dwell = k.up_time - k.down_time
                dwells.append(dwell)
                if dwell < 10.0:
                    is_bot = True
                    reasons.append(f"Impossible keypress dwell time on '{k.key}': {dwell:.1f}ms (<10ms physical threshold)")
                    break

            # Uniform robotic cadence (e.g. script doing fixed sleep(50ms))
            if len(dwells) >= 5:
                dwell_std = float(np.std(dwells))
                if dwell_std < 0.8:
                    is_bot = True
                    reasons.append(f"Robotic cadence detected: keystroke dwell variance is unnaturally uniform (σ = {dwell_std:.2f}ms)")

        # 3. Mouse trajectory linearity and micro-jitter check
        if len(mouse_events) >= 5:
            coords = np.array([[m.x, m.y] for m in mouse_events], dtype=float)
            start_p = coords[0]
            end_p = coords[-1]
            total_disp = np.linalg.norm(end_p - start_p)

            if total_disp > 40.0:
                # Calculate perpendicular distance of each point to the straight line between start and end
                line_vec = end_p - start_p
                line_len = np.linalg.norm(line_vec)
                if line_len > 0:
                    line_unit = line_vec / line_len
                    # Vector from start to point
                    pt_vecs = coords - start_p
                    # Projection length onto line
                    proj_lens = np.dot(pt_vecs, line_unit)
                    proj_points = start_p + np.outer(proj_lens, line_unit)
                    # Lateral displacement distance
                    perp_dists = np.linalg.norm(coords - proj_points, axis=1)
                    lateral_std = float(np.std(perp_dists))

                    if lateral_std < 0.15:
                        is_bot = True
                        reasons.append(f"Linear trajectory bot detected: cursor path has 0 micro-jitter (lateral σ = {lateral_std:.3f}px)")

        return is_bot, reasons

    # -------------------------------------------------------------------------
    # Kinematics Computation
    # -------------------------------------------------------------------------

    @staticmethod
    def compute_kinematics(mouse_events: List[MouseEvent]) -> Dict[str, float]:
        """
        Derives velocity, acceleration, jerk, and path tortuosity from mouse points.
        """
        if len(mouse_events) < 2:
            return {
                "mean_velocity": 0.0,
                "mean_acceleration": 0.0,
                "mean_jerk": 0.0,
                "tortuosity": 1.0,
                "path_length": 0.0,
                "displacement": 0.0
            }

        coords = np.array([[m.x, m.y] for m in mouse_events], dtype=float)
        times = np.array([m.t for m in mouse_events], dtype=float)

        # Distances between consecutive points
        diffs = np.diff(coords, axis=0)
        dt = np.diff(times)
        # Prevent division by zero: minimum 1.0ms dt
        dt = np.where(dt <= 0.0, 1.0, dt)

        distances = np.linalg.norm(diffs, axis=1)
        path_length = float(np.sum(distances))
        displacement = float(np.linalg.norm(coords[-1] - coords[0]))

        # Tortuosity ratio: Total Path Length / Straight-line Euclidean Distance
        tortuosity = float(path_length / max(1.0, displacement))

        # Velocities: px / sec
        velocities = (distances / (dt / 1000.0))
        mean_vel = float(np.mean(velocities)) if len(velocities) > 0 else 0.0

        # Accelerations: px / sec^2
        if len(velocities) >= 2:
            dv = np.diff(velocities)
            dt_acc = dt[:-1]
            accelerations = np.abs(dv / (dt_acc / 1000.0))
            mean_acc = float(np.mean(accelerations)) if len(accelerations) > 0 else 0.0
        else:
            mean_acc = 0.0

        # Jerk: px / sec^3
        if len(velocities) >= 3:
            da = np.diff(accelerations)
            dt_jerk = dt[:-2]
            jerks = np.abs(da / (dt_jerk / 1000.0))
            mean_jerk = float(np.mean(jerks)) if len(jerks) > 0 else 0.0
        else:
            mean_jerk = 0.0

        return {
            "mean_velocity": mean_vel,
            "mean_acceleration": mean_acc,
            "mean_jerk": mean_jerk,
            "tortuosity": tortuosity,
            "path_length": path_length,
            "displacement": displacement
        }

    # -------------------------------------------------------------------------
    # Keystroke Deviation Evaluation
    # -------------------------------------------------------------------------

    @staticmethod
    def evaluate_keystroke_dynamics(
        keystrokes: List[KeystrokeEvent],
        baseline: Dict[str, Any]
    ) -> Tuple[float, List[str], Dict[str, Any]]:
        """
        Calculates feature-wise Z-score deviations against baseline:
        Z_i = |T_i - mu_i| / sigma_i
        Composite average deviation: bar(Z) = 1/N * sum(Z_i)
        Score = max(0, 100 * exp(-bar(Z) / 2))

        Identifies transitions where Z_i > 2.5 for explainability.
        """
        if not keystrokes:
            return 50.0, ["No keystroke telemetry available."], {}

        dwell_baseline = baseline.get("dwell", {})
        flight_baseline = baseline.get("flight", {})

        z_scores = []
        anomalies = []
        transition_details = []

        # 1. Dwell times
        for k in keystrokes:
            dwell = max(5.0, k.up_time - k.down_time)
            key_name = k.key.lower()
            if key_name in dwell_baseline:
                mu = dwell_baseline[key_name]["mean"]
                sigma = max(SIGMA_MIN_FLOOR, dwell_baseline[key_name]["std"])
                z = abs(dwell - mu) / sigma
                z_scores.append(z)
                transition_details.append({
                    "type": "dwell",
                    "element": key_name,
                    "observed_ms": round(dwell, 1),
                    "baseline_mean": mu,
                    "baseline_sigma": sigma,
                    "z_score": round(z, 2)
                })

                if z > Z_SCORE_ANOMALY_THRESHOLD:
                    anomalies.append(
                        f"Dwell anomaly on '{key_name}': {dwell:.1f}ms vs baseline {mu:.1f}ms "
                        f"({'+' if dwell > mu else '-'}{z:.1f}σ deviation)"
                    )

        # 2. Inter-key flight times
        for i in range(len(keystrokes) - 1):
            k1 = keystrokes[i].key.lower()
            k2 = keystrokes[i + 1].key.lower()
            transition = f"{k1}->{k2}"
            flight = keystrokes[i + 1].down_time - keystrokes[i].up_time

            if transition in flight_baseline:
                mu = flight_baseline[transition]["mean"]
                sigma = max(SIGMA_MIN_FLOOR, flight_baseline[transition]["std"])
                z = abs(flight - mu) / sigma
                z_scores.append(z)
                transition_details.append({
                    "type": "flight",
                    "element": transition,
                    "observed_ms": round(flight, 1),
                    "baseline_mean": mu,
                    "baseline_sigma": sigma,
                    "z_score": round(z, 2)
                })

                if z > Z_SCORE_ANOMALY_THRESHOLD:
                    anomalies.append(
                        f"Cadence mismatch between '{k1}' and '{k2}': {flight:.1f}ms vs baseline {mu:.1f}ms "
                        f"({'+' if flight > mu else '-'}{z:.1f}σ deviation)"
                    )

        if not z_scores:
            # Unseen sequence or insufficient key baseline
            return 60.0, ["Passphrase keys partially novel compared to calibration vector."], {}

        mean_z = float(np.mean(z_scores))
        # Confidence mapping: Score = max(0, 100 * exp(-mean_z / 2))
        score = float(max(0.0, min(100.0, 100.0 * math.exp(-mean_z / 2.0))))

        return round(score, 1), anomalies, {
            "mean_z_score": round(mean_z, 2),
            "total_evaluated_features": len(z_scores),
            "transitions": transition_details
        }

    # -------------------------------------------------------------------------
    # Motor Kinematics Evaluation
    # -------------------------------------------------------------------------

    @staticmethod
    def evaluate_motor_kinematics(
        mouse_events: List[MouseEvent],
        baseline: Dict[str, Any],
        button_context: Optional[Dict[str, Any]] = None
    ) -> Tuple[float, List[str], Dict[str, Any]]:
        """
        Evaluates mouse kinematics against baseline distributions and validates Fitts's Law.
        """
        if len(mouse_events) < 3:
            return 70.0, [], {"info": "Limited mouse movement captured"}

        kin = BiometricsEngine.compute_kinematics(mouse_events)
        reasons = []
        deviations = []

        # Velocity Z-score with effective physiological floor
        mu_v = float(baseline.get("mean_velocity", 450.0))
        std_v = float(max(baseline.get("std_velocity", 120.0), mu_v * 0.30, 100.0))
        z_v = min(4.0, abs(kin["mean_velocity"] - mu_v) / std_v)
        deviations.append(z_v)

        # Acceleration Z-score with effective physiological floor
        mu_a = float(baseline.get("mean_acceleration", 1800.0))
        std_a = float(max(baseline.get("std_acceleration", 400.0), mu_a * 0.40, 1200.0))
        z_a = min(4.0, abs(kin["mean_acceleration"] - mu_a) / std_a)
        deviations.append(z_a)

        # Tortuosity Z-score with effective physiological floor
        mu_t = float(baseline.get("mean_tortuosity", 1.15))
        std_t = float(max(baseline.get("std_tortuosity", 0.12), mu_t * 0.25, 0.20))
        z_t = min(4.0, abs(kin["tortuosity"] - mu_t) / std_t)
        deviations.append(z_t)

        if z_v > 2.8:
            reasons.append(
                f"Cursor velocity deviation: {kin['mean_velocity']:.0f}px/s vs baseline {mu_v:.0f}px/s ({z_v:.1f}σ)"
            )
        if z_t > 3.0:
            reasons.append(
                f"Cursor curvature anomaly: tortuosity {kin['tortuosity']:.2f} vs baseline {mu_t:.2f} ({z_t:.1f}σ)"
            )

        # Fitts's Law Check if button target context was captured
        fitts_checked = False
        fitts_a = float(baseline.get("fitts_a", 150.0))
        fitts_b = float(baseline.get("fitts_b", 85.0))

        if button_context and "target_distance" in button_context and "target_width" in button_context:
            dist = float(button_context["target_distance"])
            width = float(button_context["target_width"])
            obs_mt = float(button_context.get("movement_time_ms", kin.get("path_length", 100) / max(0.1, kin["mean_velocity"]) * 1000.0))

            if dist > 20 and width > 5:
                fitts_checked = True
                id_val = math.log2((2.0 * dist) / width)
                exp_mt = fitts_a + (fitts_b * id_val)
                # Relative difference
                diff_ratio = abs(obs_mt - exp_mt) / max(120.0, exp_mt)

                if diff_ratio > 1.8:
                    reasons.append(
                        f"Cursor deceleration curve failed Fitts's motor signature check: "
                        f"observed {obs_mt:.0f}ms vs expected {exp_mt:.0f}ms for target ID={id_val:.2f}"
                    )
                    deviations.append(min(3.5, diff_ratio * 1.5))

        avg_dev = float(np.mean(deviations)) if deviations else 0.5
        motor_score = float(max(0.0, min(100.0, 100.0 * math.exp(-avg_dev / 2.4))))

        return round(motor_score, 1), reasons, {
            "kinematics": kin,
            "average_deviation": round(avg_dev, 2),
            "fitts_checked": fitts_checked
        }

    # -------------------------------------------------------------------------
    # Comprehensive Verification Engine Pipeline
    # -------------------------------------------------------------------------

    @classmethod
    def verify(
        cls,
        keystrokes: List[KeystrokeEvent],
        mouse_events: List[MouseEvent],
        baseline_profile: Dict[str, Any],
        button_context: Optional[Dict[str, Any]] = None
    ) -> VerificationResponse:
        """
        Executes end-to-end multi-factor verification pipeline in under 50ms.
        """
        t_start = time.perf_counter()
        explainability_reasons = []

        # 1. Bot & Automation Heuristics
        bot_detected, bot_reasons = cls.detect_bot_anomalies(keystrokes, mouse_events)
        if bot_reasons:
            explainability_reasons.extend(bot_reasons)

        # 2. Keystroke Dynamics Matching
        keystroke_baseline = baseline_profile.get("keystroke_baseline", {})
        key_score, key_reasons, key_details = cls.evaluate_keystroke_dynamics(
            keystrokes, keystroke_baseline
        )
        explainability_reasons.extend(key_reasons)

        # 3. Mouse Kinematics & Fitts's Law
        motor_baseline = baseline_profile.get("motor_baseline", {})
        motor_score, motor_reasons, motor_details = cls.evaluate_motor_kinematics(
            mouse_events, motor_baseline, button_context
        )
        explainability_reasons.extend(motor_reasons)

        # 4. Cognitive Baseline Match (Stroop)
        cognitive_baseline = baseline_profile.get("cognitive_baseline", {})
        # Baseline cognitive score default
        cog_score = 85.0
        if "login_hesitation_ms" in (button_context or {}):
            obs_hesitation = float(button_context["login_hesitation_ms"])
            mu_cog = cognitive_baseline.get("mean_reaction_ms", 550.0)
            std_cog = cognitive_baseline.get("std_reaction_ms", 85.0)
            z_cog = abs(obs_hesitation - mu_cog) / max(30.0, std_cog)
            cog_score = float(max(0.0, min(100.0, 100.0 * math.exp(-z_cog / 2.0))))
            if z_cog > 2.6:
                explainability_reasons.append(
                    f"Cognitive hesitation deviation: {obs_hesitation:.0f}ms vs baseline {mu_cog:.0f}ms ({z_cog:.1f}σ)"
                )

        # 5. Composite Fusion & Decision Logic
        if bot_detected:
            composite_score = 0.0
            authenticated = False
            bot_match = 0.0
        else:
            bot_match = 100.0
            # Multi-modal fusion weights: 50% Keystroke, 35% Motor, 15% Cognitive
            if keystrokes and len(mouse_events) >= 3:
                composite_score = (0.50 * key_score) + (0.35 * motor_score) + (0.15 * cog_score)
            elif keystrokes:
                composite_score = (0.80 * key_score) + (0.20 * cog_score)
            elif len(mouse_events) >= 3:
                composite_score = (0.75 * motor_score) + (0.25 * cog_score)
            else:
                composite_score = 50.0

            authenticated = composite_score >= CONFIDENCE_THRESHOLD

        # If authenticated, clarify in reasons if empty
        if authenticated and not explainability_reasons:
            explainability_reasons.append("Cadence and motor dynamics closely adhere to enrolled biometric signature.")

        t_elapsed_ms = (time.perf_counter() - t_start) * 1000.0

        signals = SignalsBreakdown(
            bot_detected=bot_detected,
            keystroke_rhythm_match=round(key_score, 1),
            motor_kinematics_match=round(motor_score, 1),
            cognitive_delay_match=round(cog_score, 1)
        )

        return VerificationResponse(
            authenticated=authenticated,
            confidence_score=round(composite_score, 1),
            latency_ms=round(t_elapsed_ms, 2),
            signals=signals,
            explainability_reasons=explainability_reasons,
            details={
                "keystroke": key_details,
                "motor": motor_details
            }
        )
