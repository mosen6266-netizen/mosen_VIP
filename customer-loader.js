// Customer reads are atomic: a failed/partial scan never becomes an empty list.
export function recordRows(value) {
  const rows = Array.isArray(value) ? value : value?.items;
  if (!Array.isArray(rows) || rows.some(row => !row || !row.id)) {
    throw new Error('服务器返回的数据格式不完整');
  }
  return rows;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function retryRead(read, { attempts = 3, timeoutMs = 10000, wait = sleep } = {}) {
  for (let attempt = 0; ; attempt++) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(read),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('读取超时')), timeoutMs); })
      ]);
    } catch (error) {
      const status = Number(error?.status || error?.response?.status || 0);
      const retryable = !status || status === 408 || status === 429 || status >= 500;
      if (!retryable || attempt + 1 >= attempts) throw error;
      const header = error?.response?.headers?.['retry-after'];
      const seconds = Number(header);
      const retryAfter = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
      await wait(Math.min(15000, Math.max(700 * 2 ** attempt + Math.random() * 300, retryAfter || 0)));
    } finally { clearTimeout(timer); }
  }
}

export async function readCustomerSnapshot(entity, { repUsername = '', pageSize = 500, retryOptions } = {}) {
  const all = [], ids = new Set();
  for (let skip = 0; ; skip += pageSize) {
    // Keep the sales scope on every request, including retries. Missing archived is active.
    const rows = await retryRead(async () => recordRows(await (repUsername
      ? entity.filter({ rep_username: repUsername }, 'id', pageSize, skip)
      : entity.list('id', pageSize, skip))), retryOptions);
    for (const row of rows) {
      if (ids.has(String(row.id))) throw new Error('客户分页发生变化，请重试');
      ids.add(String(row.id));
      if (repUsername && String(row.rep_username || '') !== repUsername) throw new Error('客户归属校验失败');
      if (row.duplicate_record !== true) all.push(row);
    }
    if (rows.length < pageSize) return all;
    if (skip >= 100000) throw new Error('客户数量超过本次读取上限，请联系管理员');
  }
}

export function createCustomerStore(entity, { repUsername = '', cacheKey, storage, now = Date.now, retryOptions } = {}) {
  const ttl = 30 * 60 * 1000;
  let snapshot = null, inFlight = null;
  try {
    const saved = JSON.parse(storage?.getItem(cacheKey) || 'null');
    if (saved?.version === 1 && now() - saved.at < ttl && saved.scope === repUsername) {
      const rows = recordRows(saved.rows);
      if (rows.every(row => row.duplicate_record !== true && (!repUsername || row.rep_username === repUsername))) snapshot = saved;
    }
  } catch (_) { /* Storage is optional. */ }
  return {
    peek: () => snapshot,
    clear() { snapshot = null; try { storage?.removeItem(cacheKey); } catch (_) {} },
    read({ fresh = false } = {}) {
      // A mutation/event arriving during a read needs a scan started after that read.
      if (inFlight) return fresh ? inFlight.catch(() => {}).then(() => this.read()) : inFlight;
      inFlight = (async () => {
        try {
          let rows = await readCustomerSnapshot(entity, { repUsername, retryOptions });
          // Confirm a surprising empty response before replacing a known nonempty snapshot.
          if (!rows.length && snapshot?.rows.length) rows = await readCustomerSnapshot(entity, { repUsername, retryOptions });
          snapshot = { version: 1, scope: repUsername, rows, at: now() };
          try { storage?.setItem(cacheKey, JSON.stringify(snapshot)); } catch (_) {}
          return { ...snapshot, stale: false };
        } catch (error) {
          if (snapshot && now() - snapshot.at < ttl) return { ...snapshot, stale: true, error };
          throw error;
        } finally { inFlight = null; }
      })();
      return inFlight;
    }
  };
}

export function customerPage(rows, { archived = false, repUsername = '', matches = () => true, sort = 'created_date', page = 1, pageSize = 50 } = {}) {
  const filtered = rows.filter(row => row.duplicate_record !== true && (row.archived === true) === archived &&
    (!repUsername || row.rep_username === repUsername) && matches(row));
  filtered.sort((a, b) => (sort === 'admin_sort_score' ? Number(b.admin_sort_score || 0) - Number(a.admin_sort_score || 0) : 0) ||
    String(b.created_date || '').localeCompare(String(a.created_date || '')) || String(a.id).localeCompare(String(b.id)));
  const current = Math.min(Math.max(1, page), Math.max(1, Math.ceil(filtered.length / pageSize)));
  return { filtered, page: current, rows: filtered.slice((current - 1) * pageSize, current * pageSize), hasNext: current * pageSize < filtered.length };
}

export function customerNotice(list, message, retry) {
  let notice = document.getElementById('customerLoadStatus');
  if (!notice) {
    notice = document.createElement('div'); notice.id = 'customerLoadStatus';
    notice.className = 'notice'; notice.setAttribute('role', 'status');
    list.before(notice);
  }
  notice.replaceChildren(); notice.hidden = !message;
  if (!message) return;
  notice.append(document.createTextNode(message + ' '));
  if (retry) {
    const button = document.createElement('button'); button.type = 'button';
    button.className = 'btn soft'; button.textContent = '重新读取'; button.onclick = retry;
    notice.append(button);
  }
}

// Events can be partial or batched. Never apply them directly to a paginated list.
export function subscribeCustomerRefresh(entity, refresh, { blocked = () => false, delay = 800 } = {}) {
  let timer, running = false, dirty = false, stopped = false;
  async function flush() {
    timer = null;
    if (stopped || !dirty || running) return;
    if (blocked()) { timer = setTimeout(flush, delay); return; }
    dirty = false; running = true;
    try { await refresh(); } catch (error) { console.warn('Customer refresh deferred', error); }
    finally { running = false; if (dirty && !stopped) timer = setTimeout(flush, delay); }
  }
  const unsubscribe = entity.subscribe(() => {
    dirty = true;
    // Fixed window avoids starving the refresh during a continuous event stream.
    if (!timer && !running) timer = setTimeout(flush, delay);
  });
  return () => { stopped = true; clearTimeout(timer); unsubscribe?.(); };
}
