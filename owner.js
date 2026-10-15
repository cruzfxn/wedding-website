const ownerProjectUrl = "https://smzqxypdcwnbysvfqnke.supabase.co";
const ownerPublishableKey = "sb_publishable_Ts-waAnAAj-U2JwoiQXH1g_2XDugY-F";
const feedback = document.getElementById("owner-feedback");
const loginPanel = document.getElementById("owner-login-panel");
const dashboard = document.getElementById("owner-dashboard-content");
const loginForm = document.getElementById("owner-login-form");
const requestBody = document.getElementById("owner-requests");
const filter = document.getElementById("owner-filter");
let client;
let requestRows = [];

function setFeedback(message, state = "info") {
  feedback.textContent = message;
  feedback.dataset.state = state;
}

function setSignedIn(isSignedIn) {
  loginPanel.hidden = isSignedIn;
  dashboard.hidden = !isSignedIn;
}

function addCell(row, content) {
  const cell = document.createElement("td");
  if (content instanceof Node) cell.appendChild(content);
  else cell.textContent = content == null ? "" : String(content);
  row.appendChild(cell);
  return cell;
}

function namesFor(request) {
  const names = [request.full_name, request.second_guest_name, request.third_guest_name].filter(Boolean);
  const list = document.createElement("ul");
  list.className = "owner-attendee-list";
  names.forEach(name => { const item = document.createElement("li"); item.textContent = name; list.appendChild(item); });
  return list;
}

function actionButton(row, request, action, label, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.action = action;
  button.dataset.requestId = request.request_id;
  button.textContent = label;
  row.appendChild(button);
}

function renderRequests() {
  requestBody.replaceChildren();
  const visibleRows = filter.value === "all" ? requestRows : requestRows.filter(item => item.eligibility_status === filter.value);
  for (const request of visibleRows) {
    const row = document.createElement("tr");
    addCell(row, namesFor(request));
    addCell(row, `${request.attendee_count} ${request.attendee_count === 1 ? "attendee" : "attendees"}`);
    const contact = document.createElement("div");
    contact.className = "owner-contact";
    const email = document.createElement("a"); email.href = `mailto:${encodeURIComponent(request.email)}`; email.textContent = request.email;
    const phone = document.createElement("a"); phone.href = `tel:${request.phone.replace(/[^+0-9]/g, "")}`; phone.textContent = request.phone;
    contact.append(email, document.createElement("br"), phone);
    addCell(row, contact);
    const status = document.createElement("span"); status.className = `owner-status owner-status-${request.eligibility_status}`; status.textContent = request.eligibility_status;
    addCell(row, status);
    const submitted = new Date(request.created_at);
    addCell(row, Number.isNaN(submitted.getTime()) ? "Unknown" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(submitted));
    const actions = document.createElement("div"); actions.className = "owner-actions";
    if (request.eligibility_status === "pending") {
      actionButton(actions, request, "approve", "Approve", "btn btn-primary");
      actionButton(actions, request, "reject", "Reject", "btn btn-secondary");
    } else if (request.eligibility_status === "approved") {
      actionButton(actions, request, "revoke", "Revoke", "btn btn-secondary");
    } else {
      actionButton(actions, request, "approve", "Approve", "btn btn-primary");
      actionButton(actions, request, "reopen", "Return to pending", "btn btn-secondary");
    }
    addCell(row, actions);
    requestBody.appendChild(row);
  }
  for (const status of ["pending", "approved", "rejected", "revoked"]) {
    document.getElementById(`count-${status}`).textContent = requestRows.filter(item => item.eligibility_status === status).length;
  }
  document.getElementById("count-attendees").textContent = requestRows
    .filter(item => item.eligibility_status === "approved")
    .reduce((total, item) => total + Number(item.attendee_count || 0), 0);
  if (!visibleRows.length) {
    const row = document.createElement("tr"), cell = document.createElement("td");
    cell.colSpan = 6; cell.textContent = "No requests in this view."; row.appendChild(cell); requestBody.appendChild(row);
  }
}

async function loadRequests() {
  setFeedback("Loading guest requests…");
  const { data: isAdmin, error: authzError } = await client.rpc("is_invitation_admin");
  if (authzError || isAdmin !== true) {
    await client.auth.signOut();
    setSignedIn(false);
    setFeedback("This account is not authorized to view guest requests. Sign in with the approved owner account.", "error");
    return;
  }
  const { data, error } = await client.rpc("admin_list_invitation_requests");
  if (error || !Array.isArray(data)) {
    setFeedback("Guest requests could not be loaded. Check your connection and try again.", "error");
    return;
  }
  requestRows = data;
  renderRequests();
  setSignedIn(true);
  setFeedback(`${requestRows.length} requests loaded.`, "success");
}

async function approveRequest(requestId) {
  const { data, error } = await client.functions.invoke("approve-guest", { body: { mode: "approve", requestId } });
  let result = data;
  if (!result && error?.context && typeof error.context.json === "function") {
    try { result = await error.context.json(); } catch (_) { result = null; }
  }
  if (result?.approvalStatus === "approved") {
    if (result.emailStatus === "accepted_by_brevo") return { message: "Request approved. Brevo accepted the email; delivery is not confirmed.", state: "success" };
    return { message: `Request approved. Approval email status: ${result.emailStatus || "could not be confirmed"}.`, state: "error" };
  }
  if (error) throw new Error("The approval action could not be confirmed. Refresh the list to check its current status.");
  throw new Error(data?.error || "The request could not be approved.");
}

async function updateStatus(requestId, status) {
  const { error } = await client.rpc("set_invitation_request_status", { p_request_id: requestId, p_status: status });
  if (error) throw new Error("The request status could not be changed. Refresh the list and try again.");
  return { message: `Request status changed to ${status}.`, state: "success" };
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = loginForm.querySelector("button[type='submit']");
  button.disabled = true;
  setFeedback("Signing in…");
  const { error } = await client.auth.signInWithPassword({
    email: document.getElementById("owner-email").value.trim(),
    password: document.getElementById("owner-password").value
  });
  document.getElementById("owner-password").value = "";
  button.disabled = false;
  if (error) { setFeedback("Sign in failed. Check the owner credentials and try again.", "error"); return; }
  await loadRequests();
});

requestBody.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const request = requestRows.find(item => item.request_id === button.dataset.requestId);
  if (!request) return;
  const transitions = {
    approve: { status: "approved", prompt: `Approve the request for ${request.full_name}?` },
    reject: { status: "rejected", prompt: `Reject the request for ${request.full_name}?` },
    revoke: { status: "revoked", prompt: `Revoke invitation access for ${request.full_name}?` },
    reopen: { status: "pending", prompt: `Return ${request.full_name}'s request to pending?` }
  };
  const transition = transitions[button.dataset.action];
  if (!transition || !window.confirm(transition.prompt)) return;
  button.disabled = true;
  try {
    const result = button.dataset.action === "approve"
      ? await approveRequest(request.request_id)
      : await updateStatus(request.request_id, transition.status);
    await loadRequests();
    if (result) setFeedback(result.message, result.state);
  } catch (_) {
    setFeedback("The action did not complete as expected. Refresh the list to check the current request status.", "error");
    await loadRequests();
  } finally { button.disabled = false; }
});

document.getElementById("owner-refresh").addEventListener("click", () => void loadRequests());
document.getElementById("owner-sign-out").addEventListener("click", async () => {
  await client.auth.signOut();
  requestRows = [];
  requestBody.replaceChildren();
  setSignedIn(false);
  setFeedback("You have signed out.", "info");
});
filter.addEventListener("change", renderRequests);

function initializeOwnerDashboard() {
  if (!window.supabase?.createClient) {
    setSignedIn(false);
    loginPanel.hidden = true;
    setFeedback("The owner sign-in service could not be loaded. Please refresh and try again.", "error");
    return;
  }
  client = window.supabase.createClient(ownerProjectUrl, ownerPublishableKey, { auth: { persistSession: true, autoRefreshToken: true } });
  client.auth.getSession().then(({ data, error }) => {
    if (error) { setSignedIn(false); setFeedback("Your owner session could not be checked. Please sign in again.", "error"); return; }
    if (data.session) void loadRequests();
    else { setSignedIn(false); setFeedback("Sign in with the authorized owner account to review requests."); }
  });
}

if (window.supabase?.createClient) initializeOwnerDashboard();
else window.addEventListener("load", initializeOwnerDashboard, { once: true });
