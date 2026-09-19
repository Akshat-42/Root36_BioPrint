/**
 * BioPrint Sentinel - Extension Popup Logic
 */

document.addEventListener("DOMContentLoaded", () => {
  const backendStatus = document.getElementById("backend-status");
  const checkBtn = document.getElementById("check-btn");
  const statusPill = document.getElementById("status-pill");
  const statusText = document.getElementById("status-text");

  function pingBackend() {
    backendStatus.textContent = "Pinging...";
    backendStatus.style.color = "#F59E0B";

    chrome.runtime.sendMessage({ type: "CHECK_BACKEND_HEALTH" }, (response) => {
      if (response && response.success) {
        backendStatus.textContent = "ONLINE (v1.0.0)";
        backendStatus.style.color = "#10B981";
        statusPill.style.color = "#10B981";
        statusPill.style.borderColor = "rgba(16, 185, 129, 0.3)";
        statusText.textContent = "Armed";
      } else {
        backendStatus.textContent = "OFFLINE";
        backendStatus.style.color = "#EF4444";
        statusPill.style.color = "#EF4444";
        statusPill.style.borderColor = "rgba(239, 68, 68, 0.3)";
        statusText.textContent = "Disconnected";
      }
    });
  }

  checkBtn.addEventListener("click", pingBackend);
  pingBackend();
});
