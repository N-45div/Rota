#!/usr/bin/env python3
"""HyperFrames film kit: a product demo built from real screen captures and real chat messages.

    import sys; sys.path.insert(0, ".agents/skills/demo-video/scripts")
    from film_kit import Film, Theme

    film = Film("film", Theme(primary="#E4572E", paper="#FBF7F2", ink="#2B211C", chat_name="Rota"))
    s = film.scene("open", 8)            # scenes play in the order they are added
    s.ground("paper")
    s.cam("board", ["board-before", "board-after"], hold=True)
    s.move("board", 620, 230, 2.0, t=1.0)
    s.show("board", 1, t=3.0)
    film.write()                          # film/index.html, film/compositions/*.html, film/timing.json

Captures live in <film>/assets/shots/<name>.png and are shown at 1920x1080 (capture them at 2x).
<film>/assets/vendor/gsap.min.js must exist. Fonts are optional files in <film>/assets/fonts.
Times passed to a scene are seconds from that scene's start.
"""
from __future__ import annotations

import html
import json
import os
from dataclasses import dataclass, field

W, H = 1920, 1080

CURSOR_SVG = (
    '<svg viewBox="0 0 28 40"><path d="M2 2 L2 32 L10 24.5 L15.5 37 L21 34.5 L15.5 22.5 L26 22.5 Z" '
    'fill="var(--ink)" stroke="var(--paper)" stroke-width="2.4" stroke-linejoin="round"/></svg>'
)


@dataclass
class Theme:
    primary: str = "#E4572E"  # brand color: grounds, accents
    paper: str = "#FBF7F2"  # light ground, the app's background
    ink: str = "#2B211C"  # text
    display_font: str | None = "assets/fonts/display.woff2"  # titles; None uses Georgia
    body_font: str | None = "assets/fonts/body.woff2"  # labels and chat; None uses system sans
    chat_name: str = "Bot"  # name in the phone's chat header
    chat_sub: str = "bot"  # line under the name, e.g. "bot · Telegram"
    chat_avatar: str | None = None  # e.g. "assets/brand/mark.svg"
    chat_icon_svg: str = ""  # small icon before chat_sub
    staff_bubble: str = "#F9D9CC"  # the person's bubbles
    extra_css: str = ""

    def css(self) -> str:
        faces = ""
        if self.display_font:
            faces += f'@font-face {{ font-family: "FilmDisplay"; src: url("{self.display_font}") format("woff2"); font-weight: 100 900; }}\n'
        if self.body_font:
            faces += f'@font-face {{ font-family: "FilmBody"; src: url("{self.body_font}") format("woff2"); font-weight: 100 900; }}\n'
        return faces + f"""
@font-face {{ font-family: "FilmEmoji"; src: local("Noto Color Emoji"); }}
#root {{ --primary: {self.primary}; --paper: {self.paper}; --ink: {self.ink};
  position: absolute; inset: 0; overflow: hidden; font-family: "FilmBody", "FilmEmoji", system-ui, sans-serif; color: var(--ink); }}
.ground {{ position: absolute; inset: 0; }}
.ground.primary {{ background: var(--primary); }}
.ground.paper {{ background: var(--paper); }}
.cam {{ position: absolute; left: 0; top: 0; width: {W}px; height: {H}px; transform-origin: 0 0; }}
.whip {{ position: absolute; left: 0; top: 0; width: {W}px; height: {H}px; }}
.shot {{ position: absolute; left: 0; top: 0; width: {W}px; height: {H}px; }}
.title {{ position: absolute; font-family: "FilmDisplay", Georgia, serif; font-weight: 600; letter-spacing: -0.015em; line-height: 1.06; }}
.title .w {{ display: inline-block; white-space: pre; }}
.accent {{ color: var(--primary); }}
.on-primary {{ color: var(--paper); }}
.on-primary .accent {{ color: var(--ink); }}
.label {{ position: absolute; font-weight: 600; font-size: 34px; letter-spacing: -0.01em; }}
.phone {{ position: absolute; width: 540px; height: 980px; border-radius: 64px; background: var(--ink); padding: 14px; box-shadow: 0 30px 60px rgba(0,0,0,0.25); }}
.screen {{ position: relative; width: 100%; height: 100%; border-radius: 52px; background: #EFE8DE; overflow: hidden; }}
.head {{ display: flex; align-items: center; gap: 16px; padding: 46px 28px 18px; background: var(--paper); border-bottom: 1px solid rgba(0,0,0,0.08); }}
.head img.av {{ width: 58px; height: 58px; border-radius: 16px; }}
.head .nm {{ font-weight: 700; font-size: 31px; }}
.head .sub {{ display: flex; align-items: center; gap: 6px; font-size: 28px; opacity: 0.7; }}
.head .sub svg {{ width: 26px; height: 26px; }}
.chat {{ display: flex; flex-direction: column; gap: 14px; padding: 22px 20px; }}
.slot {{ position: relative; display: flex; }}
.slot.staff {{ justify-content: flex-end; }}
.b {{ max-width: 420px; padding: 14px 18px; border-radius: 22px; font-size: 28px; line-height: 1.32; white-space: pre-line; }}
.b.bot {{ background: #FFFFFF; border-bottom-left-radius: 8px; transform-origin: 0% 100%; }}
.b.staff {{ background: {self.staff_bubble}; border-bottom-right-radius: 8px; transform-origin: 100% 100%; }}
.typing {{ position: absolute; left: 0; top: 0; display: flex; gap: 7px; padding: 18px 20px; background: #FFFFFF; border-radius: 22px; border-bottom-left-radius: 8px; }}
.typing i {{ display: block; width: 11px; height: 11px; border-radius: 50%; background: #A39488; }}
.cursor {{ position: absolute; left: 0; top: 0; width: 0; height: 0; }}
.cursor svg {{ position: absolute; left: -3px; top: -3px; width: 40px; height: 57px; filter: drop-shadow(0 3px 4px rgba(0,0,0,0.25)); transform-origin: 3px 3px; }}
.cover {{ position: absolute; inset: 0; pointer-events: none; }}
{self.extra_css}"""


def esc(text: str) -> str:
    return html.escape(text, quote=True)


def cam_xy(cx: float, cy: float, k: float) -> tuple[float, float]:
    """Camera offset that centers capture point (cx, cy) at zoom k, kept inside the capture."""
    x = max(W - W * k, min(0, W / 2 - k * cx))
    y = max(H - H * k, min(0, H / 2 - k * cy))
    return round(x, 1), round(y, 1)


def words(text: str, accent=()) -> str:
    parts = text.split(" ")
    out = []
    for i, word in enumerate(parts):
        cls = "w accent" if word.strip(".,!?") in accent else "w"
        out.append(f'<span class="{cls}">{esc(word)}{" " if i < len(parts) - 1 else ""}</span>')
    return "".join(out)


@dataclass
class Scene:
    id: str
    dur: float
    theme: Theme
    body: list[str] = field(default_factory=list)
    js: list[str] = field(default_factory=list)
    css: list[str] = field(default_factory=list)

    # --- raw building blocks ------------------------------------------------
    def add(self, markup: str):
        self.body.append(markup)

    def tl(self, line: str):
        self.js.append(line)

    def ground(self, kind: str = "paper"):
        """Full-frame background: "paper" or "primary"."""
        self.add(f'<div class="ground {kind}"></div>')

    # --- type -----------------------------------------------------------------
    def title(self, tid, text, left, top, size=72, on_primary=False, width=None, accent=()):
        """A display title split into words. It starts hidden; reveal it with title_in."""
        cls = "title on-primary" if on_primary else "title"
        w = f"width:{width}px;" if width else ""
        self.add(f'<div id="{tid}" class="{cls}" style="left:{left}px;top:{top}px;font-size:{size}px;{w}">{words(text, accent)}</div>')
        self.css.append(f"#{tid} .w {{ opacity: 0; }}")

    def title_in(self, tid, t):
        self.tl(f'tl.fromTo("#{tid} .w", {{opacity: 0, filter: "blur(6px)"}}, {{opacity: 1, filter: "blur(0px)", duration: 0.14, stagger: 0.07, ease: "power2.out"}}, {t});')

    def title_out(self, tid, t):
        self.tl(f'tl.fromTo("#{tid} .w", {{opacity: 1, filter: "blur(0px)"}}, {{opacity: 0, filter: "blur(6px)", duration: 0.18, stagger: 0.025, ease: "power2.in", immediateRender: false}}, {t});')

    def label(self, lid, text, left, top, size=34, color="var(--paper)"):
        """A small hidden label; reveal with blur_in("#id", t)."""
        self.add(f'<div class="label" id="{lid}" style="left:{left}px;top:{top}px;font-size:{size}px;color:{color};opacity:0">{esc(text)}</div>')

    # --- a phone with a chat ----------------------------------------------------
    def phone(self, pid, left, top, messages):
        """messages: [(who, text, at)] with who "bot" or "staff". Bot bubbles get a typing indicator first.
        Use real message text from the app's logs; hold each bubble ~0.5 s + 0.3 s per word before the phone leaves."""
        th = self.theme
        rows = []
        for i, (who, text, _at) in enumerate(messages):
            typing = f'<div class="typing" id="{pid}-t{i}" style="opacity:0"><i></i><i></i><i></i></div>' if who == "bot" else ""
            rows.append(f'<div class="slot {who}">{typing}<div class="b {who}" id="{pid}-m{i}" style="opacity:0">{esc(text)}</div></div>')
        avatar = f'<img class="av" src="{th.chat_avatar}" alt="">' if th.chat_avatar else ""
        self.add(
            f'<div class="phone" id="{pid}" style="left:{left}px;top:{top}px"><div class="screen">'
            f'<div class="head">{avatar}<div><div class="nm">{esc(th.chat_name)}</div>'
            f'<div class="sub">{th.chat_icon_svg}<span>{esc(th.chat_sub)}</span></div></div></div>'
            f'<div class="chat">{"".join(rows)}</div></div></div>'
        )
        for i, (who, _text, at) in enumerate(messages):
            if who == "bot":
                self.tl(f'tl.fromTo("#{pid}-t{i}", {{opacity: 0}}, {{opacity: 1, duration: 0.12}}, {max(0, at - 0.65)});')
                self.tl(f'tl.fromTo("#{pid}-t{i} i", {{opacity: 0.35}}, {{opacity: 1, duration: 0.18, stagger: 0.1, repeat: 1, yoyo: true}}, {max(0, at - 0.6)});')
                self.tl(f'tl.to("#{pid}-t{i}", {{opacity: 0, duration: 0.08}}, {max(0, at - 0.04)});')
            self.tl(f'tl.fromTo("#{pid}-m{i}", {{opacity: 0, scale: 0.9}}, {{opacity: 1, scale: 1, duration: 0.28, ease: "back.out(1.5)"}}, {at});')

    # --- a camera over stacked captures -----------------------------------------
    def cam(self, cid, shots, start_view=(0, 0, 1), hidden=False, hold=False):
        """Stack captures (first visible, rest hidden) under one camera with a cursor.
        start_view is (x, y, zoom); use cam_xy() for x, y. hidden=True wraps it for whip_in.
        hold=True marks deliberate stillness so `hyperframes check` doesn't call it dead."""
        imgs = "".join(
            f'<img class="shot" id="{cid}-{i}" src="assets/shots/{s}.png" alt=""{" style=\"opacity:0\"" if i else ""}>'
            for i, s in enumerate(shots)
        )
        markup = f'<div class="cam" id="{cid}"{" data-hold" if hold else ""}>{imgs}<div class="cursor" id="{cid}-cur" style="opacity:0">{CURSOR_SVG}</div></div>'
        if hidden:  # the wrapper carries the whip; the camera keeps its framing
            markup = f'<div class="whip" id="{cid}-w" style="opacity:0">{markup}</div>'
        self.add(markup)
        x, y, k = start_view
        self.tl(f'tl.set("#{cid}", {{x: {x}, y: {y}, scale: {k}}}, 0);')

    def show(self, cid, i, t, d=0.25):
        """Crossfade to capture i (a later state of the same screen)."""
        self.tl(f'tl.fromTo("#{cid}-{i}", {{opacity: 0}}, {{opacity: 1, duration: {d}, ease: "power1.inOut"}}, {t});')

    def move(self, cid, cx, cy, k, t, d=0.6, ease="power2.inOut"):
        """Punch in so capture point (cx, cy) is centered at zoom k."""
        x, y = cam_xy(cx, cy, k)
        self.tl(f'tl.to("#{cid}", {{x: {x}, y: {y}, scale: {k}, duration: {d}, ease: "{ease}"}}, {t});')

    def full(self, cid, t, d=0.6):
        """Pull back to the whole screen."""
        self.tl(f'tl.to("#{cid}", {{x: 0, y: 0, scale: 1, duration: {d}, ease: "power2.inOut"}}, {t});')

    def cursor_path(self, cid, frm, to, t, d=0.9, click=True):
        """Move the cursor between capture points, with a click at the end."""
        c = f"#{cid}-cur"
        self.tl(f'tl.fromTo("{c}", {{opacity: 0}}, {{opacity: 1, duration: 0.15}}, {t});')
        self.tl(f'tl.fromTo("{c}", {{x: {frm[0]}, y: {frm[1]}}}, {{x: {to[0]}, y: {to[1]}, duration: {d}, ease: "power2.inOut"}}, {t});')
        if click:
            self.tl(f'tl.fromTo("{c} svg", {{scale: 1}}, {{scale: 0.84, duration: 0.08, yoyo: true, repeat: 1, ease: "power1.inOut"}}, {t + d + 0.05});')

    def cursor_hide(self, cid, t):
        self.tl(f'tl.to("#{cid}-cur", {{opacity: 0, duration: 0.15}}, {t});')

    def drift(self, sel, t, d, scale=1.045):
        """A slow push-in while people read (a phone, a still screen), so the frame never goes dead."""
        self.tl(f'tl.fromTo("{sel}", {{scale: 1}}, {{scale: {scale}, duration: {d}, ease: "sine.inOut"}}, {t});')

    # --- transitions ---------------------------------------------------------------
    def blur_in(self, sel, t=0):
        self.tl(f'tl.fromTo("{sel}", {{opacity: 0, filter: "blur(8px)"}}, {{opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power2.out"}}, {t});')

    def blur_out(self, sel, t):
        self.tl(f'tl.fromTo("{sel}", {{opacity: 1, filter: "blur(0px)"}}, {{opacity: 0, filter: "blur(8px)", duration: 0.18, ease: "power2.in", immediateRender: false}}, {t});')

    def whip_out(self, sel, t):
        """Throw an element (e.g. a stage div holding phones and titles) off to the left."""
        self.tl(f'tl.to("{sel}", {{x: -2200, filter: "blur(18px)", duration: 0.35, ease: "power3.in"}}, {t});')

    def whip_in(self, cid, t):
        """Bring a cam(hidden=True) in from the right. It starts far enough out that a zoomed camera never peeks in."""
        self.tl(f'tl.fromTo("#{cid}-w", {{opacity: 1, x: 2700, filter: "blur(16px)"}}, {{opacity: 1, x: 0, filter: "blur(0px)", duration: 0.4, ease: "power3.out"}}, {t});')

    def iris_out(self, cx, cy, t, color="var(--primary)"):
        """Close the scene with a circle that grows from (cx, cy). Place it about 0.5 s before the end."""
        self.add(f'<div class="cover" id="{self.id}-iris" style="background:{color};clip-path:circle(0px at {cx}px {cy}px);"></div>')
        self.tl(f'tl.to("#{self.id}-iris", {{clipPath: "circle(2300px at {cx}px {cy}px)", duration: 0.5, ease: "power2.in"}}, {t});')

    def fade_to(self, color, t, d=0.35):
        """Fade the frame to a color (a soft cut to the next scene)."""
        self.add(f'<div class="cover" id="{self.id}-fade" style="background:{color};opacity:0"></div>')
        self.tl(f'tl.fromTo("#{self.id}-fade", {{opacity: 0}}, {{opacity: 1, duration: {d}, ease: "power2.inOut"}}, {t});')

    def render(self) -> str:
        js = "\n".join("    " + line for line in self.js)
        return f"""<template>
  <style>{self.theme.css()}{"".join(self.css)}</style>
  <div id="root" data-composition-id="{self.id}" data-width="{W}" data-height="{H}">
    {"".join(self.body)}
  </div>
  <script>
    const tl = gsap.timeline({{ paused: true }});
{js}
    tl.set({{}}, {{}}, {self.dur});
    window.__timelines["{self.id}"] = tl;
  </script>
</template>
"""


class Film:
    def __init__(self, out_dir: str, theme: Theme | None = None):
        self.out = out_dir
        self.theme = theme or Theme()
        self.scenes: list[Scene] = []

    def scene(self, sid: str, duration: float) -> Scene:
        s = Scene(sid, duration, self.theme)
        self.scenes.append(s)
        return s

    def timing(self):
        start, rows = 0.0, []
        for s in self.scenes:
            rows.append({"id": s.id, "start": round(start, 3), "duration": s.dur})
            start += s.dur
        return rows, round(start, 3)

    def write(self):
        if not os.path.exists(os.path.join(self.out, "assets", "vendor", "gsap.min.js")):
            raise SystemExit(f"Missing {self.out}/assets/vendor/gsap.min.js (copy it from node_modules/gsap/dist/).")
        rows, total = self.timing()
        os.makedirs(os.path.join(self.out, "compositions"), exist_ok=True)
        for s in self.scenes:
            with open(os.path.join(self.out, "compositions", f"{s.id}.html"), "w") as fh:
                fh.write(s.render())
        hosts = "\n".join(
            f'      <div id="{r["id"]}" class="clip" data-composition-id="{r["id"]}" data-composition-src="compositions/{r["id"]}.html" '
            f'data-start="{r["start"]}" data-duration="{r["duration"]}" data-track-index="1" data-track-kind="graphics" '
            f'data-width="{W}" data-height="{H}"></div>'
            for r in rows
        )
        with open(os.path.join(self.out, "index.html"), "w") as fh:
            fh.write(f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width={W}, height={H}" />
    <script src="assets/vendor/gsap.min.js"></script>
    <style>
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{ margin: 0; width: {W}px; height: {H}px; overflow: hidden; background: {self.theme.paper}; }}
      #main {{ position: relative; width: 100%; height: 100%; }}
    </style>
  </head>
  <body>
    <div id="main" data-composition-id="main" data-start="0" data-duration="{total}" data-width="{W}" data-height="{H}">
{hosts}
    </div>
    <script>
      window.__timelines = window.__timelines || {{}};
      const tl = gsap.timeline({{ paused: true }});
      tl.set({{}}, {{}}, {total});
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
""")
        with open(os.path.join(self.out, "timing.json"), "w") as fh:
            json.dump({"total": total, "scenes": rows}, fh, indent=2)
        for r in rows:
            m, sec = divmod(r["start"], 60)
            print(f'{int(m)}:{sec:05.2f}  {r["id"]} ({r["duration"]} s)')
        print(f"total {total} s")
