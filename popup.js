// ============================================
// POPUP.JS — NotebookLM Web Clipper
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  const actionBtn = document.getElementById('action-btn');
  const retryBtn = document.getElementById('retry-btn');
  const copyBtn = document.getElementById('copy-btn');
  const rerunBtn = document.getElementById('rerun-btn');
  const openNotebooklmBtn = document.getElementById('open-notebooklm-btn');
  const mainContent = document.getElementById('main-content');
  const loading = document.getElementById('loading');
  const result = document.getElementById('result');
  const resultContent = document.getElementById('result-content');
  const error = document.getElementById('error');
  const errorMessage = document.getElementById('error-message');

  const settingsBtn = document.getElementById('settings-btn');
  const settingsPanel = document.getElementById('settings-panel');
  const settingsClose = document.getElementById('settings-close');
  const geminiKeyInput = document.getElementById('gemini-key-input');
  const openrouterKeyInput = document.getElementById('openrouter-key-input');
  const saveKeysBtn = document.getElementById('save-keys-btn');
  const clearKeysBtn = document.getElementById('clear-keys-btn');
  const toggleGeminiKey = document.getElementById('toggle-gemini-key');
  const toggleOpenrouterKey = document.getElementById('toggle-openrouter-key');

  let currentTabUrl = '';

  // ---- Markdown → HTML ----

  function renderMarkdown(text) {
    let html = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/^# (.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^---$/gm, '<hr>');

    html = html.replace(/((?:^\|.+\|$\n?)+)/gm, (tableBlock) => {
      const rows = tableBlock.trim().split('\n').filter(r => r.trim());
      if (rows.length < 2 || !/^\|[\s\-:]+\|/.test(rows[1])) return tableBlock;
      const parseRow = (row) => row.split('|').slice(1, -1).map(c => c.trim());
      const headers = parseRow(rows[0]);
      let table = '<table><thead><tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
      rows.slice(2).forEach(row => {
        const cells = parseRow(row);
        table += '<tr>' + cells.map(c => `<td>${c.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</td>`).join('') + '</tr>';
      });
      return table + '</tbody></table>';
    });

    html = html.replace(/((?:^- .+$\n?)+)/gm, (block) => {
      return '<ul>' + block.trim().split('\n').map(l => `<li>${l.replace(/^- /, '').trim()}</li>`).join('') + '</ul>';
    });

    html = html.replace(/((?:^\d+\. .+$\n?)+)/gm, (block) => {
      return '<ol>' + block.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '').trim()}</li>`).join('') + '</ol>';
    });

    html = html.split(/\n{2,}/).map(chunk => {
      const t = chunk.trim();
      if (!t) return '';
      if (/^<(h[2-4]|ul|ol|table|hr)/.test(t)) return t;
      return `<p>${t.replace(/\n/g, '<br>')}</p>`;
    }).join('');

    return html;
  }

  // ---- UI State Machine ----

  function showState(state) {
    mainContent.classList.toggle('hidden', state !== 'idle');
    loading.classList.toggle('hidden', state !== 'loading');
    result.classList.toggle('hidden', state !== 'result');
    error.classList.toggle('hidden', state !== 'error');
    if (state === 'result') result.classList.add('fade-in');
  }

  function showResult(text) {
    resultContent.innerHTML = renderMarkdown(text);
    showState('result');
    chrome.storage.session.set({
      cached_result: text,
      cached_at: Date.now(),
      cached_url: currentTabUrl,
    });
  }

  function showError(msg) {
    errorMessage.textContent = msg;
    showState('error');
  }

  // ---- Populate page card ----

  async function populatePageCard() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      currentTabUrl = tab.url;
      const domainEl = document.getElementById('page-domain');
      const titleEl = document.getElementById('page-title');
      if (domainEl) {
        try {
          domainEl.textContent = new URL(tab.url).hostname.replace(/^www\./, '');
        } catch (e) {
          domainEl.textContent = tab.url.slice(0, 40);
        }
      }
      if (titleEl) titleEl.textContent = tab.title || 'Untitled Page';
    } catch (e) {
      // page card stays as "Loading..."
    }
  }

  // ---- First-run onboarding ----

  const onboarding = document.getElementById('onboarding');
  const onboardGeminiInput = document.getElementById('onboard-gemini-input');
  const onboardOpenrouterInput = document.getElementById('onboard-openrouter-input');
  const onboardSaveBtn = document.getElementById('onboard-save-btn');

  function showOnboarding() {
    onboarding.classList.remove('hidden');
    mainContent.classList.add('hidden');
    loading.classList.add('hidden');
    result.classList.add('hidden');
    error.classList.add('hidden');
  }

  function hideOnboarding() { onboarding.classList.add('hidden'); }

  document.getElementById('onboard-toggle-gemini').addEventListener('click', () => {
    onboardGeminiInput.type = onboardGeminiInput.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('onboard-toggle-openrouter').addEventListener('click', () => {
    onboardOpenrouterInput.type = onboardOpenrouterInput.type === 'password' ? 'text' : 'password';
  });

  onboardSaveBtn.addEventListener('click', () => {
    const gk = onboardGeminiInput.value.trim();
    const ok = onboardOpenrouterInput.value.trim();
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

  // ---- Restore cache on popup open ----

  async function initApp() {
    await populatePageCard();
    chrome.storage.session.get(['cached_result', 'cached_at', 'cached_url'], (data) => {
      if (
        data.cached_result &&
        data.cached_at &&
        Date.now() - data.cached_at < 10 * 60 * 1000 &&
        data.cached_url === currentTabUrl
      ) {
        resultContent.innerHTML = renderMarkdown(data.cached_result);
        showState('result');
        return;
      }
      showState('idle');
    });
  }

  chrome.storage.local.get(['gemini_api_key', 'openrouter_api_key'], (keys) => {
    if (!keys.gemini_api_key && !keys.openrouter_api_key) showOnboarding();
    else initApp();
  });

  // ============================================
  // ▼▼▼ ACTION LOGIC ▼▼▼
  // ============================================

  async function runAction() {
    showState('loading');

    try {
      const page = await getPageContent();
      currentTabUrl = page.url;

      const today = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      });

      const prompt = `Create a structured research note for saving to NotebookLM.

Page details:
Title: ${page.title}
URL: ${page.url}
Date: ${today}${page.metaDescription ? `\nDescription: ${page.metaDescription}` : ''}

Content:
${page.text.slice(0, 8000)}

Format the note EXACTLY like this (use these exact headings):

# ${page.title.slice(0, 70)}

**Source:** ${page.url}
**Date:** ${today}

## Summary
[Write 3-4 sentences capturing the core message and main argument of this page]

## Key Points
- [Most important insight or fact]
- [Second key point]
- [Third key point]
- [Fourth key point]
- [Fifth key point if content warrants it]

## Tags
[8-10 relevant topic tags, comma-separated, lowercase]`;

      chrome.runtime.sendMessage(
        {
          action: 'callGeminiBackground',
          prompt,
          options: {
            systemInstruction: 'You are a research assistant creating structured notes for NotebookLM. Format notes precisely as requested. Be concise and information-dense. Do not add extra sections.',
            temperature: 0.3,
            maxTokens: 1024,
          },
        },
        (response) => {
          if (response?.success) {
            showResult(response.data);
          } else {
            showError(response?.error || 'Failed to generate clip. Try again.');
          }
        }
      );
    } catch (err) {
      showError(err.message || 'Could not read page content. Try refreshing the page.');
    }
  }

  // ============================================
  // ▲▲▲ END ACTION LOGIC ▲▲▲
  // ============================================

  // ---- Open NotebookLM ----

  openNotebooklmBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://notebooklm.google.com' });
  });

  // ---- Settings Panel ----

  function openSettings() {
    settingsPanel.classList.remove('hidden');
    settingsPanel.classList.add('fade-in');
    chrome.storage.local.get(['gemini_api_key', 'openrouter_api_key'], (data) => {
      geminiKeyInput.value = data.gemini_api_key || '';
      openrouterKeyInput.value = data.openrouter_api_key || '';
    });
  }

  function closeSettings() {
    settingsPanel.classList.add('hidden');
    settingsPanel.classList.remove('fade-in');
  }

  settingsBtn.addEventListener('click', openSettings);
  settingsClose.addEventListener('click', closeSettings);

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
    if (Object.keys(updates).length === 0) return;
    chrome.storage.local.set(updates, () => {
      saveKeysBtn.textContent = '✅ Saved';
      setTimeout(() => { saveKeysBtn.textContent = 'Save Keys'; }, 1500);
    });
  });

  clearKeysBtn.addEventListener('click', async () => {
    await resetApiKeys();
    geminiKeyInput.value = '';
    openrouterKeyInput.value = '';
    clearKeysBtn.textContent = '✅ Cleared';
    setTimeout(() => { clearKeysBtn.textContent = 'Clear All Keys'; }, 1500);
  });

  // ---- Event Listeners ----

  actionBtn.addEventListener('click', runAction);
  retryBtn.addEventListener('click', runAction);
  rerunBtn.addEventListener('click', runAction);

  copyBtn.addEventListener('click', () => {
    const temp = document.createElement('div');
    temp.innerHTML = resultContent.innerHTML;
    const text = temp.textContent || temp.innerText;
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.textContent = '✅';
      setTimeout(() => { copyBtn.textContent = '📋'; }, 1500);
    });
  });
});
