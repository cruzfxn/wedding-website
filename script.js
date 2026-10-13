// ===== COUNTDOWN TIMER =====

const weddingDate = new Date("December 20, 2026 09:00:00");
const daysEl = document.getElementById("days");
const hoursEl = document.getElementById("hours");
const minutesEl = document.getElementById("minutes");
const secondsEl = document.getElementById("seconds");

function updateCountdown() {
  const timeLeft = weddingDate - new Date();

  if (timeLeft <= 0) {
    daysEl.textContent = "00";
    hoursEl.textContent = "00";
    minutesEl.textContent = "00";
    secondsEl.textContent = "00";
    return;
  }

  daysEl.textContent = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
  hoursEl.textContent = Math.floor((timeLeft / (1000 * 60 * 60)) % 24);
  minutesEl.textContent = Math.floor((timeLeft / (1000 * 60)) % 60);
  secondsEl.textContent = Math.floor((timeLeft / 1000) % 60);
}

if (daysEl && hoursEl && minutesEl && secondsEl) {
  updateCountdown();
  setInterval(updateCountdown, 1000);
}

// ===== MOBILE NAV TOGGLE =====

const navToggle = document.querySelector(".nav-toggle");
const navLinks = document.querySelector(".nav-links");

if (navToggle && navLinks) {
  navToggle.addEventListener("click", function () {
    navLinks.classList.toggle("active");
  });
}

// ===== SCROLL REVEAL =====

const revealElements = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) entry.target.classList.add("visible");
    });
  }, { threshold: 0.15 });

  revealElements.forEach(function (element) {
    revealObserver.observe(element);
  });
} else {
  revealElements.forEach(function (element) {
    element.classList.add("visible");
  });
}

// ===== SUPABASE AUTH AND RSVP =====

const supabaseProjectUrl = "https://smzqxypdcwnbysvfqnke.supabase.co";
const supabaseConfig = {
  // This browser key is public by design; never put a service-role key here.
  publishableKey: "sb_publishable_Ts-waAnAAj-U2JwoiQXH1g_2XDugY-F"
};

const inviteLinks = document.querySelectorAll("[data-invite-link]");
const inviteAccessStatus = document.getElementById("invite-access-status");
const inviteHeader = document.getElementById("invite-header");
const inviteContent = document.getElementById("invite-content");
let supabaseClient = null;
let supabaseClientPromise = null;
let inviteCheckSequence = 0;
let resetRsvpSession = null;

function getSupabaseClient() {
  if (supabaseClient) return Promise.resolve(supabaseClient);
  if (supabaseClientPromise) return supabaseClientPromise;

  supabaseClientPromise = new Promise(function (resolve, reject) {
    function initializeClient() {
      if (!window.supabase || typeof window.supabase.createClient !== "function") {
        reject(new Error("The Supabase client could not be loaded."));
        return;
      }
      supabaseClient = window.supabase.createClient(supabaseProjectUrl, supabaseConfig.publishableKey);
      resolve(supabaseClient);
    }

    if (window.supabase && typeof window.supabase.createClient === "function") {
      initializeClient();
      return;
    }

    const library = document.createElement("script");
    library.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    library.async = true;
    library.onload = initializeClient;
    library.onerror = function () { reject(new Error("The Supabase client could not be loaded.")); };
    document.head.appendChild(library);
  });

  return supabaseClientPromise;
}

function setInviteAccess(allowed, message) {
  inviteLinks.forEach(function (link) {
    link.hidden = !allowed;
    const navigationItem = link.closest("li");
    if (navigationItem) navigationItem.hidden = !allowed;
  });
  if (inviteHeader) inviteHeader.hidden = !allowed;
  if (inviteContent) inviteContent.hidden = !allowed;
  if (!allowed && inviteContent) {
    document.getElementById("invite-message").textContent = "";
    document.getElementById("invite-details").replaceChildren();
    document.getElementById("invite-dresscode").textContent = "";
    const image = document.getElementById("private-invite-image");
    if (image.dataset.objectUrl) URL.revokeObjectURL(image.dataset.objectUrl);
    image.removeAttribute("src");
    delete image.dataset.objectUrl;
  }
  if (inviteAccessStatus) {
    inviteAccessStatus.hidden = allowed;
    inviteAccessStatus.textContent = message || "";
  }
}

async function loadProtectedInvite(client, sequence) {
  if (!inviteContent) return true;

  const inviteResult = await client.functions.invoke("protected-invite");
  if (sequence !== inviteCheckSequence) return false;
  if (inviteResult.error || !inviteResult.data) return false;

  const data = inviteResult.data;
  document.getElementById("invite-message").textContent = data.message;
  const details = document.getElementById("invite-details");
  details.replaceChildren();
  data.details.forEach(function (line, index) {
    if (index > 0) details.appendChild(document.createElement("br"));
    if (line) details.appendChild(document.createTextNode(line));
  });
  document.getElementById("invite-dresscode").textContent = data.dressCode;

  const sessionResult = await client.auth.getSession();
  if (sequence !== inviteCheckSequence || sessionResult.error || !sessionResult.data.session) return false;
  const imageResponse = await fetch(supabaseProjectUrl + "/functions/v1/protected-invite?asset=invite.png", {
    headers: {
      apikey: supabaseConfig.publishableKey,
      Authorization: "Bearer " + sessionResult.data.session.access_token
    }
  });
  if (sequence !== inviteCheckSequence || !imageResponse.ok) return false;

  const imageUrl = URL.createObjectURL(await imageResponse.blob());
  const image = document.getElementById("private-invite-image");
  if (image.dataset.objectUrl) URL.revokeObjectURL(image.dataset.objectUrl);
  image.src = imageUrl;
  image.dataset.objectUrl = imageUrl;
  return true;
}

async function refreshInviteAccess(session) {
  const sequence = ++inviteCheckSequence;
  setInviteAccess(false, inviteAccessStatus ? "Checking invitation access..." : "");
  if (!inviteLinks.length && !inviteContent) return;
  if (!session) {
    setInviteAccess(false, inviteAccessStatus ? "Sign in with an approved guest account to view the invitation." : "");
    return;
  }

  let client;
  try {
    client = await getSupabaseClient();
    const userResult = await client.auth.getUser(session.access_token);
    if (sequence !== inviteCheckSequence) return;
    if (userResult.error || !userResult.data.user) {
      setInviteAccess(false, "Your session could not be verified. Please sign in again.");
      return;
    }

    const profileResult = await client
      .from("registration_profiles")
      .select("eligibility_status")
      .eq("user_id", userResult.data.user.id)
      .maybeSingle();
    if (sequence !== inviteCheckSequence) return;
    if (profileResult.error) {
      setInviteAccess(false, "Invitation access could not be verified. Please try again later.");
      return;
    }
    if (profileResult.data?.eligibility_status !== "eligible") {
      const stateMessage = profileResult.data?.eligibility_status === "pending"
        ? "Your registration is awaiting approval. The invitation will be available after approval."
        : "Invitation access is available only to guests with an approved registration.";
      setInviteAccess(false, stateMessage);
      return;
    }

    if (inviteContent && !await loadProtectedInvite(client, sequence)) {
      if (sequence === inviteCheckSequence) {
        setInviteAccess(false, "The invitation could not be loaded. Please try again later.");
      }
      return;
    }
    if (sequence === inviteCheckSequence) setInviteAccess(true, "");
  } catch (_error) {
    if (sequence === inviteCheckSequence) {
      setInviteAccess(false, "Invitation access could not be verified. Check your connection and try again.");
    }
  }
}

// Start hidden before any saved session or profile request is checked.
setInviteAccess(false, inviteAccessStatus ? "Checking invitation access..." : "");

const rsvpStatus = document.getElementById("rsvp-status");
if (rsvpStatus) {
  const authSection = document.getElementById("auth-section");
  const profileSection = document.getElementById("profile-section");
  const guestSection = document.getElementById("guest-section");
  const authForm = document.getElementById("auth-form");
  const profileForm = document.getElementById("profile-form");
  const rsvpForm = document.getElementById("rsvp-form");
  const authFullName = document.getElementById("auth-full-name");
  const profileFullName = document.getElementById("profile-full-name");
  const fullNameLabel = document.getElementById("full-name-label");
  const authPassword = document.getElementById("auth-password");
  const authSubmit = document.getElementById("auth-submit");
  const guestEmail = document.getElementById("guest-email");
  const eligibilityStatus = document.getElementById("eligibility-status");
  const previousRsvp = document.getElementById("previous-rsvp");
  const showSignin = document.getElementById("show-signin");
  const showSignup = document.getElementById("show-signup");
  let currentUser = null;
  let authMode = "signin";
  let isBusy = false;
  let refreshSequence = 0;

  function setMessage(message, type) {
    rsvpStatus.textContent = message;
    rsvpStatus.dataset.state = type || "info";
  }

  function setBusy(busy) {
    isBusy = busy;
    document.querySelectorAll(".rsvp-form button, .auth-mode-button, #signout-button").forEach(function (button) {
      button.disabled = busy;
    });
    if (authSubmit) authSubmit.textContent = busy ? "Please wait..." : (authMode === "signup" ? "Create account" : "Sign in");
  }

  function setAuthMode(mode) {
    authMode = mode;
    const isSignup = mode === "signup";
    authFullName.hidden = !isSignup;
    fullNameLabel.hidden = !isSignup;
    authFullName.required = isSignup;
    authPassword.autocomplete = isSignup ? "new-password" : "current-password";
    showSignin.classList.toggle("is-active", !isSignup);
    showSignup.classList.toggle("is-active", isSignup);
    showSignin.setAttribute("aria-pressed", String(!isSignup));
    showSignup.setAttribute("aria-pressed", String(isSignup));
    authSubmit.textContent = isSignup ? "Create account" : "Sign in";
  }

  function showSignedOut() {
    currentUser = null;
    authSection.hidden = false;
    profileSection.hidden = true;
    guestSection.hidden = true;
    setAuthMode("signin");
  }
  resetRsvpSession = showSignedOut;

  function explainError(error) {
    const message = error && typeof error.message === "string" ? error.message.toLowerCase() : "";
    if (message.includes("already registered") || message.includes("already exists")) {
      return "An account with this email may already exist. Try signing in instead.";
    }
    if (message.includes("invalid login") || message.includes("invalid email or password")) {
      return "Email or password was not recognized. Check your details and try again.";
    }
    if (message.includes("email not confirmed") || message.includes("email confirmation")) {
      return "Please confirm your email using the link we sent, then sign in.";
    }
    if (message.includes("password") && (message.includes("length") || message.includes("least"))) {
      return "Choose a password that meets the minimum length shown in the form.";
    }
    if (message.includes("verified email required")) {
      return "Email confirmation is required before you can submit an RSVP. Check your inbox, confirm your email, and sign in again.";
    }
    if (message.includes("eligible registration required") || message.includes("administrator approval required")) {
      return "Your registration is not approved for RSVP access yet. Please contact the couple if you think this is a mistake.";
    }
    if (message.includes("failed to fetch") || message.includes("network")) {
      return "We couldn't reach Supabase. Check your connection and project settings, then try again.";
    }
    return "We couldn't complete that request. Please try again in a moment.";
  }

  async function loadGuestData() {
    const sequence = ++refreshSequence;
    const authResult = await supabaseClient.auth.getUser();
    if (sequence !== refreshSequence) return;
    if (authResult.error) {
      showSignedOut();
      setMessage(explainError(authResult.error), "error");
      return;
    }
    if (!authResult.data.user) {
      showSignedOut();
      setMessage("Your sign-in session has expired. Please sign in again.", "error");
      return;
    }

    currentUser = authResult.data.user;
    authSection.hidden = true;
    guestSection.hidden = false;
    profileSection.hidden = true;
    guestEmail.textContent = currentUser.email || "Signed in";
    rsvpForm.hidden = true;
    setMessage("Loading your registration and RSVP...", "info");

    const profileResult = await supabaseClient
      .from("registration_profiles")
      .select("user_id, full_name, eligibility_status")
      .eq("user_id", currentUser.id)
      .maybeSingle();
    if (sequence !== refreshSequence) return;
    if (profileResult.error) {
      setMessage("We couldn't load your registration. Please try refreshing or sign in again.", "error");
      return;
    }

    let profile = profileResult.data;
    if (!profile) {
      const metadataName = currentUser.user_metadata && currentUser.user_metadata.full_name;
      if (typeof metadataName === "string" && metadataName.trim()) {
        const createResult = await supabaseClient
          .from("registration_profiles")
          .insert({ user_id: currentUser.id, full_name: metadataName.trim() })
          .select("user_id, full_name, eligibility_status")
          .single();
        if (sequence !== refreshSequence) return;
        if (createResult.error) {
          // A retry or second tab may have created the row between the read and insert.
          const retryResult = await supabaseClient
            .from("registration_profiles")
            .select("user_id, full_name, eligibility_status")
            .eq("user_id", currentUser.id)
            .maybeSingle();
          if (sequence !== refreshSequence) return;
          if (retryResult.error || !retryResult.data) {
            setMessage(explainError(createResult.error), "error");
            return;
          }
          profile = retryResult.data;
        } else {
          profile = createResult.data;
        }
      } else {
        authSection.hidden = true;
        guestSection.hidden = true;
        profileSection.hidden = false;
        profileFullName.value = "";
        setMessage("Your account is signed in. Add your full name to finish creating your pending registration.", "info");
        return;
      }
    }

    if (profile.eligibility_status === "pending") {
      eligibilityStatus.textContent = "Your registration is awaiting administrator approval. You can sign in again later to check its status.";
      eligibilityStatus.dataset.state = "pending";
    } else if (profile.eligibility_status === "eligible") {
      eligibilityStatus.textContent = "Your registration is approved.";
      eligibilityStatus.dataset.state = "eligible";
    } else {
      eligibilityStatus.textContent = "This registration is not eligible for RSVP access. Please contact the couple if you think this is a mistake.";
      eligibilityStatus.dataset.state = "revoked";
    }

    const emailConfirmed = Boolean(currentUser.email_confirmed_at || currentUser.confirmed_at);
    if (!emailConfirmed) {
      const approvalMessage = profile.eligibility_status === "pending"
        ? " Your registration is also awaiting administrator approval."
        : profile.eligibility_status === "eligible"
          ? " Your registration is approved."
          : " This registration is not eligible for RSVP access.";
      eligibilityStatus.textContent = "Email confirmation is required. Check your inbox for the confirmation link, then sign in again." + approvalMessage;
      eligibilityStatus.dataset.state = "pending";
    }

    const rsvpResult = await supabaseClient
      .from("rsvps")
      .select("attending, attendee_count, notes, updated_at")
      .eq("user_id", currentUser.id)
      .maybeSingle();
    if (sequence !== refreshSequence) return;
    if (rsvpResult.error) {
      previousRsvp.textContent = "We couldn't load your saved RSVP.";
      setMessage("Your registration loaded, but your RSVP could not be loaded. Please try again.", "error");
      return;
    }

    if (rsvpResult.data) {
      previousRsvp.textContent = rsvpResult.data.attending
        ? "RSVP submitted: joyfully accepts (1 attendee)."
        : "RSVP submitted: regretfully declines.";
      const response = rsvpForm.querySelector('input[name="attending"][value="' + (rsvpResult.data.attending ? "yes" : "no") + '"]');
      if (response) response.checked = true;
      document.getElementById("rsvp-notes").value = rsvpResult.data.notes || "";
    } else {
      previousRsvp.textContent = "No RSVP has been submitted yet.";
    }

    const canRsvp = emailConfirmed && profile.eligibility_status === "eligible";
    rsvpForm.hidden = !canRsvp;
    setMessage(canRsvp ? "Your registration is approved. You can submit or update your RSVP below." : eligibilityStatus.textContent, canRsvp ? "success" : "info");
  }

  async function runRequest(action) {
    if (isBusy) return;
    setBusy(true);
    try {
      if (!supabaseClient) supabaseClient = await getSupabaseClient();
      await action();
    } catch (error) {
      setMessage(explainError(error), "error");
    } finally {
      setBusy(false);
    }
  }

  showSignin.addEventListener("click", function () { setAuthMode("signin"); });
  showSignup.addEventListener("click", function () { setAuthMode("signup"); });

  authForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!authForm.reportValidity()) return;
    runRequest(async function () {
      const formData = new FormData(authForm);
      const email = String(formData.get("email") || "").trim();
      const password = String(formData.get("password") || "");
      if (authMode === "signup") {
        const fullName = String(formData.get("fullName") || "").trim();
        if (!fullName || fullName.length > 120) {
          setMessage("Enter a full name between 1 and 120 characters.", "error");
          return;
        }
        const result = await supabaseClient.auth.signUp({
          email: email,
          password: password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: window.location.origin + window.location.pathname
          }
        });
        if (result.error) throw result.error;
        if (result.data.session) {
          setMessage("Account created. Loading your registration...", "success");
          await loadGuestData();
        } else {
          setMessage("Registration started. Check your email and confirm your address, then return here and sign in. Your pending profile will be created after you sign in.", "success");
          authForm.reset();
          setAuthMode("signin");
        }
      } else {
        const result = await supabaseClient.auth.signInWithPassword({ email: email, password: password });
        if (result.error) throw result.error;
        authPassword.value = "";
        await loadGuestData();
      }
    });
  });

  profileForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!profileForm.reportValidity() || !currentUser) return;
    runRequest(async function () {
      const fullName = String(new FormData(profileForm).get("fullName") || "").trim();
      if (!fullName || fullName.length > 120) {
        setMessage("Enter a full name between 1 and 120 characters.", "error");
        return;
      }
      const result = await supabaseClient
        .from("registration_profiles")
        .insert({ user_id: currentUser.id, full_name: fullName })
        .select("user_id, full_name, eligibility_status")
        .single();
      if (result.error) throw result.error;
      setMessage("Your registration is saved and awaiting administrator approval.", "success");
      await loadGuestData();
    });
  });

  rsvpForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!rsvpForm.reportValidity() || !currentUser) return;
    runRequest(async function () {
      const formData = new FormData(rsvpForm);
      const attending = formData.get("attending") === "yes";
      const notes = String(formData.get("notes") || "").trim();
      const result = await supabaseClient.rpc("save_my_rsvp", {
        p_attending: attending,
        p_attendee_count: attending ? 1 : 0,
        p_notes: notes || null
      });
      if (result.error) throw result.error;
      previousRsvp.textContent = attending
        ? "RSVP submitted: joyfully accepts (1 attendee)."
        : "RSVP submitted: regretfully declines.";
      setMessage("Thank you. Your RSVP has been submitted successfully.", "success");
    });
  });

  document.getElementById("signout-button").addEventListener("click", function () {
    runRequest(async function () {
      const result = await supabaseClient.auth.signOut();
      if (result.error) throw result.error;
      refreshSequence++;
      showSignedOut();
      setMessage("You have been signed out.", "success");
    });
  });

}

if (inviteLinks.length || inviteContent || rsvpStatus) {
  if (!supabaseProjectUrl || !supabaseConfig.publishableKey || supabaseConfig.publishableKey === "YOUR_SUPABASE_PUBLISHABLE_KEY") {
    setInviteAccess(false, "Supabase is not configured. Invitation access is unavailable.");
    if (rsvpStatus) {
      showSignedOut();
      setMessage("Add your Supabase project URL and publishable key in script.js to enable registration and RSVP.", "error");
    }
  } else {
    getSupabaseClient().then(function (client) {
      client.auth.onAuthStateChange(function (event, session) {
        if (event === "SIGNED_OUT") {
          refreshSequence++;
          showSignedOutIfNeeded();
          refreshInviteAccess(null);
          if (rsvpStatus) setMessage("You have been signed out.", "info");
        } else if (session && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED")) {
          window.setTimeout(function () {
            refreshInviteAccess(session);
            if (rsvpStatus) loadGuestData().catch(function (error) { setMessage(explainError(error), "error"); });
          }, 0);
        }
      });

      return client.auth.getSession().then(function (result) {
        if (result.error) throw result.error;
        refreshInviteAccess(result.data.session);
        if (rsvpStatus) {
          if (result.data.session) return loadGuestData();
          showSignedOut();
          setMessage("Sign in to check your registration and RSVP, or create an account to register.", "info");
        }
      });
    }).catch(function (error) {
      setInviteAccess(false, "Invitation access could not be verified. Check your connection and try again.");
      if (rsvpStatus) {
        showSignedOut();
        setMessage(explainError(error), "error");
      }
    });
  }
}

function showSignedOutIfNeeded() {
  if (resetRsvpSession) resetRsvpSession();
}

window.addEventListener("focus", function () {
  if (inviteLinks.length || inviteContent) {
    getSupabaseClient().then(function (client) {
      return client.auth.getSession().then(function (result) {
        if (!result.error) refreshInviteAccess(result.data.session);
      });
    }).catch(function () {
      setInviteAccess(false, "Invitation access could not be verified. Check your connection and try again.");
    });
  }
});
