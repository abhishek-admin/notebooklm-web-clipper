chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractContent') {
    const article = document.querySelector('article') || document.querySelector('main') || document.body;
    const clone = article.cloneNode(true);
    clone.querySelectorAll('script, style, nav, footer, aside, header, iframe, .ad, [role="navigation"]')
      .forEach(el => el.remove());
    sendResponse({
      title: document.title,
      url: window.location.href,
      text: clone.innerText.replace(/\n{3,}/g, '\n\n').trim().slice(0, 12000),
      metaDescription: document.querySelector('meta[name="description"]')?.content || '',
    });
    return true;
  }
});
