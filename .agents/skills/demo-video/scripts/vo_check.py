#!/usr/bin/env python3
"""Check a voiceover .srt against the film's timing.

    python3 vo_check.py rota-voiceover.srt [film/timing.json]

Flags cues spoken faster than 2.7 words a second (about 160 words a minute), cues that overlap,
and, with timing.json, cues that cross a scene boundary or run past the end of the film.
"""
import json
import re
import sys

MAX_WPS = 2.7


def seconds(stamp):
    h, m, rest = stamp.split(":")
    s, ms = rest.replace(".", ",").split(",")
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def cues(path):
    blocks = re.split(r"\n\s*\n", open(path, encoding="utf-8").read().strip())
    for block in blocks:
        lines = block.strip().splitlines()
        stamp = next((l for l in lines if "-->" in l), None)
        if not stamp:
            continue
        a, b = [x.strip() for x in stamp.split("-->")]
        text = " ".join(l for l in lines[lines.index(stamp) + 1 :]).strip()
        yield seconds(a), seconds(b), text


def main():
    items = list(cues(sys.argv[1]))
    timing = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else None
    bounds = [(s["start"], s["start"] + s["duration"], s["id"]) for s in timing["scenes"]] if timing else []
    problems = 0
    prev_end = 0.0
    for start, end, text in items:
        n = len(text.split())
        wps = n / max(0.1, end - start)
        notes = []
        if wps > MAX_WPS:
            notes.append(f"fast: {wps:.1f} words/s, cut about {int(n - MAX_WPS * (end - start)) + 1} words")
        if start < prev_end:
            notes.append("overlaps the previous cue")
        if timing:
            scene = next((b for b in bounds if b[0] <= start < b[1]), None)
            if scene and end > scene[1] + 0.05:
                notes.append(f"runs {end - scene[1]:.1f} s past the end of scene '{scene[2]}'")
            if end > timing["total"]:
                notes.append("runs past the end of the film")
        prev_end = end
        flag = "!!" if notes else "ok"
        problems += bool(notes)
        print(f"{flag} {start:7.2f}-{end:7.2f}  {n:3d} words  {text[:60]}")
        for note in notes:
            print(f"     {note}")
    print(f"{len(items)} cues, {problems} with problems")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
