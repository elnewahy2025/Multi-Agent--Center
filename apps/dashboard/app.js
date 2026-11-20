/**
 * Pairwise | AI Coding Command Center Live Operator Controller
 * Connects every view, approval gate, dual agent stream, image upload,
 * file explorer, Git repository snapshot, and settings panel to the
 * local FastAPI + PostgreSQL orchestrator backend.
 */

const API_BASE = "";
const PREFS_KEY = "pairwiseCommandCenterPrefs_v1";

const AGENT_META = {
  ANTIGRAVITY: {
    short: "Antigravity",
    full: "Google Antigravity CLI",
    icon: "🟣",
    logoText: "G",
    logoClass: "google",
    role: "Architect · Inspector & Reviewer",
    cmd: "agy CLI",
  },
  OPENCODE: {
    short: "OpenCode",
    full: "OpenCode Desktop CLI",
    icon: "🟢",
    logoText: "O",
    logoClass: "deep",
    role: "Negotiator · Implementer & Tester",
    cmd: "opencode CLI",
  },
  CLAUDE_CODE: {
    short: "Claude Code",
    full: "Claude Code CLI",
    icon: "🟠",
    logoText: "C",
    logoClass: "claude",
    role: "Negotiator · Implementer & Tester",
    cmd: "claude CLI",
  },
  QWEN_CODE: {
    short: "Qwen Code",
    full: "Qwen Code CLI",
    icon: "🔵",
    logoText: "Q",
    logoClass: "qwen",
    role: "Negotiator · Implementer & Tester",
    cmd: "qwen CLI",
  },
  CODEX: {
    short: "Codex",
    full: "OpenAI Codex",
    icon: "⚪",
    logoText: "X",
    logoClass: "deep",
    role: "CLI Coding Agent",
    cmd: "codex CLI",
  },
  SYSTEM: {
    short: "System",
    full: "Command Center",
    icon: "⚖️",
    logoText: "S",
    logoClass: "google",
    role: "Orchestrator",
    cmd: "system",
  },
};

const VIEW_META = {
  overview: [null, "Your host agents are connected and ready to collaborate."],
  tasks: ["Task queue", "Create, run, focus, inspect files, or manage tasks across agents."],
  agents: ["Detected agents", "Live capabilities, executable paths, and bilateral role routing."],
  reviews: ["Code reviews & decisions", "Approve gated actions and inspect modified patches."],
  activity: ["Errors & activity log", "Diagnostics center and chronological orchestration events."],
  messages: ["Live agent streams", "Expanded dual-agent activity streams and quick dispatch."],
  repository: ["Repository & diffs", "Live Git branch, worktrees, commits, and changed task files."],
  tests: ["Diagnostics & health", "Database status, host CLI probes, and task metrics."],
  settings: ["Settings", "Configure default worker, safety policy, workspace root, and theme."],
};

function getAgentMeta(key) {
  return AGENT_META[key] || {
    short: key || "Agent",
    full: key || "Agent",
    icon: "🤖",
    logoText: (key || "A").slice(0, 1).toUpperCase(),
    logoClass: "deep",
    role: "Coding Agent",
    cmd: "cli",
  };
}

function dynamicGreeting() {
  const hr = new Date().getHours();
  if (hr < 12) return "Good morning. Let's build.";
  if (hr < 18) return "Good afternoon. Let's build.";
  return "Good evening. Let's build.";
}

/* ---------- Persistent UI Preferences ---------- */

let prefs = loadPrefs();
function loadPrefs() {
  const defaults = {
    defaultWorker: "",
    defaultPolicy: "AUTO_LOW_IMPACT",
    defaultWorktree: true,
    theme: "dark",
    compact: false,
  };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return defaults;
  }
}

function savePrefsToStorage() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage errors in private browsing
  }
}

function applyPrefsToUI() {
  const root = document.documentElement;
  root.dataset.theme = prefs.theme === "light" ? "light" : "dark";
  if (prefs.compact) root.dataset.density = "compact";
  else delete root.dataset.density;

  const metaTheme = document.getElementById("metaThemeColor");
  if (metaTheme) metaTheme.content = prefs.theme === "light" ? "#f3f6fc" : "#0a1020";

  const ovSelect = document.getElementById("overviewWorkerSelect");
  const modalAgent = document.getElementById("taskAgent");
  const modalPolicy = document.getElementById("taskPolicy");
  const modalWt = document.getElementById("useWorktree");
  const prefWorker = document.getElementById("prefDefaultWorker");
  const prefPolicy = document.getElementById("prefDefaultPolicy");
  const prefTheme = document.getElementById("themeSelect");
  const swWt = document.getElementById("prefWorktreeSwitch");
  const swCompact = document.getElementById("prefCompactSwitch");

  if (ovSelect) ovSelect.value = prefs.defaultWorker || "";
  if (modalAgent) modalAgent.value = prefs.defaultWorker || "";
  if (modalPolicy) modalPolicy.value = prefs.defaultPolicy || "AUTO_LOW_IMPACT";
  if (modalWt) modalWt.checked = Boolean(prefs.defaultWorktree);
  if (prefWorker) prefWorker.value = prefs.defaultWorker || "";
  if (prefPolicy) prefPolicy.value = prefs.defaultPolicy || "AUTO_LOW_IMPACT";
  if (prefTheme) prefTheme.value = prefs.theme || "dark";
  if (swWt) {
    swWt.classList.toggle("on", Boolean(prefs.defaultWorktree));
    swWt.setAttribute("aria-pressed", String(Boolean(prefs.defaultWorktree)));
  }
  if (swCompact) {
    swCompact.classList.toggle("on", Boolean(prefs.compact));
    swCompact.setAttribute("aria-pressed", String(Boolean(prefs.compact)));
  }

  const ruleWorker = document.getElementById("ruleWorker");
  const rulePolicy = document.getElementById("rulePolicy");
  const ruleWorktree = document.getElementById("ruleWorktree");
  if (ruleWorker) ruleWorker.textContent = prefs.defaultWorker ? getAgentMeta(prefs.defaultWorker).full : "Auto (OpenCode)";
  if (rulePolicy) rulePolicy.textContent = prefs.defaultPolicy || "AUTO_LOW_IMPACT";
  if (ruleWorktree) ruleWorktree.textContent = prefs.defaultWorktree ? "On" : "Off";

  syncOverviewAgentCards();
}

/* ---------- Live Workspace State ---------- */

let currentView = "overview";
let cachedTasks = [];
let cachedAgents = [];
let cachedApprovals = [];
let cachedErrors = [];
let cachedAudit = [];
let cachedDiagnostics = null;
let cachedRepoStatus = null;

let activeTaskId = null;
let lastLoadedActiveTaskId = null;
const eventFingerprints = new Map();
const supplementFingerprints = new Map();
let lastActiveActionsFp = "";
let lastApprovalsFingerprint = null;
let lastReviewsInboxFp = null;
let lastErrorsFingerprint = null;
let lastFilesModalFp = null;
let lastRepoFilesFp = null;
let pendingDecisionInFlight = false;

// Composer scope & image attachments
let scopeMode = "folder";
let selectedContextFiles = [];
let attachedImages = [];
let workspaceRootPath = "";
let repoRootPath = "";
let selectedFolderRoot = "";

// Explorer state
let explorerOpen = false;
let explorerMode = "folder";
let explorerCurrentDir = "";
let explorerParentDir = null;
let explorerSearchTimer = null;
let currentExplorerFolders = [];
let currentExplorerFiles = [];

/* ---------- Boot ---------- */

document.addEventListener("DOMContentLoaded", () => {
  installDialogLightDismissFallback();
  applyPrefsToUI();
  setupEventListeners();
  navigate("overview", false);
  initDashboard();
  setInterval(refreshAll, 2500);
  setInterval(() => {
    if (activeTaskId) refreshActiveTaskWorkspace();
  }, 1500);
});

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

function announceStatus(message) {
  const el = document.getElementById("statusAnnouncer");
  if (!el || !message) return;
  el.textContent = "";
  window.requestAnimationFrame(() => {
    el.textContent = message;
  });
}

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById("toast");
  if (!el || !msg) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  announceStatus(msg);
}

function showComposerFeedback(msg) {
  const el = document.getElementById("composerFeedback");
  if (!el) return;
  if (!msg) {
    el.textContent = "";
    el.hidden = true;
    return;
  }
  el.textContent = msg;
  el.hidden = false;
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

function openDialogModal(id) {
  const dlg = document.getElementById(id);
  if (dlg && !dlg.open) dlg.showModal();
}

function closeDialogModal(id) {
  const dlg = document.getElementById(id);
  if (dlg && dlg.open) dlg.close();
}

/* ---------- View Navigation ---------- */

function navigate(view, scrollTop = true) {
  if (!VIEW_META[view]) return;
  currentView = view;

  document.querySelectorAll(".view").forEach((v) => {
    v.classList.toggle("active", v.id === `view-${view}`);
  });
  document.querySelectorAll("[data-view]").forEach((btn) => {
    const isMatch = btn.dataset.view === view;
    btn.classList.toggle("active", isMatch);
    if (isMatch) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });

  const [title, sub] = VIEW_META[view];
  const headingTitle = title || dynamicGreeting();
  const crumbEl = document.getElementById("crumb");
  const titleEl = document.getElementById("pageTitle");
  const subEl = document.getElementById("pageSub");
  if (crumbEl) crumbEl.textContent = title || "Overview";
  if (titleEl) titleEl.textContent = headingTitle;
  if (subEl) subEl.textContent = sub;

  if (scrollTop) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (view === "tasks") renderTasksTable();
  if (view === "agents") renderAgentsCards();
  if (view === "reviews") renderReviewsView();
  if (view === "activity") {
    lastErrorsFingerprint = null;
    renderErrors();
    renderActivityTimeline();
  }
  if (view === "messages" && activeTaskId) refreshActiveTaskWorkspace();
  if (view === "repository") fetchRepoStatus();
  if (view === "tests") fetchDiagnostics();
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
    descEl.value = descEl.value + "```\n# Paste your code to fix here\n```\n";
  }
  descEl.dispatchEvent(new Event("input"));
  descEl.focus();
}

/* ---------- Scope, Workspace & Interactive Explorer ---------- */

function updateWorkspaceLabels() {
  const folder = selectedFolderRoot || workspaceRootPath || repoRootPath || "AI-Coding-Command-Center";
  const shortName = folder.split("\\").filter(Boolean).pop()?.split("/").filter(Boolean).pop() || folder;
  const sideName = document.getElementById("sidebarProjectName");
  const quickSum = document.getElementById("quickTargetSummary");
  const prefPath = document.getElementById("prefWorkspacePath");
  if (sideName) sideName.textContent = shortName;
  if (quickSum) quickSum.textContent = `Target: ${folder}`;
  if (prefPath) prefPath.value = folder;
}

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
  selectedContextFiles.splice(idx, 1);
  renderScopeChips();
  if (explorerOpen) renderExplorerRows();
}

function renderScopeChips() {
  const container = document.getElementById("selectedFilesChips");
  if (!container) return;
  if (scopeMode === "folder" || selectedContextFiles.length === 0) {
    const raw = (document.getElementById("projectPath")?.value || "").trim();
    const label = raw || selectedFolderRoot || workspaceRootPath || "Default Project Root";
    container.innerHTML = scopeMode === "folder"
      ? `<span class="file-chip file-chip-folder">📁 ${escapeHtml(label)}</span>`
      : `<span class="file-chip">Click Files… to add specific files or subfolders</span>`;
    return;
  }
  container.innerHTML = selectedContextFiles.map((f, idx) => `
    <span class="file-chip">
      📄 ${escapeHtml(f)}
      <button type="button" class="file-chip-remove" data-remove-file="${idx}" aria-label="Remove target ${escapeHtml(f)}">✕</button>
    </span>
  `).join("");
  container.querySelectorAll("[data-remove-file]").forEach((btn) => {
    btn.addEventListener("click", () => removeTargetFile(Number(btn.dataset.removeFile)));
  });
}

async function loadWorkspacePaths(rootPath = null) {
  const list = document.getElementById("workspacePathsList");
  try {
    const url = rootPath ? `${API_BASE}/fs/list?root=${encodeURIComponent(rootPath)}` : `${API_BASE}/fs/list`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    if (!repoRootPath && data.root) repoRootPath = data.root;
    workspaceRootPath = data.root || workspaceRootPath;
    if (!selectedFolderRoot) selectedFolderRoot = workspaceRootPath;
    if (list) {
      list.innerHTML = (data.entries || []).map((e) => (
        `<option value="${escapeHtml(e.path)}">${e.type === "folder" ? "Folder" : "File"}</option>`
      )).join("");
    }
    updateWorkspaceLabels();
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

async function selectEntireFolder(folderPath) {
  if (!folderPath) return;
  const pathInput = document.getElementById("projectPath");
  setScopeMode("folder");
  selectedFolderRoot = folderPath;
  workspaceRootPath = folderPath;
  if (pathInput) pathInput.value = folderPath;
  renderScopeChips();
  updateWorkspaceLabels();
  await Promise.all([loadWorkspacePaths(folderPath), fetchRepoStatus()]);
  showToast(`Target folder set: ${folderPath}`);
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

function isTargetSelected(entry) {
  const rel = toRelativeTarget(entry.rel_path || entry.path);
  return selectedContextFiles.includes(rel) || selectedContextFiles.includes(entry.path);
}

function formatEntrySize(bytes) {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function browseFsDirectory(dirPath = "", query = "") {
  const listEl = document.getElementById("fsEntriesList");
  const pathLabel = document.getElementById("fsCurrentDirLabel");
  const drivesBar = document.getElementById("fsDrivesBar");
  const parentBtn = document.getElementById("btnFsParent");
  if (!listEl) return;

  listEl.innerHTML = `<div class="empty">Loading directory…</div>`;
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
      pathLabel.textContent = explorerCurrentDir + (data.query ? ` (filter: "${data.query}")` : "");
    }
    if (parentBtn) parentBtn.disabled = !explorerParentDir;
    if (drivesBar) {
      const drives = data.drives || [];
      drivesBar.innerHTML = drives.map((drv, idx) => (
        `<button type="button" class="fs-drive-btn" data-drive-idx="${idx}" aria-label="Browse drive ${escapeHtml(drv)}">${escapeHtml(drv)}</button>`
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
    listEl.innerHTML = `<div class="empty" role="alert">Unable to list directory: ${escapeHtml(err.message)}</div>`;
  }
}

function renderExplorerRows() {
  const listEl = document.getElementById("fsEntriesList");
  if (!listEl) return;
  if (currentExplorerFolders.length === 0 && currentExplorerFiles.length === 0) {
    listEl.innerHTML = `<div class="empty">No matching folders or files here.</div>`;
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
        <button type="button" class="btn btn-sm ${isSel ? "btn-approve" : ""}" data-folder-select="${idx}" aria-label="${escapeHtml(btnLabel)} ${escapeHtml(folder.name)}">${btnLabel}</button>
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
        ${sizeText ? `<span class="muted" style="font-size:11px;">${sizeText}</span>` : ""}
        <button type="button" class="btn btn-sm ${isSel ? "btn-approve" : ""}" data-file-select-btn="${idx}" aria-label="${escapeHtml(btnLabel)} ${escapeHtml(file.name)}">${btnLabel}</button>
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

  const handleFile = (idx) => {
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
    btn.addEventListener("click", () => handleFile(Number(btn.dataset.fileSelect)));
  });
  listEl.querySelectorAll("[data-file-select-btn]").forEach((btn) => {
    btn.addEventListener("click", () => handleFile(Number(btn.dataset.fileSelectBtn)));
  });
}

/* ---------- Image Uploads & Preview ---------- */

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
  const hintEl = document.getElementById("imageDropHint");
  if (hintEl) hintEl.textContent = "Uploading image…";

  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) {
      showComposerFeedback(`Image "${file.name}" exceeds the 10 MB limit.`);
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
  if (hintEl) hintEl.textContent = "or drag & drop / paste";
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
      <span class="muted" style="font-size:11.5px; max-inline-size:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(img.original_name)}</span>
      <button type="button" class="file-chip-remove" data-remove-img="${idx}" aria-label="Remove image ${escapeHtml(img.original_name)}">✕</button>
    </div>
  `).join("");
  container.querySelectorAll("[data-remove-img]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.removeImg);
      attachedImages.splice(idx, 1);
      renderAttachedImages();
    });
  });
}

/* ---------- Event Listeners ---------- */

function setupEventListeners() {
  // Sidebar & bottom mobile nav routing
  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.view));
  });
  document.querySelectorAll("[data-go]").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.go));
  });

  document.getElementById("projectSwitch")?.addEventListener("click", () => {
    openFsExplorer("folder", getInitialBrowseDir("folder"));
  });
  document.getElementById("syncBtn")?.addEventListener("click", async () => {
    await refreshAll();
    showToast("Synchronized with local PostgreSQL & host CLIs.");
  });
  document.getElementById("errorPillBtn")?.addEventListener("click", () => navigate("activity"));

  // Open task composer modal
  const openComposer = () => {
    showComposerFeedback("");
    openDialogModal("taskModal");
    document.getElementById("taskDesc")?.focus();
  };
  document.getElementById("newTaskBtn")?.addEventListener("click", openComposer);
  document.getElementById("tasksNew")?.addEventListener("click", openComposer);
  document.getElementById("btnOpenFullComposer")?.addEventListener("click", openComposer);
  document.getElementById("closeModalBtn")?.addEventListener("click", () => closeDialogModal("taskModal"));
  document.getElementById("cancelModalBtn")?.addEventListener("click", () => closeDialogModal("taskModal"));

  // Task form submit & actions
  document.getElementById("taskForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    submitAndRunTask("collaborate");
  });
  document.getElementById("btnSingleRun")?.addEventListener("click", () => {
    submitAndRunTask("execute");
  });

  // Quick dispatch form on Live Streams view
  document.getElementById("quickStreamForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    submitQuickStreamTask();
  });
  const quickPrompt = document.getElementById("quickStreamPrompt");
  quickPrompt?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (isImeComposing(e)) return;
      document.getElementById("quickStreamForm")?.requestSubmit();
    }
  });

  // Prompt auto-title, code wrap, screenshot paste & IME-safe shortcuts
  const descEl = document.getElementById("taskDesc");
  const titleEl = document.getElementById("taskTitle");
  if (descEl && titleEl) {
    descEl.addEventListener("input", () => {
      showComposerFeedback("");
      if (!titleEl.value.trim()) {
        const autoTitle = deriveTitleFromPrompt(descEl.value);
        titleEl.placeholder = autoTitle
          ? `Auto-title: ${autoTitle}`
          : "Auto-generated from your prompt below (or enter custom title)";
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

  // Composer folder/file controls
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

  // File explorer dialog controls
  document.getElementById("btnFsParent")?.addEventListener("click", () => {
    if (!explorerParentDir) return;
    const s = document.getElementById("fsSearchInput");
    if (s) s.value = "";
    browseFsDirectory(explorerParentDir, "");
  });
  document.getElementById("btnFsRoot")?.addEventListener("click", () => {
    const s = document.getElementById("fsSearchInput");
    if (s) s.value = "";
    browseFsDirectory(repoRootPath || workspaceRootPath || "", "");
  });
  document.getElementById("btnFsClose")?.addEventListener("click", closeFsExplorer);
  document.getElementById("btnUseCurrentFolder")?.addEventListener("click", async () => {
    if (!explorerCurrentDir) return;
    await selectEntireFolder(explorerCurrentDir);
    closeFsExplorer();
  });
  document.getElementById("btnFsDone")?.addEventListener("click", closeFsExplorer);
  document.getElementById("btnFsClearSelected")?.addEventListener("click", () => {
    selectedContextFiles = [];
    if (pathInput && scopeMode === "files") pathInput.value = "";
    renderScopeChips();
    renderExplorerRows();
  });
  document.getElementById("fsExplorerDialog")?.addEventListener("close", () => {
    explorerOpen = false;
  });

  const fsSearch = document.getElementById("fsSearchInput");
  fsSearch?.addEventListener("input", (e) => {
    if (explorerSearchTimer) clearTimeout(explorerSearchTimer);
    explorerSearchTimer = setTimeout(() => browseFsDirectory(explorerCurrentDir, e.target.value || ""), 180);
  });
  document.getElementById("fsSearchForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    browseFsDirectory(explorerCurrentDir, fsSearch?.value || "");
  });
  fsSearch?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (isImeComposing(e)) return;
      browseFsDirectory(explorerCurrentDir, e.target.value || "");
    }
  });

  // Image attachments
  const imgInput = document.getElementById("imageFileInput");
  document.getElementById("btnAddImages")?.addEventListener("click", () => imgInput?.click());
  imgInput?.addEventListener("change", async (e) => {
    await uploadImageFiles(e.target.files);
    e.target.value = "";
  });
  const dropZone = document.getElementById("imageDropZone");
  if (dropZone) {
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
    dropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
      if (e.dataTransfer?.files?.length) await uploadImageFiles(e.dataTransfer.files);
    });
  }

  // Worker selection sync between Overview card and Task Composer
  document.getElementById("overviewWorkerSelect")?.addEventListener("change", (e) => {
    const val = e.target.value;
    prefs.defaultWorker = val;
    savePrefsToStorage();
    const modalAgent = document.getElementById("taskAgent");
    if (modalAgent) modalAgent.value = val;
    applyPrefsToUI();
    showToast(`Default worker updated: ${val ? getAgentMeta(val).full : "Auto (OpenCode)"}`);
  });

  // Active task switchers (Overview + Live Streams)
  document.getElementById("activeTaskSelect")?.addEventListener("change", (e) => {
    if (e.target.value) focusTaskInWorkspace(e.target.value);
  });
  document.getElementById("streamsTaskSelect")?.addEventListener("change", (e) => {
    if (e.target.value) focusTaskInWorkspace(e.target.value);
  });
  document.getElementById("btnStreamsOpenFiles")?.addEventListener("click", () => {
    if (activeTaskId) viewTaskFiles(activeTaskId);
  });

  // Files modal
  document.getElementById("btnCloseFilesDialog")?.addEventListener("click", () => closeDialogModal("filesDialog"));
  document.getElementById("btnRepoOpenFilesModal")?.addEventListener("click", () => {
    if (activeTaskId) viewTaskFiles(activeTaskId);
  });

  // Tasks, Activity, Errors, Agents, Repo, Diagnostics filters/buttons
  document.getElementById("taskSearch")?.addEventListener("input", renderTasksTable);
  document.getElementById("taskFilter")?.addEventListener("change", renderTasksTable);
  document.getElementById("activitySearch")?.addEventListener("input", renderActivityTimeline);
  document.getElementById("activityType")?.addEventListener("change", renderActivityTimeline);
  document.getElementById("btnClearErrors")?.addEventListener("click", clearAllErrors);
  document.getElementById("btnRefreshAgentsView")?.addEventListener("click", async () => {
    await fetchAgents();
    showToast("Host coding CLI registry re-scanned.");
  });
  document.getElementById("btnRepoRefresh")?.addEventListener("click", async () => {
    await fetchRepoStatus();
    showToast("Repository status refreshed.");
  });
  document.getElementById("btnRepoChangeFolder")?.addEventListener("click", () => {
    openFsExplorer("folder", getInitialBrowseDir("folder"));
  });
  document.getElementById("btnRunDiagnostics")?.addEventListener("click", async () => {
    await fetchDiagnostics();
    showToast("Diagnostics probe completed.");
  });
  document.getElementById("exportLog")?.addEventListener("click", exportAuditCsv);

  // Settings navigation & live controls
  document.querySelectorAll("[data-settings]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-settings]").forEach((x) => {
        const active = x === btn;
        x.classList.toggle("active", active);
        x.setAttribute("aria-selected", String(active));
      });
      document.querySelectorAll(".settings-pane").forEach((pane) => {
        pane.hidden = pane.id !== `settings-${btn.dataset.settings}`;
      });
    });
  });

  document.getElementById("prefWorktreeSwitch")?.addEventListener("click", (e) => {
    const sw = e.currentTarget;
    const next = !sw.classList.contains("on");
    sw.classList.toggle("on", next);
    sw.setAttribute("aria-pressed", String(next));
  });
  document.getElementById("prefCompactSwitch")?.addEventListener("click", (e) => {
    const sw = e.currentTarget;
    const next = !sw.classList.contains("on");
    sw.classList.toggle("on", next);
    sw.setAttribute("aria-pressed", String(next));
  });
  document.getElementById("btnSettingsBrowseFolder")?.addEventListener("click", () => {
    openFsExplorer("folder", getInitialBrowseDir("folder"));
  });
  document.getElementById("saveSettings")?.addEventListener("click", () => {
    prefs.defaultWorker = document.getElementById("prefDefaultWorker")?.value || "";
    prefs.defaultPolicy = document.getElementById("prefDefaultPolicy")?.value || "AUTO_LOW_IMPACT";
    prefs.defaultWorktree = document.getElementById("prefWorktreeSwitch")?.classList.contains("on") ?? true;
    prefs.theme = document.getElementById("themeSelect")?.value === "light" ? "light" : "dark";
    prefs.compact = document.getElementById("prefCompactSwitch")?.classList.contains("on") ?? false;
    savePrefsToStorage();
    applyPrefsToUI();
    showToast("Workspace preferences saved.");
  });
}

/* ---------- Data Fetching ---------- */

async function initDashboard() {
  await Promise.all([
    fetchHealth(),
    fetchAgents(),
    fetchTasks(),
    fetchApprovals(),
    fetchErrors(),
    fetchAudit(),
    fetchDiagnostics(),
    loadWorkspacePaths(),
    fetchRepoStatus(),
  ]);
}

async function refreshAll() {
  await Promise.all([
    fetchHealth(),
    fetchTasks(),
    fetchApprovals(),
    fetchErrors(),
    fetchAudit(),
    fetchDiagnostics(),
  ]);
  if (activeTaskId) await refreshActiveTaskWorkspace();
  if (currentView === "repository") await fetchRepoStatus();
}

async function fetchHealth() {
  const dbEl = document.getElementById("dbStatus");
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (dbEl) dbEl.textContent = "DB: PostgreSQL 18 (Online)";
  } catch {
    if (dbEl) dbEl.textContent = "DB: Offline";
  }
}

async function fetchAgents() {
  try {
    const res = await fetch(`${API_BASE}/agents`);
    const agents = await res.json();
    cachedAgents = Array.isArray(agents) ? agents : [];

    const navCount = document.getElementById("navAgentsCount");
    const statAgents = document.getElementById("statAgents");
    const statFoot = document.getElementById("statAgentsFoot");
    if (navCount) navCount.textContent = String(cachedAgents.length);
    if (statAgents) statAgents.textContent = String(cachedAgents.length).padStart(2, "0");
    if (statFoot) {
      statFoot.textContent = cachedAgents.length
        ? cachedAgents.map((a) => getAgentMeta(a.agent_type).short).join(" · ")
        : "No host CLIs detected";
    }

    // Sidebar connections card
    const connList = document.getElementById("sidebarConnectionsList");
    if (connList) {
      connList.innerHTML = cachedAgents.length === 0
        ? `<div class="connect-line"><span>No CLI detected</span><span>—</span></div>`
        : cachedAgents.map((a) => `
            <div class="connect-line">
              <span>${escapeHtml(getAgentMeta(a.agent_type).short)}</span>
              <span class="live">Connected</span>
            </div>
          `).join("");
    }

    syncOverviewAgentCards();
    if (currentView === "agents") renderAgentsCards();
  } catch {
    // Non-fatal
  }
}

function syncOverviewAgentCards(workflow = null) {
  const inspectorKey = workflow?.inspector_agent || "ANTIGRAVITY";
  const selectedWorker = workflow?.worker_agent
    || document.getElementById("overviewWorkerSelect")?.value
    || prefs.defaultWorker
    || "OPENCODE";
  const workerKey = selectedWorker;

  const inspMeta = getAgentMeta(inspectorKey);
  const workMeta = getAgentMeta(workerKey);
  const inspInfo = cachedAgents.find((a) => a.agent_type === inspectorKey);
  const workInfo = cachedAgents.find((a) => a.agent_type === workerKey);

  const inspLogo = document.getElementById("ovInspectorLogo");
  const inspName = document.getElementById("ovInspectorName");
  const inspVer = document.getElementById("ovInspectorVer");
  const inspStat = document.getElementById("ovInspectorStatus");

  const workLogo = document.getElementById("ovWorkerLogo");
  const workName = document.getElementById("ovWorkerName");
  const workVer = document.getElementById("ovWorkerVer");
  const workStat = document.getElementById("ovWorkerStatus");

  if (inspLogo) {
    inspLogo.textContent = inspMeta.logoText;
    inspLogo.className = `agent-logo ${inspMeta.logoClass}`;
  }
  if (inspName) inspName.textContent = inspInfo?.name || inspMeta.full;
  if (inspVer) inspVer.textContent = inspInfo?.version ? `v${inspInfo.version}` : inspMeta.cmd;
  if (inspStat) inspStat.textContent = inspInfo || cachedAgents.length === 0 ? "● Online" : "○ Standby";

  if (workLogo) {
    workLogo.textContent = workMeta.logoText;
    workLogo.className = `agent-logo ${workMeta.logoClass}`;
  }
  if (workName) workName.textContent = workInfo?.name || workMeta.full;
  if (workVer) workVer.textContent = workInfo?.version ? `v${workInfo.version}` : workMeta.cmd;
  if (workStat) workStat.textContent = workInfo || cachedAgents.length === 0 ? "● Online" : "○ Standby";

  const matNegotiator = document.getElementById("matrixNegotiator");
  const matImpl = document.getElementById("matrixImplementer");
  if (matNegotiator) matNegotiator.textContent = `${workMeta.full} (reviews & challenges Inspector plan)`;
  if (matImpl) matImpl.textContent = `${workMeta.full} inside isolated Git worktree`;
}

function renderAgentsCards() {
  const grid = document.getElementById("agentsCardsGrid");
  if (!grid) return;
  if (cachedAgents.length === 0) {
    grid.innerHTML = `<div class="panel"><div class="empty">No coding CLI executables detected on host PATH.</div></div>`;
    return;
  }

  grid.innerHTML = cachedAgents.map((agent) => {
    const meta = getAgentMeta(agent.agent_type);
    const caps = [];
    if (agent.capabilities?.supports_headless) caps.push("Headless CLI");
    if (agent.capabilities?.supports_acp) caps.push("ACP");
    if (agent.capabilities?.supports_mcp) caps.push("MCP");
    if (agent.capabilities?.supports_worktrees) caps.push("Worktrees");
    if (agent.capabilities?.supports_json_output) caps.push("JSON Stream");

    return `
      <div class="panel">
        <div class="panel-head">
          <div class="agent-head">
            <div class="agent-logo ${meta.logoClass}" aria-hidden="true">${escapeHtml(meta.logoText)}</div>
            <div>
              <h3 class="panel-title">${escapeHtml(agent.name)}</h3>
              <p class="panel-desc">${escapeHtml(meta.role)}</p>
            </div>
          </div>
          <span class="pill">Connected</span>
        </div>
        <div class="kv"><span>Type</span><strong>${escapeHtml(agent.agent_type)}</strong></div>
        <div class="kv"><span>Version</span><strong>v${escapeHtml(agent.version)}</strong></div>
        <div class="kv"><span>Executable</span><code>${escapeHtml(agent.executable_path || "on PATH")}</code></div>
        <div class="caps-list">
          ${caps.map((c) => `<span class="tag">${escapeHtml(c)}</span>`).join("")}
        </div>
        <div class="toolbar toolbar-bottom">
          <button type="button" class="btn btn-sm" data-set-worker="${escapeHtml(agent.agent_type)}">Set as Active Worker</button>
        </div>
      </div>
    `;
  }).join("");

  grid.querySelectorAll("[data-set-worker]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const val = btn.dataset.setWorker;
      prefs.defaultWorker = val;
      savePrefsToStorage();
      applyPrefsToUI();
      showToast(`Default worker switched to ${getAgentMeta(val).full}`);
    });
  });
}

function pickDefaultActiveTask(tasks) {
  if (!tasks || tasks.length === 0) return null;
  const live = tasks.find((t) => t.status === "RUNNING" || t.status === "AWAITING_APPROVAL");
  return (live || tasks[0]).id;
}

async function fetchTasks() {
  try {
    const res = await fetch(`${API_BASE}/tasks`);
    const tasks = await res.json();
    cachedTasks = Array.isArray(tasks) ? tasks : [];

    const exists = cachedTasks.some((t) => t.id === activeTaskId);
    if (!exists) activeTaskId = pickDefaultActiveTask(cachedTasks);

    updateTaskStatsAndSelectors();
    renderOverviewTasks();
    if (currentView === "tasks") renderTasksTable();
    if (currentView === "reviews") renderReviewsView();
    if (activeTaskId) await refreshActiveTaskWorkspace();
    else renderIdleDualStreams();
  } catch {
    // Non-fatal
  }
}

function updateTaskStatsAndSelectors() {
  const activeCount = cachedTasks.filter((t) => ["RUNNING", "AWAITING_APPROVAL", "PENDING"].includes(t.status)).length;
  const runningCount = cachedTasks.filter((t) => t.status === "RUNNING").length;
  const waitCount = cachedTasks.filter((t) => t.status === "AWAITING_APPROVAL").length;
  const completedCount = cachedTasks.filter((t) => t.status === "COMPLETED").length;

  const statActive = document.getElementById("statActive");
  const statActiveFoot = document.getElementById("statActiveFoot");
  const statComp = document.getElementById("statCompleted");
  const statCompFoot = document.getElementById("statCompletedFoot");
  const navTasksCount = document.getElementById("navTasksCount");

  if (statActive) statActive.textContent = String(activeCount).padStart(2, "0");
  if (statActiveFoot) statActiveFoot.textContent = `${runningCount} running · ${waitCount} awaiting decision`;
  if (statComp) statComp.textContent = String(completedCount).padStart(2, "0");
  if (statCompFoot) statCompFoot.textContent = `${cachedTasks.length} total tasks tracked`;
  if (navTasksCount) navTasksCount.textContent = String(cachedTasks.length);

  // Sync top system status badge
  updateGlobalStatusPill(runningCount, waitCount);

  // Sync both task dropdowns cleanly
  const optionsHtml = cachedTasks.length === 0
    ? `<option value="">No tasks submitted yet</option>`
    : cachedTasks.map((t) => `<option value="${escapeHtml(t.id)}">[${escapeHtml(t.status)}] ${escapeHtml(t.title)}</option>`).join("");

  ["activeTaskSelect", "streamsTaskSelect"].forEach((id) => {
    const sel = document.getElementById(id);
    if (sel) {
      sel.innerHTML = optionsHtml;
      if (activeTaskId) sel.value = activeTaskId;
    }
  });
}

function updateGlobalStatusPill(runningCount, waitCount) {
  const pill = document.getElementById("systemStatus");
  if (!pill) return;
  if (cachedErrors.length > 0) {
    pill.textContent = `● ${cachedErrors.length} Active Error${cachedErrors.length === 1 ? "" : "s"}`;
    pill.className = "pill red";
  } else if (waitCount > 0) {
    pill.textContent = `⏸ ${waitCount} Decision${waitCount === 1 ? "" : "s"} Pending`;
    pill.className = "pill amber";
  } else if (runningCount > 0) {
    pill.textContent = `⏳ ${runningCount} Workflow${runningCount === 1 ? "" : "s"} Running`;
    pill.className = "pill purple";
  } else {
    pill.textContent = "● All systems operational";
    pill.className = "pill";
  }
}

function taskStatusTagClass(status) {
  if (status === "COMPLETED") return "green";
  if (status === "FAILED") return "red";
  if (status === "AWAITING_APPROVAL" || status === "PENDING") return "amber";
  if (status === "RUNNING") return "purple";
  return "";
}

function renderOverviewTasks() {
  const container = document.getElementById("overviewTasks");
  if (!container) return;
  if (cachedTasks.length === 0) {
    container.innerHTML = `<div class="empty">No tasks yet. Click <strong>＋ New task</strong> to start.</div>`;
    return;
  }
  container.innerHTML = cachedTasks.slice(0, 4).map((t) => {
    const teamText = t.assigned_agent ? getAgentMeta(t.assigned_agent).full : "Antigravity ↔ OpenCode";
    return `
      <div class="task">
        <div class="task-symbol" aria-hidden="true">✦</div>
        <div class="task-body">
          <div class="task-title">${escapeHtml(t.title)}</div>
          <div class="task-desc">${escapeHtml(t.description)}</div>
          <div class="task-foot">
            <span class="tag ${taskStatusTagClass(t.status)}">${escapeHtml(t.status)}</span>
            <span class="tag">${escapeHtml(teamText)}</span>
            <span class="muted" style="font-size:11px;">${new Date(t.created_at).toLocaleTimeString()}</span>
            <button type="button" class="btn btn-sm" style="margin-inline-start:auto;" data-focus-overview="${escapeHtml(t.id)}" aria-label="Stream task ${escapeHtml(t.title)}">Stream</button>
          </div>
        </div>
      </div>
    `;
  }).join("");
  container.querySelectorAll("[data-focus-overview]").forEach((btn) => {
    btn.addEventListener("click", () => focusTaskInWorkspace(btn.dataset.focusOverview));
  });
}

function renderTasksTable() {
  const tbody = document.getElementById("taskTable");
  if (!tbody) return;
  const q = (document.getElementById("taskSearch")?.value || "").toLowerCase();
  const f = document.getElementById("taskFilter")?.value || "all";

  const filtered = cachedTasks.filter((t) => (
    (f === "all" || t.status === f)
    && `${t.title} ${t.description} ${t.assigned_agent || ""}`.toLowerCase().includes(q)
  ));

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">No matching tasks found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((t) => {
    const teamText = t.assigned_agent
      ? `${getAgentMeta(t.assigned_agent).icon} ${escapeHtml(getAgentMeta(t.assigned_agent).short)}`
      : "🟣 Antigravity ↔ 🟢 OpenCode";
    const wt = t.worktree_path ? escapeHtml(t.worktree_path.split("\\").pop().split("/").pop()) : "Root";
    const safeTitle = escapeHtml(t.title);
    let actions = `
      <button type="button" class="btn btn-sm" data-tbl-focus="${escapeHtml(t.id)}" aria-label="Stream ${safeTitle}">Stream</button>
      <button type="button" class="btn btn-sm" data-tbl-files="${escapeHtml(t.id)}" aria-label="Files for ${safeTitle}">📁 Files</button>
    `;
    if (t.status === "PENDING") {
      actions += `
        <button type="button" class="btn btn-sm primary" data-tbl-team="${escapeHtml(t.id)}" aria-label="Run team for ${safeTitle}">Team ⚡</button>
        <button type="button" class="btn btn-sm" data-tbl-exec="${escapeHtml(t.id)}" aria-label="Single run for ${safeTitle}">Run</button>
        <button type="button" class="btn btn-sm danger" data-tbl-del="${escapeHtml(t.id)}" aria-label="Delete ${safeTitle}">✕</button>
      `;
    } else if (t.status === "RUNNING" || t.status === "AWAITING_APPROVAL") {
      actions += `<button type="button" class="btn btn-sm danger" data-tbl-stop="${escapeHtml(t.id)}" aria-label="Stop ${safeTitle}">Stop ⏹</button>`;
    } else if (t.status === "FAILED" || t.status === "CANCELLED") {
      actions += `
        <button type="button" class="btn btn-sm" data-tbl-team="${escapeHtml(t.id)}" aria-label="Retry ${safeTitle}">Retry ↺</button>
        <button type="button" class="btn btn-sm danger" data-tbl-del="${escapeHtml(t.id)}" aria-label="Delete ${safeTitle}">✕</button>
      `;
    } else {
      actions += `<button type="button" class="btn btn-sm danger" data-tbl-del="${escapeHtml(t.id)}" aria-label="Delete ${safeTitle}">✕</button>`;
    }

    return `
      <tr>
        <td>
          <strong>${safeTitle}</strong>
          <div class="muted" style="max-inline-size:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(t.description)}</div>
        </td>
        <td><span class="tag ${taskStatusTagClass(t.status)}">${escapeHtml(t.status)}</span></td>
        <td>${teamText}</td>
        <td><code>${wt}</code></td>
        <td>${new Date(t.created_at).toLocaleTimeString()}</td>
        <td><div class="row-actions">${actions}</div></td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("[data-tbl-focus]").forEach((b) => b.addEventListener("click", () => {
    focusTaskInWorkspace(b.dataset.tblFocus);
    navigate("messages");
  }));
  tbody.querySelectorAll("[data-tbl-files]").forEach((b) => b.addEventListener("click", () => viewTaskFiles(b.dataset.tblFiles)));
  tbody.querySelectorAll("[data-tbl-team]").forEach((b) => b.addEventListener("click", () => collaborateTask(b.dataset.tblTeam)));
  tbody.querySelectorAll("[data-tbl-exec]").forEach((b) => b.addEventListener("click", () => executeTask(b.dataset.tblExec)));
  tbody.querySelectorAll("[data-tbl-stop]").forEach((b) => b.addEventListener("click", () => stopTask(b.dataset.tblStop)));
  tbody.querySelectorAll("[data-tbl-del]").forEach((b) => b.addEventListener("click", () => deleteTask(b.dataset.tblDel)));
}

/* ---------- Task Submission & Lifecycle Actions ---------- */

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
    showComposerFeedback("Enter a prompt, code snippet, or task instructions first.");
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
    policy_mode: policyEl?.value || prefs.defaultPolicy || "AUTO_LOW_IMPACT",
    use_worktree: Boolean(worktreeEl?.checked ?? prefs.defaultWorktree),
    preferred_agent: (agentEl?.value || prefs.defaultWorker || "") || null,
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

    const endpoint = mode === "execute"
      ? `${API_BASE}/tasks/${created.id}/execute`
      : `${API_BASE}/tasks/${created.id}/collaborate`;
    const runRes = await fetch(endpoint, { method: "POST" });
    if (!runRes.ok) {
      const errData = await runRes.json().catch(() => ({}));
      throw new Error(errData.detail || "Failed to dispatch task");
    }

    document.getElementById("taskForm")?.reset();
    if (titleEl) titleEl.placeholder = "Auto-generated from your prompt below (or enter custom title)";
    attachedImages = [];
    renderAttachedImages();
    if (repoRootPath && !selectedFolderRoot) selectedFolderRoot = repoRootPath;
    setScopeMode("folder");
    applyPrefsToUI();
    closeDialogModal("taskModal");

    focusTaskInWorkspace(created.id);
    await fetchTasks();
    showToast(`Dispatched: ${created.title}`);
  } catch (err) {
    showComposerFeedback(`Unable to start task: ${err.message}`);
  } finally {
    if (btnTeam) btnTeam.disabled = false;
    if (btnSingle) btnSingle.disabled = false;
  }
}

async function submitQuickStreamTask() {
  const promptEl = document.getElementById("quickStreamPrompt");
  const btn = document.getElementById("quickRunBtn");
  const desc = (promptEl?.value || "").trim();
  if (!desc) return;

  if (btn) btn.disabled = true;
  try {
    const createRes = await fetch(`${API_BASE}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: desc,
        policy_mode: prefs.defaultPolicy || "AUTO_LOW_IMPACT",
        use_worktree: Boolean(prefs.defaultWorktree),
        preferred_agent: prefs.defaultWorker || null,
        project_path: selectedFolderRoot || workspaceRootPath || null,
        context_files: [],
      }),
    });
    if (!createRes.ok) throw new Error("Submission failed");
    const created = await createRes.json();
    const colRes = await fetch(`${API_BASE}/tasks/${created.id}/collaborate`, { method: "POST" });
    if (!colRes.ok) throw new Error("Dispatch failed");

    if (promptEl) promptEl.value = "";
    focusTaskInWorkspace(created.id);
    await fetchTasks();
    showToast(`Team dispatched: ${created.title}`);
  } catch (err) {
    showToast(`Dispatch error: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function executeTask(taskId) {
  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/execute`, { method: "POST" });
    if (!res.ok) throw new Error("Dispatch failed");
    focusTaskInWorkspace(taskId);
    await Promise.all([fetchTasks(), fetchAudit()]);
    showToast("Single-agent execution started.");
  } catch (err) {
    showToast(`Execution error: ${err.message}`);
  }
}

async function collaborateTask(taskId) {
  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/collaborate`, { method: "POST" });
    if (!res.ok) throw new Error("Workflow dispatch failed");
    focusTaskInWorkspace(taskId);
    await Promise.all([fetchTasks(), fetchAudit()]);
    showToast("Bilateral workflow dispatched.");
  } catch (err) {
    showToast(`Workflow error: ${err.message}`);
  }
}

async function stopTask(taskId) {
  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/cancel`, { method: "POST" });
    if (!res.ok) throw new Error("Stop failed");
    await Promise.all([fetchTasks(), fetchAudit()]);
    showToast("Stop signal sent to task.");
  } catch (err) {
    showToast(`Stop error: ${err.message}`);
  }
}

async function deleteTask(taskId) {
  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Delete failed");
    if (activeTaskId === taskId) {
      activeTaskId = null;
      lastLoadedActiveTaskId = null;
    }
    await Promise.all([fetchTasks(), fetchApprovals(), fetchErrors(), fetchAudit()]);
    showToast("Task deleted.");
  } catch (err) {
    showToast(`Delete error: ${err.message}`);
  }
}

function viewTaskFiles(taskId) {
  focusTaskInWorkspace(taskId);
  loadTaskFiles(taskId);
  openDialogModal("filesDialog");
}

function focusTaskInWorkspace(taskId) {
  const changed = lastLoadedActiveTaskId !== taskId;
  activeTaskId = taskId;
  ["activeTaskSelect", "streamsTaskSelect"].forEach((id) => {
    const sel = document.getElementById(id);
    if (sel && taskId) sel.value = taskId;
  });

  if (changed) {
    lastLoadedActiveTaskId = taskId;
    eventFingerprints.clear();
    supplementFingerprints.clear();
    lastActiveActionsFp = "";
    lastFilesModalFp = null;
    lastRepoFilesFp = null;
    ["inspectorActionStream", "workerActionStream", "streamsInspectorFeed", "streamsWorkerFeed"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = "";
    });
  }
  refreshActiveTaskWorkspace();
}

/* ---------- Dual Agent Streams + Pipeline Stepper ---------- */

function renderIdleDualStreams() {
  ["stageStepper", "streamsStageStepper"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = `
      <div class="step"><b>1. Inspection</b><small>Antigravity</small></div>
      <div class="step"><b>2. Negotiation</b><small>OpenCode</small></div>
      <div class="step"><b>3. Execution</b><small>OpenCode</small></div>
      <div class="step"><b>4. Verification</b><small>Antigravity</small></div>
    `;
  });
  ["inspectorActionStream", "streamsInspectorFeed"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<div class="empty">Create or select a task to stream inspector actions here.</div>`;
  });
  ["workerActionStream", "streamsWorkerFeed"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<div class="empty">Create or select a task to stream worker actions here.</div>`;
  });
}

function renderStagePipeline(containerId, workflow) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!workflow) {
    el.innerHTML = `
      <div class="step"><b>1. Inspection</b><small>Inspector</small></div>
      <div class="step"><b>2. Negotiation</b><small>Worker</small></div>
      <div class="step"><b>3. Execution</b><small>Worker</small></div>
      <div class="step"><b>4. Verification</b><small>Inspector</small></div>
    `;
    return;
  }

  const inspector = getAgentMeta(workflow.inspector_agent || "ANTIGRAVITY");
  const worker = getAgentMeta(workflow.worker_agent || "OPENCODE");
  const stages = [
    { key: "INSPECTION", label: "01 · Inspect", agent: inspector.short },
    { key: "NEGOTIATION", label: "02 · Negotiate", agent: worker.short },
    { key: "EXECUTION", label: "03 · Execute", agent: worker.short },
    { key: "VERIFICATION", label: "04 · Verify", agent: inspector.short },
  ];
  const order = ["INSPECTION", "NEGOTIATION", "EXECUTION", "VERIFICATION", "COMPLETED"];
  const curIdx = order.indexOf(workflow.current_phase);
  const completedSet = new Set((workflow.messages || []).map((m) => m.phase));

  el.innerHTML = stages.map((st, idx) => {
    let cls = "";
    let icon = "";
    if (workflow.status === "COMPLETED" || (completedSet.has(st.key) && idx < curIdx)) {
      cls = "done";
      icon = "✓ ";
    } else if (st.key === workflow.current_phase || idx === curIdx) {
      cls = workflow.status === "FAILED" ? "failed" : "now";
      icon = workflow.status === "FAILED" ? "✕ " : "";
    }
    return `<div class="step ${cls}"><b>${icon}${escapeHtml(st.label)}</b><small>${escapeHtml(st.agent)}</small></div>`;
  }).join("");
}

function renderActiveTaskControls(task) {
  const wrap = document.getElementById("activeTaskActions");
  if (!wrap || !task) return;
  const fp = `${task.id}|${task.status}`;
  if (fp === lastActiveActionsFp) return;
  lastActiveActionsFp = fp;

  let html = `<button type="button" class="btn btn-sm" id="btnActiveFiles">📁 Files</button>`;
  if (task.status === "PENDING") {
    html += `<button type="button" class="btn btn-sm primary" id="btnActiveTeam">Run Team ⚡</button>`;
  } else if (task.status === "RUNNING" || task.status === "AWAITING_APPROVAL") {
    html += `<button type="button" class="btn btn-sm danger" id="btnActiveStop">Stop ⏹</button>`;
  } else if (task.status === "FAILED" || task.status === "CANCELLED") {
    html += `<button type="button" class="btn btn-sm" id="btnActiveRetry">Retry ↺</button>`;
  }
  wrap.innerHTML = html;

  document.getElementById("btnActiveFiles")?.addEventListener("click", () => viewTaskFiles(task.id));
  document.getElementById("btnActiveTeam")?.addEventListener("click", () => collaborateTask(task.id));
  document.getElementById("btnActiveStop")?.addEventListener("click", () => stopTask(task.id));
  document.getElementById("btnActiveRetry")?.addEventListener("click", () => collaborateTask(task.id));
}

function toolStatusIcon(status) {
  if (status === "running") return `<span class="spinner-dot"></span>`;
  if (status === "failed") return `<span style="color:var(--red); font-weight:700;">✕</span>`;
  return `<span style="color:var(--green); font-weight:700;">✓</span>`;
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
  const meta = getAgentMeta(ev.agent);
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
    const cursor = ev.status === "running" ? " ▋" : "";
    node.innerHTML = `
      <div class="activity-text-meta">
        <span>${meta.icon} <strong>${escapeHtml(meta.short)}</strong></span>
        ${ev.phase ? `<span class="phase-badge">${escapeHtml(ev.phase)}</span>` : ""}
      </div>
      <div class="activity-text-body">${escapeHtml(ev.content || "")}${cursor}</div>
    `;
    return;
  }

  if (ev.kind === "error" || ev.status === "failed") {
    node.className = "activity-error-line";
    node.innerHTML = `${meta.icon} <strong>Error:</strong> ${escapeHtml(ev.title || "")} ${escapeHtml(ev.content || "")}`;
    return;
  }

  node.className = "activity-system-line";
  const icon = ev.status === "running" ? `<span class="spinner-dot"></span>` : "•";
  node.innerHTML = `${icon} <strong>${escapeHtml(meta.short)}:</strong> <span>${escapeHtml(ev.title || ev.content || "")}</span>`;
}

function updateStreamContainer(containerId, paneKey, events, supplementHtml, supplementFp, isLeft) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 70;
  const placeholder = container.querySelector(".empty");
  if ((events.length > 0 || supplementHtml) && placeholder) placeholder.remove();

  const activeIds = new Set(events.map((ev) => `${paneKey}-${ev.id}`));
  container.querySelectorAll("[data-event-id]").forEach((el) => {
    if (!activeIds.has(el.dataset.eventId)) el.remove();
  });

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

  if (supplementFingerprints.get(containerId) !== supplementFp) {
    supplementFingerprints.set(containerId, supplementFp);
    if (!supplementHtml) {
      if (supplementBox) supplementBox.remove();
    } else {
      if (!supplementBox) {
        supplementBox = document.createElement("div");
        supplementBox.dataset.supplementBox = "1";
        supplementBox.style.display = "flex";
        supplementBox.style.flexDirection = "column";
        supplementBox.style.gap = "7px";
        container.appendChild(supplementBox);
      }
      supplementBox.innerHTML = supplementHtml;
    }
  }

  if (events.length === 0 && !supplementHtml && !container.querySelector(".empty")) {
    container.innerHTML = `<div class="empty">${isLeft
      ? "Waiting for inspection / verification output…"
      : "Waiting for negotiation / implementation output…"}</div>`;
  }

  if (nearBottom) {
    container.scrollTop = container.scrollHeight;
  }
}

function updateStreamPill(pillId, isLeft, events, workflow, task) {
  const pill = document.getElementById(pillId);
  if (!pill) return;

  const taskStatus = task?.status || "IDLE";
  const phase = workflow?.current_phase || "";
  const isPhaseActive = (isLeft && ["INSPECTION", "VERIFICATION"].includes(phase))
    || (!isLeft && ["NEGOTIATION", "EXECUTION"].includes(phase));
  const hasRunningEv = taskStatus === "RUNNING" && events.some((ev) => ev.status === "running");

  if (taskStatus === "RUNNING" && (hasRunningEv || isPhaseActive)) {
    pill.textContent = "Streaming";
    pill.className = "pill-mini running";
  } else if (taskStatus === "RUNNING") {
    pill.textContent = "Standby";
    pill.className = "pill-mini";
  } else if (taskStatus === "AWAITING_APPROVAL") {
    pill.textContent = "Awaiting You";
    pill.className = "pill-mini waiting";
  } else if (taskStatus === "FAILED") {
    const failedHere = events.some((ev) => ev.status === "failed" || ev.kind === "error") || isPhaseActive;
    pill.textContent = failedHere ? "Failed" : "Halted";
    pill.className = failedHere ? "pill-mini failed" : "pill-mini";
  } else if (taskStatus === "CANCELLED") {
    pill.textContent = "Stopped";
    pill.className = "pill-mini";
  } else if (taskStatus === "COMPLETED") {
    pill.textContent = "Done";
    pill.className = "pill-mini done";
  } else {
    pill.textContent = taskStatus === "PENDING" ? "Queued" : "Idle";
    pill.className = "pill-mini";
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

    syncOverviewAgentCards(workflow);
    renderStagePipeline("stageStepper", workflow);
    renderStagePipeline("streamsStageStepper", workflow);
    if (task) renderActiveTaskControls(task);

    if (filesData) {
      const total = (filesData.total_changed || 0) + (filesData.total_activity || 0);
      const badge = document.getElementById("modalFilesBadge");
      if (badge) badge.textContent = String(total);
      if (document.getElementById("filesDialog")?.open) renderFilesInto("filesContainer", filesData, "modal");
      if (currentView === "repository") renderFilesInto("repoFilesContainer", filesData, "repo");
    }

    const inspectorKey = workflow?.inspector_agent || "ANTIGRAVITY";
    const dropdownWorker = document.getElementById("overviewWorkerSelect")?.value || prefs.defaultWorker || "";
    const workerKey = workflow?.worker_agent
      || (task?.assigned_agent && task.assigned_agent !== inspectorKey ? task.assigned_agent : null)
      || (dropdownWorker && dropdownWorker !== inspectorKey ? dropdownWorker : "OPENCODE");

    const inspMeta = getAgentMeta(inspectorKey);
    const workMeta = getAgentMeta(workerKey);

    ["inspectorAreaTitle", "streamsInspectorTitle"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = `${inspMeta.icon} ${inspMeta.short} Action Area`;
    });
    ["workerAreaTitle", "streamsWorkerTitle"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = `${workMeta.icon} ${workMeta.short} Action Area`;
    });

    const leftEvents = [];
    const rightEvents = [];
    const sameAgent = inspectorKey === workerKey;
    events.forEach((ev) => {
      if (sameAgent) {
        if (["NEGOTIATION", "EXECUTION"].includes(ev.phase)) rightEvents.push(ev);
        else leftEvents.push(ev);
        return;
      }
      if (ev.agent === inspectorKey) leftEvents.push(ev);
      else if (ev.agent === workerKey) rightEvents.push(ev);
      else if (ev.agent === "SYSTEM") {
        if (["NEGOTIATION", "EXECUTION"].includes(ev.phase)) rightEvents.push(ev);
        else leftEvents.push(ev);
      } else {
        rightEvents.push(ev);
      }
    });

    let leftSupHtml = "";
    let rightSupHtml = "";
    if (workflow) {
      if (workflow.status === "FAILED" && workflow.verification_report) {
        leftSupHtml += `<div class="activity-error-line" role="alert"><strong>🚨 Workflow Failed:</strong> ${escapeHtml(workflow.verification_report)}</div>`;
      }
      const counts = new Map();
      (workflow.messages || []).forEach((m) => counts.set(m.phase, (counts.get(m.phase) || 0) + 1));
      const seen = new Map();
      (workflow.messages || []).forEach((m) => {
        const idx = (seen.get(m.phase) || 0) + 1;
        seen.set(m.phase, idx);
        const suffix = (counts.get(m.phase) || 1) > 1 ? ` #${idx}` : "";
        const goesRight = sameAgent ? ["NEGOTIATION", "EXECUTION"].includes(m.phase) : m.sender === workerKey;
        const sm = getAgentMeta(m.sender);
        const card = `
          <details class="stage-summary-card">
            <summary>
              <span>${sm.icon} Stage Summary &mdash; ${escapeHtml(m.phase)}${suffix}</span>
              <span class="phase-badge">${escapeHtml(sm.short)}</span>
            </summary>
            <div class="stage-summary-body">${escapeHtml(m.content)}</div>
          </details>
        `;
        if (goesRight) rightSupHtml += card;
        else leftSupHtml += card;
      });
    } else if (runs.length > 0 && events.length === 0) {
      const latest = runs[0];
      let text = "";
      if (latest.stdout) text += "=== STDOUT ===\n" + latest.stdout + "\n\n";
      if (latest.stderr) text += "=== STDERR ===\n" + latest.stderr + "\n\n";
      if (latest.error_reason) text += "=== ERROR ===\n" + latest.error_reason + "\n";
      const card = `<pre class="diff">${escapeHtml(text || "Initializing agent run…")}</pre>`;
      if (latest.agent_type === inspectorKey) leftSupHtml += card;
      else rightSupHtml += card;
    }

    const leftFp = `${taskId}|L|${leftSupHtml.length}|${workflow?.status || ""}|${(workflow?.messages || []).length}`;
    const rightFp = `${taskId}|R|${rightSupHtml.length}|${workflow?.status || ""}|${(workflow?.messages || []).length}`;

    updateStreamContainer("inspectorActionStream", "OVL", leftEvents, leftSupHtml, leftFp, true);
    updateStreamContainer("workerActionStream", "OVR", rightEvents, rightSupHtml, rightFp, false);
    updateStreamPill("inspectorStatusPill", true, leftEvents, workflow, task);
    updateStreamPill("workerStatusPill", false, rightEvents, workflow, task);

    if (currentView === "messages") {
      updateStreamContainer("streamsInspectorFeed", "MSL", leftEvents, leftSupHtml, leftFp, true);
      updateStreamContainer("streamsWorkerFeed", "MSR", rightEvents, rightSupHtml, rightFp, false);
      updateStreamPill("streamsInspectorPill", true, leftEvents, workflow, task);
      updateStreamPill("streamsWorkerPill", false, rightEvents, workflow, task);
    }
  } catch {
    // Non-fatal
  }
}

/* ---------- Human Decisions Area & Code Reviews ---------- */

async function fetchApprovals() {
  try {
    if (pendingDecisionInFlight) return;
    const res = await fetch(`${API_BASE}/approvals`);
    const approvals = await res.json();
    cachedApprovals = Array.isArray(approvals) ? approvals : [];

    const navBadge = document.getElementById("navReviewsCount");
    const ovBadge = document.getElementById("approvalsBadge");
    const revPill = document.getElementById("reviewsPendingPill");
    if (navBadge) navBadge.textContent = String(cachedApprovals.length);
    if (ovBadge) ovBadge.textContent = `${cachedApprovals.length} pending`;
    if (revPill) revPill.textContent = `${cachedApprovals.length} awaiting approval`;

    renderApprovalCards("approvalsList", "modalAprNote_", true);
    if (currentView === "reviews") renderReviewsView();
  } catch {
    // Non-fatal
  }
}

function renderApprovalCards(containerId, inputPrefix, isOverview) {
  const container = document.getElementById(containerId);
  if (!container || pendingDecisionInFlight) return;

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

  const fp = cachedApprovals.map((a) => `${a.id}|${a.action_type}|${a.risk_level}`).join(",");
  if (isOverview && fp === lastApprovalsFingerprint) return;
  if (!isOverview && fp === lastReviewsInboxFp) return;

  const existingNotes = {};
  container.querySelectorAll(".approval-note-input").forEach((inp) => { existingNotes[inp.id] = inp.value; });

  if (cachedApprovals.length === 0) {
    container.innerHTML = `<div class="empty">No actions currently require human approval.</div>`;
    if (isOverview) lastApprovalsFingerprint = fp;
    else lastReviewsInboxFp = fp;
    return;
  }

  container.innerHTML = cachedApprovals.map((a) => {
    const safeId = escapeHtml(a.id);
    const shortId = escapeHtml(a.id.slice(0, 8));
    const inputId = `${inputPrefix}${safeId}`;
    return `
      <form class="modal-approval-box" data-approval-id="${safeId}">
        <div class="approval-top">
          <span class="approval-title">⏸ ${escapeHtml(a.action_type)} (AWAITING_APPROVAL)</span>
          <span class="pill amber">${escapeHtml(a.risk_level)}</span>
        </div>
        <div class="approval-desc">${escapeHtml(a.description)}</div>
        <div class="approval-path">${escapeHtml(a.command_or_path)}</div>
        <label for="${inputId}" class="visually-hidden">Optional instructions for ${escapeHtml(a.action_type)}</label>
        <input type="text" class="approval-note-input" id="${inputId}"
          placeholder="Optional instructions for agents (e.g. skip driver upgrade, fix test)…">
        <div class="approval-actions">
          <button type="button" class="btn btn-sm btn-approve" data-decide-approve="${safeId}"
            aria-label="Approve and Continue ${escapeHtml(a.action_type)} ${shortId}">Approve &amp; Continue ✓</button>
          <button type="button" class="btn btn-sm btn-deny" data-decide-deny="${safeId}"
            aria-label="Deny and Stop ${escapeHtml(a.action_type)} ${shortId}">Deny &amp; Stop ✕</button>
          <button type="button" class="btn btn-sm" data-apr-files="${escapeHtml(a.task_id)}"
            aria-label="Inspect files for ${shortId}">📁 Files</button>
        </div>
      </form>
    `;
  }).join("");

  if (isOverview) lastApprovalsFingerprint = fp;
  else lastReviewsInboxFp = fp;

  container.querySelectorAll("form.modal-approval-box").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      decideApproval(form.dataset.approvalId, "APPROVED", form.querySelector("[data-decide-approve]"));
    });
  });
  container.querySelectorAll("[data-decide-approve]").forEach((btn) => {
    btn.addEventListener("click", () => decideApproval(btn.dataset.decideApprove, "APPROVED", btn));
  });
  container.querySelectorAll("[data-decide-deny]").forEach((btn) => {
    btn.addEventListener("click", () => decideApproval(btn.dataset.decideDeny, "DENIED", btn));
  });
  container.querySelectorAll("[data-apr-files]").forEach((btn) => {
    btn.addEventListener("click", () => viewTaskFiles(btn.dataset.aprFiles));
  });

  Object.entries(existingNotes).forEach(([id, val]) => {
    const inp = document.getElementById(id);
    if (inp) inp.value = val;
  });
}

async function decideApproval(approvalId, decision, btnEl = null) {
  if (pendingDecisionInFlight) return;
  pendingDecisionInFlight = true;
  const wrap = btnEl ? btnEl.closest(".approval-actions") : null;
  const btns = wrap ? Array.from(wrap.querySelectorAll("button")) : (btnEl ? [btnEl] : []);
  const orig = btnEl ? btnEl.textContent : "";
  btns.forEach((b) => { b.disabled = true; });
  if (btnEl) btnEl.textContent = decision === "APPROVED" ? "⏳ Approving…" : "⏳ Denying…";

  try {
    const ovNote = document.getElementById(`modalAprNote_${approvalId}`)?.value || "";
    const revNote = document.getElementById(`reviewAprNote_${approvalId}`)?.value || "";
    const note = (ovNote || revNote).trim();

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
    lastReviewsInboxFp = null;
    pendingDecisionInFlight = false;
    await Promise.all([fetchApprovals(), fetchTasks(), fetchAudit()]);
    if (activeTaskId) await refreshActiveTaskWorkspace();
    showToast(decision === "APPROVED" ? "Approved — workflow resuming." : "Denied — workflow stopped.");
  } catch (err) {
    btns.forEach((b) => { b.disabled = false; });
    if (btnEl) btnEl.textContent = orig;
    pendingDecisionInFlight = false;
    showToast(`Approval error: ${err.message}`);
  }
}

function renderReviewsView() {
  renderApprovalCards("reviewsInboxList", "reviewAprNote_", false);
  const completedList = document.getElementById("completedReviewsList");
  if (!completedList) return;
  const done = cachedTasks.filter((t) => t.status === "COMPLETED").slice(0, 6);
  if (done.length === 0) {
    completedList.innerHTML = `<div class="empty">No completed workflow runs recorded yet.</div>`;
    return;
  }
  completedList.innerHTML = done.map((t) => `
    <div class="review-card">
      <div class="approval-top">
        <strong>${escapeHtml(t.title)}</strong>
        <span class="pill">COMPLETED</span>
      </div>
      <p class="muted" style="font-size:12px; margin:4px 0 8px;">${escapeHtml(t.description)}</p>
      <div class="inline-actions">
        <button type="button" class="btn btn-sm" data-rev-files="${escapeHtml(t.id)}">📁 Inspect Modified Files</button>
        <button type="button" class="btn btn-sm" data-rev-stream="${escapeHtml(t.id)}">↔ View Stream</button>
      </div>
    </div>
  `).join("");
  completedList.querySelectorAll("[data-rev-files]").forEach((b) => b.addEventListener("click", () => viewTaskFiles(b.dataset.revFiles)));
  completedList.querySelectorAll("[data-rev-stream]").forEach((b) => b.addEventListener("click", () => {
    focusTaskInWorkspace(b.dataset.revStream);
    navigate("messages");
  }));
}

/* ---------- Errors Center, Audit & CSV Export ---------- */

async function fetchErrors() {
  try {
    const res = await fetch(`${API_BASE}/errors?unresolved_only=true`);
    const errors = await res.json();
    cachedErrors = Array.isArray(errors) ? errors : [];

    const navErr = document.getElementById("navErrorsCount");
    const topErr = document.getElementById("errorPillCount");
    const badge = document.getElementById("errorCountBadge");
    if (navErr) navErr.textContent = String(cachedErrors.length);
    if (topErr) topErr.textContent = String(cachedErrors.length);
    if (badge) {
      badge.textContent = `${cachedErrors.length} active`;
      badge.className = cachedErrors.length > 0 ? "pill red" : "pill";
    }
    const statHealth = document.getElementById("statHealth");
    const statHealthFoot = document.getElementById("statHealthFoot");
    if (statHealth) statHealth.textContent = cachedErrors.length === 0 ? "100%" : "Alert";
    if (statHealthFoot) statHealthFoot.textContent = `${cachedErrors.length} unresolved error${cachedErrors.length === 1 ? "" : "s"}`;

    renderErrors();
  } catch {
    // Non-fatal
  }
}

function renderErrors() {
  const container = document.getElementById("errorCenterList");
  if (!container) return;

  const fp = cachedErrors.map((e) => `${e.id}|${e.severity}`).join(",");
  if (fp === lastErrorsFingerprint) return;
  lastErrorsFingerprint = fp;

  if (cachedErrors.length === 0) {
    container.innerHTML = `<div class="empty">✓ All systems operational. No unresolved errors.</div>`;
    return;
  }

  container.innerHTML = cachedErrors.map((err) => {
    const safeTitle = escapeHtml(err.title);
    return `
      <div class="error-entry" role="alert">
        <div class="error-entry-header">
          <div class="inline-actions">
            <span class="tag">${escapeHtml(err.source)}</span>
            <span class="pill red">${escapeHtml(err.severity)}</span>
            <strong>${safeTitle}</strong>
          </div>
          <button type="button" class="btn btn-sm" data-resolve-err="${err.id}" aria-label="Dismiss error ${safeTitle} (${err.id})">Dismiss ✕</button>
        </div>
        <div class="muted" style="font-size:12px;">${escapeHtml(err.message)}</div>
        ${err.stderr ? `
          <details>
            <summary style="cursor:pointer; font-size:11.5px; color:var(--muted);">Stack trace / stderr</summary>
            <pre class="error-stderr-box">${escapeHtml(err.stderr)}</pre>
          </details>
        ` : ""}
        <div class="error-entry-header" style="font-size:11.5px; color:var(--muted);">
          <span>Task: <code>${escapeHtml(err.task_id || "System")}</code> &bull; ${new Date(err.created_at).toLocaleTimeString()}</span>
          ${err.task_id ? `<button type="button" class="btn btn-sm" data-err-focus="${escapeHtml(err.task_id)}">Inspect Stream ➔</button>` : ""}
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll("[data-resolve-err]").forEach((b) => {
    b.addEventListener("click", () => resolveError(Number(b.dataset.resolveErr)));
  });
  container.querySelectorAll("[data-err-focus]").forEach((b) => {
    b.addEventListener("click", () => {
      focusTaskInWorkspace(b.dataset.errFocus);
      navigate("messages");
    });
  });
}

async function resolveError(id) {
  try {
    await fetch(`${API_BASE}/errors/${id}/resolve`, { method: "POST" });
    lastErrorsFingerprint = null;
    await fetchErrors();
    showToast(`Dismissed error #${id}`);
  } catch {
    // Non-fatal
  }
}

async function clearAllErrors() {
  try {
    await fetch(`${API_BASE}/errors/clear`, { method: "POST" });
    lastErrorsFingerprint = null;
    await fetchErrors();
    showToast("Cleared all unresolved error notifications.");
  } catch {
    // Non-fatal
  }
}

async function fetchAudit() {
  try {
    const res = await fetch(`${API_BASE}/audit?limit=40`);
    const logs = await res.json();
    cachedAudit = Array.isArray(logs) ? logs : [];
    renderOverviewActivity();
    if (currentView === "activity") renderActivityTimeline();
  } catch {
    // Non-fatal
  }
}

function renderOverviewActivity() {
  const container = document.getElementById("overviewActivity");
  if (!container) return;
  if (cachedAudit.length === 0) {
    container.innerHTML = `<div class="empty">No audit events recorded yet.</div>`;
    return;
  }
  container.innerHTML = cachedAudit.slice(0, 6).map((l) => `
    <div class="activity-item">
      <div class="activity-icon" aria-hidden="true">${escapeHtml((l.event_type || "S").slice(0, 1))}</div>
      <div>
        <div class="activity-text"><strong>${escapeHtml(l.event_type)}</strong> &middot; ${escapeHtml(l.message)}</div>
        <div class="activity-time">${new Date(l.created_at).toLocaleTimeString()}</div>
      </div>
    </div>
  `).join("");
}

function renderActivityTimeline() {
  const container = document.getElementById("activityList");
  if (!container) return;
  const q = (document.getElementById("activitySearch")?.value || "").toLowerCase();
  const type = document.getElementById("activityType")?.value || "all";

  const filtered = cachedAudit.filter((l) => (
    (type === "all" || (l.event_type || "").includes(type))
    && `${l.event_type} ${l.message}`.toLowerCase().includes(q)
  ));

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty">No activity events match the current filter.</div>`;
    return;
  }

  container.innerHTML = filtered.map((l) => `
    <div class="activity-item" style="padding: 8px 0; border-bottom: 1px solid var(--line);">
      <div class="activity-icon" aria-hidden="true">${escapeHtml((l.event_type || "S").slice(0, 1))}</div>
      <div>
        <div class="activity-text"><strong>[${escapeHtml(l.event_type)}]</strong> ${escapeHtml(l.message)}</div>
        <div class="activity-time">${new Date(l.created_at).toLocaleTimeString()} ${l.task_id ? `&middot; ${escapeHtml(l.task_id)}` : ""}</div>
      </div>
    </div>
  `).join("");
}

function exportAuditCsv() {
  const rows = ["Time,Event Type,Task ID,Message"];
  cachedAudit.forEach((l) => {
    const row = [l.created_at, l.event_type, l.task_id || "", l.message]
      .map((v) => `"${String(v || "").replace(/"/g, '""')}"`)
      .join(",");
    rows.push(row);
  });
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "command-center-audit.csv";
  a.click();
  URL.revokeObjectURL(a.href);
  showToast("Exported audit log CSV.");
}

/* ---------- Live Repository & Diagnostics Views ---------- */

async function fetchRepoStatus() {
  try {
    const target = selectedFolderRoot || workspaceRootPath || "";
    const url = target ? `${API_BASE}/repo/status?path=${encodeURIComponent(target)}` : `${API_BASE}/repo/status`;
    const res = await fetch(url);
    if (!res.ok) return;
    cachedRepoStatus = await res.json();
    renderRepoPanels();
  } catch {
    // Non-fatal
  }
}

function renderRepoPanels() {
  const r = cachedRepoStatus;
  if (!r) return;

  // Overview snapshot card
  const desc = document.getElementById("ovRepoRootDesc");
  const badge = document.getElementById("ovRepoBadge");
  const br = document.getElementById("ovRepoBranch");
  const cm = document.getElementById("ovRepoCommit");
  const tr = document.getElementById("ovRepoTree");
  if (desc) desc.textContent = r.name || r.root;
  if (badge) {
    badge.textContent = r.is_git_repo ? (r.clean ? "Clean" : `${r.uncommitted_count} modified`) : "Folder";
    badge.className = r.is_git_repo && r.clean ? "pill" : "pill amber";
  }
  if (br) br.textContent = r.is_git_repo ? r.branch : "Not a Git repo";
  if (cm) cm.textContent = r.latest_commit ? `${r.latest_commit.hash} · ${r.latest_commit.relative_time}` : "—";
  if (tr) tr.textContent = r.is_git_repo ? (r.clean ? "No conflicts" : `${r.uncommitted_count} uncommitted`) : r.root;

  // Dedicated Repository view
  const repoPath = document.getElementById("repoViewPath");
  const repoBadge = document.getElementById("repoViewCleanBadge");
  const kvEl = document.getElementById("repoDetailsKv");
  const cwEl = document.getElementById("repoCommitsAndWorktrees");
  if (repoPath) repoPath.textContent = r.root || "—";
  if (repoBadge) {
    repoBadge.textContent = r.is_git_repo ? (r.clean ? "Clean" : `${r.uncommitted_count} dirty`) : "Non-Git";
    repoBadge.className = r.clean ? "pill" : "pill amber";
  }
  if (kvEl) {
    kvEl.innerHTML = `
      <div class="kv"><span>Folder name</span><strong>${escapeHtml(r.name)}</strong></div>
      <div class="kv"><span>Current branch</span><strong>${escapeHtml(r.branch || "—")}</strong></div>
      <div class="kv"><span>Working tree</span><strong class="${r.clean ? "live" : ""}">${r.clean ? "Clean" : `${r.uncommitted_count} changed files`}</strong></div>
      <div class="kv"><span>Latest commit</span><strong>${r.latest_commit ? `${escapeHtml(r.latest_commit.hash)} — ${escapeHtml(r.latest_commit.subject)}` : "—"}</strong></div>
      <div class="kv"><span>Active Git worktrees</span><strong>${(r.worktrees || []).length}</strong></div>
    `;
  }
  if (cwEl) {
    let html = `<div style="font-size:12px; font-weight:700; margin-bottom:6px;">Active Worktrees</div>`;
    if (!r.worktrees || r.worktrees.length === 0) {
      html += `<div class="muted" style="font-size:12px; margin-bottom:10px;">None</div>`;
    } else {
      html += r.worktrees.map((w) => `
        <div class="repo-row">
          <span>⑂ ${escapeHtml(w.branch)}</span>
          <code>${escapeHtml(w.path.split("\\").pop().split("/").pop())}</code>
        </div>
      `).join("");
    }
    html += `<div style="font-size:12px; font-weight:700; margin:12px 0 6px;">Recent Commits</div>`;
    if (!r.recent_commits || r.recent_commits.length === 0) {
      html += `<div class="muted" style="font-size:12px;">No commit history.</div>`;
    } else {
      html += r.recent_commits.map((c) => `
        <div class="repo-row">
          <span><code>${escapeHtml(c.hash)}</code> ${escapeHtml(c.subject)}</span>
          <span>${escapeHtml(c.relative_time)}</span>
        </div>
      `).join("");
    }
    cwEl.innerHTML = html;
  }
}

async function loadTaskFiles(taskId) {
  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/files`);
    if (!res.ok) throw new Error("Failed to load files");
    const data = await res.json();
    renderFilesInto("filesContainer", data, "modal");
    if (currentView === "repository") renderFilesInto("repoFilesContainer", data, "repo");
  } catch (err) {
    const el = document.getElementById("filesContainer");
    if (el) el.innerHTML = `<div class="empty">Error loading files: ${escapeHtml(err.message)}</div>`;
  }
}

function renderFilesInto(containerId, data, mode) {
  const container = document.getElementById(containerId);
  if (!container || !data) return;

  const fp = JSON.stringify(data);
  if (mode === "modal" && fp === lastFilesModalFp) return;
  if (mode === "repo" && fp === lastRepoFilesFp) return;
  if (mode === "modal") lastFilesModalFp = fp;
  if (mode === "repo") lastRepoFilesFp = fp;

  const changed = data.changed_files || [];
  const activity = data.activity_files || [];
  const repoDesc = document.getElementById("repoTaskFilesDesc");
  if (mode === "repo" && repoDesc) {
    repoDesc.textContent = `${data.working_dir} (${changed.length} changed, ${activity.length} tool events)`;
  }

  let html = `
    <div class="files-summary-bar">
      <div><strong>Working Directory:</strong> <code>${escapeHtml(data.working_dir)}</code></div>
      <div><strong>Modified:</strong> ${changed.length} &bull; <strong>Tool Calls:</strong> ${activity.length}</div>
    </div>
  `;

  if (changed.length === 0) {
    html += `<div class="empty">No uncommitted file changes in this task workspace yet.</div>`;
  } else {
    changed.forEach((file) => {
      html += `
        <div class="file-card" style="margin-top:8px;">
          <div class="file-card-header">
            <span>📄 ${escapeHtml(file.path)}</span>
            <span class="tag">${escapeHtml(file.status)}</span>
          </div>
          <div class="diff">${formatDiff(file.diff || "")}</div>
        </div>
      `;
    });
  }

  if (activity.length > 0) {
    html += `<div style="font-size:12.5px; font-weight:700; margin-top:10px;">Live Tool Calls (${activity.length})</div>`;
    activity.slice(-30).forEach((act) => {
      const lowerStatus = (act.status || "done").toLowerCase();
      const dur = act.duration_seconds != null ? `${act.duration_seconds.toFixed(1)}s` : "";
      html += `
        <details class="activity-tool-card" data-status="${escapeHtml(lowerStatus)}">
          <summary class="activity-tool-header">
            ${toolStatusIcon(lowerStatus)}
            <span class="tool-name-pill">${escapeHtml(act.tool)}</span>
            <span class="activity-tool-target">${escapeHtml(act.target)}</span>
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

async function fetchDiagnostics() {
  try {
    const res = await fetch(`${API_BASE}/diagnostics`);
    if (!res.ok) return;
    cachedDiagnostics = await res.json();
    const d = cachedDiagnostics;

    const total = d.total_tasks || 0;
    const failed = d.failed_tasks || 0;
    const passPct = total > 0 ? Math.round(((total - failed) / total) * 100) : 100;

    // Overview diagnostics mini-card
    const ovBadge = document.getElementById("ovHealthBadge");
    const ovAgents = document.getElementById("ovHealthAgents");
    const ovAgentsBar = document.getElementById("ovAgentsBar");
    const ovPass = document.getElementById("ovPassRate");
    const ovPassBar = document.getElementById("ovPassBar");
    if (ovBadge) {
      ovBadge.textContent = d.status === "healthy" ? "Healthy" : "Degraded";
      ovBadge.className = d.status === "healthy" ? "pill" : "pill red";
    }
    const cliCnt = (d.agents || []).length;
    if (ovAgents) ovAgents.textContent = `${cliCnt} detected`;
    if (ovAgentsBar) ovAgentsBar.style.width = `${Math.min(100, Math.round((cliCnt / 4) * 100))}%`;
    if (ovPass) ovPass.textContent = `${passPct}% (${total - failed}/${total})`;
    if (ovPassBar) ovPassBar.style.width = `${passPct}%`;

    // Dedicated Diagnostics view
    const dbVal = document.getElementById("diagDbValue");
    const dbFoot = document.getElementById("diagDbFoot");
    const cliVal = document.getElementById("diagCliValue");
    const totVal = document.getElementById("diagTotalValue");
    const failFoot = document.getElementById("diagFailedFoot");
    const errVal = document.getElementById("diagErrorsValue");
    const statFoot = document.getElementById("diagStatusFoot");
    const tbody = document.getElementById("diagCliTbody");

    if (dbVal) dbVal.textContent = "OK";
    if (dbFoot) dbFoot.textContent = d.database || "postgresql";
    if (cliVal) cliVal.textContent = String(cliCnt);
    if (totVal) totVal.textContent = String(total);
    if (failFoot) failFoot.textContent = `${failed} failed runs`;
    if (errVal) errVal.textContent = String(d.active_errors || 0);
    if (statFoot) statFoot.textContent = `Status: ${d.status}`;

    if (tbody) {
      tbody.innerHTML = (d.agents || []).map((a) => `
        <tr>
          <td><strong>${escapeHtml(a.name)}</strong></td>
          <td><code>${escapeHtml(a.type)}</code></td>
          <td>v${escapeHtml(a.version)}</td>
          <td><code>${escapeHtml(a.executable || "on PATH")}</code></td>
          <td><span class="pill">${a.available ? "Available" : "Missing"}</span></td>
        </tr>
      `).join("") || `<tr><td colspan="5" class="empty">No host CLIs detected.</td></tr>`;
    }
  } catch {
    // Non-fatal
  }
}
