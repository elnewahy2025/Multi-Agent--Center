/**
 * AI Coding Command Center Operator UI Logic
 */

const API_BASE = "http://127.0.0.1:8000";
let activeModalTaskId = null;

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
    fetchAudit(),
  ]);
}

async function refreshData() {
  await Promise.all([
    fetchHealth(),
    fetchTasks(),
    fetchApprovals(),
    fetchAudit(),
  ]);
  if (activeModalTaskId) {
    loadTaskDetails(activeModalTaskId);
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
        `;
      } else if (t.status === "RUNNING") {
        actionHtml = `
          <span style="font-size:0.75rem; color:#58a6ff; margin-right:0.3rem;">⏳ Running</span>
          <button class="btn btn-sm btn-view" onclick="viewTaskOutput('${t.id}')">Inspect</button>
          <button class="btn btn-sm btn-stop" onclick="stopTask('${t.id}')">Stop ⏹</button>
        `;
      } else if (t.status === "COMPLETED") {
        actionHtml = `<button class="btn btn-sm btn-view" onclick="viewTaskOutput('${t.id}')">View Output</button>`;
      } else if (t.status === "FAILED" || t.status === "CANCELLED") {
        actionHtml = `
          <button class="btn btn-sm btn-view" style="background:#da3633;" onclick="viewTaskOutput('${t.id}')">Details</button>
          <button class="btn btn-sm btn-secondary" onclick="collaborateTask('${t.id}')" title="Retry task with collaborative team">Retry ↺</button>
        `;
      }

      return `
        <tr>
          <td style="font-family: monospace;">${t.id.slice(0, 8)}...</td>
          <td><strong>${escapeHtml(t.title)}</strong></td>
          <td>${t.assigned_agent || "Antigravity + OpenCode"}</td>
          <td><span class="status-badge status-${t.status}">${t.status}</span></td>
          <td style="font-size:0.75rem; color:var(--text-muted);">${t.worktree_path ? escapeHtml(t.worktree_path.split('\\').pop()) : 'Root'}</td>
          <td style="font-size:0.75rem;">${new Date(t.created_at).toLocaleTimeString()}</td>
          <td>${actionHtml}</td>
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

function viewTaskOutput(taskId) {
  activeModalTaskId = taskId;
  const modal = document.getElementById("outputModal");
  modal.style.display = "flex";
  loadTaskDetails(taskId);
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

      if (workflow.messages && workflow.messages.length > 0) {
        let html = `<div style="display:flex; flex-direction:column; gap:0.6rem;">`;
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
        content.innerHTML = `
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

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
