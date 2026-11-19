/**
 * AI Coding Command Center Operator UI Logic
 */

const API_BASE = "http://127.0.0.1:8000";

document.addEventListener("DOMContentLoaded", () => {
  initDashboard();
  setupEventListeners();
  setInterval(refreshData, 5000);
});

function setupEventListeners() {
  document.getElementById("btnRefresh").addEventListener("click", refreshData);
  document.getElementById("taskForm").addEventListener("submit", handleTaskSubmit);
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
        <div class="agent-title">${agent.name}</div>
        <div class="agent-version">v${agent.version}</div>
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

    tbody.innerHTML = tasks.map((t) => `
      <tr>
        <td style="font-family: monospace;">${t.id.slice(0, 8)}...</td>
        <td><strong>${escapeHtml(t.title)}</strong></td>
        <td>${t.assigned_agent || "Auto"}</td>
        <td><span class="status-badge status-${t.status}">${t.status}</span></td>
        <td style="font-size:0.75rem; color:var(--text-muted);">${t.worktree_path ? t.worktree_path.split('\\').pop() : 'Root'}</td>
        <td style="font-size:0.75rem;">${new Date(t.created_at).toLocaleTimeString()}</td>
        <td>
          ${t.status === "PENDING" ? `<button class="btn btn-run" onclick="executeTask('${t.id}')">Run</button>` : "-"}
        </td>
      </tr>
    `).join("");
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
    if (!res.ok) throw new Error("Execution failed to start");
    await fetchTasks();
    await fetchAudit();
  } catch (err) {
    alert("Execution error: " + err.message);
  }
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
      <div style="padding: 0.5rem 0; border-bottom: 1px solid var(--card-border);">
        <div style="font-weight:600; color:var(--text-bright);">${escapeHtml(a.action_type)}</div>
        <div style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(a.description)}</div>
      </div>
    `).join("");
  } catch (err) {
    container.innerHTML = `<p class="empty-state">Unable to load approvals.</p>`;
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
