// Shows one view of the main column at a time, chosen by the URL hash, so every view can be
// linked and the back button moves between them.
//   #/overview (or no hash)  the overview of every topic
//   #/deadlines #/documents #/ask #/notebooks  one topic each
//   #/notebooks/<id>         one notebook
//   #rover                   the Rover panel; the site menu (/nav.js) links this exact hash
const views = new Map([...document.querySelectorAll("[data-route]")].map((v) => [v.dataset.route, v]));
const links = document.querySelectorAll("[data-route-link]");
const listeners = [];

export function parse(hash) {
  if (hash === "#rover") return { route: "rover" };
  const [route, id] = hash.replace(/^#\/?/, "").split("/");
  if (route === "notebooks" && id) return { route: "notebooks", id: decodeURIComponent(id) };
  return { route: views.has(route) ? route : "overview" };
}

// Calls fn({ route, id }) on every change of view, including the first.
export function onRoute(fn) {
  listeners.push(fn);
}

function show() {
  // An older notebook link, #notebook=<id>, becomes #/notebooks/<id>.
  const legacy = new URLSearchParams(location.hash.slice(1)).get("notebook");
  if (legacy) {
    history.replaceState(null, "", `#/notebooks/${encodeURIComponent(legacy)}`);
  }
  const state = parse(location.hash);
  for (const [route, view] of views) view.hidden = route !== state.route;
  for (const link of links) {
    if (link.dataset.routeLink === state.route) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  listeners.forEach((fn) => fn(state));
  return state;
}

export function start() {
  addEventListener("hashchange", () => {
    const state = show();
    // Move focus to the new view's heading so keyboard and screen reader users land in it.
    const heading = views.get(state.route).querySelector("h1, h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    scrollTo({ top: 0 });
  });
  show();
}

export function go(hash) {
  if (location.hash === hash) show();
  else location.hash = hash;
}
