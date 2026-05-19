// Music Uploader — Add Music FAB + drag-drop modal.
//
// Loaded by Jellyfin's web client when the user pastes
//   <script src="/musicup/frontend/js/uploader.js" defer></script>
// into Dashboard → Branding → Custom CSS (the field is interpolated into
// every page's <head>, so HTML tags inside it work fine).
//
// Behavior:
//   1. Probe ApiClient.getCurrentUser(); show the FAB only for admins.
//   2. Click FAB → modal with a drop zone.
//   3. Drop one or more folders. Folders must look like
//      Artist/Album/<songs> or Artist/<songs> (single-album short form).
//      Per drop: the first directory level is treated as Artist, the
//      second (if present) as Album. Files directly under Artist with
//      no Album subfolder get placed under Artist/Unknown Album/.
//   4. Preview the tree, then POST each file to /musicup/upload with
//      a multipart body containing the file + its relativePath.
//   5. After the batch finishes, POST /musicup/refresh to kick the
//      library scan.

(function () {
  'use strict';

  const POLL_MS = 1500;
  const FAB_ID = 'musicup-fab';
  const MODAL_ID = 'musicup-modal';
  const STYLE_ID = 'musicup-style';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${FAB_ID} {
        position: fixed; right: 24px; bottom: 24px; z-index: 9998;
        height: 56px; padding: 0 22px; border-radius: 28px; border: none;
        background: #00a4dc; color: #fff; font-size: 14px; font-weight: 600;
        letter-spacing: 0.3px; cursor: pointer;
        box-shadow: 0 4px 14px rgba(0,0,0,0.35);
        display: inline-flex; align-items: center; gap: 8px;
      }
      #${FAB_ID}:hover { background: #00b8f4; }
      #${FAB_ID} svg { width: 18px; height: 18px; fill: currentColor; }

      #${MODAL_ID}-backdrop {
        position: fixed; inset: 0; background: rgba(0,0,0,0.55);
        z-index: 9999; display: flex; align-items: center; justify-content: center;
      }
      #${MODAL_ID} {
        width: min(640px, 92vw); max-height: 86vh; overflow: hidden;
        background: #1c1c1c; color: #eee; border-radius: 10px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.6);
        display: flex; flex-direction: column;
        font-family: inherit;
      }
      #${MODAL_ID} header {
        padding: 14px 18px; display: flex; align-items: center; justify-content: space-between;
        border-bottom: 1px solid #2b2b2b;
      }
      #${MODAL_ID} header h3 { margin: 0; font-size: 16px; font-weight: 600; }
      #${MODAL_ID} header button.close {
        background: transparent; border: none; color: #aaa; font-size: 22px; cursor: pointer;
        line-height: 1; padding: 0 4px;
      }
      #${MODAL_ID} .body { padding: 18px; overflow: auto; }
      #${MODAL_ID} .drop {
        border: 2px dashed #444; border-radius: 8px; padding: 36px 18px;
        text-align: center; color: #bbb; transition: border-color 0.15s, background 0.15s;
      }
      #${MODAL_ID} .drop.hover { border-color: #00a4dc; background: rgba(0,164,220,0.08); color: #eee; }
      #${MODAL_ID} .drop p { margin: 6px 0; }
      #${MODAL_ID} .drop .hint { font-size: 12px; color: #888; }
      #${MODAL_ID} .preview { margin-top: 14px; font-size: 13px; }
      #${MODAL_ID} .preview table { width: 100%; border-collapse: collapse; }
      #${MODAL_ID} .preview th, #${MODAL_ID} .preview td { padding: 6px 8px; border-bottom: 1px solid #2a2a2a; text-align: left; }
      #${MODAL_ID} .preview th { color: #888; font-weight: 500; font-size: 11px; text-transform: uppercase; }
      #${MODAL_ID} .preview td.cover { width: 1%; white-space: nowrap; text-align: right; }
      #${MODAL_ID} .preview button.cover-btn {
        background: transparent; border: 1px solid #444; color: #ddd; padding: 4px 10px;
        border-radius: 4px; cursor: pointer; font-size: 11px; line-height: 1; height: 26px;
      }
      #${MODAL_ID} .preview button.cover-btn:hover { border-color: #00a4dc; color: #fff; }
      #${MODAL_ID} .preview .cover-set {
        display: inline-flex; align-items: center; gap: 6px; vertical-align: middle;
      }
      #${MODAL_ID} .preview .cover-set img {
        width: 26px; height: 26px; object-fit: cover; border-radius: 3px; border: 1px solid #333;
      }
      #${MODAL_ID} .preview .cover-set button.cover-clear {
        background: transparent; border: none; color: #888; font-size: 16px; cursor: pointer;
        padding: 0 4px; line-height: 1;
      }
      #${MODAL_ID} .preview .cover-set button.cover-clear:hover { color: #ff7a7a; }
      #${MODAL_ID} .progress { margin-top: 14px; }
      #${MODAL_ID} .progress .bar { height: 6px; background: #2a2a2a; border-radius: 3px; overflow: hidden; }
      #${MODAL_ID} .progress .bar > div { height: 100%; background: #00a4dc; width: 0%; transition: width 0.15s; }
      #${MODAL_ID} .progress .text { margin-top: 6px; font-size: 12px; color: #aaa; }
      #${MODAL_ID} footer {
        padding: 12px 18px; display: flex; justify-content: flex-end; gap: 10px;
        border-top: 1px solid #2b2b2b;
      }
      #${MODAL_ID} button.primary {
        background: #00a4dc; border: none; color: #fff; padding: 8px 16px;
        border-radius: 4px; cursor: pointer; font-weight: 600;
      }
      #${MODAL_ID} button.primary:disabled { opacity: 0.5; cursor: not-allowed; }
      #${MODAL_ID} button.secondary {
        background: transparent; border: 1px solid #444; color: #ddd; padding: 8px 16px;
        border-radius: 4px; cursor: pointer;
      }
      #${MODAL_ID} .err { color: #ff7a7a; font-size: 12px; margin-top: 8px; white-space: pre-wrap; }
    `;
    document.head.appendChild(s);
  }

  async function isAdmin() {
    try {
      const api = window.ApiClient;
      if (!api || !api.getCurrentUser) return false;
      const u = await api.getCurrentUser();
      return !!(u && u.Policy && u.Policy.IsAdministrator);
    } catch { return false; }
  }

  function authHeader() {
    const api = window.ApiClient;
    if (!api) return {};
    const token = api.accessToken && api.accessToken();
    return token ? { 'X-Emby-Token': token } : {};
  }

  function ensureFab() {
    if (document.getElementById(FAB_ID)) return;
    injectStyles();
    const btn = document.createElement('button');
    btn.id = FAB_ID;
    btn.title = 'Add music to library';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/></svg>
      Add Music
    `;
    btn.addEventListener('click', openModal);
    document.body.appendChild(btn);
  }

  function removeFab() {
    const el = document.getElementById(FAB_ID);
    if (el) el.remove();
  }

  // --- folder traversal -----------------------------------------------------

  // Walk a webkit FileSystemEntry tree and return [{file, relPath}, ...]
  // where relPath is "Artist/Album/song.mp3" form (forward slashes).
  function walkEntry(entry, prefix = '') {
    return new Promise((resolve, reject) => {
      if (entry.isFile) {
        entry.file(f => resolve([{ file: f, relPath: prefix + entry.name }]), reject);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const all = [];
        const readBatch = () => {
          reader.readEntries(async batch => {
            if (!batch.length) {
              try {
                const nested = await Promise.all(all.map(e => walkEntry(e, prefix + entry.name + '/')));
                resolve(nested.flat());
              } catch (e) { reject(e); }
              return;
            }
            all.push(...batch);
            readBatch();
          }, reject);
        };
        readBatch();
      } else {
        resolve([]);
      }
    });
  }

  // Drop handler: gather all dropped folders into a flat list with relPaths
  // rooted at the dropped folder's name (so dropping "Radiohead/" yields
  // relPaths like "Radiohead/OK Computer/Airbag.flac").
  async function gatherFromDataTransfer(dt) {
    const items = dt.items ? Array.from(dt.items) : [];
    const entries = items
      .map(it => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
      .filter(Boolean);
    if (!entries.length) throw new Error('Drop a folder, not loose files.');

    const folderRoots = entries.filter(e => e.isDirectory);
    if (!folderRoots.length) throw new Error('Drop the Artist folder, not individual songs.');

    const all = await Promise.all(folderRoots.map(e => walkEntry(e, '')));
    return all.flat();
  }

  // Filter out hidden/system files and non-music sidecars we don't accept.
  function applyAllowedExtensions(files, allowed) {
    const set = new Set(allowed.map(x => x.toLowerCase()));
    return files.filter(({ file, relPath }) => {
      const base = relPath.split('/').pop();
      if (base.startsWith('.')) return false;
      if (base.toLowerCase() === 'thumbs.db' || base.toLowerCase() === 'desktop.ini') return false;
      const dot = base.lastIndexOf('.');
      if (dot < 0) return false;
      const ext = base.slice(dot + 1).toLowerCase();
      return set.has(ext);
    });
  }

  // Group flat list by Artist/Album for the preview table.
  // Files with depth=2 (Artist/song) get bucketed under "Unknown Album".
  // `id` is the stable key for the cover-picker map; it's the same
  // forward-slash form we'll use as the prefix for cover.<ext>.
  function summarize(files) {
    const groups = new Map();
    for (const { file, relPath } of files) {
      const parts = relPath.split('/');
      const artist = parts[0];
      let album = 'Unknown Album';
      if (parts.length >= 3) album = parts[1];
      const id = artist + '/' + album;
      const g = groups.get(id) || { id, artist, album, count: 0, bytes: 0 };
      g.count++; g.bytes += file.size;
      groups.set(id, g);
    }
    return Array.from(groups.values()).sort((a, b) =>
      a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album));
  }

  // Normalize each file's relPath to Artist/Album/song.ext form. Files
  // dropped as Artist/song.ext (no Album) are placed under
  // Artist/Unknown Album/. Deeper paths (Artist/Album/Disc 1/song) are
  // preserved unchanged — the server accepts arbitrary depth >=2.
  function normalizeRelPaths(files) {
    return files.map(({ file, relPath }) => {
      const parts = relPath.split('/');
      if (parts.length < 2) return null;
      if (parts.length === 2) {
        return { file, relPath: parts[0] + '/Unknown Album/' + parts[1] };
      }
      return { file, relPath };
    }).filter(Boolean);
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  // --- modal ---------------------------------------------------------------

  let serverCfg = null;

  async function loadServerCfg() {
    if (serverCfg) return serverCfg;
    const r = await fetch('/musicup/config', { headers: authHeader() });
    if (!r.ok) throw new Error('Could not load uploader config (HTTP ' + r.status + ')');
    serverCfg = await r.json();
    return serverCfg;
  }

  async function openModal() {
    if (document.getElementById(MODAL_ID + '-backdrop')) return;
    injectStyles();

    const backdrop = document.createElement('div');
    backdrop.id = MODAL_ID + '-backdrop';
    backdrop.innerHTML = `
      <div id="${MODAL_ID}" role="dialog" aria-modal="true" aria-labelledby="${MODAL_ID}-title">
        <header>
          <h3 id="${MODAL_ID}-title">Add Music</h3>
          <button class="close" aria-label="Close">&times;</button>
        </header>
        <div class="body">
          <div class="drop" tabindex="0">
            <p><strong>Drop a folder here</strong></p>
            <p class="hint">Expected layout: Artist / Album / songs</p>
            <p class="hint">You can drop multiple Artist folders at once.</p>
          </div>
          <div class="preview" hidden>
            <table>
              <thead><tr><th>Artist</th><th>Album</th><th>Tracks</th><th>Size</th><th></th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
          <div class="progress" hidden>
            <div class="bar"><div></div></div>
            <div class="text"></div>
          </div>
          <div class="err" hidden></div>
        </div>
        <footer>
          <button class="secondary" data-act="cancel">Cancel</button>
          <button class="primary" data-act="upload" disabled>Upload</button>
        </footer>
      </div>
    `;
    document.body.appendChild(backdrop);

    const $modal = backdrop.firstElementChild;
    const $drop = $modal.querySelector('.drop');
    const $previewWrap = $modal.querySelector('.preview');
    const $previewBody = $previewWrap.querySelector('tbody');
    const $progressWrap = $modal.querySelector('.progress');
    const $progressBar = $progressWrap.querySelector('.bar > div');
    const $progressText = $progressWrap.querySelector('.text');
    const $err = $modal.querySelector('.err');
    const $upload = $modal.querySelector('[data-act="upload"]');
    const $cancel = $modal.querySelector('[data-act="cancel"]');
    const $close = $modal.querySelector('.close');

    let pending = []; // [{file, relPath}]
    let covers = new Map(); // groupId ("Artist/Album") -> File (an image)
    let cfg;
    try {
      cfg = await loadServerCfg();
      if (!cfg.configured) showErr('Library path is not configured. Open the Music Uploader plugin settings first.');
    } catch (e) {
      showErr(e.message || String(e));
    }

    function showErr(msg) { $err.textContent = msg; $err.hidden = !msg; }
    function close() { backdrop.remove(); }

    $close.addEventListener('click', close);
    $cancel.addEventListener('click', close);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

    ['dragenter', 'dragover'].forEach(ev =>
      $drop.addEventListener(ev, e => { e.preventDefault(); $drop.classList.add('hover'); }));
    ['dragleave', 'drop'].forEach(ev =>
      $drop.addEventListener(ev, e => { e.preventDefault(); $drop.classList.remove('hover'); }));

    $drop.addEventListener('drop', async e => {
      showErr('');
      try {
        const raw = await gatherFromDataTransfer(e.dataTransfer);
        const filtered = applyAllowedExtensions(raw, (cfg && cfg.allowedExtensions) || []);
        if (!filtered.length) {
          showErr('No music files found in the drop. Allowed: ' +
            ((cfg && cfg.allowedExtensions) || []).join(', '));
          pending = []; covers = new Map(); renderPreview(); return;
        }
        pending = normalizeRelPaths(filtered);
        // Drop any covers that no longer match a visible album.
        const liveIds = new Set(summarize(pending).map(g => g.id));
        for (const k of Array.from(covers.keys())) if (!liveIds.has(k)) covers.delete(k);
        renderPreview();
      } catch (err) {
        showErr(err.message || String(err));
      }
    });

    function renderPreview() {
      if (!pending.length) {
        $previewWrap.hidden = true;
        $upload.disabled = true;
        return;
      }
      const groups = summarize(pending);
      $previewBody.innerHTML = groups.map((g, i) =>
        `<tr data-row="${i}"><td>${escape(g.artist)}</td><td>${escape(g.album)}</td>` +
        `<td>${g.count}</td><td>${fmtBytes(g.bytes)}</td>` +
        `<td class="cover" data-cover-cell></td></tr>`).join('');
      // Wire up the cover-picker cell per row. Done in JS (not innerHTML)
      // so we can attach the file-input change listener cleanly and keep
      // each <input> element associated with its group id.
      $previewBody.querySelectorAll('tr').forEach(tr => {
        const g = groups[Number(tr.dataset.row)];
        const cell = tr.querySelector('[data-cover-cell]');
        renderCoverCell(cell, g);
      });
      $previewWrap.hidden = false;
      $upload.disabled = !(cfg && cfg.configured);
    }

    function renderCoverCell(cell, g) {
      cell.innerHTML = '';
      const existing = covers.get(g.id);
      if (existing) {
        const wrap = document.createElement('span');
        wrap.className = 'cover-set';
        wrap.title = existing.name;
        const img = document.createElement('img');
        img.alt = '';
        const url = URL.createObjectURL(existing);
        img.src = url;
        img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
        const clear = document.createElement('button');
        clear.type = 'button'; clear.className = 'cover-clear';
        clear.innerHTML = '&times;'; clear.title = 'Remove cover';
        clear.addEventListener('click', () => {
          covers.delete(g.id);
          renderCoverCell(cell, g);
        });
        wrap.append(img, clear);
        cell.appendChild(wrap);
        return;
      }
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'cover-btn';
      btn.textContent = 'Upload Thumbnail';
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.hidden = true;
      input.addEventListener('change', () => {
        const f = input.files && input.files[0];
        if (!f) return;
        if (!/^image\//.test(f.type)) {
          showErr('That file is not an image.');
          return;
        }
        covers.set(g.id, f);
        renderCoverCell(cell, g);
      });
      btn.addEventListener('click', () => input.click());
      cell.append(btn, input);
    }

    function escape(s) { return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

    $upload.addEventListener('click', async () => {
      $upload.disabled = true; $cancel.disabled = true;
      $progressWrap.hidden = false;

      // Build the upload queue: music files first (so the album folder
      // exists before we drop the cover into it), then one cover per
      // album that has a thumbnail selected. Jellyfin's library scanner
      // recognizes cover.<ext> in an album folder and uses it as the
      // album art — which also becomes the per-track art for every
      // song that lives in that folder.
      const queue = pending.slice();
      for (const [groupId, coverFile] of covers.entries()) {
        const ext = (coverFile.name.split('.').pop() || 'jpg').toLowerCase();
        queue.push({ file: coverFile, relPath: groupId + '/cover.' + ext });
      }
      const total = queue.length;
      let done = 0, failed = 0;
      const errors = [];

      for (const { file, relPath } of queue) {
        $progressText.textContent = `Uploading ${done + 1} of ${total}: ${relPath}`;
        try {
          const fd = new FormData();
          fd.append('file', file, file.name);
          fd.append('relativePath', relPath);
          const r = await fetch('/musicup/upload', {
            method: 'POST',
            headers: authHeader(),
            body: fd,
          });
          if (!r.ok) {
            failed++;
            let msg = 'HTTP ' + r.status;
            try { const j = await r.json(); if (j && j.error) msg = j.error; } catch {}
            errors.push(`${relPath}: ${msg}`);
          }
        } catch (e) {
          failed++; errors.push(`${relPath}: ${e.message || e}`);
        }
        done++;
        $progressBar.style.width = ((done / total) * 100).toFixed(1) + '%';
      }

      try {
        await fetch('/musicup/refresh', { method: 'POST', headers: authHeader() });
      } catch {}

      const summary = `Done. ${done - failed} uploaded` + (failed ? `, ${failed} failed.` : '.');
      $progressText.textContent = summary;
      if (errors.length) showErr(errors.slice(0, 6).join('\n') + (errors.length > 6 ? `\n…and ${errors.length - 6} more` : ''));
      $cancel.disabled = false;
      $cancel.textContent = 'Close';
    });
  }

  // --- bootstrap ------------------------------------------------------------

  let lastAdmin = null;
  async function tick() {
    const admin = await isAdmin();
    if (admin !== lastAdmin) {
      lastAdmin = admin;
      if (admin) ensureFab(); else removeFab();
    } else if (admin && !document.getElementById(FAB_ID)) {
      ensureFab();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tick);
  } else {
    tick();
  }
  setInterval(tick, POLL_MS);
})();
