/**
 * AI Coding Command Center Operator UI Logic
 */

const API_BASE = "http://127.0.0.1:8000";
let activeModalTaskId = null;
let currentModalTab = "chat";

document.addEventListener("DOMContentLoaded", () => {
  initDashboard();
  setupEventListeners();
  setInterval(refreshData, 2000);
});

function setupEventListeners() {
  document.getElementById("btnRefresh").addEventListener("click", refreshData);
  document.getElementById("taskForm").addEventListener("submit", handleTaskSubmit);

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
  if (activeModalTaskId) {
    loadTaskDetails(activeModalTaskId);
    if (currentModalTab === "files") {
      loadTaskFiles(activeModalTaskId);
    }
  }
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
        `;
      } else if (t.status === "RUNNING") {
        actionHtml = `
          <span style="font-size:0.75rem; color:#58a6ff; margin-right:0.3rem;">⏳ Running</span>
          <button class="btn btn-sm btn-view" onclick="viewTaskDetails('${t.id}', 'chat')">Log</button>
          <button class="btn btn-sm btn-files" onclick="viewTaskDetails('${t.id}', 'files')">📁 Files</button>
          <button class="btn btn-sm btn-stop" onclick="stopTask('${t.id}')">Stop ⏹</button>
        `;
      } else if (t.status === "COMPLETED") {
        actionHtml = `
          <button class="btn btn-sm btn-view" onclick="viewTaskDetails('${t.id}', 'chat')">Log</button>
          <button class="btn btn-sm btn-files" onclick="viewTaskDetails('${t.id}', 'files')">📁 Files</button>
        `;
      } else if (t.status === "FAILED" || t.status === "CANCELLED") {
        actionHtml = `
          <button class="btn btn-sm btn-view" style="background:#da3633;" onclick="viewTaskDetails('${t.id}', 'chat')">Details</button>
          <button class="btn btn-sm btn-files" onclick="viewTaskDetails('${t.id}', 'files')">📁 Files</button>
          <button class="btn btn-sm btn-secondary" onclick="collaborateTask('${t.id}')" title="Retry task with collaborative team">Retry ↺</button>
        `;
      }

      return `
        <tr>
          <td style="font-family: monospace;">${t.id.slice(0, 8)}...</td>
          <td><strong>${escapeHtml(t.title)}</strong></td>
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
    title,
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
    document.getElementById("useWorktree").checked = true;
    await fetchTasks();
  } catch (err) {
    alert("Error submitting task: " + err.message);
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
  activeModalTaskId = taskId;
  const modal = document.getElementById("outputModal");
  if (modal) modal.style.display = "flex";
  switchModalTab(tab);
  loadTaskDetails(taskId);
  loadTaskFiles(taskId);
}

function viewTaskOutput(taskId) {
  viewTaskDetails(taskId, "chat");
}

function viewTaskFiles(taskId) {
  viewTaskDetails(taskId, "files");
}

async function loadTaskDetails(taskId) {
  const meta = document.getElementById("modalMeta");
  const content = document.getElementById("modalContent");

  try {
    const wfRes = await fetch(`${API_BASE}/tasks/${taskId}/workflow`);
    const workflow = wfRes.ok ? await wfRes.json() : null;

    if (workflow) {
      document.getElementById("modalTitle").textContent = "Bilateral Teamwork: Antigravity ↔ OpenCode";
      meta.innerHTML = `
        <strong>Current Stage:</strong> <span class="phase-badge">${workflow.current_phase}</span> &bull;
        <strong>Status:</strong> <span class="status-badge status-${workflow.status}">${workflow.status}</span> &bull;
        <strong>Verification:</strong> ${workflow.is_verified ? '<span style="color:#3fb950; font-weight:600;">✓ 100% Certified by Antigravity</span>' : '<span style="color:#d29922;">In Progress...</span>'}
      `;

      let alertHtml = "";
      if (workflow.status === "FAILED") {
        alertHtml = `
          <div style="background:rgba(218,54,51,0.18); border:1px solid #da3633; border-radius:6px; padding:0.75rem 1rem; color:#f85149; margin-bottom:0.75rem;">
            <strong>🚨 Workflow Execution Halted with Error:</strong>
            <div style="margin-top:0.25rem; font-size:0.8rem; color:#f0f6fc;">${escapeHtml(workflow.verification_report || 'An error occurred during agent execution.')}</div>
          </div>
        `;
      }

      if (workflow.messages && workflow.messages.length > 0) {
        let html = alertHtml + `<div style="display:flex; flex-direction:column; gap:0.6rem;">`;
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
        html += `</div>`;
        content.innerHTML = html;
      } else {
        content.innerHTML = alertHtml + `
          <div style="padding:1rem; text-align:center; color:#58a6ff;">
            <p><strong>[Stage 1: INSPECTION]</strong> Google Antigravity is currently inspecting your codebase and drafting the technical proposal...</p>
            <p style="font-size:0.75rem; color:var(--text-muted); margin-top:0.4rem;">This screen refreshes live automatically.</p>
          </div>
        `;
      }
      return;
    }

    // Fallback to single agent run
    document.getElementById("modalTitle").textContent = "Single Agent Execution Details";
    const res = await fetch(`${API_BASE}/tasks/${taskId}/runs`);
    const runs = await res.json();

    if (!runs || runs.length === 0) {
      meta.textContent = `Task ID: ${taskId}`;
      content.textContent = "No run records found for this task.";
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
    if (!text) text = "No console output recorded yet. Agent is initializing...";

    content.textContent = text;
  } catch (err) {
    content.textContent = "Failed to fetch task details: " + err.message;
  }
}

function closeModal() {
  activeModalTaskId = null;
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
    if (badge) badge.textContent = changedFiles.length;

    let html = `
      <div class="files-summary-bar">
        <div><strong>Working Directory:</strong> <span style="font-family:monospace; color:var(--accent-color);">${escapeHtml(data.working_dir)}</span></div>
        <div><strong>Files Changed:</strong> <span style="color:#3fb950; font-weight:700;">${changedFiles.length}</span></div>
      </div>
    `;

    if (changedFiles.length === 0) {
      html += `
        <div class="empty-state" style="padding:2rem;">
          <p style="font-size:0.95rem; color:var(--text-bright); margin-bottom:0.5rem;">ℹ️ No files modified on disk yet</p>
          <p style="color:var(--text-muted); font-size:0.8rem;">Agents may currently be reading the codebase, planning, or negotiating before writing changes.</p>
          ${data.context_files && data.context_files.length ? `<p style="margin-top:0.8rem; font-size:0.8rem;"><strong>Target Context Files:</strong> ${data.context_files.map(f => `<code>${escapeHtml(f)}</code>`).join(", ")}</p>` : ''}
        </div>
      `;
      container.innerHTML = html;
      return;
    }

    changedFiles.forEach((file) => {
      const statusClass = `file-status-${file.status || 'CHANGED'}`;
      const diffFormatted = formatDiff(file.diff || '');

      html += `
        <div class="file-card">
          <div class="file-card-header">
            <span class="file-path">📄 ${escapeHtml(file.path)}</span>
            <span class="file-status-badge ${statusClass}">${file.status}</span>
          </div>
          <div class="diff-viewer">${diffFormatted}</div>
        </div>
      `;
    });

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
        <div class="approval-actions">
          <button class="btn btn-approve" onclick="decideApproval('${a.id}', 'APPROVED')">Approve ✓</button>
          <button class="btn btn-deny" onclick="decideApproval('${a.id}', 'DENIED')">Deny ✕</button>
        </div>
      </div>
    `).join("");
  } catch (err) {
    container.innerHTML = `<p class="empty-state">Unable to load approvals.</p>`;
  }
}

async function decideApproval(approvalId, decision) {
  try {
    const res = await fetch(`${API_BASE}/approvals/${approvalId}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, decided_by: "Ahmed" }),
    });
    if (!res.ok) throw new Error("Decision submission failed");
    await fetchApprovals();
    await fetchAudit();
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
