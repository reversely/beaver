// The Rover view: start and stop the rover's phone page on the Pi and show its address. The
// overview's Rover tile repeats the view's status line.
const status = document.getElementById("rover-status");
const tileStatus = document.getElementById("overview-rover");
const link = document.getElementById("rover-link");
const qr = document.getElementById("rover-qr");
const address = document.getElementById("rover-address");
const toggle = document.getElementById("rover-toggle");

const MESSAGES = {
  stopped: "The phone page is off",
  starting: "Starting the phone page",
  running: "Scan with the phone's camera",
  unreachable: "The rover is off or out of reach",
};
let polling = null;

function show(state) {
  status.classList.remove("is-error");
  status.textContent = MESSAGES[state.state];
  // The server reports an error only when the phone page exited on its own with a failure, and a
  // note when the rover restarted under it.
  if (state.error) {
    status.textContent = `The phone page stopped: ${state.error}`;
    status.classList.add("is-error");
  } else if (state.note) {
    status.textContent = state.note;
  }
  mirror();
  link.hidden = state.state !== "running";
  if (state.state === "running") {
    // The SVG is built by segno on this laptop from the rover's address, not from page input.
    qr.innerHTML = state.qr_svg;
    address.href = state.address;
  } else {
    qr.replaceChildren();
    address.removeAttribute("href");
  }
  toggle.hidden = state.state === "unreachable";
  toggle.disabled = false;
  toggle.textContent = state.state === "stopped" ? "Start" : "Stop";
  toggle.dataset.action = state.state === "stopped" ? "start" : "stop";
  clearTimeout(polling);
  if (state.state === "starting") polling = setTimeout(refresh, 2000);
  if (state.state === "unreachable") polling = setTimeout(refresh, 15000);
}

function mirror() {
  tileStatus.textContent = status.textContent;
  tileStatus.classList.toggle("is-error", status.classList.contains("is-error"));
}

function fail(message) {
  status.textContent = message;
  status.classList.add("is-error");
  mirror();
  toggle.hidden = false;
  toggle.disabled = false;
}

async function call(path, method = "GET") {
  const response = await fetch(path, { method, headers: method === "POST" ? { "X-Beaver": "1" } : {} });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `rover request failed (${response.status})`);
  return body;
}

async function refresh() {
  try {
    show(await call("/api/rover"));
  } catch (error) {
    fail(error.message);
  }
}

toggle.addEventListener("click", async () => {
  toggle.disabled = true;
  status.classList.remove("is-error");
  status.textContent = toggle.dataset.action === "start" ? MESSAGES.starting : "Stopping the phone page";
  try {
    show(await call(`/api/rover/${toggle.dataset.action}`, "POST"));
  } catch (error) {
    fail(error.message);
  }
});

refresh();
