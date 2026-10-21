// ===== COUNTDOWN =====
const weddingDate = new Date("December 22, 2026 09:00:00");
const daysEl = document.getElementById("days"), hoursEl = document.getElementById("hours"), minutesEl = document.getElementById("minutes"), secondsEl = document.getElementById("seconds");
function updateCountdown() {
  const left = weddingDate - new Date();
  if (left <= 0) { [daysEl, hoursEl, minutesEl, secondsEl].forEach(el => { if (el) el.textContent = "00"; }); return; }
  if (daysEl && hoursEl && minutesEl && secondsEl) {
    daysEl.textContent = Math.floor(left / 86400000); hoursEl.textContent = Math.floor(left / 3600000 % 24);
    minutesEl.textContent = Math.floor(left / 60000 % 60); secondsEl.textContent = Math.floor(left / 1000 % 60);
  }
}
if (daysEl) { updateCountdown(); setInterval(updateCountdown, 1000); }

const navToggle = document.querySelector(".nav-toggle"), navLinks = document.querySelector(".nav-links");
if (navToggle && navLinks) navToggle.addEventListener("click", () => {
  const open = navLinks.classList.toggle("active"); navToggle.setAttribute("aria-expanded", String(open));
});
const revealElements = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add("visible"); }), { threshold: 0.15 });
  revealElements.forEach(el => observer.observe(el));
} else revealElements.forEach(el => el.classList.add("visible"));

// Guest requests use a random bearer receipt. The database stores only its SHA-256 hash.
const projectUrl = "https://smzqxypdcwnbysvfqnke.supabase.co";
const publishableKey = "sb_publishable_Ts-waAnAAj-U2JwoiQXH1g_2XDugY-F";
const inviteLinks = document.querySelectorAll("[data-invite-link]");
const receiptPattern = /^[a-f0-9]{64}$/i;
let activeReceipt = null;
let invalidReceiptLink = false;
try {
  const fragmentParams = new URLSearchParams(location.hash.slice(1));
  const queryParams = new URLSearchParams(location.search);
  const hasFragmentReceipt = fragmentParams.has("receipt");
  const hasQueryReceipt = queryParams.has("receipt");
  const incomingReceipt = hasFragmentReceipt ? fragmentParams.get("receipt") : null;
  if (hasFragmentReceipt || hasQueryReceipt) {
    if (incomingReceipt && receiptPattern.test(incomingReceipt)) {
      activeReceipt = incomingReceipt;
      sessionStorage.setItem("weddingGuestReceipt", activeReceipt);
    } else {
      invalidReceiptLink = true;
      sessionStorage.removeItem("weddingGuestReceipt");
    }
    fragmentParams.delete("receipt");
    queryParams.delete("receipt");
    const cleanHash = fragmentParams.toString();
    const cleanQuery = queryParams.toString();
    history.replaceState(null, "", location.pathname + (cleanQuery ? "?" + cleanQuery : "") + (cleanHash ? "#" + cleanHash : ""));
  } else {
    const savedReceipt = sessionStorage.getItem("weddingGuestReceipt");
    if (savedReceipt && receiptPattern.test(savedReceipt)) activeReceipt = savedReceipt;
    else if (savedReceipt) sessionStorage.removeItem("weddingGuestReceipt");
  }
} catch (_) {
  activeReceipt = null;
  invalidReceiptLink = true;
}
const inviteStatus = document.getElementById("invite-access-status"), inviteHeader = document.getElementById("invite-header"), inviteContent = document.getElementById("invite-content");
let clientPromise;
function fetchWithTimeout(input, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const callerSignal = init.signal;
  const cancelFromCaller = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", cancelFromCaller, { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timeout);
    if (callerSignal) callerSignal.removeEventListener("abort", cancelFromCaller);
  });
}
function getClient() {
  if (!clientPromise) clientPromise = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, client) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error); else resolve(client);
    };
    const start = () => window.supabase?.createClient
      ? finish(null, window.supabase.createClient(projectUrl, publishableKey, { global: { fetch: fetchWithTimeout } }))
      : finish(new Error("Supabase client unavailable"));
    const timeout = setTimeout(() => finish(new Error("Supabase client loading timed out")), 12000);
    if (window.supabase?.createClient) start();
    else {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      script.onload = start;
      script.onerror = () => finish(new Error("Could not load the RSVP service"));
      document.head.appendChild(script);
    }
  });
  return clientPromise.catch(error => { clientPromise = null; throw error; });
}
function randomReceipt() {
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") {
    const error = new Error("Secure random number generation is unavailable");
    error.code = "SECURE_CRYPTO_UNAVAILABLE";
    throw error;
  }
  const bytes = new Uint8Array(32); globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
async function hashReceipt(receipt) {
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.subtle.digest !== "function" || typeof globalThis.TextEncoder !== "function") {
    const error = new Error("Secure receipt hashing is unavailable");
    error.code = "SECURE_CRYPTO_UNAVAILABLE";
    throw error;
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new globalThis.TextEncoder().encode(receipt));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
function showInvite(allowed, message, retryable = false) {
  inviteLinks.forEach(link => { link.hidden = !allowed; if (link.closest("li")) link.closest("li").hidden = !allowed; });
  if (inviteHeader) inviteHeader.hidden = !allowed;
  if (inviteContent) inviteContent.hidden = !allowed;
  if (!allowed && inviteContent) {
    ["invite-message", "invite-dresscode"].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ""; });
    const details = document.getElementById("invite-details"); if (details) details.replaceChildren();
    const image = document.getElementById("private-invite-image"); if (image) image.removeAttribute("src");
  }
  if (inviteStatus) { inviteStatus.hidden = allowed; inviteStatus.textContent = message || ""; }
  const retry = document.getElementById("invite-retry");
  if (retry) retry.hidden = allowed || !retryable;
}
function logInviteFailure(stage, error) {
  const diagnostic = { stage };
  if (typeof error?.code === "string" && /^[A-Z0-9]{4,8}$/.test(error.code)) diagnostic.code = error.code;
  const status = Number.isInteger(error?.httpStatus) ? error.httpStatus : error?.status;
  if (Number.isInteger(status)) diagnostic.httpStatus = status;
  if (typeof error?.name === "string") diagnostic.errorType = error.name;
  console.error("Private invitation access failed", diagnostic);
}
async function checkRequest(client, receipt) {
  if (!receiptPattern.test(receipt)) throw new Error("This return link is not valid.");
  const { data, error } = await client.rpc("check_guest_request", { p_receipt_hash: await hashReceipt(receipt) });
  if (error) throw error;
  return data;
}
async function updateReceiptStatus() {
  const section = document.getElementById("receipt-status"), message = document.getElementById("receipt-message"), approvedLink = document.getElementById("approved-invite-link");
  if (!section) return;
  if (invalidReceiptLink) { section.hidden = false; message.textContent = "This private return link is invalid. Please use the link you saved after submitting your request."; return; }
  const receipt = activeReceipt;
  if (!receipt) return;
  section.hidden = false; message.textContent = "Checking your request status…";
  try {
    const status = await checkRequest(await getClient(), receipt);
    if (status === "approved") { message.textContent = "Your request has been approved. Your invitation is ready."; approvedLink.href = "invite.html"; approvedLink.hidden = false; }
    else if (status === "pending") message.textContent = "Your request has been received and is awaiting approval. Please keep this private link and return to check again.";
    else message.textContent = "This request has not been approved. Please contact the couple if you believe this is an error.";
  } catch (error) { logInviteFailure("check_request_status", error); message.textContent = "We couldn't check this return link. Please try again later."; }
}
async function loadInvitation() {
  if (!inviteContent) return;
  showInvite(false, "Checking invitation access…");
  if (invalidReceiptLink) { showInvite(false, "This private return link is invalid. Invitation access is unavailable."); return; }
  const receipt = activeReceipt;
  if (!receipt) { showInvite(false, "Use your private RSVP return link to check approval and view the invitation."); return; }
  let failureStage = "check_request_status";
  try {
    const status = await checkRequest(await getClient(), receipt);
    if (status !== "approved") { showInvite(false, status === "pending" ? "Your request is awaiting approval. Invitation access will be available if approved." : "Invitation access is not available for this request."); return; }
    const receiptHash = await hashReceipt(receipt);
    failureStage = "fetch_invitation_content";
    const response = await fetchWithTimeout(projectUrl + "/functions/v1/protected-invite", { headers: { apikey: publishableKey, Authorization: "Bearer " + receiptHash } });
    if (!response.ok) { const error = new Error("Invitation content request failed"); error.httpStatus = response.status; throw error; }
    const payload = await response.json();
    document.getElementById("invite-message").textContent = payload.message;
    const details = document.getElementById("invite-details"); details.replaceChildren();
    payload.details.forEach((line, i) => { if (i) details.appendChild(document.createElement("br")); if (line) details.appendChild(document.createTextNode(line)); });
    document.getElementById("invite-dresscode").textContent = payload.dressCode;
    failureStage = "fetch_invitation_image";
    const imageResponse = await fetchWithTimeout(projectUrl + "/functions/v1/protected-invite?asset=invite.png", { headers: { apikey: publishableKey, Authorization: "Bearer " + receiptHash } });
    if (!imageResponse.ok) { const error = new Error("Invitation image request failed"); error.httpStatus = imageResponse.status; throw error; }
    document.getElementById("private-invite-image").src = URL.createObjectURL(await imageResponse.blob());
    showInvite(true, "");
  } catch (error) { logInviteFailure(failureStage, error); showInvite(false, "We couldn't verify invitation access just now. Check your connection and try again.", true); }
}
async function updateInviteNavigation() {
  if (!inviteLinks.length || inviteContent) return;
  inviteLinks.forEach(link => { link.hidden = true; if (link.closest("li")) link.closest("li").hidden = true; });
  if (invalidReceiptLink || !activeReceipt) return;
  try {
    const status = await checkRequest(await getClient(), activeReceipt);
    const allowed = status === "approved";
    inviteLinks.forEach(link => { link.hidden = !allowed; if (link.closest("li")) link.closest("li").hidden = !allowed; });
  } catch (error) {
    logInviteFailure("check_invite_navigation_eligibility", error);
  }
}
const inviteRetry = document.getElementById("invite-retry");
if (inviteRetry) inviteRetry.addEventListener("click", () => void loadInvitation());

const form = document.getElementById("rsvp-form"), statusEl = document.getElementById("rsvp-status");
if (form && statusEl) {
  const count = document.getElementById("guest-count"), countWrap = document.getElementById("guest-count-wrap"), secondWrap = document.getElementById("second-guest-wrap"), secondGuest = document.getElementById("second-guest"), thirdWrap = document.getElementById("third-guest-wrap"), thirdGuest = document.getElementById("third-guest");
  let isSubmitting = false;
  const updateFields = () => {
    const attending = form.querySelector('input[name="attending"]:checked')?.value === "yes";
    countWrap.hidden = !attending; count.disabled = !attending;
    const partySize = Number(count.value);
    secondWrap.hidden = !attending || partySize < 2; secondGuest.required = !secondWrap.hidden; secondGuest.disabled = secondWrap.hidden;
    thirdWrap.hidden = !attending || partySize < 3; thirdGuest.required = !thirdWrap.hidden; thirdGuest.disabled = thirdWrap.hidden;
    if (secondWrap.hidden) secondGuest.value = "";
    if (thirdWrap.hidden) thirdGuest.value = "";
  };
  form.querySelectorAll('input[name="attending"]').forEach(input => input.addEventListener("change", updateFields)); count.addEventListener("change", updateFields); updateFields();
  if (activeReceipt || invalidReceiptLink) form.hidden = true;
  else statusEl.textContent = "Your request will be reviewed by the couple. Submission does not grant invitation access.";
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (isSubmitting) return;
    form.querySelectorAll("[aria-invalid='true']").forEach(el => { el.removeAttribute("aria-invalid"); });
    if (!form.reportValidity()) { const invalid = form.querySelector(":invalid"); if (invalid) { invalid.setAttribute("aria-invalid", "true"); invalid.focus(); } statusEl.textContent = "Please check the highlighted fields and try again."; statusEl.dataset.state = "error"; return; }
    const button = document.getElementById("rsvp-submit"), data = new FormData(form), attending = data.get("attending") === "yes";
    isSubmitting = true; button.disabled = true; button.textContent = "Submitting…"; statusEl.textContent = "Sending your request securely…"; statusEl.dataset.state = "info";
    let failureStage = "prepare";
    let failureOperation = "create_receipt";
    try {
      const returnReceipt = randomReceipt();
      failureOperation = "hash_receipt";
      const receiptHash = await hashReceipt(returnReceipt);
      failureStage = "connect";
      failureOperation = "load_supabase_client";
      const db = await getClient();
      failureStage = "submit_guest_request";
      failureOperation = "rpc_call";
      const response = await db.rpc("submit_guest_request", {
        p_full_name: String(data.get("fullName")).trim(), p_email: String(data.get("email")).trim(), p_phone: String(data.get("phone")).trim(),
        p_attending: attending,
        p_second_guest_name: attending && Number(count.value) >= 2 ? String(data.get("secondGuest")).trim() : null,
        p_third_guest_name: attending && Number(count.value) === 3 ? String(data.get("thirdGuest")).trim() : null,
        p_receipt_hash: receiptHash
      });
      if (response.error) throw response.error;
      failureStage = "show_confirmation";
      failureOperation = "render_confirmation";
      const link = new URL("rsvp.html", location.href); link.hash = "receipt=" + returnReceipt;
      form.hidden = true; statusEl.dataset.state = "success";
      statusEl.textContent = "Your request has been received and is awaiting approval. Save the private return link below to check its status later.";
      const section = document.getElementById("receipt-status"); section.hidden = false;
      document.getElementById("receipt-message").textContent = "Pending approval. Keep your return link safe. Anyone with it can access this request.";
      const returnLink = document.createElement("a"); returnLink.href = link.href; returnLink.textContent = "View Your Invitation"; returnLink.className = "btn btn-primary private-return-link"; section.appendChild(returnLink);
    } catch (error) {
      const diagnostic = { stage: failureStage, operation: failureOperation };
      if (typeof error?.code === "string" && /^[A-Z0-9]{4,8}$/.test(error.code)) diagnostic.code = error.code;
      if (Number.isInteger(error?.status)) diagnostic.httpStatus = error.status;
      if (typeof error?.name === "string") diagnostic.errorType = error.name;
      if (failureStage === "prepare") {
        diagnostic.secureContext = window.isSecureContext === true;
        diagnostic.webCryptoAvailable = Boolean(globalThis.crypto?.getRandomValues && globalThis.crypto?.subtle?.digest && globalThis.TextEncoder);
      }
      console.error("RSVP submission failed", diagnostic);
      statusEl.dataset.state = "error";
      if (error?.code === "SECURE_CRYPTO_UNAVAILABLE") {
        statusEl.textContent = "Your browser needs a secure connection to submit this request. Please open this page using its HTTPS address and try again; your details are still here.";
      } else if (error?.code === "PGRST202" || error?.code === "42883") {
        statusEl.textContent = "The RSVP service needs an update before it can accept requests. Your details are still here; please try again later.";
      } else if (error?.code === "22023" || error?.code === "23514") {
        statusEl.textContent = "Some details could not be accepted. Please review the form and try again; your details are still here.";
      } else {
        statusEl.textContent = "We couldn't submit your request just now. Please check your connection and try again; your details are still here.";
      }
    }
    finally { isSubmitting = false; button.disabled = false; button.textContent = "Submit RSVP"; }
  });
}

const copyAccount = document.getElementById("copy-account-number");
if (copyAccount) copyAccount.addEventListener("click", async () => {
  const feedback = document.getElementById("copy-feedback");
  try { await navigator.clipboard.writeText("6510147606"); feedback.textContent = "Account number copied."; }
  catch (_) { feedback.textContent = "Copy failed. Please select the account number manually."; }
});
updateReceiptStatus(); loadInvitation(); updateInviteNavigation();
