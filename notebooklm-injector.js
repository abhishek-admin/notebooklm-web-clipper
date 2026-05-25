// ============================================
// NOTEBOOKLM INJECTOR
// Runs only on notebooklm.google.com
// Checks for a pending clip URL in session
// storage, then automates: create notebook →
// add URL source → (optional) trigger podcast
// ============================================

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Poll until fn() returns a truthy element or timeout
function waitFor(fn, timeout = 15000, interval = 300) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const el = fn();
      if (el) return resolve(el);
      if (Date.now() - start > timeout) return reject(new Error(`Timeout waiting for element`));
      setTimeout(tick, interval);
    };
    tick();
  });
}

// Find any clickable element whose visible text contains `text`
function findByText(text, root = document) {
  const lower = text.toLowerCase();
  const candidates = root.querySelectorAll('button, [role="button"], [role="menuitem"], [role="option"], li, a');
  return Array.from(candidates).find(el =>
    el.offsetParent !== null && // visible
    el.textContent.trim().toLowerCase().includes(lower)
  );
}

// React/Angular-compatible value setter — works for both input and textarea
function setInputValue(el, value) {
  const proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  el.focus();
  if (nativeSetter) nativeSetter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur',   { bubbles: true }));
}

async function runClipper() {
  // Only fire when triggered by the extension
  const data = await chrome.storage.local.get([
    'nlm_pending_url',
    'nlm_pending_title',
    'nlm_pending_mode',
    'nlm_pending_content',
  ]);

  if (!data.nlm_pending_url) return;

  const targetUrl     = data.nlm_pending_url;
  const targetTitle   = data.nlm_pending_title || '';
  const targetMode    = data.nlm_pending_mode || 'source';
  const targetContent = data.nlm_pending_content || '';

  // Clear so it doesn't re-fire on refresh
  await chrome.storage.local.remove([
    'nlm_pending_url', 'nlm_pending_title',
    'nlm_pending_mode', 'nlm_pending_content',
  ]);

  // Wait for NLM to fully hydrate
  await sleep(1500);

  try {
    // ── STEP 1: Click "+ Create new" ──────────────────────────────────
    const createBtn = await waitFor(() =>
      findByText('Create new') ||
      document.querySelector('[aria-label*="Create new" i]')
    );
    createBtn.click();
    await sleep(2000); // wait for notebook page to open

    // ── STEP 2: Click "Add source" inside the new notebook ────────────
    const addSourceBtn = await waitFor(() =>
      findByText('Add source') ||
      findByText('Add sources') ||
      document.querySelector('[aria-label*="Add source" i]')
    , 12000);
    addSourceBtn.click();
    await sleep(600);

    // ── STEP 3: Select "Website" / "Link" source type ─────────────────
    const websiteBtn = await waitFor(() =>
      findByText('Website') ||
      findByText('Link') ||
      findByText('URL') ||
      document.querySelector('[aria-label*="website" i]') ||
      document.querySelector('[aria-label*="url" i]')
    , 8000);
    websiteBtn.click();
    await sleep(500);

    // ── STEP 4: Fill in the URL input ─────────────────────────────────
    const urlInput = await waitFor(() =>
      document.querySelector('textarea[placeholder*="Paste" i]') ||
      document.querySelector('textarea[placeholder*="link" i]') ||
      document.querySelector('textarea[placeholder*="url" i]') ||
      document.querySelector('textarea') ||
      document.querySelector('input[type="url"]') ||
      document.querySelector('input[placeholder*="url" i]') ||
      document.querySelector('input[placeholder*="http" i]')
    , 8000);
    setInputValue(urlInput, targetUrl);
    await sleep(300);

    // ── STEP 5: Click Insert ──────────────────────────────────────────
    const insertBtn = await waitFor(() =>
      findByText('Insert') ||
      findByText('Add') ||
      findByText('Submit') ||
      findByText('Done') ||
      findByText('Confirm') ||
      document.querySelector('button[type="submit"]')
    , 8000);
    insertBtn.click();

    // ── STEP 5b: Poll the "N sources" counter — stays 0 if URL import failed ──
    await sleep(1500); // let dialog animate out and source card appear

    // NLM shows "0 sources" / "1 source" in the chat bottom bar.
    // Use TreeWalker to scan raw text nodes — more reliable than el.textContent.
    function getLoadedSourceCount() {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent.trim();
        const m = text.match(/^(\d+)\s+sources?$/i);
        if (m && node.parentElement?.offsetParent !== null) return parseInt(m[1]);
      }
      return -1; // indicator not visible
    }

    let urlSucceeded = false;
    let countEverDetected = false;
    for (let i = 0; i < 8; i++) {
      await sleep(800);
      const count = getLoadedSourceCount();
      if (count >= 0) countEverDetected = true;
      console.log('[NotebookLM Clipper] source count:', count);
      if (count > 0) { urlSucceeded = true; break; }
    }

    // Only fall back if we could read the counter AND it stayed at 0
    const hasRestriction = countEverDetected && !urlSucceeded;
    console.log('[NotebookLM Clipper] urlSucceeded:', urlSucceeded, '| hasRestriction:', hasRestriction, '| hasContent:', !!targetContent);

    if (hasRestriction && targetContent) {
      // No open dialog to close — error is on the source card in the panel

      // Re-open Add sources
      const addBtn2 = await waitFor(() =>
        findByText('Add source') || findByText('Add sources')
      , 6000);
      addBtn2.click();
      await sleep(600);

      // Click "Copied text" / "Paste text" option
      const textBtn = await waitFor(() =>
        findByText('Copied text') ||
        findByText('Paste text') ||
        findByText('Text') ||
        document.querySelector('[aria-label*="paste" i]') ||
        document.querySelector('[aria-label*="text" i]')
      , 6000);
      textBtn.click();
      await sleep(1000); // wait for "Paste copied text" dialog to fully open

      // Wait for "Paste copied text" dialog — target its specific placeholder, NOT the search box
      const textArea2 = await waitFor(() =>
        document.querySelector('textarea[placeholder*="paste" i]') ||
        document.querySelector('textarea[placeholder*="here" i]') ||
        document.querySelector('textarea[placeholder*="type" i]') ||
        (() => {
          const dlg = document.querySelector('[role="dialog"], mat-dialog-container, .cdk-dialog-container');
          return dlg?.querySelector('textarea');
        })()
      , 8000);
      const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      // Strip HTML tags before pasting so NLM gets clean readable text
      const cleanContent = targetContent
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
      const formattedText = `Title: ${targetTitle}\nSource: ${targetUrl}\nDate: ${today}\n\n${cleanContent.slice(0, 50000)}`;
      setInputValue(textArea2, formattedText);
      await sleep(400);

      // Click Insert — scope to the open dialog so we don't accidentally click "Add sources"
      const insertBtn2 = await waitFor(() => {
        const dlg = document.querySelector('[role="dialog"], mat-dialog-container, .cdk-dialog-container');
        const root = dlg || document;
        return findByText('Insert', root) || root.querySelector('button[type="submit"]');
      }, 6000);
      insertBtn2.click();
      await sleep(1000);
    } else {
      await sleep(500);
    }

    // ── STEP 6 (podcast only): Trigger Audio Overview ─────────────────
    if (targetMode === 'podcast') {
      // 6a: Wait until at least 1 source is confirmed loaded (up to 30 s)
      //     — do NOT touch Audio Overview until there's actual content
      let sourceReady = false;
      for (let i = 0; i < 20; i++) {
        await sleep(1000);
        const count = getLoadedSourceCount();
        console.log('[NotebookLM Clipper] podcast source count:', count);
        if (count > 0) { sourceReady = true; break; }
      }

      if (!sourceReady) {
        console.warn('[NotebookLM Clipper] No source loaded — skipping Audio Overview');
        return; // user is on NLM, they can trigger it manually
      }

      await sleep(1000);

      // 6b: Click "Audio Overview" card in the Studio panel to open the generator
      const audioCard = await waitFor(() =>
        findByText('Audio Overview') ||
        document.querySelector('[aria-label*="audio overview" i]')
      , 10000, 500);
      audioCard.click();
      await sleep(1500);

      // 6c: Click the "Generate" button that appears inside the Audio Overview panel
      const generateBtn = await waitFor(() =>
        findByText('Generate') ||
        document.querySelector('[aria-label*="generate" i]')
      , 10000, 500);
      if (generateBtn) generateBtn.click();
    }

  } catch (err) {
    // Fail silently — user is already on NLM, they can complete manually
    console.warn('[NotebookLM Clipper] Auto-add step failed:', err.message);
  }
}

// Run after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runClipper);
} else {
  runClipper();
}
