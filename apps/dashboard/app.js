/**
 * AI Coding Command Center Operator UI Logic
 */

const API_BASE = "http://127.0.0.1:8000";
let activeModalTaskId = null;
let lastRenderedTaskId = null;
let currentModalTab = "chat";
let modalPollTimer = null;
const eventFingerprints = new Map();
let lastFilesFingerprint = null;

document.addEventListener("DOMContentLoaded", () => {
  initDashboard();
  setupEventListeners();
  setInterval(refreshData, 2000);
});

function deriveTitleFromPrompt(desc) {
  let firstLine = "";
  for (const raw of (desc || "").split(/\r?\n/)) {
    const cleaned = raw.replace(/^[#*\->\s]+/, "").trim();
    if (cleaned) { firstLine = cleaned; break; }
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

function setupEventListeners() {
  document.getElementById("btnRefresh").addEventListener("click", refreshData);
  document.getElementById("taskForm").addEventListener("submit", handleTaskSubmit);

  const descEl = document.getElementById("taskDesc");
  const titleEl = document.getElementById("taskTitle");
  if (descEl && titleEl) {
    descEl.addEventListener("input", () => {
      if (!titleEl.value.trim()) {
        const autoTitle = deriveTitleFromPrompt(descEl.value);
        titleEl.placeholder = autoTitle
          ? `Auto-title: ${autoTitle}`
          : "Auto-generated from your prompt below (or type a custom title)";
      }
    });
  }

  const btnClose = document.getElementById("btnCloseModal");
  if (btnClose) btnClose.addEventListener("click", closeModal);

  const modal = document.getElementById("outputModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target.id === "outputModal") closeModal();
    });
  }
}

async function initDashboard() {
  await Promise.all([
    fetchHealth(),
    fetchAgents(),
    fetchTasks(),
    fetchApprovals(),
    fetchErrors(),
    fetchAudit(),
  ]);
}

async function refreshData() {
  await Promise.all([
    fetchHealth(),
    fetchTasks(),
    fetchApprovals(),
    fetchErrors(),
    fetchAudit(),
  ]);
}

async function fetchHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    const data = await res.json();
    document.getElementById("dbStatus").textContent = "DB: Connected (Postgres)";
    document.getElementById("agentsCount").textContent = `Agents: ${data.available_agents}`;
  } catch (err) {
    document.getElementById("dbStatus").textContent = "DB: Offline";
    document.getElementById("dbStatus").className = "status-pill status-error";
  }
}

async function fetchAgents() {
  const container = document.getElementById("agentsGrid");
  try {
    const res = await fetch(`${API_BASE}/agents`);
    const agents = await res.json();
    container.innerHTML = "";

    agents.forEach((agent) => {
      const card = document.createElement("div");
      card.className = "agent-card";

      const caps = [];
      if (agent.capabilities.supports_headless) caps.push("Headless CLI");
      if (agent.capabilities.supports_acp) caps.push("ACP");
      if (agent.capabilities.supports_mcp) caps.push("MCP");
      if (agent.capabilities.supports_worktrees) caps.push("Worktrees");
      if (agent.capabilities.supports_json_output) caps.push("JSON Stream");

      card.innerHTML = `
        <div class="agent-title">${escapeHtml(agent.name)}</div>
        <div class="agent-version">v${escapeHtml(agent.version)}</div>
        <div class="caps-tags">
          ${caps.map((c) => `<span class="cap-tag">${c}</span>`).join("")}
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Failed to connect to agent registry.</div>`;
  }
}

async function fetchTasks() {
  const tbody = document.getElementById("tasksTbody");
  try {
    const res = await fetch(`${API_BASE}/tasks`);
    const tasks = await res.json();

    if (tasks.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No tasks submitted yet. Create one above!</td></tr>`;
      return;
    }

    tbody.innerHTML = tasks.map((t) => {
      let actionHtml = "-";
      if (t.status === "PENDING") {
        actionHtml = `
          <button class="btn btn-sm btn-run" onclick="executeTask('${t.id}')">Run</button>
          <button class="btn btn-sm btn-team" onclick="collaborateTask('${t.id}')">Team Run ⚡</button>
          <button class="btn btn-sm btn-files" onclick="viewTaskDetails('${t.id}', 'files')">📁 Files</button>
          <button class="btn-dismiss" onclick="deleteTask('${t.id}')" title="Delete task">✕</button>
        `;
      } else if (t.status === "RUNNING") {
        actionHtml = `
          <span style="font-size:0.75rem; color:#58a6ff; margin-right:0.3rem;">⏳ Running</span>
          <button class="btn btn-sm btn-view" onclick="viewTaskDetails('${t.id}', 'chat')">Log</button>
          <button class="btn btn-sm btn-files" onclick="viewTaskDetails('${t.id}', 'files')">📁 Files</button>
          <button class="btn btn-sm btn-stop" onclick="stopTask('${t.id}')">Stop ⏹</button>
        `;
      } else if (t.status === "AWAITING_APPROVAL") {
        actionHtml = `
          <span style="font-size:0.75rem; color:#f2cc60; margin-right:0.3rem;">⏸ Awaiting You</span>
          <button class="btn btn-sm btn-team" onclick="viewTaskDetails('${t.id}', 'chat')">⚖️ Decide</button>
          <button class="btn btn-sm btn-files" onclick="viewTaskDetails('${t.id}', 'files')">📁 Files</button>
          <button class="btn btn-sm btn-stop" onclick="stopTask('${t.id}')">Stop ⏹</button>
        `;
      } else if (t.status === "COMPLETED") {
        actionHtml = `
          <button class="btn btn-sm btn-view" onclick="viewTaskDetails('${t.id}', 'chat')">Log</button>
          <button class="btn btn-sm btn-files" onclick="viewTaskDetails('${t.id}', 'files')">📁 Files</button>
          <button class="btn-dismiss" onclick="deleteTask('${t.id}')" title="Delete task">✕</button>
        `;
      } else if (t.status === "FAILED" || t.status === "CANCELLED") {
        actionHtml = `
          <button class="btn btn-sm btn-view" style="background:#da3633;" onclick="viewTaskDetails('${t.id}', 'chat')">Details</button>
          <button class="btn btn-sm btn-files" onclick="viewTaskDetails('${t.id}', 'files')">📁 Files</button>
          <button class="btn btn-sm btn-secondary" onclick="collaborateTask('${t.id}')" title="Retry task with collaborative team">Retry ↺</button>
          <button class="btn-dismiss" onclick="deleteTask('${t.id}')" title="Delete task">✕</button>
        `;
      }

      return `
        <tr>
          <td style="font-family: monospace;">${t.id.slice(0, 8)}...</td>
          <td>
            <strong>${escapeHtml(t.title)}</strong>
            <div style="font-size:0.73rem; color:var(--text-muted); max-width:340px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(t.description)}">${escapeHtml(t.description)}</div>
          </td>
          <td>${t.assigned_agent || "Antigravity + OpenCode"}</td>
          <td><span class="status-badge status-${t.status}">${t.status}</span></td>
          <td style="font-size:0.75rem; color:var(--text-muted);">${t.worktree_path ? escapeHtml(t.worktree_path.split('\\\\').pop().split('/').pop()) : 'Root'}</td>
          <td style="font-size:0.75rem;">${new Date(t.created_at).toLocaleTimeString()}</td>
          <td style="display:flex; gap:0.3rem; align-items:center;">${actionHtml}</td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Error fetching tasks.</td></tr>`;
  }
}

async function handleTaskSubmit(e) {
  e.preventDefault();
  const title = document.getElementById("taskTitle").value.trim();
  const description = document.getElementById("taskDesc").value.trim();
  const agentVal = document.getElementById("taskAgent").value;
  const policyVal = document.getElementById("taskPolicy").value;
  const projectPath = document.getElementById("projectPath").value.trim();
  const useWorktree = document.getElementById("useWorktree").checked;

  const payload = {
    title: title || null,
    description,
    policy_mode: policyVal,
    use_worktree: useWorktree,
    preferred_agent: agentVal || null,
    project_path: projectPath || null,
  };

  try {
    const res = await fetch(`${API_BASE}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error("Submission failed");
    document.getElementById("taskForm").reset();
    document.getElementById("taskTitle").placeholder = "Auto-generated from your prompt below (or type a custom title)";
    document.getElementById("useWorktree").checked = true;
    await fetchTasks();
  } catch (err) {
    alert("Error submitting task: " + err.message);
  }
}

async function deleteTask(taskId) {
  if (!confirm("Delete this task and its local history?")) return;
  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete task");
    if (activeModalTaskId === taskId) closeModal();
    await Promise.all([fetchTasks(), fetchApprovals(), fetchErrors(), fetchAudit()]);
  } catch (err) {
    alert("Delete error: " + err.message);
  }
}

async function executeTask(taskId) {
  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/execute`, { method: "POST" });
    if (!res.ok) throw new Error("Execution failed to dispatch");
    await fetchTasks();
    await fetchAudit();
  } catch (err) {
    alert("Execution error: " + err.message);
  }
}

async function collaborateTask(taskId) {
  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/collaborate`, { method: "POST" });
    if (!res.ok) throw new Error("Collaboration workflow failed to dispatch");
    await fetchTasks();
    await fetchAudit();
  } catch (err) {
    alert("Collaboration error: " + err.message);
  }
}

async function stopTask(taskId) {
  if (!confirm("Are you sure you want to stop this running task?")) return;
  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/cancel`, { method: "POST" });
    if (!res.ok) throw new Error("Failed to stop task");
    await fetchTasks();
    await fetchAudit();
  } catch (err) {
    alert("Stop error: " + err.message);
  }
}

function switchModalTab(tabName) {
  currentModalTab = tabName;
  const tabChatBtn = document.getElementById("tabChat");
  const tabFilesBtn = document.getElementById("tabFiles");
  const chatView = document.getElementById("tabChatView");
  const filesView = document.getElementById("tabFilesView");

  if (tabName === "files") {
    if (tabFilesBtn) tabFilesBtn.classList.add("active");
    if (tabChatBtn) tabChatBtn.classList.remove("active");
    if (filesView) filesView.style.display = "block";
    if (chatView) chatView.style.display = "none";
    if (activeModalTaskId) loadTaskFiles(activeModalTaskId);
  } else {
    if (tabChatBtn) tabChatBtn.classList.add("active");
    if (tabFilesBtn) tabFilesBtn.classList.remove("active");
    if (chatView) chatView.style.display = "block";
    if (filesView) filesView.style.display = "none";
  }
}

function viewTaskDetails(taskId, tab = "chat") {
  const isNewTask = lastRenderedTaskId !== taskId;
  activeModalTaskId = taskId;
  if (isNewTask) {
    lastRenderedTaskId = taskId;
    eventFingerprints.clear();
    lastFilesFingerprint = null;
    const feed = document.getElementById("liveActivityFeed");
    if (feed) feed.innerHTML = "";
    const content = document.getElementById("modalContent");
    if (content) content.innerHTML = "";
  }
  const modal = document.getElementById("outputModal");
  if (modal) modal.style.display = "flex";
  switchModalTab(tab);
  refreshActiveModal();
  if (modalPollTimer) clearInterval(modalPollTimer);
  modalPollTimer = setInterval(refreshActiveModal, 1000);
}

function refreshActiveModal() {
  if (!activeModalTaskId) return;
  loadTaskDetails(activeModalTaskId);
  loadTaskFiles(activeModalTaskId);
}

function viewTaskOutput(taskId) {
  viewTaskDetails(taskId, "chat");
}

function viewTaskFiles(taskId) {
  viewTaskDetails(taskId, "files");
}

function agentBadgeHtml(agentName) {
  if (agentName === "ANTIGRAVITY") return `<span class="agent-pill agent-pill-ANTIGRAVITY">🟣 Antigravity</span>`;
  if (agentName === "OPENCODE") return `<span class="agent-pill agent-pill-OPENCODE">🟢 OpenCode</span>`;
  return `<span class="agent-pill agent-pill-OTHER">🤖 ${escapeHtml(agentName || "Agent")}</span>`;
}

function renderStageStepper(workflow) {
  const stepper = document.getElementById("stageStepper");
  if (!stepper) return;
  if (!workflow) {
    stepper.style.display = "none";
    stepper.innerHTML = "";
    return;
  }
  stepper.style.display = "grid";
  const stages = [
    { key: "INSPECTION", label: "1. Inspection (Antigravity)" },
    { key: "NEGOTIATION", label: "2. Negotiation (OpenCode)" },
    { key: "EXECUTION", label: "3. Execution (Worktree)" },
    { key: "VERIFICATION", label: "4. Verification (Sign-off)" },
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
    return `<div class="stage-step ${cls}">${icon}<span>${st.label}</span></div>`;
  }).join("");
}

function renderActivityFeed(events) {
  const feed = document.getElementById("liveActivityFeed");
  if (!feed) return;

  const modalBody = feed.closest(".modal-body");
  const nearBottom = modalBody
    ? (modalBody.scrollHeight - modalBody.scrollTop - modalBody.clientHeight < 70)
    : false;

  if (!events || events.length === 0) {
    if (feed.children.length === 0) {
      feed.innerHTML = `<div class="empty-state" style="padding:0.9rem;">⏳ Waiting for live agent events...</div>`;
    }
    return;
  }

  const placeholder = feed.querySelector(".empty-state");
  if (placeholder) placeholder.remove();

  events.forEach((ev) => {
    const fp = `${ev.updated_at}|${ev.status}|${(ev.content || "").length}`;
    if (eventFingerprints.get(ev.id) === fp) return;

    let node = feed.querySelector(`[data-event-id="${ev.id}"]`);
    if (!node) {
      node = createEventElement(ev);
      feed.appendChild(node);
    } else {
      updateEventElement(node, ev);
    }
    eventFingerprints.set(ev.id, fp);
  });

  if (nearBottom && modalBody) {
    modalBody.scrollTop = modalBody.scrollHeight;
  }
}

function toolStatusIcon(status) {
  if (status === "running") return `<span class="spinner-dot"></span>`;
  if (status === "failed") return `<span style="color:#f85149; font-weight:700;">✕</span>`;
  return `<span style="color:#3fb950; font-weight:700;">✓</span>`;
}

function createEventElement(ev) {
  if (ev.kind === "tool") {
    const details = document.createElement("details");
    details.className = "activity-tool-card";
    details.dataset.eventId = String(ev.id);
    details.innerHTML = `<summary class="activity-tool-header"></summary><div class="activity-tool-body"><pre></pre></div>`;
    updateEventElement(details, ev);
    return details;
  }
  const div = document.createElement("div");
  div.dataset.eventId = String(ev.id);
  updateEventElement(div, ev);
  return div;
}

function updateEventElement(node, ev) {
  if (ev.kind === "tool") {
    node.dataset.status = ev.status || "done";
    const summary = node.querySelector("summary");
    const dur = ev.duration_seconds != null ? `${ev.duration_seconds.toFixed(1)}s` : (ev.status === "running" ? "running…" : "");
    summary.innerHTML = `
      ${toolStatusIcon(ev.status)}
      ${agentBadgeHtml(ev.agent)}
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
        <span>${agentBadgeHtml(ev.agent)} <span style="color:var(--text-muted); margin-left:0.35rem;">Live Response</span></span>
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

async function loadTaskDetails(taskId) {
  const meta = document.getElementById("modalMeta");
  const content = document.getElementById("modalContent");

  try {
    const [wfRes, evRes, aprRes] = await Promise.all([
      fetch(`${API_BASE}/tasks/${taskId}/workflow`),
      fetch(`${API_BASE}/tasks/${taskId}/events`),
      fetch(`${API_BASE}/approvals`),
    ]);
    const workflow = wfRes.ok ? await wfRes.json() : null;
    const evPayload = evRes.ok ? await evRes.json() : { events: [] };
    const events = evPayload.events || [];
    const allApprovals = aprRes.ok ? await aprRes.json() : [];
    const pendingApproval = allApprovals.find((a) => a.task_id === taskId);

    renderStageStepper(workflow);
    renderActivityFeed(events);

    const focused = document.activeElement;
    if (focused && content.contains(focused) && focused.classList.contains("approval-note-input")) {
      return;
    }

    const existingModalNotes = {};
    content.querySelectorAll(".approval-note-input").forEach((inp) => {
      existingModalNotes[inp.id] = inp.value;
    });

    let approvalBannerHtml = "";
    if (pendingApproval) {
      approvalBannerHtml = `
        <div class="modal-approval-box">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="color:#f2cc60;">⏸ Human Decision Required: ${escapeHtml(pendingApproval.action_type)}</strong>
            <span class="badge badge-warning">${escapeHtml(pendingApproval.risk_level)}</span>
          </div>
          <div style="font-size:0.82rem; color:var(--text-bright);">${escapeHtml(pendingApproval.description)}</div>
          <div style="font-family:monospace; font-size:0.74rem; color:#79c0ff; word-break:break-all;">${escapeHtml(pendingApproval.command_or_path)}</div>
          <input type="text" class="approval-note-input" id="modalAprNote_${escapeHtml(pendingApproval.id)}"
            placeholder="Optional instructions for agents (e.g. skip driver upgrade, fix test)...">
          <div class="approval-actions">
            <button class="btn btn-approve" onclick="decideApproval('${escapeHtml(pendingApproval.id)}', 'APPROVED')">Approve &amp; Continue ✓</button>
            <button class="btn btn-deny" onclick="decideApproval('${escapeHtml(pendingApproval.id)}', 'DENIED')">Deny &amp; Stop ✕</button>
          </div>
        </div>
      `;
    }

    if (workflow) {
      document.getElementById("modalTitle").textContent = "Bilateral Teamwork: Antigravity ↔ OpenCode";
      const verifyHtml = workflow.is_verified
        ? '<span style="color:#3fb950; font-weight:600;">✓ 100% Certified by Antigravity</span>'
        : (workflow.status === "FAILED"
            ? '<span style="color:#f85149; font-weight:600;">✕ Rejected / Failed</span>'
            : (workflow.status === "CANCELLED"
                ? '<span style="color:#8b949e; font-weight:600;">⏹ Cancelled</span>'
                : '<span style="color:#d29922;">In Progress...</span>'));
      meta.innerHTML = `
        <strong>Current Stage:</strong> <span class="phase-badge">${workflow.current_phase}</span> &bull;
        <strong>Status:</strong> <span class="status-badge status-${workflow.status}">${workflow.status}</span> &bull;
        <strong>Verification:</strong> ${verifyHtml}
      `;

      let alertHtml = approvalBannerHtml;
      if (workflow.status === "FAILED") {
        alertHtml += `
          <div style="background:rgba(218,54,51,0.18); border:1px solid #da3633; border-radius:6px; padding:0.75rem 1rem; color:#f85149; margin-bottom:0.5rem;">
            <strong>🚨 Workflow Execution Halted with Error:</strong>
            <div style="margin-top:0.25rem; font-size:0.8rem; color:#f0f6fc;">${escapeHtml(workflow.verification_report || 'An error occurred during agent execution.')}</div>
          </div>
        `;
      }

      if (workflow.messages && workflow.messages.length > 0) {
        let html = alertHtml + `<div class="files-section-heading">Completed Stage Summaries</div>`;
        workflow.messages.forEach((msg) => {
          const isAntigravity = msg.sender === "ANTIGRAVITY";
          const bubbleClass = isAntigravity ? "msg-antigravity" : "msg-opencode";
          const roleLabel = isAntigravity ? "🟣 Google Antigravity (Architect / Quality Reviewer)" : "🟢 OpenCode Desktop (Implementer / Worker)";

          html += `
            <div class="msg-bubble ${bubbleClass}">
              <div class="msg-header">
                <span>${roleLabel}</span>
                <span class="phase-badge">${msg.phase}</span>
              </div>
              <div class="msg-body">${escapeHtml(msg.content)}</div>
            </div>
          `;
        });
        content.innerHTML = html;
      } else {
        content.innerHTML = alertHtml;
      }
      Object.entries(existingModalNotes).forEach(([id, val]) => {
        const inp = document.getElementById(id);
        if (inp) inp.value = val;
      });
      return;
    }

    // Fallback to single agent run
    document.getElementById("modalTitle").textContent = "Single Agent Execution Details";
    const res = await fetch(`${API_BASE}/tasks/${taskId}/runs`);
    const runs = await res.json();

    if (!runs || runs.length === 0) {
      meta.textContent = `Task ID: ${taskId}`;
      content.innerHTML = approvalBannerHtml + (events.length ? "" : `<div class="empty-state">No run records found for this task.</div>`);
      return;
    }

    const latest = runs[0];
    meta.innerHTML = `
      <strong>Agent:</strong> ${latest.agent_type} &bull;
      <strong>Status:</strong> <span class="status-badge status-${latest.status}">${latest.status}</span> &bull;
      <strong>Duration:</strong> ${latest.duration_seconds ? latest.duration_seconds.toFixed(2) + 's' : 'In progress'} &bull;
      <strong>Exit Code:</strong> ${latest.exit_code !== null ? latest.exit_code : '-'}
    `;

    let text = "";
    if (latest.stdout) text += "=== STDOUT ===\n" + latest.stdout + "\n\n";
    if (latest.stderr) text += "=== STDERR ===\n" + latest.stderr + "\n\n";
    if (latest.error_reason) text += "=== ERROR ===\n" + latest.error_reason + "\n";

    if (events.length > 0) {
      content.innerHTML = approvalBannerHtml + (text ? `
        <details class="activity-tool-card">
          <summary class="activity-tool-header">
            <span class="tool-name-pill">RAW LOG</span>
            <span class="activity-tool-target">Process STDOUT / STDERR &amp; Exit Details</span>
          </summary>
          <div class="activity-tool-body"><pre>${escapeHtml(text)}</pre></div>
        </details>
      ` : "");
    } else {
      content.innerHTML = approvalBannerHtml + `<pre class="output-terminal">${escapeHtml(text || "No console output recorded yet. Agent is initializing...")}</pre>`;
    }
    Object.entries(existingModalNotes).forEach(([id, val]) => {
      const inp = document.getElementById(id);
      if (inp) inp.value = val;
    });
  } catch (err) {
    content.innerHTML = `<pre class="output-terminal">Failed to fetch task details: ${escapeHtml(err.message)}</pre>`;
  }
}

function closeModal() {
  activeModalTaskId = null;
  if (modalPollTimer) {
    clearInterval(modalPollTimer);
    modalPollTimer = null;
  }
  const modal = document.getElementById("outputModal");
  if (modal) modal.style.display = "none";
}

async function loadTaskFiles(taskId) {
  const container = document.getElementById("filesContainer");
  const badge = document.getElementById("modalFilesBadge");
  if (!container) return;

  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/files`);
    if (!res.ok) throw new Error("Could not fetch file status");
    const data = await res.json();

    const changedFiles = data.changed_files || [];
    const activityFiles = data.activity_files || [];
    if (badge) badge.textContent = changedFiles.length + activityFiles.length;

    const fp = JSON.stringify(data);
    if (fp === lastFilesFingerprint) return;
    lastFilesFingerprint = fp;

    let html = `
      <div class="files-summary-bar">
        <div><strong>Working Directory:</strong> <span style="font-family:monospace; color:var(--accent-color);">${escapeHtml(data.working_dir)}</span></div>
        <div><strong>Modified:</strong> <span style="color:#3fb950; font-weight:700;">${changedFiles.length}</span> &bull; <strong>Tool Calls:</strong> <span style="color:#58a6ff; font-weight:700;">${activityFiles.length}</span></div>
      </div>
    `;

    html += `<div class="files-section-heading">✏️ Modified Files on Disk (Git Diff)</div>`;
    if (changedFiles.length === 0) {
      html += `
        <div class="empty-state" style="padding:1rem;">
          <p style="font-size:0.85rem; color:var(--text-main);">No uncommitted modifications on disk yet.</p>
          ${data.context_files && data.context_files.length ? `<p style="margin-top:0.5rem; font-size:0.78rem;"><strong>Target Context Files:</strong> ${data.context_files.map(f => `<code>${escapeHtml(f)}</code>`).join(", ")}</p>` : ''}
        </div>
      `;
    } else {
      changedFiles.forEach((file) => {
        const statusClass = `file-status-${file.status || 'CHANGED'}`;
        html += `
          <div class="file-card">
            <div class="file-card-header">
              <span class="file-path">📄 ${escapeHtml(file.path)}</span>
              <span class="file-status-badge ${statusClass}">${file.status}</span>
            </div>
            <div class="diff-viewer">${formatDiff(file.diff || '')}</div>
          </div>
        `;
      });
    }

    html += `<div class="files-section-heading">🔍 Live Agent Tool &amp; File Activity</div>`;
    if (activityFiles.length === 0) {
      html += `<div class="empty-state" style="padding:1rem;">No tool invocations recorded for this task yet.</div>`;
    } else {
      activityFiles.forEach((act) => {
        const lowerStatus = (act.status || "done").toLowerCase();
        const dur = act.duration_seconds != null ? `${act.duration_seconds.toFixed(1)}s` : (lowerStatus === "running" ? "running…" : "");
        html += `
          <details class="activity-tool-card" data-status="${lowerStatus}">
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
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Error loading file details: ${escapeHtml(err.message)}</div>`;
  }
}

function formatDiff(diffText) {
  if (!diffText) return `<span class="diff-line diff-ctx">No diff available</span>`;
  const lines = diffText.split('\n');
  return lines.map((line) => {
    let cls = "diff-ctx";
    if (line.startsWith('+') && !line.startsWith('+++')) cls = "diff-add";
    else if (line.startsWith('-') && !line.startsWith('---')) cls = "diff-del";
    else if (line.startsWith('@@') || line.startsWith('+++') || line.startsWith('---')) cls = "diff-hdr";
    return `<span class="diff-line ${cls}">${escapeHtml(line)}</span>`;
  }).join('');
}

async function fetchApprovals() {
  const container = document.getElementById("approvalsList");
  const badge = document.getElementById("approvalsBadge");
  try {
    if (document.activeElement && container.contains(document.activeElement)
        && document.activeElement.classList.contains("approval-note-input")) {
      return;
    }
    const existingNotes = {};
    container.querySelectorAll(".approval-note-input").forEach((inp) => { existingNotes[inp.id] = inp.value; });

    const res = await fetch(`${API_BASE}/approvals`);
    const approvals = await res.json();
    badge.textContent = approvals.length;

    if (approvals.length === 0) {
      container.innerHTML = `<p class="empty-state">No actions currently require human approval.</p>`;
      return;
    }

    container.innerHTML = approvals.map((a) => `
      <div class="approval-item">
        <div class="approval-header">
          <strong style="color:var(--text-bright);">${escapeHtml(a.action_type)}</strong>
          <span class="badge badge-warning">${escapeHtml(a.risk_level)}</span>
        </div>
        <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:0.3rem;">${escapeHtml(a.description)}</div>
        <div style="font-family:monospace; font-size:0.75rem; color:#79c0ff; margin-bottom:0.5rem; word-break:break-all;">${escapeHtml(a.command_or_path)}</div>
        <input type="text" class="approval-note-input" id="aprNote_${escapeHtml(a.id)}"
          placeholder="Optional instructions for agents (e.g. skip driver upgrade, fix test)...">
        <div class="approval-actions">
          <button class="btn btn-approve" onclick="decideApproval('${escapeHtml(a.id)}', 'APPROVED')">Approve &amp; Continue ✓</button>
          <button class="btn btn-deny" onclick="decideApproval('${escapeHtml(a.id)}', 'DENIED')">Deny &amp; Stop ✕</button>
        </div>
      </div>
    `).join("");

    Object.entries(existingNotes).forEach(([id, val]) => {
      const inp = document.getElementById(id);
      if (inp) inp.value = val;
    });
  } catch (err) {
    container.innerHTML = `<p class="empty-state">Unable to load approvals.</p>`;
  }
}

async function decideApproval(approvalId, decision) {
  try {
    const modalNote = document.getElementById(`modalAprNote_${approvalId}`);
    const listNote = document.getElementById(`aprNote_${approvalId}`);
    const note = ((modalNote && modalNote.value) || (listNote && listNote.value) || "").trim();

    const res = await fetch(`${API_BASE}/approvals/${approvalId}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, decided_by: "Ahmed", reason: note || null }),
    });
    if (!res.ok) throw new Error("Decision submission failed");
    await Promise.all([fetchApprovals(), fetchTasks(), fetchAudit()]);
    if (activeModalTaskId) {
      await loadTaskDetails(activeModalTaskId);
    }
  } catch (err) {
    alert("Approval error: " + err.message);
  }
}

async function fetchAudit() {
  const container = document.getElementById("auditLogContainer");
  try {
    const res = await fetch(`${API_BASE}/audit?limit=25`);
    const logs = await res.json();
    if (logs.length === 0) return;

    container.innerHTML = logs.map((l) => `
      <div class="audit-entry">
        <span class="audit-time">${new Date(l.created_at).toLocaleTimeString()}</span>
        <span class="audit-type">[${escapeHtml(l.event_type)}]</span>
        <span>${escapeHtml(l.message)}</span>
      </div>
    `).join("");
  } catch (err) {
    // Silent fail for audit polling
  }
}

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
      if (errors.length > 0) {
        pill.className = "status-pill status-error";
      } else {
        pill.className = "status-pill status-healthy";
      }
    }

    if (badge) {
      badge.textContent = `${errors.length} Active Error${errors.length === 1 ? '' : 's'}`;
      badge.className = errors.length > 0 ? "badge badge-error" : "badge badge-success";
    }

    if (errors.length === 0) {
      container.innerHTML = `<div class="empty-state">✓ All systems operational. No active errors or agent failures.</div>`;
      return;
    }

    container.innerHTML = errors.map((err) => {
      const severityClass = `severity-${err.severity || 'ERROR'}`;
      const timeStr = new Date(err.created_at).toLocaleTimeString();
      return `
        <div class="error-entry ${severityClass}">
          <div class="error-entry-header">
            <div class="error-title-row">
              <span class="error-source-tag">[${escapeHtml(err.source)}]</span>
              <span class="badge ${err.severity === 'CRITICAL' ? 'badge-error' : 'badge-warning'}">${err.severity}</span>
              <span class="error-title">${escapeHtml(err.title)}</span>
            </div>
            <button class="btn-dismiss" onclick="resolveError(${err.id})" title="Dismiss error notification">Dismiss ✕</button>
          </div>
          <div class="error-message">${escapeHtml(err.message)}</div>
          ${err.stderr ? `<pre class="error-stderr-box">${escapeHtml(err.stderr)}</pre>` : ''}
          <div class="error-entry-footer">
            <span>Task ID: <code>${err.task_id || 'System'}</code> &bull; ${timeStr}</span>
            ${err.task_id ? `<button class="btn btn-sm btn-view" onclick="viewTaskDetails('${err.task_id}', 'chat')">Inspect Task ➔</button>` : ''}
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    // Silent fail for polling
  }
}

async function resolveError(errorId) {
  try {
    await fetch(`${API_BASE}/errors/${errorId}/resolve`, { method: "POST" });
    await fetchErrors();
  } catch (e) {
    console.error("Failed to dismiss error:", e);
  }
}

async function clearAllErrors() {
  try {
    await fetch(`${API_BASE}/errors/clear`, { method: "POST" });
    await fetchErrors();
  } catch (e) {
    console.error("Failed to clear errors:", e);
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
