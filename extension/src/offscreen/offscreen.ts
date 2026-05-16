// Offscreen document for MV3 screenshot capture
// Chrome restricts some APIs in service workers; offscreen documents bridge the gap.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'capture-screenshot') {
    void (async () => {
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 70 });
        sendResponse(dataUrl);
      } catch {
        sendResponse(null);
      }
    })();
    return true; // keep message channel open for async response
  }
  return false;
});
