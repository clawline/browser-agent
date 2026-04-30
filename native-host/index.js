#!/usr/bin/env node

/**
 * Clawline Native Messaging Host
 *
 * Dual role:
 * 1. Chrome Native Messaging protocol (stdin/stdout, 4-byte LE length prefix + JSON)
 * 2. HTTP Server on port 4820 for external tool integration
 *
 * No external dependencies — uses Node.js built-in modules only.
 */

import { createServer } from 'node:http';
import { createWriteStream, statSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ── Config ──

const HTTP_PORT = parseInt(process.env.CLAWLINE_HOOK_PORT || '4821', 10);
// Bind address: default 0.0.0.0 (all interfaces — LAN reachable).
// Set CLAWLINE_HOOK_HOST=127.0.0.1 to restrict to localhost only.
// SECURITY NOTE: with 0.0.0.0 anyone on the LAN can POST /hook and drive
// the agent. Only run on trusted networks or behind a firewall.
const HTTP_HOST = process.env.CLAWLINE_HOOK_HOST || '0.0.0.0';
const REQUEST_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const ERROR_LOG_PATH = join(dirname(fileURLToPath(import.meta.url)), 'error.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB
const TIMING_ENABLED = process.env.CLAWLINE_TIMING === '1';

let errorStream = createWriteStream(ERROR_LOG_PATH, { flags: 'a' });

// Redact common secret shapes before writing to the persistent error log.
// Covers: Anthropic (sk-ant-*), OpenAI-style (sk-*), Bearer tokens, and x-api-key/api_key values.
const _SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
  /(x-api-key|api[_-]?key|authorization)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}["']?/gi,
];
function redactSecrets(s) {
  let out = String(s);
  for (const re of _SECRET_PATTERNS) out = out.replace(re, '[REDACTED]');
  return out;
}

function rotateLogIfNeeded() {
  try {
    const stat = statSync(ERROR_LOG_PATH);
    if (stat.size > MAX_LOG_SIZE) {
      errorStream.end();
      renameSync(ERROR_LOG_PATH, ERROR_LOG_PATH + '.old');
      errorStream = createWriteStream(ERROR_LOG_PATH, { flags: 'a' });
    }
  } catch {}
}

// ── State ──

const pendingRequests = new Map(); // taskId → { resolve, timer }
let taskCounter = 0;
let chromeConnected = false;
const HOST_STARTED_AT = new Date().toISOString();
let lastSessionsInfo = null; // { sessions, extensionVersion, extensionName, fetchedAt }

// ── Native Messaging Protocol (stdin/stdout) ──

function sendToChrome(msg) {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json, 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  try {
    process.stdout.write(header);
    process.stdout.write(buf);
    log('Sent to Chrome:', msg.type || msg.action || 'unknown', msg.taskId ? `(taskId: ${msg.taskId})` : '');
  } catch (e) {
    log('Failed to send to Chrome:', e.message);
    chromeConnected = false;
  }
}

let stdinBuf = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  // Mark Chrome as connected on first data received
  if (!chromeConnected) {
    chromeConnected = true;
    log('Chrome connection established (first data received)');
  }

  stdinBuf = Buffer.concat([stdinBuf, chunk]);
  // Parse messages: 4-byte LE length + JSON payload
  while (stdinBuf.length >= 4) {
    const msgLen = stdinBuf.readUInt32LE(0);
    if (stdinBuf.length < 4 + msgLen) break; // wait for more data
    const payload = stdinBuf.subarray(4, 4 + msgLen).toString('utf-8');
    stdinBuf = stdinBuf.subarray(4 + msgLen);
    try {
      const msg = JSON.parse(payload);
      log('Received from Chrome:', msg.type || msg.action || 'unknown', msg.taskId ? `(taskId: ${msg.taskId})` : '');
      handleChromeMessage(msg);
    } catch (e) {
      log('Failed to parse Chrome message:', e.message);
    }
  }
});

process.stdin.on('end', () => {
  chromeConnected = false;
  log('Chrome disconnected (stdin closed)');
  // Reject all pending requests
  for (const [taskId, req] of pendingRequests) {
    req.resolve({ status: 'error', taskId, error: 'Chrome extension disconnected' });
    clearTimeout(req.timer);
  }
  pendingRequests.clear();
  process.exit(0);
});

process.stdin.on('error', (err) => {
  log('stdin error:', err.message);
  chromeConnected = false;
});

// ── Chrome Message Handling ──

function handleChromeMessage(msg) {
  // Ping/heartbeat — respond immediately
  if (msg.type === 'ping') {
    try {
      sendToChrome({ type: 'pong', timestamp: Date.now() });
    } catch (e) {
      log('Failed to send pong:', e.message);
    }
    return;
  }

  // Error log — append to local file
  if (msg.type === 'error_log' && msg.error) {
    const e = msg.error;
    const line = `[${e.timestamp || new Date().toISOString()}] [${e.from || 'unknown'}] ${e.message}${e.source ? ` (${e.source}:${e.line}:${e.col})` : ''}${e.stack ? '\n  ' + e.stack.split('\n').slice(0, 10).join('\n  ') : ''}\n`;
    try { rotateLogIfNeeded(); errorStream.write(redactSecrets(line)); } catch {}
    return;
  }

  // Chrome sends responses with type: 'hook_response'
  if (msg.type === 'hook_response' && msg.taskId) {
    const pending = pendingRequests.get(msg.taskId);
    if (pending) {
      if (msg.status === 'started') {
        // Idempotent: only the first 'started' message is recorded. A duplicate
        // (or a rogue 'started' after a real final response) must not overwrite
        // the resolver and leave the HTTP request hanging forever.
        if (!pending.startedData) pending.startedData = msg;
        return;
      }
      clearTimeout(pending.timer);
      pendingRequests.delete(msg.taskId);
      // Final response (completed / error / stopped)
      pending.resolve(msg);
    }
    return;
  }

  // Sessions list response
  if (msg.type === 'sessions') {
    // Cache latest sessions snapshot so GET / can return rich discovery info
    lastSessionsInfo = {
      sessions: msg.sessions || [],
      extensionVersion: msg.extensionVersion || null,
      extensionName: msg.extensionName || null,
      fetchedAt: new Date().toISOString(),
    };
    const pending = pendingRequests.get('__list_sessions');
    if (pending) {
      clearTimeout(pending.timer);
      pendingRequests.delete('__list_sessions');
      pending.resolve(msg);
    }
    return;
  }

  if (msg.type === 'recordings_list' && msg.requestId) {
    const pending = pendingRequests.get(msg.requestId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingRequests.delete(msg.requestId);
      pending.resolve(msg);
    }
    return;
  }

  if (msg.type === 'recording_detail' && msg.requestId) {
    const pending = pendingRequests.get(msg.requestId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingRequests.delete(msg.requestId);
      pending.resolve(msg);
    }
    return;
  }

  if (msg.type === 'recording_update' && msg.requestId) {
    const pending = pendingRequests.get(msg.requestId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingRequests.delete(msg.requestId);
      pending.resolve(msg);
    }
    return;
  }

  if (msg.type === 'replay_response' && msg.taskId) {
    const pending = pendingRequests.get(msg.taskId);
    if (pending) {
      if (msg.status === 'started') {
        if (!pending.startedData) pending.startedData = msg;
        return;
      }
      clearTimeout(pending.timer);
      pendingRequests.delete(msg.taskId);
      pending.resolve(msg);
    }
    return;
  }
}

// ── HTTP Server ──

function generateTaskId() {
  return 'task_' + Date.now() + '_' + (++taskCounter);
}

// Mutate sessions[] in place, adding `busy` + `runningTasks` per window based
// on currently-pending /hook requests. Lets callers see which sidepanels are
// occupied before launching parallel work.
function annotateBusy(sessions) {
  if (!Array.isArray(sessions)) return sessions;
  const byWindow = new Map(); // windowId → [{taskId, startedAt, tabId}]
  const now = Date.now();
  for (const [taskId, p] of pendingRequests) {
    if (typeof taskId !== 'string' || taskId.startsWith('__')) continue;
    if (p.windowId == null) continue;
    if (!byWindow.has(p.windowId)) byWindow.set(p.windowId, []);
    byWindow.get(p.windowId).push({
      taskId,
      tabId: p.tabId,
      startedAt: p.startedAt || null,
      runningMs: p.startedAt ? now - p.startedAt : null,
    });
  }
  for (const s of sessions) {
    const tasks = byWindow.get(s.windowId) || [];
    s.busy = tasks.length > 0;
    s.runningTasks = tasks;
  }
  return sessions;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalSize = 0;
    const MAX_BODY_SIZE = 1024 * 1024; // 1 MB
    req.on('data', (c) => {
      totalSize += c.length;
      if (totalSize > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body exceeds 1MB limit'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${HTTP_PORT}`);
  const path = url.pathname;

  try {
    // POST /hook — send a task
    if (req.method === 'POST' && path === '/hook') {
      if (!chromeConnected) {
        sendJSON(res, 503, { error: 'Chrome extension not connected' });
        return;
      }

      const body = await parseBody(req);
      if (!body.task) {
        sendJSON(res, 400, { error: 'Missing required field: task' });
        return;
      }

      const taskId = generateTaskId();
      const msg = {
        action: body.action || 'start_task',
        taskId,
        task: body.task,
        tabId: body.tabId || null,
        windowId: body.windowId || null,
        conversationId: body.conversationId || null,
        model: body.model || null,
        apiUrl: body.apiUrl || null,
        apiKey: body.apiKey || null,
        include_tools: body.include_tools === true,
        include_screenshot: body.include_screenshot === true,
        record: body.record === true,
        recording: body.recording || null,
      };

      // Create pending request
      const promise = new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(taskId);
          resolve({ status: 'timeout', taskId, error: 'Request timed out' });
        }, REQUEST_TIMEOUT);
        pendingRequests.set(taskId, { resolve, timer, windowId: body.windowId || null, tabId: body.tabId || null, startedAt: Date.now() });
      });

      // If the HTTP client disconnects before the task finishes, free the timer
      // and the Map slot (otherwise REQUEST_TIMEOUT worth of timers accumulate)
      // and tell Chrome to stop the in-flight task.
      const onClientGone = () => {
        const p = pendingRequests.get(taskId);
        if (!p) return;
        clearTimeout(p.timer);
        pendingRequests.delete(taskId);
        if (chromeConnected) { try { sendToChrome({ type: 'hook_stop', taskId }); } catch {} }
        p.resolve({ status: 'aborted', taskId, error: 'Client disconnected' });
      };
      res.on('close', () => { if (!res.writableEnded) onClientGone(); });

      // Timing (dev-only via CLAWLINE_TIMING=1): record server-side processing window
      const _t_received = TIMING_ENABLED ? Date.now() : 0;

      // Send to Chrome
      sendToChrome(msg);

      // Wait for result
      const result = await promise;
      if (TIMING_ENABLED) {
        const _t_responded = Date.now();
        result._timing = {
          received_at: _t_received,
          responded_at: _t_responded,
          server_ms: _t_responded - _t_received,
        };
      }
      const httpStatus = result.status === 'error' ? 500 : 200;
      sendJSON(res, httpStatus, result);
      return;
    }

    // GET /status/:taskId — check task status
    if (req.method === 'GET' && path.startsWith('/status/')) {
      const taskId = path.slice('/status/'.length);
      const pending = pendingRequests.get(taskId);
      if (!pending) {
        sendJSON(res, 404, { taskId, status: 'not_found' });
      } else if (pending.startedData) {
        sendJSON(res, 200, { ...pending.startedData, status: 'running' });
      } else {
        sendJSON(res, 200, { taskId, status: 'pending' });
      }
      return;
    }

    // POST /stop/:taskId — stop a task
    if (req.method === 'POST' && path.startsWith('/stop/')) {
      if (!chromeConnected) {
        sendJSON(res, 503, { error: 'Chrome extension not connected' });
        return;
      }
      const taskId = path.slice('/stop/'.length);
      sendToChrome({ type: 'hook_stop', taskId });
      sendJSON(res, 200, { taskId, status: 'stop_requested' });
      return;
    }

    // GET /sessions — list active sidepanel connections
    if (req.method === 'GET' && path === '/sessions') {
      if (!chromeConnected) {
        sendJSON(res, 503, { error: 'Chrome extension not connected' });
        return;
      }

      const promise = new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingRequests.delete('__list_sessions');
          resolve({ sessions: [], error: 'Timeout listing sessions' });
        }, 5000);
        pendingRequests.set('__list_sessions', { resolve, timer });
      });

      sendToChrome({ action: 'list_sessions' });
      const result = await promise;
      annotateBusy(result.sessions);
      sendJSON(res, 200, result);
      return;
    }

    // GET /recordings — list reusable recorded browser flows
    if (req.method === 'GET' && path === '/recordings') {
      if (!chromeConnected) {
        sendJSON(res, 503, { error: 'Chrome extension not connected' });
        return;
      }

      const requestId = '__list_recordings_' + Date.now() + '_' + (++taskCounter);
      const promise = new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(requestId);
          resolve({ type: 'recordings_list', requestId, recordings: [], error: 'Timeout listing recordings' });
        }, 5000);
        pendingRequests.set(requestId, { resolve, timer });
      });

      sendToChrome({ action: 'list_recordings', requestId, windowId: url.searchParams.get('windowId') ? Number(url.searchParams.get('windowId')) : null, tabId: url.searchParams.get('tabId') ? Number(url.searchParams.get('tabId')) : null });
      const result = await promise;
      sendJSON(res, result.error ? 500 : 200, result);
      return;
    }

    // GET /recordings/:id — fetch one reusable flow including replay steps
    if (req.method === 'GET' && path.startsWith('/recordings/')) {
      if (!chromeConnected) {
        sendJSON(res, 503, { error: 'Chrome extension not connected' });
        return;
      }
      const recordingId = decodeURIComponent(path.slice('/recordings/'.length));
      if (!recordingId) {
        sendJSON(res, 400, { error: 'Missing recording id' });
        return;
      }

      const requestId = '__get_recording_' + Date.now() + '_' + (++taskCounter);
      const promise = new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(requestId);
          resolve({ type: 'recording_detail', requestId, recording: null, error: 'Timeout loading recording' });
        }, 5000);
        pendingRequests.set(requestId, { resolve, timer });
      });

      sendToChrome({ action: 'get_recording', requestId, recordingId, windowId: url.searchParams.get('windowId') ? Number(url.searchParams.get('windowId')) : null, tabId: url.searchParams.get('tabId') ? Number(url.searchParams.get('tabId')) : null });
      const result = await promise;
      sendJSON(res, result.error ? 404 : 200, result);
      return;
    }

    // PATCH/POST /recordings/:id — update metadata or repaired replay steps
    if ((req.method === 'PATCH' || req.method === 'POST') && path.startsWith('/recordings/')) {
      if (!chromeConnected) {
        sendJSON(res, 503, { error: 'Chrome extension not connected' });
        return;
      }
      const recordingId = decodeURIComponent(path.slice('/recordings/'.length));
      if (!recordingId) {
        sendJSON(res, 400, { error: 'Missing recording id' });
        return;
      }
      const body = await parseBody(req);
      const requestId = '__update_recording_' + Date.now() + '_' + (++taskCounter);
      const promise = new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(requestId);
          resolve({ type: 'recording_update', requestId, recording: null, error: 'Timeout updating recording' });
        }, 5000);
        pendingRequests.set(requestId, { resolve, timer });
      });

      sendToChrome({ action: 'update_recording', requestId, recordingId, patch: body, windowId: url.searchParams.get('windowId') ? Number(url.searchParams.get('windowId')) : null, tabId: url.searchParams.get('tabId') ? Number(url.searchParams.get('tabId')) : null });
      const result = await promise;
      sendJSON(res, result.error ? 404 : 200, result);
      return;
    }

    // POST /replay — run a saved flow deterministically without model calls
    if (req.method === 'POST' && path === '/replay') {
      if (!chromeConnected) {
        sendJSON(res, 503, { error: 'Chrome extension not connected' });
        return;
      }
      const body = await parseBody(req);
      if (!body.recordingId) {
        sendJSON(res, 400, { error: 'Missing required field: recordingId' });
        return;
      }

      const taskId = generateTaskId();
      const msg = {
        action: 'replay_recording',
        taskId,
        recordingId: body.recordingId,
        inputs: body.inputs || {},
        tabId: body.tabId || null,
        windowId: body.windowId || null,
      };

      const promise = new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(taskId);
          resolve({ status: 'timeout', taskId, recordingId: body.recordingId, error: 'Replay timed out' });
        }, REQUEST_TIMEOUT);
        pendingRequests.set(taskId, { resolve, timer, windowId: body.windowId || null, tabId: body.tabId || null, startedAt: Date.now() });
      });

      sendToChrome(msg);
      const result = await promise;
      const httpStatus = result.status === 'error' ? 500 : 200;
      sendJSON(res, httpStatus, result);
      return;
    }

    // GET / — health check + discovery info
    if (req.method === 'GET' && path === '/') {
      // Proactively refresh sessions snapshot if stale (>5s) and Chrome is connected
      const stale = !lastSessionsInfo || (Date.now() - new Date(lastSessionsInfo.fetchedAt).getTime() > 5000);
      if (chromeConnected && stale) {
        try { sendToChrome({ action: 'list_sessions' }); } catch {}
        // Don't wait — we serve whatever we have; next GET / will see fresh data
      }
      sendJSON(res, 200, {
        name: 'clawline-hook',
        version: '1.0.0',
        pid: process.pid,
        hostStartedAt: HOST_STARTED_AT,
        chromeConnected,
        port: actualPort,
        pendingTasks: pendingRequests.size,
        extensionName: lastSessionsInfo?.extensionName || null,
        extensionVersion: lastSessionsInfo?.extensionVersion || null,
        windows: annotateBusy(structuredClone(lastSessionsInfo?.sessions || [])),
        sessionsFetchedAt: lastSessionsInfo?.fetchedAt || null,
      });
      return;
    }

    sendJSON(res, 404, { error: 'Not found' });
  } catch (e) {
    sendJSON(res, 500, { error: e.message });
  }
});

let actualPort = HTTP_PORT;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    actualPort++;
    if (actualPort > HTTP_PORT + 10) {
      log(`All ports ${HTTP_PORT}-${actualPort - 1} in use, giving up`);
      return;
    }
    log(`Port ${actualPort - 1} in use, trying ${actualPort}...`);
    server.listen(actualPort, HTTP_HOST);
  } else {
    log('HTTP server error:', err.message);
  }
});

server.listen(HTTP_PORT, HTTP_HOST);

server.on('listening', () => {
  actualPort = server.address().port;
  log(`HTTP server listening on http://${HTTP_HOST}:${actualPort}` + (HTTP_HOST === '0.0.0.0' ? ' (LAN reachable)' : ''));
  sendToChrome({ type: 'hook_port', port: actualPort });
});

// ── Logging (to stderr, since stdout is for native messaging) ──

function log(...args) {
  process.stderr.write('[clawline-hook] ' + args.join(' ') + '\n');
}

log('Native messaging host started');
