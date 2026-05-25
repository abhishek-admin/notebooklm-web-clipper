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
  await sleep(2000);

  try {
    // ── STEP 1: Click "+ Create new" ──────────────────────────────────
    const createBtn = await waitFor(() =>
      findByText('Create new') ||
      document.querySelector('[aria-label*="Create new" i]')
    );
    createBtn.click();
    await sleep(2500); // wait for notebook page to open

    // ── STEP 2: Click "Add source" inside the new notebook ────────────
    const addSourceBtn = await waitFor(() =>
      findByText('Add source') ||
      findByText('Add sources') ||
      document.querySelector('[aria-label*="Add source" i]')
    , 12000);
    addSourceBtn.click();
    await sleep(800);

    // ── STEP 3: Select "Website" / "Link" source type ─────────────────
    const websiteBtn = await waitFor(() =>
      findByText('Website') ||
      findByText('Link') ||
      findByText('URL') ||
      document.querySelector('[aria-label*="website" i]') ||
      document.querySelector('[aria-label*="url" i]')
    , 8000);
    websiteBtn.click();
    await sleep(600);

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
    await sleep(400);

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

    // Dialog closes — poll for up to 12 s for NLM to async-fetch the URL
    await sleep(1500); // let dialog animate out first

    const ERROR_PHRASES = [
      'source restriction', 'unable to import', "can't be added",
      "couldn't be imported", 'failed to import', 'cannot be imported',
      'import failed', 'web page restrict', 'could not be added',
    ];

    // ── STEP 5b: Detect restriction error on the source card ──────────
    function pageHasRestrictionError() {
      // Primary: check all rendered text on the page
      const body = document.body.innerText.toLowerCase();
      if (ERROR_PHRASES.some(p => body.includes(p))) return true;
      // Secondary: check aria-labels and titles on any element
      for (const el of document.querySelectorAll('[aria-label],[title]')) {
        const attr = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
        if (attr.includes('error') || attr.includes('restriction') || attr.includes('failed')) return true;
      }
      return false;
    }

    // Poll up to 12 s total (1.5 s already elapsed)
    let hasRestriction = false;
    for (let i = 0; i < 11; i++) {
      await sleep(1000);
      if (pageHasRestrictionError()) { hasRestriction = true; break; }
      // Also stop early if a source was successfully loaded (no need to wait further)
      const successCard = document.querySelector('[class*="source" i] [class*="check" i], [class*="source" i] [class*="done" i]');
      if (successCard) break;
    }
    console.log('[NotebookLM Clipper] restriction detected:', hasRestriction, '| has content:', !!targetContent);

    if (hasRestriction && targetContent) {
      // No open dialog to close — error is on the source card in the panel

      // Re-open Add sources
      const addBtn2 = await waitFor(() =>
        findByText('Add source') || findByText('Add sources')
      , 6000);
      addBtn2.click();
      await sleep(800);

      // Click "Copied text" / "Paste text" option
      const textBtn = await waitFor(() =>
        findByText('Copied text') ||
        findByText('Paste text') ||
        findByText('Text') ||
        document.querySelector('[aria-label*="paste" i]') ||
        document.querySelector('[aria-label*="text" i]')
      , 6000);
      textBtn.click();
      await sleep(600);

      // Fill the textarea with formatted content
      const textArea2 = await waitFor(() => document.querySelector('textarea'), 6000);
      const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const formattedText = `Title: ${targetTitle}\nSource: ${targetUrl}\nDate: ${today}\n\n${targetContent.slice(0, 50000)}`;
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
      // Wait for source to finish processing (up to 30s)
      const genBtn = await waitFor(() =>
        findByText('Generate') ||
        findByText('Audio Overview') ||
        findByText('Customize') ||
        document.querySelector('[aria-label*="audio overview" i]') ||
        document.querySelector('[aria-label*="generate" i]')
      , 30000, 1000);

      if (genBtn) {
        genBtn.click();
        await sleep(500);
        // If a "Generate" confirm dialog appears, click it
        const confirmBtn = findByText('Generate') || findByText('Start');
        if (confirmBtn) confirmBtn.click();
      }
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
