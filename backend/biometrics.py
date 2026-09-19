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
    DragGestureEvent,
    StroopTrialEvent,
    EnrollmentSample,
    SignalsBreakdown,
    VerificationResponse,
)

# Standard deviation floors (milliseconds) to prevent zero-variance divisions
SIGMA_MIN_FLOOR = 15.0
SIGMA_DWELL_FLOOR = 15.0
SIGMA_FLIGHT_FLOOR = 25.0
MAX_FLIGHT_PAUSE_MS = 550.0
Z_SCORE_CAP = 3.5
# Decision threshold for granting authentication (0 - 100 scale)
CONFIDENCE_THRESHOLD = 70.0
# Outlier Z-score threshold for generating human-readable explainability
Z_SCORE_ANOMALY_THRESHOLD = 2.8


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
            std_val = float(max(SIGMA_DWELL_FLOOR, np.std(vals, ddof=1 if len(vals) > 1 else 0)))
            keystroke_baseline["dwell"][key] = {
                "mean": round(mean_val, 2),
                "std": round(std_val, 2),
                "samples": len(vals)
            }

        for trans, vals in flight_pools.items():
            mean_val = float(np.mean(vals))
            std_val = float(max(SIGMA_FLIGHT_FLOOR, abs(mean_val) * 0.22, np.std(vals, ddof=1 if len(vals) > 1 else 0)))
            keystroke_baseline["flight"][trans] = {
                "mean": round(mean_val, 2),
                "std": round(std_val, 2),
                "samples": len(vals)
            }

        # 2. Motor & Kinematics Baseline (including Drag-and-Drop gestures)
        velocities = []
        accelerations = []
        jerks = []
        tortuosities = []
        fitts_data_id = []
        fitts_data_mt = []

        # Drag Dynamics pools
        drag_vels = []
        drag_directness = []
        drop_drifts = []
        hold_durations = []
        initial_latencies = []
        drag_distances = []

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

            # Analyze Fitts's Law calibration motor targets if present
            for target in sample.motor_targets:
                movement_time = max(20.0, target.click_t - target.start_t)
                distance = max(10.0, target.distance)
                width = max(10.0, target.width)
                # Fitts's Index of Difficulty: ID = log2(2D / W)
                index_of_difficulty = math.log2((2.0 * distance) / width)
                fitts_data_id.append(index_of_difficulty)
                fitts_data_mt.append(movement_time)

            # Analyze Drag-and-Drop gestures
            for drag in getattr(sample, "drag_gestures", []):
                # Calculate or ingest metrics
                traj = drag.trajectory or []
                if len(traj) >= 2:
                    d_kin = BiometricsEngine.compute_kinematics(traj)
                    v_mean = drag.drag_velocity_mean or d_kin["mean_velocity"]
                    directness = drag.trajectory_directness_ratio or (1.0 / max(1.0, d_kin["tortuosity"]))
                    p_len = max(40.0, d_kin["path_length"])
                else:
                    v_mean = drag.drag_velocity_mean or 400.0
                    directness = drag.trajectory_directness_ratio or 0.88
                    p_len = 180.0

                hold = drag.hold_duration or max(50.0, drag.drop_time - drag.start_time)
                drift = max(0.0, drag.drop_drift_offset)
                init_lat = max(20.0, drag.initial_drag_latency) if drag.initial_drag_latency > 0 else 250.0

                drag_vels.append(v_mean)
                drag_directness.append(directness)
                drop_drifts.append(drift)
                hold_durations.append(hold)
                initial_latencies.append(init_lat)
                drag_distances.append(p_len)

                # Also contribute to overall motor velocity
                if v_mean > 0:
                    velocities.append(v_mean)

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

        # Compile drag baseline distributions with physiological floors
        mean_d_vel = float(np.mean(drag_vels)) if drag_vels else 420.0
        std_d_vel = float(max(100.0, mean_d_vel * 0.30, np.std(drag_vels, ddof=1 if len(drag_vels) > 1 else 0) if drag_vels else 120.0))

        mean_direct = float(np.mean(drag_directness)) if drag_directness else 0.88
        std_direct = float(max(0.08, np.std(drag_directness, ddof=1 if len(drag_directness) > 1 else 0) if drag_directness else 0.12))

        mean_drift = float(np.mean(drop_drifts)) if drop_drifts else 8.5
        std_drift = float(max(3.0, mean_drift * 0.35, np.std(drop_drifts, ddof=1 if len(drop_drifts) > 1 else 0) if drop_drifts else 5.0))

        mean_hold = float(np.mean(hold_durations)) if hold_durations else 450.0
        std_hold = float(max(80.0, mean_hold * 0.25, np.std(hold_durations, ddof=1 if len(hold_durations) > 1 else 0) if hold_durations else 120.0))

        mean_init_lat = float(np.mean(initial_latencies)) if initial_latencies else 280.0
        std_init_lat = float(max(50.0, mean_init_lat * 0.30, np.std(initial_latencies, ddof=1 if len(initial_latencies) > 1 else 0) if initial_latencies else 90.0))

        mean_d_dist = float(np.mean(drag_distances)) if drag_distances else 180.0

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
            "fitts_b": round(fitts_b, 2),
            "drag_dynamics": {
                "drag_velocity_mean": round(mean_d_vel, 1),
                "drag_velocity_std": round(std_d_vel, 1),
                "path_length_mean": round(mean_d_dist, 1),
                "trajectory_directness_mean": round(mean_direct, 3),
                "trajectory_directness_std": round(std_direct, 3),
                "drop_drift_offset_mean": round(mean_drift, 1),
                "drop_drift_offset_std": round(std_drift, 1),
                "hold_duration_mean": round(mean_hold, 1),
                "hold_duration_std": round(std_hold, 1),
                "initial_drag_latency_mean": round(mean_init_lat, 1),
                "initial_drag_latency_std": round(std_init_lat, 1),
                "samples_enrolled": len(drag_vels)
            }
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
        mouse_events: List[MouseEvent],
        drag_gestures: Optional[List[DragGestureEvent]] = None
    ) -> Tuple[bool, List[str]]:
        """
        Evaluates low-level browser automation indicators:
        - `isTrusted == False` (synthetic JS dispatchEvent injection)
        - Zero micro-jitter linear trajectories (perfect collinearity or zero acceleration variance)
        - Impossible keypress dwell times (<10ms)
        - Unnatural robotic uniform pacing (dwell variance < 0.8ms)
        - Drag teleportation (instantaneous drop without intermediate move trajectory)
        """
        reasons = []
        is_bot = False

        # 0. Inspect Drag Gestures for automation and teleportation
        if drag_gestures:
            for dg in drag_gestures:
                # Check hold duration
                duration = dg.hold_duration or (dg.drop_time - dg.start_time)
                traj = dg.trajectory or []

                # Impossible drag speed / teleportation: distance > 40px but duration < 15ms or < 2 intermediate points
                if duration < 15.0:
                    is_bot = True
                    reasons.append(f"Synthetic drag teleportation detected: hold duration {duration:.1f}ms (<15ms physical threshold)")
                    break

                if traj:
                    # Check isTrusted on drag trajectory
                    for p in traj:
                        if not p.is_trusted:
                            is_bot = True
                            reasons.append("Synthetic drag detected: DOM pointer event isTrusted is false")
                            break
                    if is_bot:
                        break

                    # Check for teleportation with missing intermediate movement
                    if len(traj) < 3 and duration < 80.0:
                        start_pt = np.array([traj[0].x, traj[0].y])
                        end_pt = np.array([traj[-1].x, traj[-1].y])
                        if np.linalg.norm(end_pt - start_pt) > 50.0:
                            is_bot = True
                            reasons.append("Instant drag teleportation detected: target reached with no intermediate pointer coordinates")
                            break

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
                sigma = max(SIGMA_DWELL_FLOOR, dwell_baseline[key_name]["std"])
                z = abs(dwell - mu) / sigma
                z_capped = min(Z_SCORE_CAP, z)
                z_scores.append(z_capped)
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
                sigma = max(SIGMA_FLIGHT_FLOOR, abs(mu) * 0.22, flight_baseline[transition]["std"])
                raw_z = abs(flight - mu) / sigma

                # Check for cognitive flow break or hesitation pause (>550ms)
                if flight > MAX_FLIGHT_PAUSE_MS:
                    z_capped = min(2.5, raw_z)
                else:
                    z_capped = min(Z_SCORE_CAP, raw_z)

                z_scores.append(z_capped)
                transition_details.append({
                    "type": "flight",
                    "element": transition,
                    "observed_ms": round(flight, 1),
                    "baseline_mean": mu,
                    "baseline_sigma": sigma,
                    "z_score": round(raw_z, 2)
                })

                if raw_z > Z_SCORE_ANOMALY_THRESHOLD:
                    anomalies.append(
                        f"Cadence mismatch between '{k1}' and '{k2}': {flight:.1f}ms vs baseline {mu:.1f}ms "
                        f"({'+' if flight > mu else '-'}{raw_z:.1f}σ deviation)"
                    )

        if not z_scores:
            # Unseen sequence or insufficient key baseline
            return 60.0, ["Passphrase keys partially novel compared to calibration vector."], {}

        # Outlier-resilient scoring: Trim top 10% extreme outliers (e.g. typing flow breaks/pauses)
        sorted_z = sorted(z_scores)
        if len(sorted_z) >= 8:
            n_trim = max(1, int(len(sorted_z) * 0.10))
            eval_z = sorted_z[:-n_trim]
        else:
            eval_z = sorted_z

        mean_z = float(np.mean(eval_z))
        score = float(max(0.0, min(100.0, 100.0 * math.exp(-mean_z / 3.5))))

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

        # Scale expected velocity by movement distance if target context is provided
        if button_context and "target_distance" in button_context:
            dist = float(button_context["target_distance"])
            base_dist = float(baseline.get("drag_dynamics", {}).get("path_length_mean", 180.0))
            dist_scale = max(0.5, min(2.8, dist / max(40.0, base_dist)))
            mu_v = mu_v * dist_scale
            std_v = max(std_v * dist_scale, mu_v * 0.35, 120.0)

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
        motor_score = float(max(0.0, min(100.0, 100.0 * math.exp(-avg_dev / 3))))

        return round(motor_score, 1), reasons, {
            "kinematics": kin,
            "average_deviation": round(avg_dev, 2),
            "fitts_checked": fitts_checked
        }

    # -------------------------------------------------------------------------
    # Drag Dynamics Evaluation
    # -------------------------------------------------------------------------

    @staticmethod
    def evaluate_drag_dynamics(
        drag_gestures: List[DragGestureEvent],
        baseline: Dict[str, Any]
    ) -> Tuple[float, List[str], Dict[str, Any]]:
        """
        Evaluates drag-and-drop gesture dynamics (velocity, directness ratio, drift offset, hold duration)
        against enrolled baseline distributions using feature-wise Z-score deviations:
        Z = |x - mu| / sigma
        """
        if not drag_gestures:
            return 75.0, [], {"info": "No drag gestures provided"}

        drag_base = baseline.get("drag_dynamics", {})
        reasons = []
        deviations = []
        gesture_reports = []

        base_dist = float(drag_base.get("path_length_mean", 180.0))
        mu_v = float(drag_base.get("drag_velocity_mean", baseline.get("mean_velocity", 420.0)))
        std_v = float(max(drag_base.get("drag_velocity_std", 120.0), mu_v * 0.30, 80.0))

        mu_dir = float(drag_base.get("trajectory_directness_mean", 0.88))
        std_dir = float(max(drag_base.get("trajectory_directness_std", 0.12), 0.08))

        mu_drift = float(drag_base.get("drop_drift_offset_mean", 8.5))
        std_drift = float(max(drag_base.get("drop_drift_offset_std", 5.0), mu_drift * 0.35, 3.0))

        mu_hold = float(drag_base.get("hold_duration_mean", 450.0))
        std_hold = float(max(drag_base.get("hold_duration_std", 120.0), mu_hold * 0.25, 80.0))

        for idx, g in enumerate(drag_gestures):
            # Derive metrics if trajectory is available
            traj = g.trajectory or []
            if len(traj) >= 2:
                kin = BiometricsEngine.compute_kinematics(traj)
                obs_v = g.drag_velocity_mean or kin["mean_velocity"]
                obs_dir = g.trajectory_directness_ratio or (1.0 / max(1.0, kin["tortuosity"]))
                obs_dist = max(40.0, kin["path_length"])
            else:
                obs_v = g.drag_velocity_mean or mu_v
                obs_dir = g.trajectory_directness_ratio or mu_dir
                obs_dist = base_dist

            obs_hold = g.hold_duration or max(40.0, g.drop_time - g.start_time)
            obs_drift = max(0.0, g.drop_drift_offset)

            # Distance-normalized velocity scaling according to Fitts's Law (v proportional to distance D)
            dist_scale = max(0.5, min(2.8, obs_dist / max(40.0, base_dist)))
            exp_v = mu_v * dist_scale
            exp_std_v = max(std_v * dist_scale, exp_v * 0.35, 120.0)

            # 1. Velocity Z-score
            z_v = min(4.0, abs(obs_v - exp_v) / exp_std_v)
            deviations.append(z_v)

            # 2. Trajectory Directness Z-score
            z_dir = min(4.0, abs(obs_dir - mu_dir) / std_dir)
            deviations.append(z_dir)

            # 3. Drop Drift Offset Z-score
            z_drift = min(4.0, abs(obs_drift - mu_drift) / std_drift)
            deviations.append(z_drift)

            # 4. Hold Duration Z-score
            hold_scale = 1.0 + (0.25 * (dist_scale - 1.0))
            exp_hold = mu_hold * hold_scale
            exp_std_hold = max(std_hold * hold_scale, exp_hold * 0.30, 80.0)
            z_hold = min(4.0, abs(obs_hold - exp_hold) / exp_std_hold)
            deviations.append(z_hold)

            gesture_reports.append({
                "shape": g.shape_type,
                "velocity_px_s": round(obs_v, 1),
                "expected_velocity_px_s": round(exp_v, 1),
                "z_velocity": round(z_v, 2),
                "directness_ratio": round(obs_dir, 3),
                "z_directness": round(z_dir, 2),
                "drift_px": round(obs_drift, 1),
                "z_drift": round(z_drift, 2),
                "hold_ms": round(obs_hold, 1),
                "z_hold": round(z_hold, 2)
            })

            if z_v > 2.8:
                reasons.append(
                    f"Drag velocity anomaly on {g.shape_type}: {obs_v:.0f}px/s vs expected {exp_v:.0f}px/s ({z_v:.1f}σ)"
                )
            if z_dir > 2.8:
                reasons.append(
                    f"Drag curvature directness anomaly on {g.shape_type}: {obs_dir:.2f} vs baseline {mu_dir:.2f} ({z_dir:.1f}σ)"
                )
            if z_drift > 3.0:
                reasons.append(
                    f"Drop accuracy drift anomaly on {g.shape_type}: {obs_drift:.1f}px vs baseline {mu_drift:.1f}px ({z_drift:.1f}σ)"
                )

        mean_dev = float(np.mean(deviations)) if deviations else 0.4
        # Exponential scoring falloff
        score = float(max(0.0, min(100.0, 100.0 * math.exp(-mean_dev / 3.0))))

        return round(score, 1), reasons, {
            "average_deviation": round(mean_dev, 2),
            "gestures": gesture_reports,
            "baseline_used": {
                "velocity_mean": mu_v,
                "directness_mean": mu_dir,
                "drift_mean": mu_drift,
                "hold_mean": mu_hold
            }
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
        button_context: Optional[Dict[str, Any]] = None,
        drag_gestures: Optional[List[DragGestureEvent]] = None
    ) -> VerificationResponse:
        """
        Executes end-to-end multi-factor verification pipeline in under 50ms.
        Supports Keystroke Dynamics, Mouse Kinematics, and Drag-and-Drop Dynamics.
        """
        t_start = time.perf_counter()
        explainability_reasons = []
        all_drags = drag_gestures or []

        # 1. Bot & Automation Heuristics
        bot_detected, bot_reasons = cls.detect_bot_anomalies(keystrokes, mouse_events, all_drags)
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
        # When a drag gesture is present, its trajectory is the physical motor challenge.
        # Ambient cursor movements while filling form fields are checked for bots in step 1,
        # but the task kinematics evaluation uses the drag gesture trajectory.
        if all_drags and all_drags[0].trajectory and len(all_drags[0].trajectory) >= 3:
            motor_events_to_eval = all_drags[0].trajectory
            g = all_drags[0]
            if not button_context and len(g.trajectory) >= 2:
                button_context = {
                    "target_distance": math.hypot(g.trajectory[-1].x - g.trajectory[0].x, g.trajectory[-1].y - g.trajectory[0].y),
                    "target_width": 78.0,
                    "movement_time_ms": max(40.0, g.drop_time - g.start_time)
                }
        else:
            motor_events_to_eval = mouse_events

        motor_score, motor_reasons, motor_details = cls.evaluate_motor_kinematics(
            motor_events_to_eval, motor_baseline, button_context
        )
        explainability_reasons.extend(motor_reasons)

        # 4. Drag Dynamics Matching
        drag_score, drag_reasons, drag_details = cls.evaluate_drag_dynamics(
            all_drags, motor_baseline
        )
        explainability_reasons.extend(drag_reasons)

        # 5. Cognitive Baseline Match (Stroop) - Temporarily inactive for login
        cog_score = 100.0  # Inactive on standard login forms

        # 6. Composite Fusion & Decision Logic
        if bot_detected:
            composite_score = 0.0
            authenticated = False
            bot_match = 0.0
        else:
            bot_match = 100.0
            # Multi-modal fusion:
            # If drag gesture provided: Keystroke (50%), Drag Dynamics (35%), Motor (15%)
            # If no drag gesture: Keystroke (60%), Motor (40%)
            if all_drags and keystrokes:
                composite_score = (0.50 * key_score) + (0.35 * drag_score) + (0.15 * motor_score)
            elif all_drags:
                composite_score = (0.75 * drag_score) + (0.25 * motor_score)
            elif keystrokes and len(mouse_events) >= 3:
                composite_score = (0.60 * key_score) + (0.40 * motor_score)
            elif keystrokes:
                composite_score = key_score
            elif len(mouse_events) >= 3:
                composite_score = motor_score
            else:
                composite_score = 50.0

            authenticated = composite_score >= CONFIDENCE_THRESHOLD

        # Deduplicate reasons preserving order
        seen_r = set()
        deduped_reasons = []
        for r in explainability_reasons:
            if r not in seen_r:
                seen_r.add(r)
                deduped_reasons.append(r)
        explainability_reasons = deduped_reasons

        # If authenticated, clarify in reasons if empty
        if authenticated and not explainability_reasons:
            explainability_reasons.append("Cadence, drag gesture, and motor dynamics closely adhere to enrolled biometric signature.")

        t_elapsed_ms = (time.perf_counter() - t_start) * 1000.0

        signals = SignalsBreakdown(
            bot_detected=bot_detected,
            keystroke_rhythm_match=round(key_score, 1),
            motor_kinematics_match=round(motor_score, 1),
            drag_dynamics_match=round(drag_score, 1),
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
                "motor": motor_details,
                "drag": drag_details
            }
        )
