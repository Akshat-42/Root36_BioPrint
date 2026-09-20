"""
BioPrint Behavioral Biometrics Engine (V2)
=========================================
Secure user authentication, Argon2id/bcrypt salted hashing, universal typing
dynamics (QWERTY hand-switch ratio, key cluster dwell matrix, spacebar boundary
latency, inter-keystroke entropy, error dynamics), psychomotor kinematics
(tortuosity, velocity bell-curve symmetry, acceleration variance, docking latency),
bot heuristics, and diagnostic explainability.
"""

import math
import time
from typing import List, Dict, Tuple, Any, Optional, Set
import numpy as np
from passlib.context import CryptContext

from backend.models import (
    KeystrokeEvent,
    MouseEvent,
    DragGestureEvent,
    TypingSessionTelemetry,
    SignalsBreakdown,
    VerificationResponse,
    BrowserIntegrity,
)

# Password Hashing CryptContext (Argon2id default with bcrypt compatibility)
pwd_context = CryptContext(schemes=["argon2", "bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """Generates a secure, salted Argon2id password hash."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain password against the salted Argon2id/bcrypt hash."""
    if not hashed_password or not plain_password:
        return False
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        return False


# =============================================================================
# Keyboard Ergonomics & Layout Mappings (Standard QWERTY)
# =============================================================================
LEFT_HAND_KEYS: Set[str] = {
    'q', 'w', 'e', 'r', 't',
    'a', 's', 'd', 'f', 'g',
    'z', 'x', 'c', 'v', 'b'
}

RIGHT_HAND_KEYS: Set[str] = {
    'y', 'u', 'i', 'o', 'p',
    'h', 'j', 'k', 'l',
    'n', 'm'
}

VOWEL_KEYS: Set[str] = {'a', 'e', 'i', 'o', 'u'}
TOP_ROW_KEYS: Set[str] = {'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'}
HOME_ROW_KEYS: Set[str] = {'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'}
BOTTOM_ROW_KEYS: Set[str] = {'z', 'x', 'c', 'v', 'b', 'n', 'm'}

# Physiological Variance Floors (Calibrated for Natural Human Inter-Session Variance)
SIGMA_DWELL_FLOOR = 25.0     # Key dwell minimum variance floor (ms)
SIGMA_FLIGHT_FLOOR = 55.0    # Flight latency minimum variance floor (ms)
MAX_CONTINUOUS_FLIGHT_MS = 350.0  # Max threshold for continuous typing transition (above this is cognitive pause)
Z_SCORE_CAP = 3.5            # Winsorization cap to prevent extreme skew
CONFIDENCE_THRESHOLD = 70.0  # Authentication decision cutoff (%) - strict security threshold
Z_SCORE_ANOMALY_THRESHOLD = 2.5  # Threshold for explainability diagnostic trigger


class BiometricsEngine:
    """
    Core scientific behavioral biometrics engine for BioPrint V2.
    """

    # -------------------------------------------------------------------------
    # 1. Feature Extraction: Universal Typing Dynamics
    # -------------------------------------------------------------------------

    @staticmethod
    def extract_universal_typing_features(keystrokes: List[KeystrokeEvent]) -> Dict[str, float]:
        """
        Extracts universal psychomotor typing dynamics from arbitrary text:
        - Hand-Switch Ratio (R_hand: cross-hand vs same-hand transition latency)
        - Key Cluster Dwell Matrix (vowels, top row, home row, bottom row)
        - Word-Boundary Saccade Delay (inter-key flight preceding Spacebar)
        - Inter-Keystroke Interval Entropy (Coefficient of variation: CV = sigma / mu)
        - Error Dynamics (Backspace frequency ratio and error recovery speed)
        """
        if not keystrokes:
            return {
                "hand_switch_ratio": 0.85,
                "dwell_vowels": 85.0,
                "dwell_top_row": 88.0,
                "dwell_home_row": 82.0,
                "dwell_bottom_row": 90.0,
                "spacebar_saccade_delay": 160.0,
                "flight_entropy_cv": 0.45,
                "backspace_ratio": 0.0,
                "error_recovery_ms": 180.0
            }

        dwells = []
        dwells_vowels = []
        dwells_top = []
        dwells_home = []
        dwells_bottom = []

        cross_hand_flights = []
        same_hand_flights = []
        spacebar_flights = []
        all_flights = []
        backspace_count = 0
        error_recovery_flights = []

        for i, k in enumerate(keystrokes):
            dwell = max(10.0, k.up_time - k.down_time)
            key_char = k.key.lower()

            if key_char == "backspace" or (k.code and "backspace" in k.code.lower()):
                backspace_count += 1
                # Check error recovery time to next key
                if i < len(keystrokes) - 1:
                    rec_flight = keystrokes[i + 1].down_time - k.up_time
                    if 0 < rec_flight < 1500.0:
                        error_recovery_flights.append(rec_flight)
                continue

            dwells.append(dwell)
            if key_char in VOWEL_KEYS:
                dwells_vowels.append(dwell)
            if key_char in TOP_ROW_KEYS:
                dwells_top.append(dwell)
            if key_char in HOME_ROW_KEYS:
                dwells_home.append(dwell)
            if key_char in BOTTOM_ROW_KEYS:
                dwells_bottom.append(dwell)

            # Flight transitions to next key
            if i < len(keystrokes) - 1:
                next_k = keystrokes[i + 1]
                next_char = next_k.key.lower()
                flight = next_k.down_time - k.up_time

                # Continuous typing filter: exclude multi-second cognitive freezes/distractions
                if -60.0 <= flight <= MAX_CONTINUOUS_FLIGHT_MS:
                    effective_flight = max(15.0, flight)
                    all_flights.append(effective_flight)

                    # Word boundary saccade (flight preceding space)
                    if next_char in (" ", "space") or (next_k.code and "space" in next_k.code.lower()):
                        spacebar_flights.append(effective_flight)

                    # Hand-switch classification (QWERTY alphanumeric only)
                    is_k_left = key_char in LEFT_HAND_KEYS
                    is_k_right = key_char in RIGHT_HAND_KEYS
                    is_next_left = next_char in LEFT_HAND_KEYS
                    is_next_right = next_char in RIGHT_HAND_KEYS

                    if (is_k_left and is_next_right) or (is_k_right and is_next_left):
                        cross_hand_flights.append(effective_flight)
                    elif (is_k_left and is_next_left) or (is_k_right and is_next_right):
                        same_hand_flights.append(effective_flight)

        # Robust Median Hand-Switch Ratio
        med_cross = float(np.median(cross_hand_flights)) if cross_hand_flights else 75.0
        med_same = float(np.median(same_hand_flights)) if same_hand_flights else 85.0
        r_hand = float(med_cross / max(25.0, med_same))

        # Dwell Clusters
        mean_vowels = float(np.mean(dwells_vowels)) if dwells_vowels else float(np.mean(dwells) if dwells else 85.0)
        mean_top = float(np.mean(dwells_top)) if dwells_top else float(np.mean(dwells) if dwells else 88.0)
        mean_home = float(np.mean(dwells_home)) if dwells_home else float(np.mean(dwells) if dwells else 82.0)
        mean_bottom = float(np.mean(dwells_bottom)) if dwells_bottom else float(np.mean(dwells) if dwells else 90.0)

        # Spacebar Saccade Latency (Robust Median)
        mean_space = float(np.median(spacebar_flights)) if spacebar_flights else 165.0

        # Flight Entropy (Coefficient of Variation on continuous flights)
        if len(all_flights) >= 3:
            f_mean = max(25.0, float(np.mean(all_flights)))
            f_std = float(np.std(all_flights))
            cv_entropy = float(f_std / f_mean)
        else:
            cv_entropy = 0.42

        # Error Dynamics
        backspace_ratio = float(backspace_count / max(1, len(keystrokes)))
        mean_recovery = float(np.median(error_recovery_flights)) if error_recovery_flights else 190.0

        return {
            "hand_switch_ratio": round(r_hand, 3),
            "dwell_vowels": round(mean_vowels, 1),
            "dwell_top_row": round(mean_top, 1),
            "dwell_home_row": round(mean_home, 1),
            "dwell_bottom_row": round(mean_bottom, 1),
            "spacebar_saccade_delay": round(mean_space, 1),
            "flight_entropy_cv": round(cv_entropy, 3),
            "backspace_ratio": round(backspace_ratio, 3),
            "error_recovery_ms": round(mean_recovery, 1)
        }

    # -------------------------------------------------------------------------
    # 2. Feature Extraction: Motor Kinematic Dynamics & Spectral Tremor
    # -------------------------------------------------------------------------

    @staticmethod
    def extract_saccadic_notch_pause(
        trajectory: List[MouseEvent], 
        notch_x: Optional[float] = None, 
        notch_y: Optional[float] = None
    ) -> Tuple[float, float, float]:
        """
        Extracts ocular-motor coordination features around track detour notch:
        - saccadic_dip_ratio: min_velocity_in_notch / max_approach_velocity
        - saccadic_pause_ms: dwell duration in deceleration valley
        - approach_deceleration: magnitude of deceleration entering the notch
        """
        if len(trajectory) < 4:
            return 0.45, 75.0, 450.0

        coords = np.array([[m.x, m.y] for m in trajectory], dtype=float)
        times = np.array([m.t for m in trajectory], dtype=float)

        diffs = np.diff(coords, axis=0)
        dt = np.diff(times) / 1000.0  # seconds
        dt = np.where(dt <= 0.0, 0.001, dt)

        step_dists = np.linalg.norm(diffs, axis=1)
        step_vels = step_dists / dt

        # Determine notch reference X: if not provided, assume halfway through horizontal travel
        x_start = coords[0, 0]
        x_end = coords[-1, 0]
        x_min = min(x_start, x_end)
        x_max = max(x_start, x_end)
        x_range = max(1.0, x_max - x_min)

        target_nx = notch_x if (notch_x is not None and x_min <= notch_x <= x_max) else (x_min + 0.50 * x_range)

        # Notch zone: within 20% of travel range around notch X
        zone_radius = max(20.0, 0.20 * x_range)
        mid_x = (coords[:-1, 0] + coords[1:, 0]) / 2.0

        in_notch_mask = np.abs(mid_x - target_nx) <= zone_radius
        before_notch_mask = (mid_x < (target_nx - zone_radius * 0.5)) if x_end > x_start else (mid_x > (target_nx + zone_radius * 0.5))

        v_approach = float(np.max(step_vels[before_notch_mask])) if np.any(before_notch_mask) else float(np.percentile(step_vels, 75))
        v_approach = max(50.0, v_approach)

        if np.any(in_notch_mask):
            v_notch = float(np.min(step_vels[in_notch_mask]))
            dip_ratio = float(min(1.0, v_notch / v_approach))
            pause_dt = dt[in_notch_mask & (step_vels < 0.65 * v_approach)]
            raw_pause = float(np.sum(pause_dt) * 1000.0) if len(pause_dt) > 0 else 40.0
            pause_ms = float(min(300.0, max(25.0, raw_pause)))
        else:
            mid_slice = step_vels[int(len(step_vels)*0.2):int(len(step_vels)*0.8)]
            v_notch = float(np.min(mid_slice)) if len(mid_slice) > 0 else (0.45 * v_approach)
            dip_ratio = float(min(1.0, v_notch / v_approach))
            pause_ms = 60.0

        if len(step_vels) >= 3:
            dv = np.diff(step_vels)
            neg_dv = dv[dv < 0]
            decels = np.abs(neg_dv / dt[:-1][dv < 0]) if len(neg_dv) > 0 else np.array([450.0])
            approach_decel = float(np.median(decels)) if len(decels) > 0 else 450.0
        else:
            approach_decel = 450.0

        return round(dip_ratio, 3), round(pause_ms, 1), round(approach_decel, 1)

    @staticmethod
    def extract_physiological_grip_tremor(
        trajectory: List[MouseEvent],
        notch_x: Optional[float] = None
    ) -> Tuple[float, float, float]:
        """
        Extracts involuntary neuromuscular micro-tremor along the perpendicular axis:
        - tremor_8_12hz_ratio: Relative spectral power in the physiological 8-12 Hz tremor band
        - tremor_peak_freq: Dominant tremor peak frequency (Hz)
        - tremor_rms_jitter: RMS amplitude of lateral micro-displacements (px)
        """
        if len(trajectory) < 8:
            return 0.45, 10.0, 0.75

        coords = np.array([[m.x, m.y] for m in trajectory], dtype=float)
        times = np.array([m.t for m in trajectory], dtype=float)

        sort_idx = np.argsort(times)
        coords = coords[sort_idx]
        times = times[sort_idx]

        dur = times[-1] - times[0]
        if dur < 100.0:
            return 0.40, 10.0, 0.65

        dx_total = abs(coords[-1, 0] - coords[0, 0])
        dy_total = abs(coords[-1, 1] - coords[0, 1])

        # Exclude notch region to measure pure horizontal drag tremor
        x_min = min(coords[0, 0], coords[-1, 0])
        x_max = max(coords[0, 0], coords[-1, 0])
        x_range = max(1.0, x_max - x_min)
        nx = notch_x if (notch_x is not None and x_min <= notch_x <= x_max) else (x_min + 0.50 * x_range)
        notch_radius = max(25.0, 0.18 * x_range)

        # Select longest contiguous straight segment outside notch to avoid time-gap interpolation artifacts
        x_dist = np.abs(coords[:, 0] - nx) if dx_total >= dy_total else np.abs(coords[:, 1] - nx)
        outside_indices = np.where(x_dist > notch_radius)[0]

        if len(outside_indices) >= 8:
            # Group consecutive indices into contiguous segments
            diffs = np.diff(outside_indices)
            split_points = np.where(diffs > 1)[0] + 1
            segments = np.split(outside_indices, split_points)
            best_seg = max(segments, key=len)
            if len(best_seg) >= 6:
                perp = coords[best_seg, 1 if dx_total >= dy_total else 0]
                t_sub = times[best_seg]
            else:
                perp = coords[:, 1 if dx_total >= dy_total else 0]
                t_sub = times
        else:
            perp = coords[:, 1 if dx_total >= dy_total else 0]
            t_sub = times

        t_sec = (t_sub - t_sub[0]) / 1000.0
        if len(t_sec) < 4 or (t_sec[-1] - t_sec[0]) < 0.05:
            return 0.45, 10.0, 0.70

        # Linear detrend of macro horizontal drift
        poly = np.poly1d(np.polyfit(t_sec, perp, 1))
        residual = perp - poly(t_sec)
        rms_jitter = float(np.sqrt(np.mean(residual ** 2)))

        # Uniform interpolation for spectral density (Fs = 200 Hz)
        fs = 200.0
        n_samples = int(np.floor((t_sec[-1] - t_sec[0]) * fs))
        if n_samples < 16:
            return 0.45, 10.0, round(rms_jitter, 3)

        t_uniform = np.linspace(t_sec[0], t_sec[-1], n_samples)
        r_uniform = np.interp(t_uniform, t_sec, residual)

        try:
            from scipy.signal import welch
            nperseg = min(len(r_uniform), 64)
            freqs, psd = welch(r_uniform, fs=fs, nperseg=nperseg)

            band_8_12 = (freqs >= 7.5) & (freqs <= 12.5)
            band_total = (freqs >= 2.0) & (freqs <= 35.0)

            p_tremor = float(np.sum(psd[band_8_12])) if np.any(band_8_12) else 0.0
            p_total = float(np.sum(psd[band_total])) if np.any(band_total) else 1e-9
            tremor_ratio = float(p_tremor / max(1e-9, p_total))

            band_search = (freqs >= 6.0) & (freqs <= 15.0)
            if np.any(band_search) and np.max(psd[band_search]) > 1e-9:
                peak_freq = float(freqs[band_search][np.argmax(psd[band_search])])
            else:
                peak_freq = 10.0
        except Exception:
            tremor_ratio = 0.45
            peak_freq = 10.0

        return round(tremor_ratio, 3), round(peak_freq, 1), round(rms_jitter, 3)

    @classmethod
    def extract_motor_kinematics(cls, drags: List[DragGestureEvent]) -> Dict[str, float]:
        """
        Extracts psychomotor features from drag-and-drop & slider gestures:
        - Path Tortuosity: tau = L_actual / D_straight
        - Velocity bell-curve symmetry (accel_duration / decel_duration)
        - Acceleration variance (smoothness vs jerky synthetic line)
        - Target docking release latency (T_dock: dwell inside slot before release)
        - Mean Velocity & Directness ratio
        - Saccadic notch deceleration dip ratio & pause duration
        - Physiological grip tremor spectral ratio (8-12Hz) & peak frequency
        - Lateral micro-jitter RMS amplitude
        """
        if not drags:
            return {
                "tortuosity": 1.25,
                "velocity_symmetry": 1.0,
                "acceleration_variance": 1200.0,
                "docking_latency": 110.0,
                "mean_velocity": 450.0,
                "drop_drift": 6.0,
                "saccadic_dip_ratio": 0.45,
                "saccadic_pause_ms": 75.0,
                "tremor_8_12hz_ratio": 0.45,
                "tremor_peak_freq": 10.0,
                "tremor_rms_jitter": 0.75
            }

        tortuosities = []
        symmetries = []
        accel_vars = []
        docking_latencies = []
        velocities = []
        drifts = []
        saccadic_dips = []
        saccadic_pauses = []
        tremor_ratios = []
        tremor_peaks = []
        tremor_rms_list = []

        for g in drags:
            traj = g.trajectory or []
            hold = max(30.0, g.hold_duration or (g.drop_time - g.start_time))
            drift = max(0.0, g.drop_drift_offset)
            dock = max(10.0, g.docking_latency) if g.docking_latency > 0 else max(30.0, hold * 0.22)

            docking_latencies.append(dock)
            drifts.append(drift)

            if len(traj) >= 3:
                coords = np.array([[m.x, m.y] for m in traj], dtype=float)
                times = np.array([m.t for m in traj], dtype=float)

                diffs = np.diff(coords, axis=0)
                dt = np.diff(times)
                dt = np.where(dt <= 0.0, 1.0, dt)

                step_dists = np.linalg.norm(diffs, axis=1)
                path_len = float(np.sum(step_dists))
                straight_dist = float(np.linalg.norm(coords[-1] - coords[0]))

                # Tortuosity tau = Path Length / Straight Distance
                tau = float(path_len / max(1.0, straight_dist))
                tortuosities.append(tau)

                # Velocity profile
                step_vels = step_dists / (dt / 1000.0)
                # Macro velocity: total path length / elapsed duration (px/s)
                total_dur_sec = max(0.01, (times[-1] - times[0]) / 1000.0)
                mean_v = float(path_len / total_dur_sec)
                velocities.append(mean_v)

                # Bell-curve symmetry
                if len(step_vels) >= 3:
                    peak_idx = int(np.argmax(step_vels))
                    t_start = times[0]
                    t_peak = times[peak_idx]
                    t_end = times[-1]

                    t_acc = max(10.0, t_peak - t_start)
                    t_dec = max(10.0, t_end - t_peak)
                    symmetry = float(t_acc / t_dec)
                    symmetries.append(symmetry)

                # Acceleration variance
                if len(step_vels) >= 2:
                    dv = np.diff(step_vels)
                    dt_acc = dt[:-1]
                    accels = dv / (dt_acc / 1000.0)
                    acc_var = float(np.var(accels))
                    accel_vars.append(acc_var)

                # Ocular-motor saccadic pause & grip tremor
                s_dip, s_pause, _ = cls.extract_saccadic_notch_pause(traj, g.track_notch_x, g.track_notch_y)
                t_ratio, t_peak, t_rms = cls.extract_physiological_grip_tremor(traj, g.track_notch_x)

                saccadic_dips.append(s_dip)
                saccadic_pauses.append(s_pause)
                tremor_ratios.append(t_ratio)
                tremor_peaks.append(t_peak)
                tremor_rms_list.append(t_rms)

            else:
                tortuosities.append(g.tortuosity if g.tortuosity >= 1.0 else 1.25)
                velocities.append(g.drag_velocity_mean if g.drag_velocity_mean > 0 else 450.0)
                symmetries.append(1.0)
                accel_vars.append(1200.0)
                saccadic_dips.append(g.saccadic_dip_ratio or 0.45)
                saccadic_pauses.append(g.saccadic_pause_ms or 75.0)
                tremor_ratios.append(g.tremor_8_12hz_ratio or 0.45)
                tremor_peaks.append(g.tremor_peak_freq or 10.0)
                tremor_rms_list.append(g.tremor_rms_jitter or 0.75)

        return {
            "tortuosity": round(float(np.mean(tortuosities)) if tortuosities else 1.25, 3),
            "velocity_symmetry": round(float(np.mean(symmetries)) if symmetries else 1.0, 3),
            "acceleration_variance": round(float(np.mean(accel_vars)) if accel_vars else 1200.0, 1),
            "docking_latency": round(float(np.mean(docking_latencies)) if docking_latencies else 110.0, 1),
            "mean_velocity": round(float(np.mean(velocities)) if velocities else 450.0, 1),
            "drop_drift": round(float(np.mean(drifts)) if drifts else 6.0, 1),
            "saccadic_dip_ratio": round(float(np.mean(saccadic_dips)) if saccadic_dips else 0.45, 3),
            "saccadic_pause_ms": round(float(np.mean(saccadic_pauses)) if saccadic_pauses else 75.0, 1),
            "tremor_8_12hz_ratio": round(float(np.mean(tremor_ratios)) if tremor_ratios else 0.45, 3),
            "tremor_peak_freq": round(float(np.mean(tremor_peaks)) if tremor_peaks else 10.0, 1),
            "tremor_rms_jitter": round(float(np.mean(tremor_rms_list)) if tremor_rms_list else 0.75, 3)
        }

    # -------------------------------------------------------------------------
    # 3. Bot & Automation Integrity Heuristics
    # -------------------------------------------------------------------------

    @staticmethod
    def detect_bot_anomalies(
        keystrokes: List[KeystrokeEvent],
        mouse_events: List[MouseEvent],
        drag_gestures: Optional[List[DragGestureEvent]] = None,
        browser_integrity: Optional[BrowserIntegrity] = None
    ) -> Tuple[bool, List[str]]:
        """
        Validates hardware/DOM automation integrity:
        - `isTrusted == False` (synthetic JS dispatchEvent)
        - `navigator.webdriver == True` (headless browser automation)
        - Impossible keypress dwell times (<10ms physical human limit)
        - Unnatural robotic uniform pacing (dwell variance < 0.8ms)
        - Perfectly collinear cursor trajectory without lateral jitter (zero acceleration variance)
        - Drag teleportation (instant drop <15ms)
        """
        reasons = []
        is_bot = False

        # Browser automation flags
        if browser_integrity and browser_integrity.is_webdriver:
            is_bot = True
            reasons.append("Headless browser automation detected: navigator.webdriver is true.")

        # Synthetic DOM Event Flag (event.isTrusted)
        for k in keystrokes:
            if not k.is_trusted:
                is_bot = True
                reasons.append(f"Synthetic keystroke injection detected: isTrusted is false on key '{k.key}'.")
                break

        for m in mouse_events:
            if not m.is_trusted:
                is_bot = True
                reasons.append("Synthetic pointer event injection detected: isTrusted is false.")
                break

        # Drag Teleportation check
        if drag_gestures:
            for d in drag_gestures:
                hold = max(0.0, d.hold_duration or (d.drop_time - d.start_time))
                traj_len = len(d.trajectory) if d.trajectory else 0
                if hold < 15.0 or (traj_len < 3 and d.drop_drift_offset < 10.0 and hold < 30.0):
                    is_bot = True
                    reasons.append(f"Instant drag teleportation detected on '{d.shape_type}': hold duration {hold:.1f}ms (<15ms human limit).")
                    break

        # Impossible Key Dwell
        if keystrokes:
            dwells = []
            for k in keystrokes:
                dwell = k.up_time - k.down_time
                dwells.append(dwell)
                if dwell < 10.0:
                    is_bot = True
                    reasons.append(f"Impossible keypress dwell time on '{k.key}': {dwell:.1f}ms (<10ms neuromuscular limit).")
                    break

            if len(dwells) >= 6:
                d_std = float(np.std(dwells))
                if d_std < 0.8:
                    is_bot = True
                    reasons.append(f"Robotic cadence detected: keystroke dwell variance is unnaturally uniform (σ = {d_std:.2f}ms).")

        # Straight-line mouse trajectory (collinearity test)
        if len(mouse_events) >= 6:
            coords = np.array([[m.x, m.y] for m in mouse_events], dtype=float)
            start_p = coords[0]
            end_p = coords[-1]
            disp = float(np.linalg.norm(end_p - start_p))

            if disp > 50.0:
                line_vec = end_p - start_p
                line_len = np.linalg.norm(line_vec)
                if line_len > 0:
                    line_unit = line_vec / line_len
                    pt_vecs = coords - start_p
                    proj_lens = np.dot(pt_vecs, line_unit)
                    proj_pts = start_p + np.outer(proj_lens, line_unit)
                    perp_dists = np.linalg.norm(coords - proj_pts, axis=1)
                    lat_std = float(np.std(perp_dists))

                    if lat_std < 0.15:
                        is_bot = True
                        reasons.append(f"Linear trajectory bot detected: cursor path has zero micro-jitter (lateral σ = {lat_std:.3f}px).")

        # Zero physiological grip tremor check on slider drag gestures
        if drag_gestures:
            for d in drag_gestures:
                if d.trajectory and len(d.trajectory) >= 12:
                    coords = np.array([[m.x, m.y] for m in d.trajectory], dtype=float)
                    disp = float(np.linalg.norm(coords[-1] - coords[0]))
                    hold = max(0.0, d.hold_duration or (d.drop_time - d.start_time))
                    if disp >= 80.0 and hold >= 180.0:
                        t_ratio, t_peak, t_rms = BiometricsEngine.extract_physiological_grip_tremor(d.trajectory, d.track_notch_x)
                        if t_rms < 0.05 and t_ratio < 0.05:
                            is_bot = True
                            reasons.append(f"Synthetic slider drag bot detected: zero physiological micro-tremor along track (RMS={t_rms:.3f}px, 8-12Hz power={t_ratio:.3f}).")
                            break

        return is_bot, reasons

    @staticmethod
    def extract_digram_cadence_and_dwells(keystrokes: List[KeystrokeEvent]) -> Tuple[Dict[str, List[float]], Dict[str, List[float]]]:
        """
        Extracts raw observations for:
        1. Digram flight times (inter-keystroke latency between consecutive keys k[i] -> k[i+1]).
        2. Per-key dwell times (hold duration for key k[i]).
        """
        digrams: Dict[str, List[float]] = {}
        dwells: Dict[str, List[float]] = {}

        for i, k in enumerate(keystrokes):
            c = k.key.lower()
            if len(c) == 1 or c in ("backspace", "space"):
                dwell = max(10.0, k.up_time - k.down_time)
                if dwell <= 800.0:
                    dwells.setdefault(c, []).append(dwell)

            if i < len(keystrokes) - 1:
                next_k = keystrokes[i + 1]
                next_c = next_k.key.lower()
                flight = next_k.down_time - k.up_time
                if -80.0 <= flight <= MAX_CONTINUOUS_FLIGHT_MS:
                    d_key = f"{c}_{next_c}"
                    digrams.setdefault(d_key, []).append(flight)

        return digrams, dwells

    # -------------------------------------------------------------------------
    # 4. Baseline Compilation from Enrollment (Monkeytype + Scrambled Shapes)
    # -------------------------------------------------------------------------

    @staticmethod
    def compile_enrollment_baseline(
        typing_session: TypingSessionTelemetry,
        shape_drags: List[DragGestureEvent],
        password_keystrokes: Optional[List[KeystrokeEvent]] = None
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """
        Compiles baseline distributions (means and variance floors) from the
        Monkeytype typing test, password keystrokes, and scrambled shape-matching mini-game.
        """
        all_typing_keys = list(typing_session.keystrokes)
        if password_keystrokes:
            all_typing_keys.extend(password_keystrokes)

        typing_feats = BiometricsEngine.extract_universal_typing_features(all_typing_keys)
        motor_feats = BiometricsEngine.extract_motor_kinematics(shape_drags)
        raw_digrams, raw_dwells = BiometricsEngine.extract_digram_cadence_and_dwells(all_typing_keys)

        # Build digram cadence baseline
        digram_baseline: Dict[str, Dict[str, float]] = {}
        for d_key, flights in raw_digrams.items():
            if flights:
                f_mean = float(np.mean(flights))
                f_std = float(np.std(flights))
                f_std_floor = max(18.0, f_std, abs(f_mean) * 0.25)
                digram_baseline[d_key] = {
                    "mean": round(f_mean, 2),
                    "std": round(f_std_floor, 2),
                    "count": float(len(flights))
                }

        # Build key dwell baseline
        dwell_baseline: Dict[str, Dict[str, float]] = {}
        for c, d_vals in raw_dwells.items():
            if d_vals:
                d_mean = float(np.mean(d_vals))
                d_std = float(np.std(d_vals))
                d_std_floor = max(18.0, d_std, d_mean * 0.25)
                dwell_baseline[c] = {
                    "mean": round(d_mean, 2),
                    "std": round(d_std_floor, 2),
                    "count": float(len(d_vals))
                }

        # Build typing baseline with calibrated variance floors
        typing_baseline = {
            "hand_switch_ratio_mean": typing_feats["hand_switch_ratio"],
            "hand_switch_ratio_std": max(0.40, typing_feats["hand_switch_ratio"] * 0.35),

            "dwell_vowels_mean": typing_feats["dwell_vowels"],
            "dwell_vowels_std": max(SIGMA_DWELL_FLOOR, typing_feats["dwell_vowels"] * 0.30),

            "dwell_top_row_mean": typing_feats["dwell_top_row"],
            "dwell_top_row_std": max(SIGMA_DWELL_FLOOR, typing_feats["dwell_top_row"] * 0.30),

            "dwell_home_row_mean": typing_feats["dwell_home_row"],
            "dwell_home_row_std": max(SIGMA_DWELL_FLOOR, typing_feats["dwell_home_row"] * 0.30),

            "dwell_bottom_row_mean": typing_feats["dwell_bottom_row"],
            "dwell_bottom_row_std": max(SIGMA_DWELL_FLOOR, typing_feats["dwell_bottom_row"] * 0.30),

            "spacebar_saccade_delay_mean": typing_feats["spacebar_saccade_delay"],
            "spacebar_saccade_delay_std": max(SIGMA_FLIGHT_FLOOR, typing_feats["spacebar_saccade_delay"] * 0.35),

            "flight_entropy_cv_mean": typing_feats["flight_entropy_cv"],
            "flight_entropy_cv_std": max(0.25, typing_feats["flight_entropy_cv"] * 0.35),

            "backspace_ratio_mean": typing_feats["backspace_ratio"],
            "backspace_ratio_std": max(0.15, typing_feats["backspace_ratio"] * 0.40),

            "error_recovery_ms_mean": typing_feats["error_recovery_ms"],
            "error_recovery_ms_std": max(50.0, typing_feats["error_recovery_ms"] * 0.35),

            "digram_cadence": digram_baseline,
            "key_dwells": dwell_baseline,

            "wpm": typing_session.wpm,
            "accuracy": typing_session.accuracy,
            "total_keys": len(all_typing_keys)
        }

        # Build motor baseline with calibrated variance floors
        s_dip = float(min(0.70, max(0.15, motor_feats["saccadic_dip_ratio"])))
        s_pause = float(min(300.0, max(35.0, motor_feats["saccadic_pause_ms"])))
        t_ratio = float(max(0.30, motor_feats["tremor_8_12hz_ratio"]))
        raw_freq = float(motor_feats["tremor_peak_freq"])
        t_peak = 10.0 if (raw_freq < 7.5 or raw_freq > 13.0) else raw_freq
        mean_v = float(max(200.0, min(800.0, motor_feats["mean_velocity"])))
        dock = float(max(40.0, motor_feats["docking_latency"]))

        motor_baseline = {
            "tortuosity_mean": motor_feats["tortuosity"],
            "tortuosity_std": max(0.25, motor_feats["tortuosity"] * 0.30),

            "velocity_symmetry_mean": motor_feats["velocity_symmetry"],
            "velocity_symmetry_std": max(0.40, motor_feats["velocity_symmetry"] * 0.35),

            "acceleration_variance_mean": motor_feats["acceleration_variance"],
            "acceleration_variance_std": max(600.0, motor_feats["acceleration_variance"] * 0.40),

            "docking_latency_mean": dock,
            "docking_latency_std": max(65.0, dock * 0.35),

            "mean_velocity_mean": mean_v,
            "mean_velocity_std": max(180.0, mean_v * 0.40),

            "drop_drift_mean": motor_feats["drop_drift"],
            "drop_drift_std": max(15.0, motor_feats["drop_drift"] * 0.40),

            "saccadic_dip_ratio_mean": s_dip,
            "saccadic_dip_ratio_std": max(0.20, s_dip * 0.40),

            "saccadic_pause_ms_mean": s_pause,
            "saccadic_pause_ms_std": max(60.0, s_pause * 0.40),

            "tremor_8_12hz_ratio_mean": t_ratio,
            "tremor_8_12hz_ratio_std": max(0.18, t_ratio * 0.35),

            "tremor_peak_freq_mean": t_peak,
            "tremor_peak_freq_std": max(2.5, t_peak * 0.25),

            "tremor_rms_jitter_mean": motor_feats["tremor_rms_jitter"],
            "tremor_rms_jitter_std": max(0.30, motor_feats["tremor_rms_jitter"] * 0.35),

            "shapes_slotted": len(shape_drags)
        }

        return typing_baseline, motor_baseline

    # -------------------------------------------------------------------------
    # 5. Verification Scoring Engine (<50ms Latency)
    # -------------------------------------------------------------------------

    @classmethod
    def verify(
        cls,
        username: str,
        password_valid: bool,
        pangram_keystrokes: List[KeystrokeEvent],
        token_drag: Optional[DragGestureEvent],
        baseline_profile: Dict[str, Any],
        mouse_events: Optional[List[MouseEvent]] = None,
        browser_integrity: Optional[BrowserIntegrity] = None
    ) -> VerificationResponse:
        """
        Executes end-to-end multi-factor authentication:
        1. Checks password validity first. If invalid -> immediate rejection.
        2. Inspects bot heuristics (isTrusted, webdriver, linear lines, teleportation).
        3. Extracts keystroke cadence (exact digram flight latencies, per-key dwells,
           and universal typing dynamics) and computes Z-scores.
        4. Extracts motor kinematics from the token drag and computes Z-scores.
        5. Computes composite exponential score: Score = 100 * exp(-mean_Z / 3.6).
        6. Produces explainability diagnostics for metrics with Z_i > 2.5.
        """
        t_start = time.perf_counter()
        reasons = []

        # 1. Standard Cryptographic Password Check
        if not password_valid:
            t_elapsed = (time.perf_counter() - t_start) * 1000.0
            return VerificationResponse(
                authenticated=False,
                confidence_score=0.0,
                latency_ms=round(t_elapsed, 2),
                signals=SignalsBreakdown(
                    bot_detected=False,
                    password_valid=False,
                    keystroke_rhythm_match=0.0,
                    motor_kinematics_match=0.0,
                    drag_dynamics_match=0.0
                ),
                explainability_reasons=["Invalid password credentials provided for user."]
            )

        # 2. Bot & Automation Integrity Filter
        all_mouse = list(mouse_events or [])
        all_drags = [token_drag] if token_drag else []
        bot_detected, bot_reasons = cls.detect_bot_anomalies(
            pangram_keystrokes, all_mouse, all_drags, browser_integrity
        )
        if bot_detected:
            reasons.extend(bot_reasons)
            t_elapsed = (time.perf_counter() - t_start) * 1000.0
            return VerificationResponse(
                authenticated=False,
                confidence_score=0.0,
                latency_ms=round(t_elapsed, 2),
                signals=SignalsBreakdown(
                    bot_detected=True,
                    password_valid=True,
                    keystroke_rhythm_match=0.0,
                    motor_kinematics_match=0.0,
                    drag_dynamics_match=0.0
                ),
                explainability_reasons=reasons
            )

        # Extract baselines
        typing_base = baseline_profile.get("typing_baseline") or baseline_profile.get("keystroke_baseline") or {}
        motor_base = baseline_profile.get("motor_baseline") or {}

        # 3. Keystroke Dynamics & Cadence Evaluation (Z-Score Engine)
        keystroke_list = list(pangram_keystrokes or [])
        typing_z_scores = []
        typing_details = {}

        if len(keystroke_list) < 2:
            # Missing or bypassed keystroke telemetry
            reasons.append("Zero keystroke telemetry captured: typing cadence could not be validated. Please enter your password or identity phrase.")
            key_score = 0.0
            typing_z_scores = [3.5, 3.5, 3.5]
        else:
            # 3a. Universal Typing Dynamics
            typing_obs = cls.extract_universal_typing_features(keystroke_list)
            typing_feature_mapping = [
                ("hand_switch_ratio", "Cross-hand to same-hand transition ratio", 0.40, "hunt-and-peck pattern"),
                ("dwell_vowels", "Vowel key cluster dwell latency", 25.0, "vowel muscle memory deviation"),
                ("dwell_home_row", "Home row key cluster dwell latency", 25.0, "home row cadence mismatch"),
                ("spacebar_saccade_delay", "Spacebar boundary saccade latency", 55.0, "lexical boundary delay deviation"),
                ("flight_entropy_cv", "Inter-keystroke rhythm variation entropy", 0.25, "uniform or chaotic cadence irregularity"),
            ]

            for feat_key, label, min_sigma, diag_tag in typing_feature_mapping:
                if f"{feat_key}_mean" in typing_base:
                    mu = float(typing_base[f"{feat_key}_mean"])
                    sigma = float(max(min_sigma, typing_base.get(f"{feat_key}_std", min_sigma)))
                    obs = float(typing_obs.get(feat_key, mu))

                    z = abs(obs - mu) / sigma
                    z_capped = min(Z_SCORE_CAP, z)
                    typing_z_scores.append(z_capped)
                    typing_details[feat_key] = {"observed": obs, "baseline_mean": mu, "z_score": round(z, 2)}

                    if z > Z_SCORE_ANOMALY_THRESHOLD:
                        sign = "+" if obs > mu else "-"
                        reasons.append(
                            f"{label} was {obs:.2f} vs baseline {mu:.2f} ({sign}{z:.1f}σ deviation - {diag_tag})"
                        )

            # 3b. Specific Digram Cadence Evaluation (Key-to-Key Flight Latencies)
            digram_base = typing_base.get("digram_cadence", {})
            obs_digrams, obs_dwells = cls.extract_digram_cadence_and_dwells(keystroke_list)

            for d_key, flights in obs_digrams.items():
                if d_key in digram_base:
                    d_info = digram_base[d_key]
                    mu = float(d_info["mean"])
                    sigma = float(max(18.0, d_info.get("std", 18.0)))
                    obs_f = float(np.mean(flights))

                    z = abs(obs_f - mu) / sigma
                    z_capped = min(Z_SCORE_CAP, z)
                    typing_z_scores.append(z_capped)

                    parts = d_key.split("_", 1)
                    c1 = parts[0] if len(parts) > 0 else "?"
                    c2 = parts[1] if len(parts) > 1 else "?"

                    if z > Z_SCORE_ANOMALY_THRESHOLD:
                        sign = "+" if obs_f > mu else "-"
                        reasons.append(
                            f"Cadence mismatch between '{c1}' and '{c2}': {obs_f:.1f}ms vs baseline {mu:.1f}ms ({sign}{z:.1f}σ deviation)"
                        )

            # 3c. Specific Character Dwell Evaluation
            dwell_base = typing_base.get("key_dwells", {})
            for c, d_vals in obs_dwells.items():
                if c in dwell_base:
                    d_info = dwell_base[c]
                    mu = float(d_info["mean"])
                    sigma = float(max(18.0, d_info.get("std", 18.0)))
                    obs_d = float(np.mean(d_vals))

                    z = abs(obs_d - mu) / sigma
                    z_capped = min(Z_SCORE_CAP, z)
                    typing_z_scores.append(z_capped)

                    if z > Z_SCORE_ANOMALY_THRESHOLD:
                        sign = "+" if obs_d > mu else "-"
                        reasons.append(
                            f"Key dwell latency mismatch for '{c}': {obs_d:.1f}ms vs baseline {mu:.1f}ms ({sign}{z:.1f}σ deviation)"
                        )

            mean_typing_z = float(np.mean(typing_z_scores)) if typing_z_scores else 0.5
            key_score = float(max(0.0, min(100.0, 100.0 * math.exp(-mean_typing_z / 3.6))))

        # 4. Motor Kinematics Evaluation (Scrambled & Token Drag)
        has_motor = bool(token_drag and token_drag.trajectory and len(token_drag.trajectory) >= 2)
        motor_z_scores = []
        motor_details = {}

        if not has_motor:
            reasons.append("Missing psychomotor telemetry: token docking drag gesture was not detected.")
            motor_score = 0.0
            motor_z_scores = [3.5, 3.5, 3.5]
        else:
            motor_obs = cls.extract_motor_kinematics([token_drag] if token_drag else [])

            # Dynamic sanitization of baseline parameters to physiological envelopes
            base_pause_mean = min(300.0, max(40.0, float(motor_base.get("saccadic_pause_ms_mean", 75.0))))
            base_pause_std = max(60.0, float(motor_base.get("saccadic_pause_ms_std", 60.0)))

            base_dip_mean = min(0.70, max(0.15, float(motor_base.get("saccadic_dip_ratio_mean", 0.45))))
            base_dip_std = max(0.20, float(motor_base.get("saccadic_dip_ratio_std", 0.20)))

            base_tremor_mean = max(0.30, float(motor_base.get("tremor_8_12hz_ratio_mean", 0.45)))
            base_tremor_std = max(0.18, float(motor_base.get("tremor_8_12hz_ratio_std", 0.18)))

            raw_freq = float(motor_base.get("tremor_peak_freq_mean", 10.0))
            base_freq_mean = 10.0 if (raw_freq < 7.5 or raw_freq > 13.0) else raw_freq
            base_freq_std = max(2.5, float(motor_base.get("tremor_peak_freq_std", 2.5)))

            base_vel_mean = max(200.0, min(800.0, float(motor_base.get("mean_velocity_mean", 450.0))))
            base_vel_std = max(180.0, float(motor_base.get("mean_velocity_std", 180.0)))

            base_dock_mean = float(motor_base.get("docking_latency_mean", 120.0))
            base_dock_std = max(65.0, float(motor_base.get("docking_latency_std", 65.0)))

            motor_feature_mapping = [
                ("tortuosity", "Trajectory path tortuosity", float(motor_base.get("tortuosity_mean", 1.15)), max(0.25, float(motor_base.get("tortuosity_std", 0.25))), "failed curve baseline"),
                ("velocity_symmetry", "Velocity bell-curve acceleration symmetry", float(motor_base.get("velocity_symmetry_mean", 1.0)), max(0.40, float(motor_base.get("velocity_symmetry_std", 0.40))), "unnatural motor thrust profile"),
                ("docking_latency", "Target docking release dwell latency", base_dock_mean, base_dock_std, "docking deceleration mismatch"),
                ("mean_velocity", "Token drag velocity", base_vel_mean, base_vel_std, "ballistic sweep velocity mismatch"),
                ("drop_drift", "Drop docking accuracy radial drift", float(motor_base.get("drop_drift_mean", 6.0)), max(15.0, float(motor_base.get("drop_drift_std", 15.0))), "precision target placement drift"),
                ("saccadic_dip_ratio", "Saccadic notch deceleration dip ratio", base_dip_mean, base_dip_std, "ocular-motor notch alignment pause mismatch"),
                ("saccadic_pause_ms", "Notch saccadic alignment pause duration", base_pause_mean, base_pause_std, "notch deceleration dwell mismatch"),
                ("tremor_8_12hz_ratio", "Physiological grip tremor spectral ratio (8-12Hz)", base_tremor_mean, base_tremor_std, "involuntary neuromuscular tremor power mismatch"),
                ("tremor_peak_freq", "Grip tremor peak frequency", base_freq_mean, base_freq_std, "involuntary tremor frequency mismatch"),
                ("tremor_rms_jitter", "Lateral micro-jitter RMS amplitude", float(motor_base.get("tremor_rms_jitter_mean", 0.75)), max(0.30, float(motor_base.get("tremor_rms_jitter_std", 0.30))), "grip pressure jitter anomaly")
            ]

            for feat_key, label, mu, sigma, diag_tag in motor_feature_mapping:
                obs = float(motor_obs.get(feat_key, mu))
                z = abs(obs - mu) / sigma
                z_capped = min(Z_SCORE_CAP, z)
                motor_z_scores.append(z_capped)
                motor_details[feat_key] = {"observed": obs, "baseline_mean": mu, "z_score": round(z, 2)}

                if z > Z_SCORE_ANOMALY_THRESHOLD:
                    sign = "+" if obs > mu else "-"
                    reasons.append(
                        f"{label} was {obs:.1f} vs baseline {mu:.1f} ({sign}{z:.1f}σ deviation - {diag_tag})"
                    )

            mean_motor_z = float(np.mean(motor_z_scores)) if motor_z_scores else 0.5
            motor_score = float(max(0.0, min(100.0, 100.0 * math.exp(-mean_motor_z / 3))))

        # 5. Composite Fusion & Verdict Logic
        all_z = typing_z_scores + motor_z_scores
        composite_z = float(np.mean(all_z)) if all_z else 0.5

        # Calibrated exponential confidence scoring
        composite_score = float(max(0.0, min(100.0, 100.0 * math.exp(-composite_z / 3.6))))
        
        # Must meet overall threshold AND minimum per-modality floor
        authenticated = (
            composite_score >= CONFIDENCE_THRESHOLD and
            key_score >= 45.0 and
            motor_score >= 45.0
        )

        # Deduplicate reasons
        seen_r = set()
        deduped_reasons = []
        for r in reasons:
            if r not in seen_r:
                seen_r.add(r)
                deduped_reasons.append(r)
        reasons = deduped_reasons

        if authenticated and not reasons:
            reasons.append("Universal typing dynamics and motor trajectory kinematics match enrolled profile.")

        t_elapsed = (time.perf_counter() - t_start) * 1000.0

        signals = SignalsBreakdown(
            bot_detected=False,
            password_valid=True,
            keystroke_rhythm_match=round(key_score, 1),
            motor_kinematics_match=round(motor_score, 1),
            drag_dynamics_match=round(motor_score, 1)
        )

        return VerificationResponse(
            authenticated=authenticated,
            confidence_score=round(composite_score, 1),
            latency_ms=round(t_elapsed, 2),
            signals=signals,
            explainability_reasons=reasons,
            details={
                "typing": typing_details,
                "motor": motor_details,
                "composite_z": round(composite_z, 2)
            }
        )
