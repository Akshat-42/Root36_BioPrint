/**
 * BioPrint Behavioral Biometric Sentinel - Background Service Worker (Manifest V3)
 * Manages extension state, API communication proxies, and badge notifications.
 */

const BACKEND_URL = "http://127.0.0.1:8000";

// Maintain connection state
chrome.runtime.onInstalled.addListener(() => {
  console.log("[BioPrint Background] Service worker initialized.");
  chrome.action.setBadgeText({ text: "ON" });
  chrome.action.setBadgeBackgroundColor({ color: "#00F0FF" });
});

// Listener for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CHECK_BACKEND_HEALTH") {
    fetch(`${BACKEND_URL}/api/health`)
      .then((res) => res.json())
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }

  if (message.type === "VERIFY_TELEMETRY") {
    fetch(`${BACKEND_URL}/api/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload)
    })
      .then((res) => res.json())
      .then((verdict) => {
        // Update badge based on verdict
        if (verdict.authenticated) {
          chrome.action.setBadgeText({ text: "OK" });
          chrome.action.setBadgeBackgroundColor({ color: "#10B981" });
        } else {
          chrome.action.setBadgeText({ text: "BLK" });
          chrome.action.setBadgeBackgroundColor({ color: "#EF4444" });
        }
        sendResponse({ success: true, verdict });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep channel open for async response
  }

  if (message.type === "UPDATE_BADGE") {
    chrome.action.setBadgeText({ text: message.text || "ON" });
    if (message.color) {
      chrome.action.setBadgeBackgroundColor({ color: message.color });
    }
    sendResponse({ success: true });
    return false;
  }
});
