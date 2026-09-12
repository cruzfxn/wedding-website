// ===== COUNTDOWN TIMER =====

// 1. Set the target date/time we're counting down to
const weddingDate = new Date("December 20, 2026 09:00:00");

// 2. Grab references to the HTML elements we need to update
const daysEl = document.getElementById("days");
const hoursEl = document.getElementById("hours");
const minutesEl = document.getElementById("minutes");
const secondsEl = document.getElementById("seconds");

// 3. This function runs the calculation and updates the page
function updateCountdown() {
  const now = new Date();                     // current date/time, right now
  const timeLeft = weddingDate - now;          // difference, in milliseconds

  // If the wedding date has already passed, stop and show zeros
  if (timeLeft <= 0) {
    daysEl.textContent = "00";
    hoursEl.textContent = "00";
    minutesEl.textContent = "00";
    secondsEl.textContent = "00";
    return; // exit the function early, don't run the math below
  }

  // 4. Convert milliseconds into days, hours, minutes, seconds
  const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
  const hours = Math.floor((timeLeft / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((timeLeft / (1000 * 60)) % 60);
  const seconds = Math.floor((timeLeft / 1000) % 60);

  // 5. Update the page with the new numbers
  daysEl.textContent = days;
  hoursEl.textContent = hours;
  minutesEl.textContent = minutes;
  secondsEl.textContent = seconds;
}

// 6. Run the countdown only on the home page, where its elements exist.
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

// 1. Get every element marked with the "reveal" class
const revealElements = document.querySelectorAll(".reveal");

// 2. Create an "observer" that watches elements and tells us when they enter the screen
const revealObserver = new IntersectionObserver(function (entries) {
  entries.forEach(function (entry) {
    if (entry.isIntersecting) {
      entry.target.classList.add("visible");
    }
  });
}, {
  threshold: 0.15 // trigger once 15% of the element is visible on screen
});

// 3. Tell the observer to start watching each reveal element
revealElements.forEach(function (element) {
  revealObserver.observe(element);
});
