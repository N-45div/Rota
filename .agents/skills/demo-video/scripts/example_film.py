#!/usr/bin/env python3
"""A three-scene starting point: a chat on a phone, the app reacting, and an end card.

    python3 example_film.py <film-dir>

Expects <film-dir>/assets/shots/screen-before.png and screen-after.png (two captures of the same
screen) and <film-dir>/assets/vendor/gsap.min.js. Replace the messages with real ones from the app.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from film_kit import Film, Theme, cam_xy  # noqa: E402

film = Film(sys.argv[1] if len(sys.argv) > 1 else "film", Theme(chat_name="Rota", chat_sub="bot · Telegram"))

# 1. Someone texts the app's bot. Hold the last bubble ~0.5 s + 0.3 s per word.
s = film.scene("chat", 9)
s.ground("primary")
s.phone("chat-phone", 250, 50, [
    ("staff", "I'm sick, can't do my shift tomorrow 🤒", 0.3),
    ("bot", "Sorry to hear that. I've opened your shift and asked two teammates to cover.", 1.8),
])
s.title("chat-title", "A call-out, by text.", 930, 380, 88, on_primary=True, width=860)
s.title_in("chat-title", 0.6)
s.drift("#chat-phone", 2.2, 6.0)
s.title_out("chat-title", 8.2)
s.fade_to("var(--paper)", 8.6, 0.4)

# 2. The board changes on its own: punch in, crossfade to the after state, pull back.
s = film.scene("board", 8)
s.ground("paper")
s.cam("board-cam", ["screen-before", "screen-after"], (*cam_xy(620, 230, 1.8), 1.8), hold=True)
s.cursor_path("board-cam", (900, 700), (620, 230), 0.8, 0.8)
s.show("board-cam", 1, 2.2)
s.cursor_hide("board-cam", 2.4)
s.full("board-cam", 4.0, 0.7)
s.title("board-title", "The board updates itself", 330, 925, 66, accent=("itself",))
s.title_in("board-title", 4.4)
s.iris_out(960, 540, 7.45)

# 3. End card.
s = film.scene("end", 5)
s.ground("primary")
s.title("end-word", "Rota", 640, 380, 200, on_primary=True)
s.label("end-tag", "Built with Agent-Native", 646, 640, 40)
s.title_in("end-word", 0.3)
s.blur_in("#end-tag", 0.9)

film.write()
