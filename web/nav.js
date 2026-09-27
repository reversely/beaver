// The site menu shared by the home page, the demo, and the app. The published site has no app
// behind it, so App, Rover, and any [data-site-local] element appear only on the laptop's server.
// <body data-site="online|local"> sets the mode; without it, 127.0.0.1 and localhost are local.
const LINKS = [
  { label: "Home", href: "/", current: (path) => path === "/" || path === "/index.html" },
  { label: "Demo", href: "/demo/", current: (path) => path.startsWith("/demo/") },
  { label: "App", href: "/app/", current: (path, hash) => path.startsWith("/app/") && hash !== "#rover", local: true },
  { label: "Rover", href: "/app/#rover", current: (path, hash) => path.startsWith("/app/") && hash === "#rover", local: true },
];

const LOCAL_HOSTS = ["127.0.0.1", "localhost"];

function build() {
  const online =
    (document.body.dataset.site || (LOCAL_HOSTS.includes(location.hostname) ? "local" : "online")) ===
    "online";
  document.querySelectorAll("[data-site-local]").forEach((element) => (element.hidden = online));
  const slot = document.querySelector("[data-site-nav]");
  const nav = document.createElement("nav");
  nav.className = slot ? "site-nav" : "site-nav is-floating";
  nav.setAttribute("aria-label", "Site");
  const list = document.createElement("ul");
  for (const link of LINKS) {
    if (link.local && online) continue;
    const item = document.createElement("li");
    const anchor = document.createElement("a");
    anchor.href = link.href;
    anchor.textContent = link.label;
    anchor.dataset.link = link.label;
    item.append(anchor);
    list.append(item);
  }
  nav.append(list);
  if (slot) slot.replaceChildren(nav);
  else document.body.prepend(nav);
  mark(nav);
  addEventListener("hashchange", () => mark(nav));
}

function mark(nav) {
  for (const anchor of nav.querySelectorAll("a")) {
    const link = LINKS.find((l) => l.label === anchor.dataset.link);
    if (link.current(location.pathname, location.hash)) anchor.setAttribute("aria-current", "page");
    else anchor.removeAttribute("aria-current");
  }
}

build();
