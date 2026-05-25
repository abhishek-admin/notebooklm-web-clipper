// ============================================
// BACKGROUND.JS — Service Worker
// Handles Gemini API calls so they continue
// even after popup closes.
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getPageContent') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'extractContent' }, (response) => {
          sendResponse(response);
        });
      }
    });
    return true;
  }

  if (message.action === 'callGeminiBackground') {
    // Run Gemini call in background — continues even if popup closes
    handleGeminiCall(message.prompt, message.options)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }
});

async function handleGeminiCall(prompt, options = {}) {
  const geminiKey = await new Promise((resolve) => {
    chrome.storage.local.get(['gemini_api_key'], (result) => {
      resolve(result.gemini_api_key);
    });
  });

  const openrouterKey = await new Promise((resolve) => {
    chrome.storage.local.get(['openrouter_api_key'], (result) => {
      resolve(result.openrouter_api_key);
    });
  });

  // If neither key exists, fail with clear message
  if (!geminiKey && !openrouterKey) {
    throw new Error('❌ No API keys set. Click ⚙ → Add Gemini key from aistudio.google.com OR OpenRouter key from openrouter.ai');
  }

  // If only OpenRouter exists, use it directly
  if (!geminiKey && openrouterKey) {
    console.log('[Background] No Gemini key → using OpenRouter');
    return await callOpenRouterBackground(prompt, openrouterKey, options);
  }

  // Try Gemini first
  try {
    const model = options.model || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: options.maxTokens || 2048,
        temperature: options.temperature ?? 0.7,
      },
    };

    if (options.systemInstruction) {
      body.systemInstruction = { parts: [{ text: options.systemInstruction }] };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const errMsg = err?.error?.message || `Gemini ${response.status}`;
      throw new Error(errMsg);
    }

    const data = await response.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  } catch (error) {
    const msg = error.message.toLowerCase();
    const shouldFallback = msg.includes('quota') || msg.includes('rate') || msg.includes('429') ||
      msg.includes('limit') || msg.includes('exhausted') || msg.includes('exceeded');

    if (shouldFallback && openrouterKey) {
      console.log('[Background] Gemini quota → falling back to OpenRouter');
      return await callOpenRouterBackground(prompt, openrouterKey, options);
    }

    throw error;
  }
}

// OpenRouter fallback (runs in background.js, not popup.js)
async function callOpenRouterBackground(prompt, apiKey, options = {}) {
  const OPENROUTER_MODELS = [
    'google/gemini-2.5-flash',
    'google/gemini-2.0-flash',
    'deepseek/deepseek-v4-flash:free',
    'meta-llama/llama-3.3-70b-instruct:free',
  ];

  const models = OPENROUTER_MODELS;
  let lastError = null;

  for (const model of models) {
    try {
      console.log(`[OpenRouter] Trying: ${model}`);

      const body = {
        model,
        messages: [
          ...(options.systemInstruction
            ? [{ role: 'system', content: options.systemInstruction }]
            : []),
          { role: 'user', content: prompt },
        ],
        max_tokens: options.maxTokens || 2048,
        temperature: options.temperature ?? 0.7,
      };

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/abhishek-admin',
          'X-Title': 'Gemini AI Tools',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        lastError = new Error(err?.error?.message || `${model}: HTTP ${response.status}`);
        console.log(`[OpenRouter] ✗ ${model} failed: ${lastError.message}`);
        continue;
      }

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) {
        lastError = new Error(`${model}: empty response`);
        console.log(`[OpenRouter] ✗ ${model} returned empty`);
        continue;
      }

      console.log(`[OpenRouter] ✅ ${model} succeeded`);
      return text;

    } catch (err) {
      lastError = err;
      console.log(`[OpenRouter] ✗ ${model} error: ${err.message}`);
      continue;
    }
  }

  throw lastError || new Error('All OpenRouter models failed. Check your API key at openrouter.ai');
}