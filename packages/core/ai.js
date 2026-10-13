// AI providers and prompts. Settings (including the API key) live only on this device and never sync.
// Two wire formats: Anthropic's Messages API, and the OpenAI-compatible chat API that the other providers share.
(function (global) {
  const KEY = 'tasklist.ai';

  const PROVIDERS = {
    anthropic:  { name: 'Anthropic (Claude)',       format: 'anthropic', base: 'https://api.anthropic.com',                              model: 'claude-opus-5-5', keyHint: 'sk-ant-…' },
    openai:     { name: 'OpenAI',                   format: 'openai',    base: 'https://api.openai.com/v1',                              model: '',               keyHint: 'sk-…' },
    glm:        { name: 'GLM Coding Plan (Z.ai)',   format: 'openai',    base: 'https://api.z.ai/api/coding/paas/v4',                    model: 'glm-5.2',        keyHint: 'Z.ai API key' },
    glmcn:      { name: 'GLM Coding Plan (China)',  format: 'openai',    base: 'https://open.bigmodel.cn/api/coding/paas/v4',            model: 'glm-5.2',        keyHint: 'BigModel API key' },
    gemini:     { name: 'Google Gemini',            format: 'openai',    base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: '',               keyHint: 'Gemini API key' },
    openrouter: { name: 'OpenRouter',               format: 'openai',    base: 'https://openrouter.ai/api/v1',                           model: '',               keyHint: 'sk-or-…' },
    ollama:     { name: 'Ollama (local)',           format: 'openai',    base: 'http://localhost:11434/v1',                              model: '',               keyHint: 'Not needed', noKey: true },
    custom:     { name: 'Custom (OpenAI-compatible)', format: 'openai',  base: '',                                                       model: '',               keyHint: 'API key (if required)' },
  };

  const DEFAULTS = { enabled: false, provider: 'anthropic', base: PROVIDERS.anthropic.base, key: '', model: PROVIDERS.anthropic.model, completion: true, suggestions: true };

  function getConfig() {
    let c = {};
    try { c = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) {}
    return { ...DEFAULTS, ...c };
  }
  function saveConfig(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (_) {} }
  const isReady = (c = getConfig()) => !!(c.enabled && c.base && c.model && (c.key || PROVIDERS[c.provider]?.noKey || c.provider === 'custom'));

  // ---------- transport ----------
  // Desktop: the Electron main process makes the request (no CORS). Android: Capacitor routes fetch through native HTTP.
  async function httpRequest(url, { method = 'POST', headers = {}, body } = {}, timeoutMs = 90000) {
    if (global.desktop && global.desktop.aiRequest) {
      const r = await global.desktop.aiRequest({ url, method, headers, body: body == null ? undefined : JSON.stringify(body), timeoutMs });
      if (r.error) throw new Error(r.error);
      return { status: r.status, text: r.body };
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method, headers, body: body == null ? undefined : JSON.stringify(body), signal: ctl.signal });
      return { status: res.status, text: await res.text() };
    } catch (err) {
      throw new Error(err.name === 'AbortError' ? 'The AI provider took too long to answer.' : 'Couldn’t reach the AI provider. Check the API address and your connection.');
    } finally { clearTimeout(timer); }
  }

  const trimBase = (b) => String(b || '').trim().replace(/\/+$/, '');
  const isOfficialAnthropic = (c) => /^https:\/\/api\.anthropic\.com$/i.test(trimBase(c.base));
  // Claude models that accept output_config.effort; older or third-party "Anthropic-compatible" models get a plain request.
  const supportsEffort = (model) => /^claude-(opus|sonnet|haiku|fable|mythos)-(5|4-[5-9])/.test(model);
  // Server-side refusal fallback (routes a declined request to another model) on the models that support "default".
  const supportsFallback = (model) => /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/.test(model);

  function apiError(status, text, c) {
    let msg = '';
    try { const j = JSON.parse(text); msg = (j.error && (j.error.message || j.error)) || j.message || ''; } catch (_) {}
    if (status === 401 || status === 403) return new Error(`The API key was rejected (${status}). Check the key in Settings → AI.`);
    if (status === 404) return new Error(`Not found (404). Check the API address and model name${c ? ` (“${c.model}”)` : ''}.`);
    if (status === 429) return new Error('Rate limited or out of quota (429). Try again in a moment.');
    return new Error(`AI request failed (${status})${msg ? `: ${String(msg).slice(0, 200)}` : ''}`);
  }

  // One request, one text answer. `effort` only applies to Claude models that support it.
  async function chat({ system, prompt, maxTokens = 4000, effort = 'low' }, c = getConfig()) {
    if (!isReady(c)) throw new Error('Set up AI first: Settings → AI.');
    const base = trimBase(c.base);
    const p = PROVIDERS[c.provider] || PROVIDERS.custom;
    if (p.format === 'anthropic') {
      const headers = {
        'content-type': 'application/json',
        'x-api-key': c.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
      const body = { model: c.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] };
      if (supportsEffort(c.model)) body.output_config = { effort };
      if (isOfficialAnthropic(c) && supportsFallback(c.model)) { headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; body.fallbacks = 'default'; }
      const r = await httpRequest(`${base}/v1/messages`, { headers, body });
      if (r.status !== 200) throw apiError(r.status, r.text, c);
      const j = JSON.parse(r.text);
      if (j.stop_reason === 'refusal') throw new Error('The model declined this request.');
      return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    }
    const headers = { 'content-type': 'application/json' };
    if (c.key) headers.authorization = `Bearer ${c.key}`;
    if (c.provider === 'openrouter') { headers['x-title'] = 'Tasklist'; }
    const body = { model: c.model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] };
    // OpenAI's newer models only accept max_completion_tokens; the other providers use max_tokens.
    if (/api\.openai\.com/i.test(base)) body.max_completion_tokens = maxTokens; else body.max_tokens = maxTokens;
    const r = await httpRequest(`${base}/chat/completions`, { headers, body });
    if (r.status !== 200) throw apiError(r.status, r.text, c);
    const j = JSON.parse(r.text);
    const msg = j.choices && j.choices[0] && j.choices[0].message;
    const content = msg && (typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map(x => x.text || '').join('') : '');
    return String(content || '').trim();
  }

  async function listModels(c = getConfig()) {
    const base = trimBase(c.base);
    const p = PROVIDERS[c.provider] || PROVIDERS.custom;
    const headers = p.format === 'anthropic'
      ? { 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
      : (c.key ? { authorization: `Bearer ${c.key}` } : {});
    const r = await httpRequest(`${base}${p.format === 'anthropic' ? '/v1/models?limit=100' : '/models'}`, { method: 'GET', headers }, 30000);
    if (r.status !== 200) throw apiError(r.status, r.text);
    const j = JSON.parse(r.text);
    return (j.data || j.models || []).map(m => m.id || m.name).filter(Boolean).sort();
  }

  // ---------- JSON helpers ----------
  function parseJson(text) {
    const t = String(text || '').replace(/```(?:json)?/gi, '').trim();
    const start = t.search(/[[{]/);
    if (start < 0) throw new Error('The AI answer wasn’t in the expected format. Try again.');
    const open = t[start], close = open === '{' ? '}' : ']';
    const end = t.lastIndexOf(close);
    try { return JSON.parse(t.slice(start, end + 1)); }
    catch (_) { throw new Error('The AI answer wasn’t in the expected format. Try again.'); }
  }
  const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

  // ---------- features ----------
  const SYSTEM = 'You are the planning assistant inside Tasklist, a personal to-do app. Be practical and specific. Write task titles as short actionable phrases that start with a verb, in the same language the user writes in. Never add commentary outside the requested format.';

  // Inline completion: returns only the text to append to what the user typed.
  async function complete(typed, ctx) {
    const prompt = [
      'The user is typing a new task title in their to-do app. Suggest how the title most likely continues.',
      `Project: ${ctx.project || 'Inbox'}`,
      ctx.recent && ctx.recent.length ? `Their recent tasks:\n${ctx.recent.map(t => `- ${clip(t, 80)}`).join('\n')}` : '',
      `Typed so far: "${typed}"`,
      'Reply with ONLY the complete task title: it must start with exactly the typed text, then continue it by at most 8 words. No quotes, no explanation. If the title already looks complete, reply with the typed text unchanged.',
    ].filter(Boolean).join('\n\n');
    const out = (await chat({ system: SYSTEM, prompt, maxTokens: 2000, effort: 'low' })).split('\n')[0].replace(/^["'`]+|["'`]+$/g, '');
    // Keep only what comes after the typed text; ignore answers that don't continue it.
    if (!out.toLowerCase().startsWith(typed.toLowerCase())) return '';
    return out.slice(typed.length).replace(/\s+$/, '').slice(0, 80);
  }

  async function suggestTasks(ctx) {
    const prompt = [
      `Today is ${ctx.today}. The user is looking at: ${ctx.viewName}.`,
      ctx.open.length ? `Open tasks here:\n${ctx.open.map(t => `- ${clip(t.title, 100)}${t.due ? ` (due ${t.due})` : ''}`).join('\n')}` : 'There are no open tasks here yet.',
      ctx.done.length ? `Recently completed:\n${ctx.done.map(t => `- ${clip(t, 100)}`).join('\n')}` : '',
      ctx.projects.length ? `Their projects: ${ctx.projects.join(', ')}` : '',
      'Suggest up to 5 next tasks that would move this forward. Do not repeat existing tasks.',
      'Reply with JSON only: {"tasks":[{"title":"…","why":"one short reason","priority":1-4 (1 = most urgent, 4 = normal),"dueInDays":number or null}]}',
    ].filter(Boolean).join('\n\n');
    const j = parseJson(await chat({ system: SYSTEM, prompt, maxTokens: 6000, effort: 'low' }));
    return (j.tasks || []).filter(t => t && t.title).slice(0, 5).map(t => ({
      title: clip(t.title, 140), why: clip(t.why, 160),
      priority: [1, 2, 3, 4].includes(Number(t.priority)) ? Number(t.priority) : 4,
      dueInDays: Number.isFinite(Number(t.dueInDays)) && t.dueInDays !== null ? Math.max(0, Math.round(Number(t.dueInDays))) : null,
    }));
  }

  async function roadmap({ goal, timeframe, start }) {
    const prompt = [
      `Goal: ${clip(goal, 1500)}`,
      `Timeframe: ${timeframe}, starting ${start}.`,
      'Plan this as a roadmap: 3 to 6 sequential phases, each with 2 to 6 concrete tasks. Spread due dates realistically across the timeframe.',
      'Reply with JSON only: {"project":"short project name","phases":[{"name":"short phase name","tasks":[{"title":"…","dueInDays":days after the start date,"priority":1-4}]}]}',
    ].join('\n\n');
    const j = parseJson(await chat({ system: SYSTEM, prompt, maxTokens: 12000, effort: 'medium' }));
    return {
      project: clip(j.project || goal, 60),
      phases: (j.phases || []).filter(p => p && p.name).map(p => ({
        name: clip(p.name, 60),
        tasks: (p.tasks || []).filter(t => t && t.title).map(t => ({
          title: clip(t.title, 140),
          dueInDays: Math.max(0, Math.round(Number(t.dueInDays) || 0)),
          priority: [1, 2, 3, 4].includes(Number(t.priority)) ? Number(t.priority) : 4,
        })),
      })).filter(p => p.tasks.length),
    };
  }

  async function mindmap(topic) {
    const prompt = [
      `Topic: ${clip(topic, 1500)}`,
      'Brainstorm this as a mind map for planning: 4 to 7 main branches, each with 2 to 5 short child items. Branches and children should be actionable where possible.',
      'Reply with JSON only: {"title":"short central title","branches":[{"title":"…","children":["…","…"]}]}',
    ].join('\n\n');
    const j = parseJson(await chat({ system: SYSTEM, prompt, maxTokens: 10000, effort: 'medium' }));
    return {
      title: clip(j.title || topic, 60),
      branches: (j.branches || []).filter(b => b && b.title).map(b => ({ title: clip(b.title, 120), children: (b.children || []).map(x => clip(typeof x === 'string' ? x : x && x.title, 120)).filter(Boolean).slice(0, 8) })),
    };
  }

  // Ideas to add under one node of a mind map (a project's tasks, or a task's sub-tasks).
  async function expand({ node, parent, siblings }) {
    const prompt = [
      parent ? `Context: "${clip(parent, 200)}"` : '',
      `Item to break down: "${clip(node, 200)}"`,
      siblings && siblings.length ? `Already listed under it:\n${siblings.map(s => `- ${clip(s, 100)}`).join('\n')}` : '',
      'Suggest 3 to 5 new, concrete next steps under this item that are not already listed.',
      'Reply with JSON only: {"items":["…","…"]}',
    ].filter(Boolean).join('\n\n');
    const j = parseJson(await chat({ system: SYSTEM, prompt, maxTokens: 6000, effort: 'low' }));
    return (j.items || []).map(x => clip(typeof x === 'string' ? x : x && x.title, 140)).filter(Boolean).slice(0, 6);
  }

  global.TaskAI = { PROVIDERS, getConfig, saveConfig, isReady, chat, listModels, complete, suggestTasks, roadmap, mindmap, expand };
})(window);
