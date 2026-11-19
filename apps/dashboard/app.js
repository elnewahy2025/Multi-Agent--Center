/**
 * AI Coding Command Center Operator UI
 * Clean single-screen cockpit with dual live agent streams, image attachments,
 * native modal dialogs, and IME-safe keyboard handling.
 */

const API_BASE = "";

const AGENT_META = {
  ANTIGRAVITY: { short: "Antigravity", full: "Google Antigravity CLI", icon: "🟣", pillClass: "agent-pill-ANTIGRAVITY" },
  OPENCODE: { short: "OpenCode", full: "OpenCode Desktop CLI", icon: "🟢", pillClass: "agent-pill-OPENCODE" },
  CLAUDE_CODE: { short: "Claude Code", full: "Claude Code CLI", icon: "🟠", pillClass: "agent-pill-CLAUDE_CODE" },
  QWEN_CODE: { short: "Qwen Code", full: "Qwen Code CLI", icon: "🔵", pillClass: "agent-pill-QWEN_CODE" },
  CODEX: { short: "Codex", full: "OpenAI Codex", icon: "⚪", pillClass: "agent-pill-OTHER" },
  OPENCLAW: { short: "OpenClaw", full: "OpenClaw", icon: "🦅", pillClass: "agent-pill-OTHER" },
  SYSTEM: { short: "System", full: "Command Center", icon: "⚖️", pillClass: "agent-pill-OTHER" },
};

function getAgentMeta(agentKey) {
  return AGENT_META[agentKey] || {
    short: agentKey || "Agent",
    full: agentKey || "Agent",
    icon: "🤖",
    pillClass: "agent-pill-OTHER",
  };
}

// Application state
let cachedTasks = [];
let detectedAgents = [];
let activeTaskId = null;
let lastLoadedActiveTaskId = null;
const eventFingerprints = new Map();
let lastInspectorSupplementFp = "";
let lastWorkerSupplementFp = "";
let lastActiveActionsFp = "";
let lastApprovalsFingerprint = null;
let lastErrorsFingerprint = null;
let lastFilesFingerprint = null;
let pendingDecisionInFlight = false;

// Composer scope & image attachments
let scopeMode = "folder";
let selectedContextFiles = [];
let attachedImages = [];
let workspaceRootPath = "";
let repoRootPath = "";
let selectedFolderRoot = "";

// File explorer state
let explorerOpen = false;
let explorerMode = "folder";
let explorerCurrentDir = "";
let explorerParentDir = null;
let explorerSearchTimer = null;
let currentExplorerFolders = [];
let currentExplorerFiles = [];

document.addEventListener("DOMContentLoaded", () => {
  installDialogLightDismissFallback();
  setupEventListeners();
  initDashboard();
  setInterval(refreshAll, 2000);
  setInterval(() => {
    if (activeTaskId) refreshActiveTaskWorkspace();
  }, 1500);
});

function announceStatus(message) {
  const el = document.getElementById("statusAnnouncer");
  if (!el || !message) return;
  el.textContent = "";
  window.requestAnimationFrame(() => {
    el.textContent = message;
  });
}

function showComposerFeedback(message) {
  const el = document.getElementById("composerFeedback");
  if (!el) return;
  if (!message) {
    el.textContent = "";
    el.hidden = true;
    return;
  }
  el.textContent = message;
  el.hidden = false;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isImeComposing(event) {
  return Boolean(event && (event.isComposing || event.keyCode === 229));
}

function installDialogLightDismissFallback() {
  if ("closedBy" in HTMLDialogElement.prototype) return;
  const outside = (e, dialog) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
    let pressedOutside = false;
    dialog.addEventListener("pointerdown", (e) => {
      pressedOutside = outside(e, dialog);
    });
    dialog.addEventListener("pointerup", (e) => {
      if (pressedOutside && outside(e, dialog)) dialog.close();
      pressedOutside = false;
    });
  }
}

function openDialogModal(dialogId) {
  const dlg = document.getElementById(dialogId);
  if (dlg && !dlg.open) dlg.showModal();
}

function closeDialogModal(dialogId) {
  const dlg = document.getElementById(dialogId);
  if (dlg && dlg.open) dlg.close();
}

/* ---------- Prompt Title & Code Helpers ---------- */

function startsWithCode(text) {
  const lines = (text || "").split(/\r?\n/);
  let first = "";
  for (const raw of lines) {
    const s = raw.trim();
    if (s) { first = s; break; }
  }
  if (!first) return false;
  const kw = /^\s*(?:def |class |import |from\s+\S+\s+import |async\s+def |return\b|if\s+__name__|function\s+|const\s+|let\s+|var\s+|export\s+|interface\s+|type\s+|#include\s+|package\s+|public\s+|private\s+|SELECT\s+|INSERT\s+|UPDATE\s+|DELETE\s+|CREATE\s+TABLE\s+|<[a-zA-Z!])/;
  const end = /(?:\{\s*|\}\s*;?|;\s*|\):\s*)$/;
  const syntax = /(?:[=(){}\[\];]|<\/|\b(?:def|class|import|function|const|let)\s+)/;
  if (first.startsWith("```")) {
    let sawOpen = false;
    for (const raw of lines) {
      const s = raw.trim();
      if (!sawOpen) {
        if (s.startsWith("```")) {
          sawOpen = true;
          const tag = s.slice(3).trim();
          if (tag && !tag.includes(" ") && !tag.includes("```")) return true;
        }
        continue;
      }
      if (s.startsWith("```")) break;
      if (!s) continue;
      if (kw.test(s) || end.test(s) || syntax.test(s)) return true;
    }
    return false;
  }
  return kw.test(first) || end.test(first);
}

function deriveTitleFromPrompt(desc) {
  if (startsWithCode(desc)) {
    let codeLine = "";
    for (const raw of (desc || "").split(/\r?\n/)) {
      const s = raw.trim();
      if (s && !s.startsWith("```")) { codeLine = s.replace(/\s+/g, " "); break; }
    }
    if (codeLine) {
      if (codeLine.length <= 52) return `Fix code: ${codeLine}`;
      const sub = codeLine.slice(0, 51);
      const idx = sub.lastIndexOf(" ");
      return `Fix code: ${(idx > 0 ? sub.slice(0, idx) : sub)}…`;
    }
  }
  let firstLine = "";
  for (const raw of (desc || "").split(/\r?\n/)) {
    const cleaned = raw.replace(/^[#*\->\s]+/, "").trim();
    if (cleaned && !cleaned.startsWith("```")) { firstLine = cleaned; break; }
  }
  if (!firstLine) return "";
  const filler = /^(?:please|can you|could you|would you|i want(?: you)? to|help me|task\s*:)\s+/i;
  for (let i = 0; i < 3; i++) {
    const next = firstLine.replace(filler, "").trim();
    if (next === firstLine) break;
    firstLine = next;
  }
  const clause = firstLine.split(/[.?!;](?:\s|$)/)[0].replace(/\s+/g, " ").trim().replace(/^[ :\-]+|[ :\-]+$/g, "");
  if (!clause) return "";
  const titled = clause.charAt(0).toUpperCase() + clause.slice(1);
  if (titled.length <= 65) return titled;
  const sub = titled.slice(0, 64);
  const idx = sub.lastIndexOf(" ");
  return (idx > 0 ? sub.slice(0, idx) : sub).replace(/[,;:\-]+$/, "") + "…";
}

async function pasteOrWrapCodeSnippet() {
  const descEl = document.getElementById("taskDesc");
  if (!descEl) return;
  let clip = "";
  if (navigator.clipboard && navigator.clipboard.readText) {
    try { clip = await navigator.clipboard.readText(); } catch { clip = ""; }
  }
  const start = descEl.selectionStart || 0;
  const end = descEl.selectionEnd || 0;
  const selected = descEl.value.slice(start, end);
  if (selected.trim()) {
    const block = selected.includes("```") ? selected : `\`\`\`\n${selected.trim()}\n\`\`\``;
    descEl.value = descEl.value.slice(0, start) + block + descEl.value.slice(end);
  } else if (clip && clip.trim()) {
    const block = clip.includes("```") ? clip.trim() : `\`\`\`\n${clip.trim()}\n\`\`\``;
    const prefix = descEl.value && !descEl.value.endsWith("\n") ? "\n" : "";
    descEl.value = descEl.value + prefix + block + "\n";
  } else if (descEl.value.trim() && !descEl.value.includes("```")) {
    descEl.value = `\`\`\`\n${descEl.value.trim()}\n\`\`\`\n`;
  } else {
    descEl.value = descEl.value + "```\n# Paste code to inspect or fix\n```\n";
  }
  descEl.dispatchEvent(new Event("input"));
  descEl.focus();
}

/* ---------- Scope & File Explorer ---------- */

function setScopeMode(mode) {
  const prevMode = scopeMode;
  scopeMode = mode === "files" ? "files" : "folder";
  const btnF = document.getElementById("btnScopeFolder");
  const btnS = document.getElementById("btnScopeFiles");
  const btnAdd = document.getElementById("btnAddTarget");
  const pathInput = document.getElementById("projectPath");
  if (btnF) btnF.classList.toggle("active", scopeMode === "folder");
  if (btnS) btnS.classList.toggle("active", scopeMode === "files");
  if (btnAdd) btnAdd.hidden = scopeMode !== "files";

  if (scopeMode === "folder") {
    selectedContextFiles = [];
    if (prevMode === "files" && pathInput && !pathInput.value.trim() && selectedFolderRoot) {
      pathInput.value = selectedFolderRoot;
    }
    if (pathInput) pathInput.placeholder = workspaceRootPath || "Target folder path…";
  } else if (pathInput) {
    const curVal = pathInput.value.trim();
    if (prevMode === "folder" && curVal && (curVal === workspaceRootPath || curVal === selectedFolderRoot)) {
      selectedFolderRoot = curVal;
      pathInput.value = "";
    }
    pathInput.placeholder = "Type or pick relative file/subfolder…";
  }
  renderScopeChips();
}

function toRelativeTarget(pickedPath) {
  const norm = (pickedPath || "").trim().replace(/\\/g, "/");
  if (!norm) return "";
  const activeBase = selectedFolderRoot || workspaceRootPath || repoRootPath;
  if (activeBase) {
    const rootNorm = activeBase.replace(/\\/g, "/").replace(/\/+$/, "");
    if (norm.toLowerCase() === rootNorm.toLowerCase()) return "";
    if (norm.toLowerCase().startsWith(rootNorm.toLowerCase() + "/")) {
      return norm.slice(rootNorm.length + 1);
    }
  }
  return norm;
}

function addTargetFileOrSubfolder(rawPath) {
  const val = toRelativeTarget(rawPath);
  if (!val) return;
  if (scopeMode !== "files") setScopeMode("files");
  if (!selectedContextFiles.includes(val)) {
    selectedContextFiles.push(val);
    renderScopeChips();
    announceStatus(`Added target ${val}`);
  }
}

function removeTargetFile(idx) {
  const removed = selectedContextFiles[idx];
  selectedContextFiles.splice(idx, 1);
  renderScopeChips();
  if (explorerOpen) renderExplorerRows();
  if (removed) announceStatus(`Removed target ${removed}`);
}

function renderScopeChips() {
  const container = document.getElementById("selectedFilesChips");
  if (!container) return;
  if (scopeMode === "folder" || selectedContextFiles.length === 0) {
    const raw = (document.getElementById("projectPath")?.value || "").trim();
    const label = raw || selectedFolderRoot || workspaceRootPath || "Default Project Root";
    container.innerHTML = scopeMode === "folder"
      ? `<span class="file-chip file-chip-folder">📁 ${escapeHtml(label)}</span>`
      : `<span class="file-chip">No specific files chosen yet — click Files… to select</span>`;
    return;
  }
  container.innerHTML = selectedContextFiles.map((f, idx) => `
    <span class="file-chip">
      📄 ${escapeHtml(f)}
      <button type="button" class="file-chip-remove" data-remove-file="${idx}" aria-label="Remove target file ${escapeHtml(f)}">✕</button>
    </span>
  `).join("");
  container.querySelectorAll("[data-remove-file]").forEach((btn) => {
    btn.addEventListener("click", () => removeTargetFile(Number(btn.dataset.removeFile)));
  });
}

async function loadWorkspacePaths(rootPath = null) {
  const list = document.getElementById("workspacePathsList");
  if (!list) return;
  try {
    const url = rootPath ? `${API_BASE}/fs/list?root=${encodeURIComponent(rootPath)}` : `${API_BASE}/fs/list`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    if (!repoRootPath && data.root) repoRootPath = data.root;
    workspaceRootPath = data.root || workspaceRootPath;
    if (!selectedFolderRoot) selectedFolderRoot = workspaceRootPath;
    list.innerHTML = (data.entries || []).map((e) => (
      `<option value="${escapeHtml(e.path)}">${e.type === "folder" ? "Folder" : "File"}</option>`
    )).join("");
    renderScopeChips();
  } catch {
    // Non-fatal
  }
}

function getInitialBrowseDir(mode) {
  const typed = (document.getElementById("projectPath")?.value || "").trim();
  if (mode === "folder" && typed) return typed;
  return explorerCurrentDir || selectedFolderRoot || workspaceRootPath || repoRootPath || "";
}

function updateExplorerModeUI() {
  const titleEl = document.getElementById("fsExplorerTitle");
  const useDirBtn = document.getElementById("btnUseCurrentFolder");
  const doneBtn = document.getElementById("btnFsDone");
  const clearBtn = document.getElementById("btnFsClearSelected");
  if (titleEl) {
    titleEl.textContent = explorerMode === "folder"
      ? "📁 Select Target Folder"
      : "📄 Select Specific File(s) or Subfolder(s)";
  }
  if (useDirBtn) useDirBtn.hidden = explorerMode !== "folder";
  if (doneBtn) doneBtn.hidden = explorerMode !== "files";
  if (clearBtn) clearBtn.hidden = explorerMode !== "files";
}

async function openFsExplorer(mode, dirPath = "") {
  explorerMode = mode === "files" ? "files" : "folder";
  explorerOpen = true;
  openDialogModal("fsExplorerDialog");
  const searchInput = document.getElementById("fsSearchInput");
  if (searchInput) {
    searchInput.value = "";
    searchInput.focus();
  }
  updateExplorerModeUI();
  await browseFsDirectory(dirPath || explorerCurrentDir || selectedFolderRoot || workspaceRootPath || "", "");
}

function closeFsExplorer() {
  explorerOpen = false;
  closeDialogModal("fsExplorerDialog");
}

function browseParentDir() {
  if (!explorerParentDir) return;
  const searchInput = document.getElementById("fsSearchInput");
  if (searchInput) searchInput.value = "";
  browseFsDirectory(explorerParentDir, "");
}

function browseProjectRoot() {
  const searchInput = document.getElementById("fsSearchInput");
  if (searchInput) searchInput.value = "";
  browseFsDirectory(repoRootPath || workspaceRootPath || "", "");
}

function handleFsSearchInput(val) {
  if (explorerSearchTimer) clearTimeout(explorerSearchTimer);
  explorerSearchTimer = setTimeout(() => {
    browseFsDirectory(explorerCurrentDir, val || "");
  }, 180);
}

async function selectEntireFolder(folderPath) {
  if (!folderPath) return;
  const pathInput = document.getElementById("projectPath");
  setScopeMode("folder");
  selectedFolderRoot = folderPath;
  workspaceRootPath = folderPath;
  if (pathInput) pathInput.value = folderPath;
  renderScopeChips();
  await loadWorkspacePaths(folderPath);
  announceStatus(`Target folder set to ${folderPath}`);
}

async function useCurrentExplorerFolder() {
  if (!explorerCurrentDir) return;
  await selectEntireFolder(explorerCurrentDir);
  closeFsExplorer();
}

function toggleTargetSelection(targetPath) {
  const rel = toRelativeTarget(targetPath);
  if (!rel) return;
  if (scopeMode !== "files") setScopeMode("files");
  const idx = selectedContextFiles.indexOf(rel);
  if (idx >= 0) selectedContextFiles.splice(idx, 1);
  else selectedContextFiles.push(rel);
  renderScopeChips();
  renderExplorerRows();
}

function clearSelectedTargets() {
  selectedContextFiles = [];
  const pathInput = document.getElementById("projectPath");
  if (pathInput && scopeMode === "files") pathInput.value = "";
  renderScopeChips();
  renderExplorerRows();
}

function formatEntrySize(bytes) {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isTargetSelected(entry) {
  const rel = toRelativeTarget(entry.rel_path || entry.path);
  return selectedContextFiles.includes(rel) || selectedContextFiles.includes(entry.path);
}

async function browseFsDirectory(dirPath = "", query = "") {
  const listEl = document.getElementById("fsEntriesList");
  const pathLabel = document.getElementById("fsCurrentDirLabel");
  const drivesBar = document.getElementById("fsDrivesBar");
  const parentBtn = document.getElementById("btnFsParent");
  if (!listEl) return;

  listEl.innerHTML = `<div class="empty-state">Loading directory…</div>`;
  try {
    const params = new URLSearchParams();
    if (dirPath) params.set("path", dirPath);
    const activeRoot = selectedFolderRoot || workspaceRootPath || repoRootPath;
    if (activeRoot) params.set("root", activeRoot);
    if (query && query.trim()) params.set("query", query.trim());

    const res = await fetch(`${API_BASE}/fs/browse?${params.toString()}`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `HTTP ${res.status}`);
    }
    const data = await res.json();
    explorerCurrentDir = data.current_dir || "";
    explorerParentDir = data.parent_dir || null;
    if (!repoRootPath && data.repo_root) repoRootPath = data.repo_root;
    currentExplorerFolders = data.folders || [];
    currentExplorerFiles = data.files || [];

    if (pathLabel) {
      pathLabel.textContent = explorerCurrentDir + (data.query ? `  (search: "${data.query}")` : "");
    }
    if (parentBtn) parentBtn.disabled = !explorerParentDir;
    if (drivesBar) {
      const drives = data.drives || [];
      drivesBar.innerHTML = drives.map((drv, idx) => (
        `<button type="button" class="fs-drive-btn" data-drive-idx="${idx}" aria-label="Open drive ${escapeHtml(drv)}">${escapeHtml(drv)}</button>`
      )).join("");
      drivesBar.querySelectorAll("[data-drive-idx]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const drv = drives[Number(btn.dataset.driveIdx)];
          if (drv) browseFsDirectory(drv, "");
        });
      });
    }
    renderExplorerRows();
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state" role="alert">Unable to list directory: ${escapeHtml(err.message)}</div>`;
  }
}

function renderExplorerRows() {
  const listEl = document.getElementById("fsEntriesList");
  if (!listEl) return;
  if (currentExplorerFolders.length === 0 && currentExplorerFiles.length === 0) {
    listEl.innerHTML = `<div class="empty-state">No matching folders or files in this directory.</div>`;
    return;
  }

  const hasQuery = Boolean(document.getElementById("fsSearchInput")?.value.trim());
  let html = "";

  currentExplorerFolders.forEach((folder, idx) => {
    const isSel = explorerMode === "files" && isTargetSelected(folder);
    const displayName = (hasQuery ? folder.rel_path : folder.name) + "/";
    const btnLabel = explorerMode === "folder" ? "✓ Select Folder" : (isSel ? "✓ Selected" : "+ Subfolder");
    html += `
      <div class="fs-entry-row ${isSel ? "selected" : ""}">
        <button type="button" class="fs-entry-main" data-folder-open="${idx}" aria-label="Open folder ${escapeHtml(folder.path)}">
          📁 <span>${escapeHtml(displayName)}</span>
        </button>
        <button type="button" class="btn btn-sm ${isSel ? "btn-approve" : "btn-subtle"}" data-folder-select="${idx}" aria-label="${escapeHtml(btnLabel)} ${escapeHtml(folder.name)}">${btnLabel}</button>
      </div>
    `;
  });

  currentExplorerFiles.forEach((file, idx) => {
    const isSel = explorerMode === "files" && isTargetSelected(file);
    const displayName = hasQuery ? file.rel_path : file.name;
    const sizeText = formatEntrySize(file.size);
    const btnLabel = isSel ? "✓ Selected" : "+ File";
    html += `
      <div class="fs-entry-row ${isSel ? "selected" : ""}">
        <button type="button" class="fs-entry-main" data-file-select="${idx}" aria-label="Select file ${escapeHtml(file.path)}">
          📄 <span>${escapeHtml(displayName)}</span>
        </button>
        ${sizeText ? `<span class="fs-entry-meta">${sizeText}</span>` : ""}
        <button type="button" class="btn btn-sm ${isSel ? "btn-approve" : "btn-subtle"}" data-file-select-btn="${idx}" aria-label="${escapeHtml(btnLabel)} ${escapeHtml(file.name)}">${btnLabel}</button>
      </div>
    `;
  });

  listEl.innerHTML = html;

  listEl.querySelectorAll("[data-folder-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const folder = currentExplorerFolders[Number(btn.dataset.folderOpen)];
      if (!folder) return;
      const searchInput = document.getElementById("fsSearchInput");
      if (searchInput) searchInput.value = "";
      browseFsDirectory(folder.path, "");
    });
  });

  listEl.querySelectorAll("[data-folder-select]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const folder = currentExplorerFolders[Number(btn.dataset.folderSelect)];
      if (!folder) return;
      if (explorerMode === "folder") {
        await selectEntireFolder(folder.path);
        closeFsExplorer();
      } else {
        toggleTargetSelection(folder.rel_path || folder.path);
      }
    });
  });

  const handlePickFile = (idx) => {
    const file = currentExplorerFiles[idx];
    if (!file) return;
    if (explorerMode !== "files") {
      explorerMode = "files";
      setScopeMode("files");
      updateExplorerModeUI();
    }
    toggleTargetSelection(file.rel_path || file.path);
  };
  listEl.querySelectorAll("[data-file-select]").forEach((btn) => {
    btn.addEventListener("click", () => handlePickFile(Number(btn.dataset.fileSelect)));
  });
  listEl.querySelectorAll("[data-file-select-btn]").forEach((btn) => {
    btn.addEventListener("click", () => handlePickFile(Number(btn.dataset.fileSelectBtn)));
  });
}

/* ---------- Image Upload & Preview ("Add Images") ---------- */

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image file"));
    reader.readAsDataURL(file);
  });
}

async function uploadImageFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => f && f.type && f.type.startsWith("image/"));
  if (files.length === 0) return;

  showComposerFeedback("");
  const dropHint = document.getElementById("imageDropHint");
  if (dropHint) dropHint.textContent = "Uploading image…";

  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) {
      showComposerFeedback(`Image "${file.name}" exceeds the 10 MB upload limit.`);
      continue;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await fetch(`${API_BASE}/uploads/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name || "pasted-screenshot.png",
          data_url: dataUrl,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Upload failed (${res.status})`);
      }
      const saved = await res.json();
      attachedImages.push(saved);
      renderAttachedImages();
      announceStatus(`Attached image ${saved.original_name}`);
    } catch (err) {
      showComposerFeedback(`Image upload failed: ${err.message}`);
    }
  }

  if (dropHint) dropHint.textContent = "or drag & drop / paste";
}

function renderAttachedImages() {
  const container = document.getElementById("attachedImagesList");
  if (!container) return;
  if (attachedImages.length === 0) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = attachedImages.map((img, idx) => `
    <div class="image-thumb-item">
      <img src="${escapeHtml(img.url)}" alt="Attached reference ${escapeHtml(img.original_name)}" width="38" height="38">
      <span class="image-thumb-name" title="${escapeHtml(img.original_name)}">${escapeHtml(img.original_name)}</span>
      <button type="button" class="file-chip-remove" data-remove-img="${idx}" aria-label="Remove image ${escapeHtml(img.original_name)}">✕</button>
    </div>
  `).join("");
  container.querySelectorAll("[data-remove-img]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.removeImg);
      const removed = attachedImages[idx];
      attachedImages.splice(idx, 1);
      renderAttachedImages();
      if (removed) announceStatus(`Removed image ${removed.original_name}`);
    });
  });
}

/* ---------- Event Wiring ---------- */

function setupEventListeners() {
  document.getElementById("btnRefresh")?.addEventListener("click", () => {
    refreshAll();
    announceStatus("Dashboard refreshed");
  });

  document.getElementById("btnScopeFolder")?.addEventListener("click", () => {
    setScopeMode("folder");
    openFsExplorer("folder", getInitialBrowseDir("folder"));
  });
  document.getElementById("btnScopeFiles")?.addEventListener("click", () => {
    setScopeMode("files");
    openFsExplorer("files", getInitialBrowseDir("files"));
  });
  document.getElementById("btnAddTarget")?.addEventListener("click", () => {
    const pathInput = document.getElementById("projectPath");
    if (pathInput && pathInput.value.trim()) {
      addTargetFileOrSubfolder(pathInput.value);
      pathInput.value = "";
      if (explorerOpen) renderExplorerRows();
    }
  });

  // File explorer modal controls
  document.getElementById("btnFsParent")?.addEventListener("click", browseParentDir);
  document.getElementById("btnFsRoot")?.addEventListener("click", browseProjectRoot);
  document.getElementById("btnFsClose")?.addEventListener("click", closeFsExplorer);
  document.getElementById("btnUseCurrentFolder")?.addEventListener("click", useCurrentExplorerFolder);
  document.getElementById("btnFsDone")?.addEventListener("click", closeFsExplorer);
  document.getElementById("btnFsClearSelected")?.addEventListener("click", clearSelectedTargets);
  document.getElementById("fsExplorerDialog")?.addEventListener("close", () => {
    explorerOpen = false;
  });

  const fsSearchInput = document.getElementById("fsSearchInput");
  fsSearchInput?.addEventListener("input", (e) => handleFsSearchInput(e.target.value));
  document.getElementById("fsSearchForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    browseFsDirectory(explorerCurrentDir, fsSearchInput?.value || "");
  });
  fsSearchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (isImeComposing(e)) return;
      browseFsDirectory(explorerCurrentDir, e.target.value || "");
    }
  });

  // Add Images (button picker, drag-drop, and clipboard screenshot paste)
  const imageInput = document.getElementById("imageFileInput");
  document.getElementById("btnAddImages")?.addEventListener("click", () => imageInput?.click());
  imageInput?.addEventListener("change", async (e) => {
    await uploadImageFiles(e.target.files);
    e.target.value = "";
  });

  const dropZone = document.getElementById("imageDropZone");
  if (dropZone) {
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });
    dropZone.addEventListener("dragleave", () => {
      dropZone.classList.remove("drag-over");
    });
    dropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
      if (e.dataTransfer?.files?.length) {
        await uploadImageFiles(e.dataTransfer.files);
      }
    });
  }

  // Prompt editing, code wrapping, image paste & IME-safe shortcuts
  const descEl = document.getElementById("taskDesc");
  const titleEl = document.getElementById("taskTitle");
  if (descEl && titleEl) {
    descEl.addEventListener("input", () => {
      showComposerFeedback("");
      if (!titleEl.value.trim()) {
        const autoTitle = deriveTitleFromPrompt(descEl.value);
        titleEl.placeholder = autoTitle
          ? `Auto-title: ${autoTitle}`
          : "Optional title (auto-generated from prompt)";
      }
    });
    descEl.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const s = descEl.selectionStart;
        const end = descEl.selectionEnd;
        descEl.value = descEl.value.slice(0, s) + "    " + descEl.value.slice(end);
        descEl.selectionStart = descEl.selectionEnd = s + 4;
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (isImeComposing(e)) return;
        document.getElementById("taskForm")?.requestSubmit();
      }
    });
    descEl.addEventListener("paste", async (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imgFiles = items
        .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
        .map((it) => it.getAsFile())
        .filter(Boolean);
      if (imgFiles.length > 0) {
        const hasText = Boolean(e.clipboardData?.getData("text/plain"));
        if (!hasText) e.preventDefault();
        await uploadImageFiles(imgFiles);
      }
    });
  }

  document.getElementById("btnPasteCode")?.addEventListener("click", pasteOrWrapCodeSnippet);

  const pathInput = document.getElementById("projectPath");
  pathInput?.addEventListener("input", () => {
    if (scopeMode === "folder") renderScopeChips();
  });
  pathInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && scopeMode === "files") {
      e.preventDefault();
      if (isImeComposing(e)) return;
      document.getElementById("btnAddTarget")?.click();
    }
  });

  // Agent selector sync with top bar chips & right pane preview
  document.getElementById("taskAgent")?.addEventListener("change", () => {
    syncAgentChipPressedState();
    syncDualPanePreviewHeaders();
  });

  // Task submission (Run Team = default submit, Single Run = button click)
  document.getElementById("taskForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    submitAndRunTask("collaborate");
  });
  document.getElementById("btnSingleRun")?.addEventListener("click", () => {
    submitAndRunTask("execute");
  });

  // Active task selector
  document.getElementById("activeTaskSelect")?.addEventListener("change", (e) => {
    const nextId = e.target.value || null;
    if (nextId && nextId !== activeTaskId) {
      focusTaskInWorkspace(nextId);
    }
  });

  // Header secondary dialogs (History, Files, Audit)
  document.getElementById("btnOpenFiles")?.addEventListener("click", () => {
    if (activeTaskId) loadTaskFiles(activeTaskId);
    openDialogModal("filesDialog");
  });
  document.getElementById("btnCloseFilesDialog")?.addEventListener("click", () => closeDialogModal("filesDialog"));

  document.getElementById("btnOpenHistory")?.addEventListener("click", () => {
    switchHistoryTab("tasks");
    openDialogModal("historyDialog");
  });
  document.getElementById("btnOpenAudit")?.addEventListener("click", () => {
    switchHistoryTab("audit");
    openDialogModal("historyDialog");
  });
  document.getElementById("btnCloseHistoryDialog")?.addEventListener("click", () => closeDialogModal("historyDialog"));
  document.getElementById("tabHistoryTasks")?.addEventListener("click", () => switchHistoryTab("tasks"));
  document.getElementById("tabHistoryAudit")?.addEventListener("click", () => switchHistoryTab("audit"));

  // Errors Clear Resolved
  document.getElementById("btnClearErrors")?.addEventListener("click", clearAllErrors);
}

function switchHistoryTab(tab) {
  const isAudit = tab === "audit";
  const btnTasks = document.getElementById("tabHistoryTasks");
  const btnAudit = document.getElementById("tabHistoryAudit");
  const panelTasks = document.getElementById("historyTasksPanel");
  const panelAudit = document.getElementById("historyAuditPanel");

  if (btnTasks) {
    btnTasks.classList.toggle("active", !isAudit);
    btnTasks.setAttribute("aria-selected", String(!isAudit));
  }
  if (btnAudit) {
    btnAudit.classList.toggle("active", isAudit);
    btnAudit.setAttribute("aria-selected", String(isAudit));
  }
  if (panelTasks) panelTasks.hidden = isAudit;
  if (panelAudit) panelAudit.hidden = !isAudit;
}

/* ---------- Data Fetching & Refresh ---------- */

async function initDashboard() {
  await Promise.all([
    fetchHealth(),
    fetchAgents(),
    fetchTasks(),
    fetchApprovals(),
    fetchErrors(),
    fetchAudit(),
    loadWorkspacePaths(),
  ]);
}

async function refreshAll() {
  await Promise.all([
    fetchHealth(),
    fetchTasks(),
    fetchApprovals(),
    fetchErrors(),
    fetchAudit(),
  ]);
  if (activeTaskId) {
    await refreshActiveTaskWorkspace();
  }
}

async function fetchHealth() {
  const dbEl = document.getElementById("dbStatus");
  const countEl = document.getElementById("agentsCount");
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (dbEl) {
      dbEl.textContent = "DB: Connected";
      dbEl.className = "status-pill status-healthy";
    }
    if (countEl) countEl.textContent = `${data.available_agents}`;
  } catch {
    if (dbEl) {
      dbEl.textContent = "DB: Offline";
      dbEl.className = "status-pill status-error";
    }
  }
}

async function fetchAgents() {
  const container = document.getElementById("agentsGrid");
  if (!container) return;
  try {
    const res = await fetch(`${API_BASE}/agents`);
    detectedAgents = await res.json();
    if (!Array.isArray(detectedAgents) || detectedAgents.length === 0) {
      container.innerHTML = `<span class="agent-chip-loading">No CLI agents detected</span>`;
      return;
    }

    container.innerHTML = detectedAgents.map((agent) => {
      const caps = [];
      if (agent.capabilities?.supports_headless) caps.push("Headless");
      if (agent.capabilities?.supports_acp) caps.push("ACP");
      if (agent.capabilities?.supports_mcp) caps.push("MCP");
      if (agent.capabilities?.supports_json_output) caps.push("Stream");
      const meta = getAgentMeta(agent.agent_type);
      return `
        <button type="button" class="agent-chip" data-agent="${escapeHtml(agent.agent_type)}"
          aria-pressed="false" title="${escapeHtml(agent.name)} v${escapeHtml(agent.version)} (${caps.join(", ")}) — Click to select worker">
          <span class="agent-dot" aria-hidden="true"></span>
          <span>${escapeHtml(agent.name || meta.full)}</span>
        </button>
      `;
    }).join("");

    container.querySelectorAll("[data-agent]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const agentType = btn.dataset.agent;
        const select = document.getElementById("taskAgent");
        if (select) {
          select.value = select.value === agentType ? "" : agentType;
          syncAgentChipPressedState();
          syncDualPanePreviewHeaders();
          const chosen = select.value ? getAgentMeta(select.value).full : "Auto (OpenCode)";
          announceStatus(`Target worker set to ${chosen}`);
        }
      });
    });

    syncAgentChipPressedState();
    syncDualPanePreviewHeaders();
  } catch {
    container.innerHTML = `<span class="agent-chip-loading">Agent registry unavailable</span>`;
  }
}

function syncAgentChipPressedState() {
  const chosen = document.getElementById("taskAgent")?.value || "";
  document.querySelectorAll(".agent-chip[data-agent]").forEach((chip) => {
    chip.setAttribute("aria-pressed", String(chip.dataset.agent === chosen));
  });
}

function pickDefaultActiveTask(tasks) {
  if (!tasks || tasks.length === 0) return null;
  const active = tasks.find((t) => t.status === "RUNNING" || t.status === "AWAITING_APPROVAL");
  return (active || tasks[0]).id;
}

async function fetchTasks() {
  const tbody = document.getElementById("tasksTbody");
  const switcher = document.getElementById("activeTaskSelect");
  const histCount = document.getElementById("historyCount");

  try {
    const res = await fetch(`${API_BASE}/tasks`);
    const tasks = await res.json();
    cachedTasks = Array.isArray(tasks) ? tasks : [];
    if (histCount) histCount.textContent = String(cachedTasks.length);

    // Ensure activeTaskId stays valid
    const exists = cachedTasks.some((t) => t.id === activeTaskId);
    if (!exists) {
      activeTaskId = pickDefaultActiveTask(cachedTasks);
    }

    // Populate top active-task switcher
    if (switcher) {
      if (cachedTasks.length === 0) {
        switcher.innerHTML = `<option value="">No tasks submitted yet</option>`;
      } else {
        switcher.innerHTML = cachedTasks.map((t) => (
          `<option value="${escapeHtml(t.id)}">[${escapeHtml(t.status)}] ${escapeHtml(t.title)}</option>`
        )).join("");
        if (activeTaskId) switcher.value = activeTaskId;
      }
    }

    // Render Tasks History table
    if (tbody) {
      if (cachedTasks.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No tasks submitted yet. Enter a prompt above to start!</td></tr>`;
      } else {
        tbody.innerHTML = cachedTasks.map((t) => {
          const teamText = t.assigned_agent
            ? `${getAgentMeta(t.assigned_agent).icon} ${escapeHtml(getAgentMeta(t.assigned_agent).short)}`
            : "🟣 Antigravity ↔ 🟢 OpenCode";
          const wtLabel = t.worktree_path
            ? escapeHtml(t.worktree_path.split("\\").pop().split("/").pop())
            : "Root";
          const shortTitle = escapeHtml(t.title);
          let actionButtons = `
            <button type="button" class="btn btn-sm btn-subtle" data-focus-task="${escapeHtml(t.id)}" aria-label="Focus task ${shortTitle}">Focus</button>
            <button type="button" class="btn btn-sm btn-ghost" data-files-task="${escapeHtml(t.id)}" aria-label="Inspect files for ${shortTitle}">📁 Files</button>
          `;
          if (t.status === "PENDING") {
            actionButtons += `
              <button type="button" class="btn btn-sm btn-primary" data-team-task="${escapeHtml(t.id)}" aria-label="Run team workflow for ${shortTitle}">Team ⚡</button>
              <button type="button" class="btn btn-sm btn-subtle" data-exec-task="${escapeHtml(t.id)}" aria-label="Run single agent for ${shortTitle}">Run</button>
              <button type="button" class="btn btn-sm btn-ghost" data-delete-task="${escapeHtml(t.id)}" aria-label="Delete task ${shortTitle}">✕</button>
            `;
          } else if (t.status === "RUNNING" || t.status === "AWAITING_APPROVAL") {
            actionButtons += `
              <button type="button" class="btn btn-sm btn-stop" data-stop-task="${escapeHtml(t.id)}" aria-label="Stop task ${shortTitle}">Stop ⏹</button>
            `;
          } else if (t.status === "FAILED" || t.status === "CANCELLED") {
            actionButtons += `
              <button type="button" class="btn btn-sm btn-subtle" data-team-task="${escapeHtml(t.id)}" aria-label="Retry task ${shortTitle}">Retry ↺</button>
              <button type="button" class="btn btn-sm btn-ghost" data-delete-task="${escapeHtml(t.id)}" aria-label="Delete task ${shortTitle}">✕</button>
            `;
          } else {
            actionButtons += `
              <button type="button" class="btn btn-sm btn-ghost" data-delete-task="${escapeHtml(t.id)}" aria-label="Delete task ${shortTitle}">✕</button>
            `;
          }
          return `
            <tr>
              <td>
                <strong>${shortTitle}</strong>
                <div class="task-row-sub" title="${escapeHtml(t.description)}">${escapeHtml(t.description)}</div>
              </td>
              <td>${teamText}</td>
              <td><span class="status-badge status-${escapeHtml(t.status)}">${escapeHtml(t.status)}</span></td>
              <td>${wtLabel}</td>
              <td>${new Date(t.created_at).toLocaleTimeString()}</td>
              <td><div class="table-actions">${actionButtons}</div></td>
            </tr>
          `;
        }).join("");

        tbody.querySelectorAll("[data-focus-task]").forEach((btn) => {
          btn.addEventListener("click", () => {
            focusTaskInWorkspace(btn.dataset.focusTask);
            closeDialogModal("historyDialog");
          });
        });
        tbody.querySelectorAll("[data-files-task]").forEach((btn) => {
          btn.addEventListener("click", () => viewTaskDetails(btn.dataset.filesTask, "files"));
        });
        tbody.querySelectorAll("[data-team-task]").forEach((btn) => {
          btn.addEventListener("click", () => {
            collaborateTask(btn.dataset.teamTask);
            closeDialogModal("historyDialog");
          });
        });
        tbody.querySelectorAll("[data-exec-task]").forEach((btn) => {
          btn.addEventListener("click", () => {
            executeTask(btn.dataset.execTask);
            closeDialogModal("historyDialog");
          });
        });
        tbody.querySelectorAll("[data-stop-task]").forEach((btn) => {
          btn.addEventListener("click", () => stopTask(btn.dataset.stopTask));
        });
        tbody.querySelectorAll("[data-delete-task]").forEach((btn) => {
          btn.addEventListener("click", () => deleteTask(btn.dataset.deleteTask));
        });
      }
    }

    if (activeTaskId) {
      await refreshActiveTaskWorkspace();
    } else {
      renderIdleActionAreas();
    }
  } catch {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Unable to load tasks.</td></tr>`;
    }
  }
}

/* ---------- Task Submission & Actions ---------- */

async function submitAndRunTask(mode = "collaborate") {
  const titleEl = document.getElementById("taskTitle");
  const descEl = document.getElementById("taskDesc");
  const agentEl = document.getElementById("taskAgent");
  const policyEl = document.getElementById("taskPolicy");
  const pathInput = document.getElementById("projectPath");
  const worktreeEl = document.getElementById("useWorktree");
  const btnTeam = document.getElementById("btnSubmitTask");
  const btnSingle = document.getElementById("btnSingleRun");

  const description = (descEl?.value || "").trim();
  if (!description) {
    showComposerFeedback("Enter a prompt, instruction, or code snippet before running.");
    descEl?.focus();
    return;
  }

  showComposerFeedback("");
  if (btnTeam) btnTeam.disabled = true;
  if (btnSingle) btnSingle.disabled = true;

  const rawPath = (pathInput?.value || "").trim();
  let projectPath = rawPath || selectedFolderRoot || null;
  const contextFiles = [...selectedContextFiles];
  if (scopeMode === "files") {
    if (rawPath) {
      const rel = toRelativeTarget(rawPath);
      if (rel && !contextFiles.includes(rel)) contextFiles.push(rel);
    }
    projectPath = selectedFolderRoot || workspaceRootPath || null;
  }
  for (const img of attachedImages) {
    if (img?.path && !contextFiles.includes(img.path)) {
      contextFiles.push(img.path);
    }
  }

  const payload = {
    title: (titleEl?.value || "").trim() || null,
    description,
    policy_mode: policyEl?.value || "AUTO_LOW_IMPACT",
    use_worktree: Boolean(worktreeEl?.checked ?? true),
    preferred_agent: (agentEl?.value || "") || null,
    project_path: projectPath,
    context_files: contextFiles,
  };

  try {
    const createRes = await fetch(`${API_BASE}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!createRes.ok) {
      const errData = await createRes.json().catch(() => ({}));
      throw new Error(errData.detail || "Task submission failed");
    }
    const created = await createRes.json();

    const dispatchEndpoint = mode === "execute"
      ? `${API_BASE}/tasks/${created.id}/execute`
      : `${API_BASE}/tasks/${created.id}/collaborate`;
    const runRes = await fetch(dispatchEndpoint, { method: "POST" });
    if (!runRes.ok) {
      const errData = await runRes.json().catch(() => ({}));
      throw new Error(errData.detail || "Dispatch failed");
    }

    // Reset composer cleanly while preserving target folder root
    document.getElementById("taskForm")?.reset();
    if (titleEl) titleEl.placeholder = "Optional title (auto-generated from prompt)";
    if (worktreeEl) worktreeEl.checked = true;
    attachedImages = [];
    renderAttachedImages();
    if (repoRootPath) {
      selectedFolderRoot = repoRootPath;
      workspaceRootPath = repoRootPath;
    }
    setScopeMode("folder");
    syncAgentChipPressedState();

    // Switch live dual panes directly to the new task
    focusTaskInWorkspace(created.id);
    await fetchTasks();
    announceStatus(`Dispatched task ${created.title}`);
  } catch (err) {
    showComposerFeedback(`Unable to start task: ${err.message}`);
  } finally {
    if (btnTeam) btnTeam.disabled = false;
    if (btnSingle) btnSingle.disabled = false;
  }
}

async function executeTask(taskId) {
  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/execute`, { method: "POST" });
    if (!res.ok) throw new Error("Execution dispatch failed");
    focusTaskInWorkspace(taskId);
    await Promise.all([fetchTasks(), fetchAudit()]);
  } catch (err) {
    showComposerFeedback(`Execution error: ${err.message}`);
  }
}

async function collaborateTask(taskId) {
  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/collaborate`, { method: "POST" });
    if (!res.ok) throw new Error("Collaboration dispatch failed");
    focusTaskInWorkspace(taskId);
    await Promise.all([fetchTasks(), fetchAudit()]);
  } catch (err) {
    showComposerFeedback(`Team workflow error: ${err.message}`);
  }
}

async function stopTask(taskId) {
  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/cancel`, { method: "POST" });
    if (!res.ok) throw new Error("Failed to stop task");
    announceStatus("Stop signal sent to task");
    await Promise.all([fetchTasks(), fetchAudit()]);
  } catch (err) {
    showComposerFeedback(`Stop error: ${err.message}`);
  }
}

async function deleteTask(taskId) {
  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete task");
    if (activeTaskId === taskId) {
      activeTaskId = null;
      lastLoadedActiveTaskId = null;
    }
    announceStatus("Deleted task");
    await Promise.all([fetchTasks(), fetchApprovals(), fetchErrors(), fetchAudit()]);
  } catch (err) {
    showComposerFeedback(`Delete error: ${err.message}`);
  }
}

function viewTaskDetails(taskId, tab = "chat") {
  focusTaskInWorkspace(taskId);
  if (tab === "files") {
    closeDialogModal("historyDialog");
    loadTaskFiles(taskId);
    openDialogModal("filesDialog");
  } else {
    closeDialogModal("historyDialog");
    closeDialogModal("filesDialog");
  }
}

function focusTaskInWorkspace(taskId) {
  const changed = lastLoadedActiveTaskId !== taskId;
  activeTaskId = taskId;
  const switcher = document.getElementById("activeTaskSelect");
  if (switcher && taskId) switcher.value = taskId;

  if (changed) {
    lastLoadedActiveTaskId = taskId;
    eventFingerprints.clear();
    lastInspectorSupplementFp = "";
    lastWorkerSupplementFp = "";
    lastActiveActionsFp = "";
    lastFilesFingerprint = null;
    const left = document.getElementById("inspectorActionStream");
    const right = document.getElementById("workerActionStream");
    if (left) left.innerHTML = "";
    if (right) right.innerHTML = "";
  }
  refreshActiveTaskWorkspace();
}

/* ---------- Dual Fixed-Height Live Action Areas ---------- */

function renderIdleActionAreas() {
  const stepper = document.getElementById("stageStepper");
  const statusBadge = document.getElementById("activeTaskStatusBadge");
  const actionsWrap = document.getElementById("activeTaskActions");
  const filesBadge = document.getElementById("headerFilesCount");
  if (stepper) { stepper.hidden = true; stepper.innerHTML = ""; }
  if (statusBadge) { statusBadge.hidden = true; }
  if (actionsWrap) actionsWrap.innerHTML = "";
  if (filesBadge) filesBadge.textContent = "0";

  syncDualPanePreviewHeaders();
  const left = document.getElementById("inspectorActionStream");
  const right = document.getElementById("workerActionStream");
  if (left) left.innerHTML = `<div class="empty-state">Submit a prompt above to start inspection &amp; verification.</div>`;
  if (right) right.innerHTML = `<div class="empty-state">Live negotiation &amp; code execution output will stream here.</div>`;
}

function syncDualPanePreviewHeaders() {
  const dropdownWorker = document.getElementById("taskAgent")?.value || "";
  const activeTask = cachedTasks.find((t) => t.id === activeTaskId);
  const inspectorMeta = getAgentMeta("ANTIGRAVITY");
  const workerKey = activeTask?.assigned_agent && activeTask.assigned_agent !== "ANTIGRAVITY"
    ? activeTask.assigned_agent
    : (dropdownWorker && dropdownWorker !== "ANTIGRAVITY" ? dropdownWorker : "OPENCODE");
  const workerMeta = getAgentMeta(workerKey);

  const inspTitle = document.getElementById("inspectorAreaTitle");
  const workTitle = document.getElementById("workerAreaTitle");
  if (inspTitle && !activeTaskId) {
    inspTitle.textContent = `${inspectorMeta.icon} ${inspectorMeta.short} Action Area`;
  }
  if (workTitle && !activeTaskId) {
    workTitle.textContent = `${workerMeta.icon} ${workerMeta.short} Action Area`;
  }
}

function renderStageStepper(workflow) {
  const stepper = document.getElementById("stageStepper");
  if (!stepper) return;
  if (!workflow) {
    stepper.hidden = true;
    stepper.innerHTML = "";
    return;
  }
  stepper.hidden = false;
  const inspector = getAgentMeta(workflow.inspector_agent || "ANTIGRAVITY");
  const worker = getAgentMeta(workflow.worker_agent || "OPENCODE");
  const stages = [
    { key: "INSPECTION", label: `1. Inspection (${inspector.short})` },
    { key: "NEGOTIATION", label: `2. Negotiation (${worker.short})` },
    { key: "EXECUTION", label: `3. Execution (${worker.short})` },
    { key: "VERIFICATION", label: `4. Verification (${inspector.short})` },
  ];
  const order = ["INSPECTION", "NEGOTIATION", "EXECUTION", "VERIFICATION", "COMPLETED"];
  const curIdx = order.indexOf(workflow.current_phase);
  const completedSet = new Set((workflow.messages || []).map((m) => m.phase));

  stepper.innerHTML = stages.map((st, idx) => {
    let cls = "";
    let icon = "○";
    if (workflow.status === "COMPLETED" || (completedSet.has(st.key) && idx < curIdx)) {
      cls = "done";
      icon = "✓";
    } else if (st.key === workflow.current_phase || idx === curIdx) {
      if (workflow.status === "FAILED") {
        cls = "failed";
        icon = "✕";
      } else {
        cls = "active";
        icon = `<span class="spinner-dot"></span>`;
      }
    }
    return `<div class="stage-step ${cls}">${icon}<span>${escapeHtml(st.label)}</span></div>`;
  }).join("");
}

function renderActiveTaskBar(task, workflow) {
  const statusBadge = document.getElementById("activeTaskStatusBadge");
  const actionsWrap = document.getElementById("activeTaskActions");
  if (statusBadge && task) {
    statusBadge.hidden = false;
    statusBadge.className = `status-badge status-${task.status}`;
    statusBadge.textContent = task.status;
  }
  renderStageStepper(workflow);

  if (!actionsWrap || !task) return;
  const fp = `${task.id}|${task.status}`;
  if (fp === lastActiveActionsFp) return;
  lastActiveActionsFp = fp;

  let buttons = `<button type="button" class="btn btn-sm btn-subtle" id="btnActiveFiles">📁 Files</button>`;
  if (task.status === "PENDING") {
    buttons += `
      <button type="button" class="btn btn-sm btn-primary" id="btnActiveTeam">Run Team ⚡</button>
      <button type="button" class="btn btn-sm btn-subtle" id="btnActiveExec">Single Run</button>
    `;
  } else if (task.status === "RUNNING" || task.status === "AWAITING_APPROVAL") {
    buttons += `<button type="button" class="btn btn-sm btn-stop" id="btnActiveStop">Stop ⏹</button>`;
  } else if (task.status === "FAILED" || task.status === "CANCELLED") {
    buttons += `<button type="button" class="btn btn-sm btn-subtle" id="btnActiveRetry">Retry ↺</button>`;
  }
  actionsWrap.innerHTML = buttons;

  document.getElementById("btnActiveFiles")?.addEventListener("click", () => {
    loadTaskFiles(task.id);
    openDialogModal("filesDialog");
  });
  document.getElementById("btnActiveTeam")?.addEventListener("click", () => collaborateTask(task.id));
  document.getElementById("btnActiveExec")?.addEventListener("click", () => executeTask(task.id));
  document.getElementById("btnActiveStop")?.addEventListener("click", () => stopTask(task.id));
  document.getElementById("btnActiveRetry")?.addEventListener("click", () => collaborateTask(task.id));
}

function toolStatusIcon(status) {
  if (status === "running") return `<span class="spinner-dot"></span>`;
  if (status === "failed") return `<span style="color:var(--danger); font-weight:700;">✕</span>`;
  return `<span style="color:var(--ok); font-weight:700;">✓</span>`;
}

function agentBadgeHtml(agentName) {
  const m = getAgentMeta(agentName);
  return `<span class="agent-pill ${m.pillClass}">${m.icon} ${escapeHtml(m.short)}</span>`;
}

function createEventElement(ev, paneKey) {
  if (ev.kind === "tool") {
    const details = document.createElement("details");
    details.className = "activity-tool-card";
    details.dataset.eventId = `${paneKey}-${ev.id}`;
    details.innerHTML = `<summary class="activity-tool-header"></summary><div class="activity-tool-body"><pre></pre></div>`;
    updateEventElement(details, ev);
    return details;
  }
  const div = document.createElement("div");
  div.dataset.eventId = `${paneKey}-${ev.id}`;
  updateEventElement(div, ev);
  return div;
}

function updateEventElement(node, ev) {
  if (ev.kind === "tool") {
    node.dataset.status = ev.status || "done";
    const summary = node.querySelector("summary");
    const dur = ev.duration_seconds != null
      ? `${ev.duration_seconds.toFixed(1)}s`
      : (ev.status === "running" ? "running…" : "");
    summary.innerHTML = `
      ${toolStatusIcon(ev.status)}
      ${ev.phase ? `<span class="phase-badge">${escapeHtml(ev.phase)}</span>` : ""}
      <span class="tool-name-pill">${escapeHtml(ev.tool || "tool")}</span>
      <span class="activity-tool-target" title="${escapeHtml(ev.title || "")}">${escapeHtml(ev.title || "(working)")}</span>
      <span class="activity-tool-duration">${dur}</span>
    `;
    const pre = node.querySelector(".activity-tool-body pre");
    pre.textContent = ev.content || (ev.status === "running" ? "Running…" : "(no output)");
    return;
  }

  if (ev.kind === "text") {
    node.className = `activity-text-bubble agent-${escapeHtml(ev.agent || "OTHER")}`;
    const cursor = ev.status === "running" ? ` <span class="stream-cursor">▋</span>` : "";
    node.innerHTML = `
      <div class="activity-text-meta">
        <span>${agentBadgeHtml(ev.agent)} <span style="margin-inline-start:0.3rem; color:var(--text-muted);">Live Output</span></span>
        ${ev.phase ? `<span class="phase-badge">${escapeHtml(ev.phase)}</span>` : ""}
      </div>
      <div class="activity-text-body">${escapeHtml(ev.content || "")}${cursor}</div>
    `;
    return;
  }

  if (ev.kind === "error" || ev.status === "failed") {
    node.className = "activity-error-line";
    node.innerHTML = `${agentBadgeHtml(ev.agent)} <strong>Error:</strong> ${escapeHtml(ev.title || "")} ${escapeHtml(ev.content || "")}`;
    return;
  }

  node.className = "activity-system-line";
  const icon = ev.status === "running" ? `<span class="spinner-dot"></span>` : "•";
  node.innerHTML = `${icon} ${agentBadgeHtml(ev.agent)} <span>${escapeHtml(ev.title || ev.content || "")}</span>`;
}

function updateScrollPaneEvents(containerId, paneKey, events, supplementHtml, supplementFp, isLeft) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 70;
  const placeholder = container.querySelector(".empty-state");
  if (events.length > 0 || supplementHtml) {
    if (placeholder) placeholder.remove();
  }

  // Track which event DOM nodes belong here
  const activeIds = new Set(events.map((ev) => `${paneKey}-${ev.id}`));
  container.querySelectorAll("[data-event-id]").forEach((el) => {
    if (!activeIds.has(el.dataset.eventId)) el.remove();
  });

  // Insert events before any trailing supplement container so summaries stay at the bottom
  let supplementBox = container.querySelector("[data-supplement-box]");
  events.forEach((ev) => {
    const key = `${paneKey}-${ev.id}`;
    const fp = `${ev.updated_at}|${ev.status}|${(ev.content || "").length}`;
    let node = container.querySelector(`[data-event-id="${key}"]`);
    if (!node) {
      node = createEventElement(ev, paneKey);
      if (supplementBox) container.insertBefore(node, supplementBox);
      else container.appendChild(node);
      eventFingerprints.set(key, fp);
    } else if (eventFingerprints.get(key) !== fp) {
      updateEventElement(node, ev);
      eventFingerprints.set(key, fp);
    }
  });

  // Update trailing stage summary / failure / raw log block only if changed
  const prevSupFp = isLeft ? lastInspectorSupplementFp : lastWorkerSupplementFp;
  if (supplementFp !== prevSupFp) {
    if (isLeft) lastInspectorSupplementFp = supplementFp;
    else lastWorkerSupplementFp = supplementFp;

    if (!supplementHtml) {
      if (supplementBox) supplementBox.remove();
    } else {
      if (!supplementBox) {
        supplementBox = document.createElement("div");
        supplementBox.dataset.supplementBox = "1";
        supplementBox.style.display = "flex";
        supplementBox.style.flexDirection = "column";
        supplementBox.style.gap = "0.45rem";
        container.appendChild(supplementBox);
      }
      supplementBox.innerHTML = supplementHtml;
    }
  }

  if (events.length === 0 && !supplementHtml && !container.querySelector(".empty-state")) {
    container.innerHTML = `<div class="empty-state">${isLeft
      ? "Waiting for inspection / verification activity…"
      : "Waiting for negotiation / implementation activity…"}</div>`;
  }

  if (nearBottom) {
    container.scrollTop = container.scrollHeight;
  }
}

function updatePaneStatusPill(pillId, agentKey, events, workflow, task) {
  const pill = document.getElementById(pillId);
  if (!pill) return;

  const taskStatus = task?.status || "IDLE";
  const isLeft = pillId === "inspectorStatusPill";
  const phase = workflow?.current_phase || "";
  const isPhaseActive = (isLeft && ["INSPECTION", "VERIFICATION"].includes(phase))
    || (!isLeft && ["NEGOTIATION", "EXECUTION"].includes(phase));
  const hasRunningEvent = taskStatus === "RUNNING" && events.some((ev) => ev.status === "running");

  if (taskStatus === "RUNNING" && (hasRunningEvent || isPhaseActive)) {
    pill.textContent = "Streaming";
    pill.className = "status-pill status-running";
  } else if (taskStatus === "RUNNING") {
    pill.textContent = "Standby";
    pill.className = "status-pill status-agent";
  } else if (taskStatus === "AWAITING_APPROVAL") {
    pill.textContent = "Awaiting You";
    pill.className = "status-pill status-waiting";
  } else if (taskStatus === "FAILED") {
    const failedHere = events.some((ev) => ev.status === "failed" || ev.kind === "error") || isPhaseActive;
    pill.textContent = failedHere ? "Failed" : "Halted";
    pill.className = failedHere ? "status-pill status-error" : "status-pill";
  } else if (taskStatus === "CANCELLED") {
    pill.textContent = "Stopped";
    pill.className = "status-pill";
  } else if (taskStatus === "COMPLETED") {
    pill.textContent = "Done";
    pill.className = "status-pill status-healthy";
  } else if (events.length > 0) {
    pill.textContent = `${events.length} events`;
    pill.className = "status-pill status-agent";
  } else {
    pill.textContent = taskStatus === "PENDING" ? "Queued" : "Idle";
    pill.className = "status-pill";
  }
}

async function refreshActiveTaskWorkspace() {
  const taskId = activeTaskId;
  if (!taskId) return;

  const task = cachedTasks.find((t) => t.id === taskId) || null;
  try {
    const [wfRes, evRes, runsRes, filesRes] = await Promise.all([
      fetch(`${API_BASE}/tasks/${taskId}/workflow`),
      fetch(`${API_BASE}/tasks/${taskId}/events`),
      fetch(`${API_BASE}/tasks/${taskId}/runs`),
      fetch(`${API_BASE}/tasks/${taskId}/files`),
    ]);
    if (activeTaskId !== taskId) return;

    const workflow = wfRes.ok ? await wfRes.json() : null;
    const evPayload = evRes.ok ? await evRes.json() : { events: [] };
    const events = evPayload.events || [];
    const runs = runsRes.ok ? await runsRes.json() : [];
    const filesData = filesRes.ok ? await filesRes.json() : null;

    if (filesData) {
      const totalFiles = (filesData.total_changed || 0) + (filesData.total_activity || 0);
      const headerFilesBadge = document.getElementById("headerFilesCount");
      const modalFilesBadge = document.getElementById("modalFilesBadge");
      if (headerFilesBadge) headerFilesBadge.textContent = String(totalFiles);
      if (modalFilesBadge) modalFilesBadge.textContent = String(totalFiles);
      if (document.getElementById("filesDialog")?.open) {
        renderFilesDialogContent(filesData);
      }
    }

    renderActiveTaskBar(task, workflow);

    // Determine dynamic left (Inspector) and right (Worker/Negotiator) agent names
    const inspectorKey = workflow?.inspector_agent || "ANTIGRAVITY";
    const dropdownWorker = document.getElementById("taskAgent")?.value || "";
    const workerKey = workflow?.worker_agent
      || (task?.assigned_agent && task.assigned_agent !== inspectorKey ? task.assigned_agent : null)
      || (dropdownWorker && dropdownWorker !== inspectorKey ? dropdownWorker : "OPENCODE");

    const inspectorMeta = getAgentMeta(inspectorKey);
    const workerMeta = getAgentMeta(workerKey);

    const inspTitleEl = document.getElementById("inspectorAreaTitle");
    const workTitleEl = document.getElementById("workerAreaTitle");
    if (inspTitleEl) inspTitleEl.textContent = `${inspectorMeta.icon} ${inspectorMeta.short} Action Area`;
    if (workTitleEl) workTitleEl.textContent = `${workerMeta.icon} ${workerMeta.short} Action Area`;

    // Partition events across Left vs Right Action Areas
    const leftEvents = [];
    const rightEvents = [];
    const sameAgentMode = inspectorKey === workerKey;

    events.forEach((ev) => {
      if (sameAgentMode) {
        if (["NEGOTIATION", "EXECUTION"].includes(ev.phase)) rightEvents.push(ev);
        else leftEvents.push(ev);
        return;
      }
      if (ev.agent === inspectorKey) {
        leftEvents.push(ev);
      } else if (ev.agent === workerKey) {
        rightEvents.push(ev);
      } else if (ev.agent === "SYSTEM") {
        if (["NEGOTIATION", "EXECUTION"].includes(ev.phase)) rightEvents.push(ev);
        else leftEvents.push(ev);
      } else {
        rightEvents.push(ev);
      }
    });

    // Partition completed workflow stage summaries & failure reports
    let leftSupHtml = "";
    let rightSupHtml = "";

    if (workflow) {
      if (workflow.status === "FAILED" && workflow.verification_report) {
        leftSupHtml += `
          <div class="activity-error-line" role="alert">
            <strong>🚨 Workflow Failed:</strong> ${escapeHtml(workflow.verification_report)}
          </div>
        `;
      }
      const phaseCounts = new Map();
      (workflow.messages || []).forEach((msg) => {
        phaseCounts.set(msg.phase, (phaseCounts.get(msg.phase) || 0) + 1);
      });
      const phaseSeen = new Map();
      (workflow.messages || []).forEach((msg) => {
        const idx = (phaseSeen.get(msg.phase) || 0) + 1;
        phaseSeen.set(msg.phase, idx);
        const totalForPhase = phaseCounts.get(msg.phase) || 1;
        const roundLabel = totalForPhase > 1 ? ` #${idx}` : "";
        const goesRight = sameAgentMode
          ? ["NEGOTIATION", "EXECUTION"].includes(msg.phase)
          : msg.sender === workerKey;
        const senderMeta = getAgentMeta(msg.sender);
        const card = `
          <details class="stage-summary-card">
            <summary>
              <span>${senderMeta.icon} Stage Summary &mdash; ${escapeHtml(msg.phase)}${roundLabel}</span>
              <span class="phase-badge">${escapeHtml(senderMeta.short)}</span>
            </summary>
            <div class="stage-summary-body">${escapeHtml(msg.content)}</div>
          </details>
        `;
        if (goesRight) rightSupHtml += card;
        else leftSupHtml += card;
      });
    } else if (runs.length > 0 && events.length === 0) {
      // Single-agent run fallback output
      const latest = runs[0];
      let text = "";
      if (latest.stdout) text += "=== STDOUT ===\n" + latest.stdout + "\n\n";
      if (latest.stderr) text += "=== STDERR ===\n" + latest.stderr + "\n\n";
      if (latest.error_reason) text += "=== ERROR ===\n" + latest.error_reason + "\n";
      const logCard = `<pre class="output-terminal">${escapeHtml(text || "Initializing agent run…")}</pre>`;
      if (latest.agent_type === inspectorKey) leftSupHtml += logCard;
      else rightSupHtml += logCard;
    }

    const leftSupFp = `${taskId}|L|${leftSupHtml.length}|${workflow?.status || ""}|${(workflow?.messages || []).length}`;
    const rightSupFp = `${taskId}|R|${rightSupHtml.length}|${workflow?.status || ""}|${(workflow?.messages || []).length}`;

    updateScrollPaneEvents("inspectorActionStream", "L", leftEvents, leftSupHtml, leftSupFp, true);
    updateScrollPaneEvents("workerActionStream", "R", rightEvents, rightSupHtml, rightSupFp, false);

    updatePaneStatusPill("inspectorStatusPill", inspectorKey, leftEvents, workflow, task);
    updatePaneStatusPill("workerStatusPill", workerKey, rightEvents, workflow, task);
  } catch {
    // Non-fatal during polling
  }
}

/* ---------- Files Worked On & Diffs Dialog ---------- */

async function loadTaskFiles(taskId) {
  const container = document.getElementById("filesContainer");
  if (!container) return;
  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/files`);
    if (!res.ok) throw new Error("Could not fetch file status");
    const data = await res.json();
    renderFilesDialogContent(data);
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Error loading files: ${escapeHtml(err.message)}</div>`;
  }
}

function renderFilesDialogContent(data) {
  const container = document.getElementById("filesContainer");
  const modalBadge = document.getElementById("modalFilesBadge");
  const headerBadge = document.getElementById("headerFilesCount");
  if (!container || !data) return;

  const changedFiles = data.changed_files || [];
  const activityFiles = data.activity_files || [];
  const totalCount = changedFiles.length + activityFiles.length;
  if (modalBadge) modalBadge.textContent = String(totalCount);
  if (headerBadge) headerBadge.textContent = String(totalCount);

  const fp = JSON.stringify(data);
  if (fp === lastFilesFingerprint) return;
  lastFilesFingerprint = fp;

  let html = `
    <div class="files-summary-bar">
      <div><strong>Working Directory:</strong> <code>${escapeHtml(data.working_dir)}</code></div>
      <div><strong>Modified:</strong> ${changedFiles.length} &bull; <strong>Tool Calls:</strong> ${activityFiles.length}</div>
    </div>
    <h3 class="files-section-heading">✏️ Modified Files on Disk</h3>
  `;

  if (changedFiles.length === 0) {
    html += `
      <div class="empty-state">
        No uncommitted modifications on disk yet.
        ${data.context_files && data.context_files.length
          ? `<div style="margin-block-start:0.4rem;">Targets: ${data.context_files.map((f) => `<code>${escapeHtml(f)}</code>`).join(", ")}</div>`
          : ""}
      </div>
    `;
  } else {
    changedFiles.forEach((file) => {
      html += `
        <div class="file-card">
          <div class="file-card-header">
            <span>📄 ${escapeHtml(file.path)}</span>
            <span class="badge">${escapeHtml(file.status)}</span>
          </div>
          <div class="diff-viewer">${formatDiff(file.diff || "")}</div>
        </div>
      `;
    });
  }

  html += `<h3 class="files-section-heading">🔍 Live Agent Tool &amp; File Activity</h3>`;
  if (activityFiles.length === 0) {
    html += `<div class="empty-state">No tool invocations recorded for this task yet.</div>`;
  } else {
    activityFiles.forEach((act) => {
      const lowerStatus = (act.status || "done").toLowerCase();
      const dur = act.duration_seconds != null ? `${act.duration_seconds.toFixed(1)}s` : (lowerStatus === "running" ? "running…" : "");
      html += `
        <details class="activity-tool-card" data-status="${escapeHtml(lowerStatus)}">
          <summary class="activity-tool-header">
            ${toolStatusIcon(lowerStatus)}
            ${agentBadgeHtml(act.agent)}
            ${act.phase ? `<span class="phase-badge">${escapeHtml(act.phase)}</span>` : ""}
            <span class="tool-name-pill">${escapeHtml(act.tool)}</span>
            <span class="activity-tool-target" title="${escapeHtml(act.target)}">${escapeHtml(act.target)}</span>
            <span class="activity-tool-duration">${dur}</span>
          </summary>
          <div class="activity-tool-body"><pre>${escapeHtml(act.output || "(no output)")}</pre></div>
        </details>
      `;
    });
  }

  container.innerHTML = html;
}

function formatDiff(diffText) {
  if (!diffText) return `<span class="diff-line diff-ctx">No diff available</span>`;
  return diffText.split("\n").map((line) => {
    let cls = "diff-ctx";
    if (line.startsWith("+") && !line.startsWith("+++")) cls = "diff-add";
    else if (line.startsWith("-") && !line.startsWith("---")) cls = "diff-del";
    else if (line.startsWith("@@") || line.startsWith("+++") || line.startsWith("---")) cls = "diff-hdr";
    return `<span class="diff-line ${cls}">${escapeHtml(line)}</span>`;
  }).join("");
}

/* ---------- Human Decisions Area (AWAITING_APPROVAL) ---------- */

async function fetchApprovals() {
  const container = document.getElementById("approvalsList");
  const badge = document.getElementById("approvalsBadge");
  if (!container) return;

  try {
    if (pendingDecisionInFlight) return;
    const active = document.activeElement;
    if (
      active && container.contains(active) && (
        active.classList.contains("approval-note-input")
        || active.classList.contains("btn-approve")
        || active.classList.contains("btn-deny")
      )
    ) {
      return;
    }

    const res = await fetch(`${API_BASE}/approvals`);
    const approvals = await res.json();
    if (badge) badge.textContent = String(approvals.length);

    const fp = approvals.map((a) => `${a.id}|${a.action_type}|${a.risk_level}`).join(",");
    if (fp === lastApprovalsFingerprint) return;

    const existingNotes = {};
    container.querySelectorAll(".approval-note-input").forEach((inp) => {
      existingNotes[inp.id] = inp.value;
    });

    if (approvals.length === 0) {
      container.innerHTML = `<p class="empty-state">No actions currently require human approval.</p>`;
      lastApprovalsFingerprint = fp;
      return;
    }

    container.innerHTML = approvals.map((a) => {
      const safeId = escapeHtml(a.id);
      const shortId = escapeHtml(a.id.slice(0, 8));
      return `
        <form class="modal-approval-box" data-approval-id="${safeId}">
          <div class="approval-header">
            <span class="approval-title">⏸ ${escapeHtml(a.action_type)} (AWAITING_APPROVAL)</span>
            <span class="badge badge-warning">${escapeHtml(a.risk_level)}</span>
          </div>
          <div class="approval-desc">${escapeHtml(a.description)}</div>
          <div class="approval-path">${escapeHtml(a.command_or_path)}</div>
          <label for="modalAprNote_${safeId}" class="visually-hidden">Optional instructions for ${escapeHtml(a.action_type)}</label>
          <input type="text" class="approval-note-input" id="modalAprNote_${safeId}"
            placeholder="Optional instructions for agents (e.g. skip driver upgrade, fix test)…">
          <div class="approval-actions">
            <button type="button" class="btn btn-approve" data-decide-approve="${safeId}"
              aria-label="Approve and Continue ${escapeHtml(a.action_type)} ${shortId}">Approve &amp; Continue ✓</button>
            <button type="button" class="btn btn-deny" data-decide-deny="${safeId}"
              aria-label="Deny and Stop ${escapeHtml(a.action_type)} ${shortId}">Deny &amp; Stop ✕</button>
          </div>
        </form>
      `;
    }).join("");
    lastApprovalsFingerprint = fp;

    container.querySelectorAll("form.modal-approval-box").forEach((form) => {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const id = form.dataset.approvalId;
        const btn = form.querySelector("[data-decide-approve]");
        decideApproval(id, "APPROVED", btn);
      });
    });
    container.querySelectorAll("[data-decide-approve]").forEach((btn) => {
      btn.addEventListener("click", () => decideApproval(btn.dataset.decideApprove, "APPROVED", btn));
    });
    container.querySelectorAll("[data-decide-deny]").forEach((btn) => {
      btn.addEventListener("click", () => decideApproval(btn.dataset.decideDeny, "DENIED", btn));
    });

    Object.entries(existingNotes).forEach(([id, val]) => {
      const inp = document.getElementById(id);
      if (inp) inp.value = val;
    });
  } catch {
    container.innerHTML = `<p class="empty-state">Unable to load pending approvals.</p>`;
  }
}

async function decideApproval(approvalId, decision, btnEl = null) {
  if (pendingDecisionInFlight) return;
  pendingDecisionInFlight = true;
  const actionsWrap = btnEl ? btnEl.closest(".approval-actions") : null;
  const actionButtons = actionsWrap ? Array.from(actionsWrap.querySelectorAll("button")) : (btnEl ? [btnEl] : []);
  const origLabel = btnEl ? btnEl.textContent : "";
  actionButtons.forEach((b) => { b.disabled = true; });
  if (btnEl) {
    btnEl.textContent = decision === "APPROVED" ? "⏳ Approving…" : "⏳ Denying…";
  }

  try {
    const noteEl = document.getElementById(`modalAprNote_${approvalId}`);
    const note = (noteEl?.value || "").trim();

    const res = await fetch(`${API_BASE}/approvals/${approvalId}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, decided_by: "Ahmed", reason: note || null }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.detail || "Decision submission failed");
    }

    lastApprovalsFingerprint = null;
    pendingDecisionInFlight = false;
    announceStatus(decision === "APPROVED" ? "Approval granted; workflow resuming." : "Action denied; workflow stopped.");
    await Promise.all([fetchApprovals(), fetchTasks(), fetchAudit()]);
    if (activeTaskId) await refreshActiveTaskWorkspace();
  } catch (err) {
    actionButtons.forEach((b) => { b.disabled = false; });
    if (btnEl) btnEl.textContent = origLabel;
    pendingDecisionInFlight = false;
    showComposerFeedback(`Approval error: ${err.message}`);
  }
}

/* ---------- Errors Area & Audit Log ---------- */

async function fetchErrors() {
  const container = document.getElementById("errorCenterList");
  const badge = document.getElementById("errorCountBadge");
  const pill = document.getElementById("errorPill");
  if (!container) return;

  try {
    const res = await fetch(`${API_BASE}/errors?unresolved_only=true`);
    const errors = await res.json();

    if (pill) {
      pill.textContent = `Errors: ${errors.length}`;
      pill.className = errors.length > 0 ? "status-pill status-error" : "status-pill status-healthy";
    }
    if (badge) {
      badge.textContent = String(errors.length);
      badge.className = errors.length > 0 ? "badge badge-error" : "badge badge-success";
    }

    const fp = errors.map((e) => `${e.id}|${e.severity}`).join(",");
    if (fp === lastErrorsFingerprint) return;
    lastErrorsFingerprint = fp;

    if (errors.length === 0) {
      container.innerHTML = `<div class="empty-state">✓ All systems operational. No active errors.</div>`;
      return;
    }

    container.innerHTML = errors.map((err) => {
      const severityClass = `severity-${escapeHtml(err.severity || "ERROR")}`;
      const timeStr = new Date(err.created_at).toLocaleTimeString();
      const safeTitle = escapeHtml(err.title);
      return `
        <div class="error-entry ${severityClass}" role="alert">
          <div class="error-entry-header">
            <div class="error-title-row">
              <span class="error-source-tag">[${escapeHtml(err.source)}]</span>
              <span class="badge ${err.severity === "CRITICAL" ? "badge-error" : "badge-warning"}">${escapeHtml(err.severity)}</span>
              <span class="error-title">${safeTitle}</span>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" data-resolve-error="${err.id}"
              aria-label="Dismiss error ${safeTitle} (${err.id})">Dismiss ✕</button>
          </div>
          <div class="error-message">${escapeHtml(err.message)}</div>
          ${err.stderr ? `
            <details class="error-stderr-details">
              <summary>Stack trace / stderr</summary>
              <pre class="error-stderr-box">${escapeHtml(err.stderr)}</pre>
            </details>
          ` : ""}
          <div class="error-entry-footer">
            <span>Task: <code>${escapeHtml(err.task_id || "System")}</code> &bull; ${timeStr}</span>
            ${err.task_id ? `<button type="button" class="btn btn-subtle btn-sm" data-inspect-task="${escapeHtml(err.task_id)}"
              aria-label="Inspect task ${escapeHtml(err.task_id)} in action areas">Inspect Task ➔</button>` : ""}
          </div>
        </div>
      `;
    }).join("");

    container.querySelectorAll("[data-resolve-error]").forEach((btn) => {
      btn.addEventListener("click", () => resolveError(Number(btn.dataset.resolveError)));
    });
    container.querySelectorAll("[data-inspect-task]").forEach((btn) => {
      btn.addEventListener("click", () => focusTaskInWorkspace(btn.dataset.inspectTask));
    });
  } catch {
    // Non-fatal
  }
}

async function resolveError(errorId) {
  try {
    await fetch(`${API_BASE}/errors/${errorId}/resolve`, { method: "POST" });
    lastErrorsFingerprint = null;
    announceStatus(`Dismissed error ${errorId}`);
    await fetchErrors();
  } catch {
    // Non-fatal
  }
}

async function clearAllErrors() {
  try {
    await fetch(`${API_BASE}/errors/clear`, { method: "POST" });
    lastErrorsFingerprint = null;
    announceStatus("Cleared all active error notifications");
    await fetchErrors();
  } catch {
    // Non-fatal
  }
}

async function fetchAudit() {
  const container = document.getElementById("auditLogContainer");
  if (!container) return;
  try {
    const res = await fetch(`${API_BASE}/audit?limit=30`);
    const logs = await res.json();
    if (!Array.isArray(logs) || logs.length === 0) return;

    container.innerHTML = logs.map((l) => `
      <div class="audit-entry">
        <span class="audit-time">${new Date(l.created_at).toLocaleTimeString()}</span>
        <span class="audit-type">[${escapeHtml(l.event_type)}]</span>
        <span>${escapeHtml(l.message)}</span>
      </div>
    `).join("");
  } catch {
    // Non-fatal
  }
}
