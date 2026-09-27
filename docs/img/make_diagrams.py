"""Draw the two diagrams in docs/how-it-works.md as SVG files next to this script.

Run: python3 docs/img/make_diagrams.py

Boxes sit on a fixed grid so edits stay aligned. Icons are Tabler Icons 3.48.0 (outline set),
MIT License, Copyright (c) 2020-2026 Pawel Kuna, https://tabler.io/icons; their path data is
copied below so rendering needs no network.
"""

from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).parent
INK = "#1f2328"
MUTED = "#59636e"
FILL = "#e8f1fb"
FONT = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"

ICONS = {
    "device-mobile": '<path d="M6 5a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2v-14" /> <path d="M11 4h2" /> <path d="M12 17v.01" />',
    "robot": '<path d="M6 6a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2l0 -4" /> <path d="M12 2v2" /> <path d="M9 12v9" /> <path d="M15 12v9" /> <path d="M5 16l4 -2" /> <path d="M15 14l4 2" /> <path d="M9 18h6" /> <path d="M10 8v.01" /> <path d="M14 8v.01" />',
    "sparkles": '<path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6" />',
    "speakerphone": '<path d="M18 8a3 3 0 0 1 0 6" /> <path d="M10 8v11a1 1 0 0 1 -1 1h-1a1 1 0 0 1 -1 -1v-5" /> <path d="M12 8l4.524 -3.77a.9 .9 0 0 1 1.476 .692v12.156a.9 .9 0 0 1 -1.476 .692l-4.524 -3.77h-8a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h8" />',
    "device-laptop": '<path d="M3 19l18 0" /> <path d="M5 7a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v8a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1l0 -8" />',
    "microphone": '<path d="M9 5a3 3 0 0 1 3 -3a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3a3 3 0 0 1 -3 -3l0 -5" /> <path d="M5 10a7 7 0 0 0 14 0" /> <path d="M8 21l8 0" /> <path d="M12 17l0 4" />',
    "file-music": '<path d="M14 3v4a1 1 0 0 0 1 1h4" /> <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2" /> <path d="M10 16a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /> <path d="M12 16l0 -5l2 1" />',
    "text-recognition": '<path d="M4 8v-2a2 2 0 0 1 2 -2h2" /> <path d="M4 16v2a2 2 0 0 0 2 2h2" /> <path d="M16 4h2a2 2 0 0 1 2 2v2" /> <path d="M16 20h2a2 2 0 0 0 2 -2v-2" /> <path d="M12 16v-7" /> <path d="M9 9h6" />',
    "shield-lock": '<path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3" /> <path d="M11 11a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /> <path d="M12 12l0 2.5" />',
    "shield-check": '<path d="M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06" /> <path d="M15 19l2 2l4 -4" />',
    "volume": '<path d="M15 8a5 5 0 0 1 0 8" /> <path d="M17.7 5a9 9 0 0 1 0 14" /> <path d="M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5" />',
}


def icon(name, cx, top, size=44, color=INK):
    scale = size / 24
    return (
        f'<g transform="translate({cx - size / 2},{top}) scale({scale})" fill="none" '
        f'stroke="{color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
        f"{ICONS[name]}</g>"
    )


def box(x, y, w, h, name, title, sub="", fill=FILL, stroke=INK):
    """A rounded box with an icon on top, a title, and an optional one-line subtitle."""
    cx = x + w / 2
    parts = [
        (
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" fill="{fill}" '
            f'stroke="{stroke}" stroke-width="2"/>'
        ),
        icon(name, cx, y + 20, color=stroke),
        (
            f'<text x="{cx}" y="{y + 92}" text-anchor="middle" font-size="20" '
            f'font-weight="600" fill="{INK}">{escape(title)}</text>'
        ),
    ]
    if sub:
        parts.append(
            f'<text x="{cx}" y="{y + 116}" text-anchor="middle" font-size="14" '
            f'fill="{MUTED}">{escape(sub)}</text>'
        )
    return "".join(parts)


def arrow(points, both=False, color=INK, dash=False):
    pts = " ".join(f"{x},{y}" for x, y in points)
    ends = ' marker-start="url(#tail)"' if both else ""
    marker = "head-red" if color != INK else "head"
    d = ' stroke-dasharray="7 6"' if dash else ""
    return (
        f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2"{d} '
        f'marker-end="url(#{marker})"{ends}/>'
    )


def label(x, y, lines, anchor="middle", color=INK):
    """Arrow labels, one short line each, with a white halo so they read over lines."""
    out = []
    for i, line in enumerate(lines):
        out.append(
            f'<text x="{x}" y="{y + i * 20}" text-anchor="{anchor}" font-size="16" '
            f'fill="{color}" stroke="#ffffff" stroke-width="5" paint-order="stroke">'
            f"{escape(line)}</text>"
        )
    return "".join(out)


def zone(x, y, w, h, title, fill, color):
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="20" fill="{fill}"/>'
        f'<text x="{x + 20}" y="{y + 30}" font-size="15" font-weight="700" '
        f'letter-spacing="0.6" fill="{color}">{escape(title)}</text>'
    )


def svg(width, height, description, body):
    defs = (
        "<defs>"
        '<marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" '
        f'markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{INK}"/></marker>'
        '<marker id="tail" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="8" '
        f'markerHeight="8" orient="auto"><path d="M10,0 L0,5 L10,10 z" fill="{INK}"/></marker>'
        '<marker id="head-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" '
        'markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#b42318"/></marker>'
        "</defs>"
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}" font-family="{FONT}" role="img" '
        f'aria-label="{escape(description)}"><title>{escape(description)}</title>{defs}'
        f'<rect width="{width}" height="{height}" fill="#ffffff"/>{body}</svg>\n'
    )


def parts():
    """The rover and its local guard proxy, the remote AI services, and the laptop."""
    w, h = 220, 140
    b = [
        zone(30, 150, 580, 220, "ON THE ROVER, LOCAL", "#e9f5ec", "#1a7f37"),
        box(50, 205, w, h - 15, "robot", "Rover", "hears, sees, speaks"),
        box(350, 205, w, h - 15, "shield-lock", "Guard proxy", "cleans before sending"),
        box(710, 40, w, h, "sparkles", "Gemini", "writes the answer"),
        box(710, 340, w, h, "speakerphone", "ElevenLabs", "speaks the answer"),
        box(1030, 190, w, h, "device-laptop", "Desktop app", "laptop, notebooks"),
    ]
    b.append(arrow([(270, 268), (348, 268)], both=True))
    b.append(label(309, 248, ["question"]))
    b.append(label(309, 296, ["answer"]))
    b.append(arrow([(570, 235), (708, 130)], both=True))
    b.append(label(625, 150, ["text without", "personal info"], anchor="end"))
    b.append(arrow([(570, 300), (708, 390)], both=True))
    b.append(label(625, 395, ["checked answer"], anchor="end"))
    b.append(arrow([(1028, 225), (932, 130)], both=True))
    b.append(label(982, 142, ["its own questions,", "no proxy yet"], anchor="start"))
    b.append(arrow([(1028, 295), (932, 390)], both=True))
    b.append(label(982, 382, ["each sentence"], anchor="start"))
    b.append(arrow([(160, 330), (160, 560), (1140, 560), (1140, 332)]))
    b.append(label(650, 550, ["pulls each saved turn over SSH, every 60 s"]))
    return svg(
        1290,
        590,
        "The parts of Beaver. On the rover, a local guard proxy sits between the rover and the "
        "AI services: it turns the spoken question into text and removes personal information "
        "before Gemini sees it, and checks the answer before ElevenLabs speaks it. The desktop "
        "app asks Gemini and ElevenLabs its own questions without the proxy yet, and pulls each "
        "rover turn over SSH every 60 seconds.",
        "".join(b),
    )


def privacy():
    """What the rover sends out, what stays on the Pi, and the desktop path the filter skips."""
    w, h = 190, 130
    y_out, y_pi = 70, 330
    b = [
        zone(250, 20, 1210, 230, "SENT TO REMOTE SERVICES", "#fff4e0", "#8a5a00"),
        zone(250, 280, 1210, 230, "STAYS ON THE ROVER", "#e9f5ec", "#1a7f37"),
        zone(
            20,
            560,
            1440,
            190,
            "DESKTOP APP QUESTIONS: NO GUARD PROXY YET",
            "#fdeceb",
            "#b42318",
        ),
        box(30, y_pi, w, h, "microphone", "Question", "spoken to the rover"),
        box(275, y_pi, w, h, "file-music", "Recording", "kept, never synced"),
        box(505, y_pi, w, h, "text-recognition", "Transcribe", "asks if unsure"),
        box(735, y_pi, w, h, "shield-lock", "Clean question", "guard proxy"),
        box(965, y_pi, w, h, "shield-check", "Check answer", "guard proxy"),
        box(1195, y_pi, w + 50, h, "volume", "Speaker", "on the rover"),
        box(850, y_out, w, h, "sparkles", "Gemini", "clean text, no audio"),
        box(1195, y_out, w + 50, h, "speakerphone", "ElevenLabs", "checked answer"),
        box(
            275,
            600,
            w,
            h,
            "device-laptop",
            "Laptop",
            "mic or typing",
            "#ffffff",
            "#b42318",
        ),
        box(
            850,
            600,
            w,
            h,
            "sparkles",
            "Gemini",
            "gets the recording",
            "#ffffff",
            "#b42318",
        ),
    ]
    mid = y_pi + h / 2
    b.append(arrow([(220, mid), (273, mid)]))
    b.append(arrow([(465, mid), (503, mid)]))
    b.append(arrow([(695, mid), (733, mid)]))
    b.append(arrow([(830, y_pi), (890, y_out + h + 2)]))
    b.append(label(848, 272, ["clean text + frame"], anchor="end"))
    b.append(arrow([(1000, y_out + h), (1060, y_pi - 2)]))
    b.append(label(1042, 272, ["answer"], anchor="start"))
    b.append(arrow([(1155, y_pi + 30), (1230, y_out + h + 2)]))
    b.append(arrow([(1340, y_out + h), (1340, y_pi - 2)]))
    b.append(label(1350, 280 - 12, ["audio"], anchor="start"))
    b.append(arrow([(465, 665), (848, 665)], color="#b42318", dash=True))
    b.append(label(656, 650, ["sent as recorded"], color="#b42318"))
    return svg(
        1480,
        770,
        "The guard proxy. The spoken question stays on the rover: Whisper turns it into text "
        "and the guard proxy removes personal information, so Gemini receives only clean text "
        "and a camera frame. The proxy checks the answer before ElevenLabs speaks it. Questions "
        "asked in the desktop app reach Gemini as recorded, because the proxy does not cover "
        "them yet.",
        "".join(b),
    )


if __name__ == "__main__":
    (HERE / "how-it-works-parts.svg").write_text(parts())
    (HERE / "how-it-works-privacy.svg").write_text(privacy())
