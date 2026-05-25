// ============================================
// POPUP.JS — NotebookLM Web Clipper v2
// Auto-analyzes on open. Two actions:
// 1. Add to NotebookLM (creates notebook + adds URL as source)
// 2. Open as Podcast (same + triggers Audio Overview)
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  const addNlmBtn   = document.getElementById('add-nlm-btn');
  const podcastBtn  = document.getElementById('podcast-btn');
  const rerunBtn    = document.getElementById('rerun-btn');
  const retryBtn    = document.getElementById('retry-btn');
  const loading     = document.getElementById('loading');
  const result      = document.getElementById('result');
  const error       = document.getElementById('error');
  const errorMsg    = document.getElementById('error-message');
  const hookText    = document.getElementById('hook-text');
  const topicsRow   = document.getElementById('topics-row');
  const statusBar   = document.getElementById('status-bar');
  const statusText  = document.getElementById('status-text');

  const settingsBtn         = document.getElementById('settings-btn');
  const settingsPanel       = document.getElementById('settings-panel');
  const settingsClose       = document.getElementById('settings-close');
  const geminiKeyInput      = document.getElementById('gemini-key-input');
  const openrouterKeyInput  = document.getElementById('openrouter-key-input');
  const saveKeysBtn         = document.getElementById('save-keys-btn');
  const clearKeysBtn        = document.getElementById('clear-keys-btn');
  const toggleGeminiKey     = document.getElementById('toggle-gemini-key');
  const toggleOpenrouterKey = document.getElementById('toggle-openrouter-key');

  let currentTabUrl     = '';
  let currentTabTitle   = '';
  let extractedContent  = ''; // cached for text-paste fallback

  // ---- UI State ----

  function showState(state) {
    loading.classList.toggle('hidden', state !== 'loading');
    result.classList.toggle('hidden', state !== 'result');
    error.classList.toggle('hidden', state !== 'error');
    if (state === 'result') result.classList.add('fade-in');
  }

  function showError(msg) {
    errorMsg.textContent = msg;
    showState('error');
  }

  function showStatus(msg) {
    statusText.textContent = msg;
    statusBar.classList.remove('hidden');
  }

  function hideStatus() {
    statusBar.classList.add('hidden');
  }

  // ---- Populate page card ----

  async function populatePageCard() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      currentTabUrl   = tab.url;
      currentTabTitle = tab.title || '';
      const domainEl = document.getElementById('page-domain');
      const titleEl  = document.getElementById('page-title');
      try { domainEl.textContent = new URL(tab.url).hostname.replace(/^www\./, ''); }
      catch (e) { domainEl.textContent = tab.url.slice(0, 40); }
      titleEl.textContent = tab.title || 'Untitled Page';
    } catch (e) { /* stays as "Loading..." */ }
  }

  // ---- Render clip preview ----

  function showPreview(hook, topics) {
    hookText.textContent = hook;
    topicsRow.innerHTML = topics
      .map(t => `<span class="topic-chip">${t}</span>`)
      .join('');
    hideStatus();
    showState('result');
    chrome.storage.session.set({
      cached_hook: hook,
      cached_topics: topics,
      cached_url: currentTabUrl,
      cached_at: Date.now(),
    });
  }

  // ---- Gemini analysis ----

  async function runAnalysis() {
    showState('loading');
    hideStatus();

    try {
      const page = await getPageContent();
      currentTabUrl    = page.url;
      currentTabTitle  = page.title;
      extractedContent = page.text || '';

      const prompt = `Analyze this web page and return ONLY the following two lines, nothing else:

HOOK: [Two sentences: first states what this page covers, second states why it matters for a researcher or professional]
TOPICS: [6-8 comma-separated topic tags, lowercase, no hashtags, relevant to the content]

Page title: ${page.title}
URL: ${page.url}
Content: ${page.text.slice(0, 6000)}`;

      chrome.runtime.sendMessage(
        {
          action: 'callGeminiBackground',
          prompt,
          options: {
            systemInstruction: 'Return exactly two lines: HOOK: and TOPICS:. No other text, no markdown, no explanation.',
            temperature: 0.3,
            maxTokens: 256,
          },
        },
        (response) => {
          if (response?.success) {
            const text = response.data;
            const hookMatch   = text.match(/HOOK:\s*(.+?)(?=\nTOPICS:|$)/s);
            const topicsMatch = text.match(/TOPICS:\s*(.+)/);
            const hook   = hookMatch?.[1]?.trim() || page.title;
            const topics = topicsMatch?.[1]?.split(',').map(t => t.trim()).filter(Boolean) || [];
            showPreview(hook, topics);
          } else {
            showError(response?.error || 'Analysis failed. Try again.');
          }
        }
      );
    } catch (err) {
      showError(err.message || 'Could not read page. Try refreshing.');
    }
  }

  // ---- Add to NotebookLM ----

  async function openNotebookLM(mode) {
    // mode: 'source' | 'podcast'
    showStatus(mode === 'podcast' ? 'Opening NotebookLM as Podcast...' : 'Opening NotebookLM...');
    addNlmBtn.disabled  = true;
    podcastBtn.disabled = true;

    await chrome.storage.local.set({
      nlm_pending_url:     currentTabUrl,
      nlm_pending_title:   currentTabTitle,
      nlm_pending_mode:    mode,
      nlm_pending_content: extractedContent, // fallback for restricted pages
    });

    chrome.tabs.create({ url: 'https://notebooklm.google.com' });

    // Re-enable after short delay (tab is opening)
    setTimeout(() => {
      addNlmBtn.disabled  = false;
      podcastBtn.disabled = false;
      showStatus(mode === 'podcast'
        ? '✓ NotebookLM opened — adding source + starting podcast'
        : '✓ NotebookLM opened — adding source automatically');
    }, 1500);
  }

  // ---- Onboarding ----

  const onboarding          = document.getElementById('onboarding');
  const onboardGeminiInput  = document.getElementById('onboard-gemini-input');
  const onboardOrInput      = document.getElementById('onboard-openrouter-input');
  const onboardSaveBtn      = document.getElementById('onboard-save-btn');

  function showOnboarding() {
    onboarding.classList.remove('hidden');
    loading.classList.add('hidden');
    result.classList.add('hidden');
    error.classList.add('hidden');
  }
  function hideOnboarding() { onboarding.classList.add('hidden'); }

  document.getElementById('onboard-toggle-gemini').addEventListener('click', () => {
    onboardGeminiInput.type = onboardGeminiInput.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('onboard-toggle-openrouter').addEventListener('click', () => {
    onboardOrInput.type = onboardOrInput.type === 'password' ? 'text' : 'password';
  });

  onboardSaveBtn.addEventListener('click', () => {
    const gk = onboardGeminiInput.value.trim();
    const ok = onboardOrInput.value.trim();
    if (!gk && !ok) {
      onboardSaveBtn.textContent = '⚠️ Enter at least one key';
      setTimeout(() => { onboardSaveBtn.textContent = 'Get Started →'; }, 2000);
      return;
    }
    const updates = {};
    if (gk) updates.gemini_api_key = gk;
    if (ok) updates.openrouter_api_key = ok;
    chrome.storage.local.set(updates, () => { hideOnboarding(); initApp(); });
  });

  // ---- Init: check cache or auto-run ----

  async function initApp() {
    await populatePageCard();
    chrome.storage.session.get(['cached_hook', 'cached_topics', 'cached_url', 'cached_at'], (data) => {
      const fresh = data.cached_at && Date.now() - data.cached_at < 10 * 60 * 1000;
      const sameUrl = data.cached_url === currentTabUrl;
      if (fresh && sameUrl && data.cached_hook) {
        showPreview(data.cached_hook, data.cached_topics || []);
      } else {
        runAnalysis();
      }
    });
  }

  chrome.storage.local.get(['gemini_api_key', 'openrouter_api_key'], (keys) => {
    if (!keys.gemini_api_key && !keys.openrouter_api_key) showOnboarding();
    else initApp();
  });

  // ---- Event listeners ----

  addNlmBtn.addEventListener('click', () => openNotebookLM('source'));
  podcastBtn.addEventListener('click', () => openNotebookLM('podcast'));
  rerunBtn.addEventListener('click', runAnalysis);
  retryBtn.addEventListener('click', runAnalysis);

  // ---- Settings ----

  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.remove('hidden');
    settingsPanel.classList.add('fade-in');
    chrome.storage.local.get(['gemini_api_key', 'openrouter_api_key'], (data) => {
      geminiKeyInput.value     = data.gemini_api_key || '';
      openrouterKeyInput.value = data.openrouter_api_key || '';
    });
  });
  settingsClose.addEventListener('click', () => {
    settingsPanel.classList.add('hidden');
    settingsPanel.classList.remove('fade-in');
  });
  toggleGeminiKey.addEventListener('click', () => {
    geminiKeyInput.type = geminiKeyInput.type === 'password' ? 'text' : 'password';
  });
  toggleOpenrouterKey.addEventListener('click', () => {
    openrouterKeyInput.type = openrouterKeyInput.type === 'password' ? 'text' : 'password';
  });
  saveKeysBtn.addEventListener('click', () => {
    const updates = {};
    const gk = geminiKeyInput.value.trim();
    const ok = openrouterKeyInput.value.trim();
    if (gk) updates.gemini_api_key = gk;
    if (ok) updates.openrouter_api_key = ok;
    if (!Object.keys(updates).length) return;
    chrome.storage.local.set(updates, () => {
      saveKeysBtn.textContent = '✅ Saved';
      setTimeout(() => { saveKeysBtn.textContent = 'Save Keys'; }, 1500);
    });
  });
  clearKeysBtn.addEventListener('click', async () => {
    await resetApiKeys();
    geminiKeyInput.value = openrouterKeyInput.value = '';
    clearKeysBtn.textContent = '✅ Cleared';
    setTimeout(() => { clearKeysBtn.textContent = 'Clear All Keys'; }, 1500);
  });
});
