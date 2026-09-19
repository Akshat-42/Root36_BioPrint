/**
 * BioPrint Sentinel - Extension Popup Logic
 */

document.addEventListener("DOMContentLoaded", () => {
  const backendStatus = document.getElementById("backend-status");
  const checkBtn = document.getElementById("check-btn");
  const statusPill = document.getElementById("status-pill");
  const statusText = document.getElementById("status-text");

  const popDirectness = document.getElementById("pop-directness");
  const popDrift = document.getElementById("pop-drift");
  const popConfidence = document.getElementById("pop-confidence");

  async function pingBackend() {
    backendStatus.textContent = "Pinging...";
    backendStatus.style.color = "#F59E0B";

    try {
      const res = await fetch("http://127.0.0.1:8000/api/health");
      if (res.ok) {
        backendStatus.textContent = "ONLINE (v1.0.0)";
        backendStatus.style.color = "#10B981";
        statusPill.style.color = "#10B981";
        statusPill.style.borderColor = "rgba(16, 185, 129, 0.3)";
        statusText.textContent = "Armed";

        // Query active baseline for real-time drag stats
        try {
          const baseRes = await fetch("http://127.0.0.1:8000/api/user/alice/baseline");
          if (baseRes.ok) {
            const baseData = await baseRes.json();
            const dragBase = baseData.motor_baseline?.drag_dynamics;
            if (dragBase) {
              if (popDirectness) popDirectness.textContent = `${dragBase.trajectory_directness_mean} (Direct)`;
              if (popDrift) popDrift.textContent = `±${dragBase.drop_drift_offset_mean} px error`;
              if (popConfidence) popConfidence.textContent = "91.2% (Enrolled)";
            }
          }
        } catch (e) {}
      } else {
        throw new Error("HTTP " + res.status);
      }
    } catch (err) {
      backendStatus.textContent = "OFFLINE";
      backendStatus.style.color = "#EF4444";
      statusPill.style.color = "#EF4444";
      statusPill.style.borderColor = "rgba(239, 68, 68, 0.3)";
      statusText.textContent = "Disconnected";
    }
  }

  checkBtn.addEventListener("click", pingBackend);
  pingBackend();
});
