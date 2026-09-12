const blobs = new Map<string, string>();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL('background.js') ||
    message?.target !== 'offscreen'
  )
    return false;
  if (
    message.action === 'blob' &&
    typeof message.id === 'string' &&
    typeof message.csv === 'string' &&
    message.csv.length < 3000000
  ) {
    let url = blobs.get(message.id);
    if (!url) {
      url = URL.createObjectURL(new Blob([message.csv], { type: 'text/csv;charset=utf-8' }));
      blobs.set(message.id, url);
    }
    respond({ url });
  }
  if (message.action === 'release' && typeof message.id === 'string') {
    const url = blobs.get(message.id);
    if (url) URL.revokeObjectURL(url);
    blobs.delete(message.id);
    respond({ released: true });
  }
  return false;
});
