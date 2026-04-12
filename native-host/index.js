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
const REQUEST_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const ERROR_LOG_PATH = join(dirname(fileURLToPath(import.meta.url)), 'error.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB

let errorStream = createWriteStream(ERROR_LOG_PATH, { flags: 'a' });

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

// ── Native Messaging Protocol (stdin/stdout) ──

function sendToChrome(msg) {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json, 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
}

let stdinBuf = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  stdinBuf = Buffer.concat([stdinBuf, chunk]);
  // Parse messages: 4-byte LE length + JSON payload
  while (stdinBuf.length >= 4) {
    const msgLen = stdinBuf.readUInt32LE(0);
    if (stdinBuf.length < 4 + msgLen) break; // wait for more data
    const payload = stdinBuf.subarray(4, 4 + msgLen).toString('utf-8');
    stdinBuf = stdinBuf.subarray(4 + msgLen);
    try {
      const msg = JSON.parse(payload);
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

// Mark Chrome as connected once we start receiving
chromeConnected = true;

// ── Chrome Message Handling ──

function handleChromeMessage(msg) {
  // Error log — append to local file
  if (msg.type === 'error_log' && msg.error) {
    const e = msg.error;
    const line = `[${e.timestamp || new Date().toISOString()}] [${e.from || 'unknown'}] ${e.message}${e.source ? ` (${e.source}:${e.line}:${e.col})` : ''}${e.stack ? '\n  ' + e.stack.split('\n').slice(0, 10).join('\n  ') : ''}\n`;
    try { rotateLogIfNeeded(); errorStream.write(line); } catch {}
    return;
  }

  // Chrome sends responses with type: 'hook_response'
  if (msg.type === 'hook_response' && msg.taskId) {
    const pending = pendingRequests.get(msg.taskId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingRequests.delete(msg.taskId);

      if (msg.status === 'started') {
        // Task started — update pending to wait for completion
        // Store initial response data, keep waiting
        pending.startedData = msg;
        pendingRequests.set(msg.taskId, pending);
        return;
      }

      // Final response (completed / error / stopped)
      pending.resolve(msg);
    }
    return;
  }

  // Sessions list response
  if (msg.type === 'sessions') {
    const pending = pendingRequests.get('__list_sessions');
    if (pending) {
      clearTimeout(pending.timer);
      pendingRequests.delete('__list_sessions');
      pending.resolve(msg);
    }
    return;
  }
}

// ── HTTP Server ──

function generateTaskId() {
  return 'task_' + Date.now() + '_' + (++taskCounter);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
      };

      // Create pending request
      const promise = new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(taskId);
          resolve({ status: 'timeout', taskId, error: 'Request timed out' });
        }, REQUEST_TIMEOUT);
        pendingRequests.set(taskId, { resolve, timer });
      });

      // Send to Chrome
      sendToChrome(msg);

      // Wait for result
      const result = await promise;
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
      sendJSON(res, 200, result);
      return;
    }

    // GET / — health check
    if (req.method === 'GET' && path === '/') {
      sendJSON(res, 200, {
        name: 'clawline-hook',
        version: '1.0.0',
        chromeConnected,
        pendingTasks: pendingRequests.size,
      });
      return;
    }

    sendJSON(res, 404, { error: 'Not found' });
  } catch (e) {
    sendJSON(res, 500, { error: e.message });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log(`Port ${HTTP_PORT} in use, retrying in 2s...`);
    setTimeout(() => {
      server.close();
      server.listen(HTTP_PORT, '127.0.0.1');
    }, 2000);
  } else {
    log('HTTP server error:', err.message);
  }
});

server.listen(HTTP_PORT, '127.0.0.1', () => {
  log(`HTTP server listening on http://127.0.0.1:${HTTP_PORT}`);
});

// ── Logging (to stderr, since stdout is for native messaging) ──

function log(...args) {
  process.stderr.write('[clawline-hook] ' + args.join(' ') + '\n');
}

log('Native messaging host started');
