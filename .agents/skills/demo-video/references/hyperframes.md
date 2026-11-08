# HyperFrames rules for demo films

HyperFrames renders HTML to video by seeking a paused GSAP timeline frame by
frame. These rules come from building Rota's demo; `npx hyperframes check`
reports most of them.

## Structure

- `index.html` is the root: one host `div.clip` per scene with `data-start`,
  `data-duration` and `data-composition-src="compositions/<id>.html"`. The
  root's `data-duration` is the film's length.
- Each scene file wraps its style, markup and script in `<template>`, styles
  its root as `#root`, builds one paused timeline, and registers it as
  `window.__timelines["<id>"]`. `film_kit.py` does all of this.
- Asset paths are relative (`assets/...`). No network fetches, `Date.now()`,
  `Math.random()` or `repeat: -1`.
- Fonts: an `@font-face` pointing at a file in `assets/fonts/`.

## Seeking correctly

- Put the hidden starting state in the markup (`style="opacity:0"`), not in a
  `tl.set()` at time 0. A render can start at any frame.
- A `fromTo()` that reveals something must set `opacity: 1` in its end state.
- Exits use `fromTo(..., {immediateRender: false})` so they don't fire early.
- Don't tween the same property from two places. A camera that is both framed
  (x, y, scale) and whipped in needs the whip on a wrapper: that's
  `cam(hidden=True)` + `whip_in()`. Start the whip at least 2700 px out, or a
  zoomed camera peeks in from the edge.

## Reading time

- Keep each bubble or line on screen for at least 0.5 s plus 0.3 s a word
  before it leaves. Long bot replies need 8–12 s; let the voiceover carry them.
- Text is at least 28 px at 1080p, the size a phone viewer can read.
- Nothing stays still for more than 3 s: pan, drift, or punch in. If stillness
  is the point, mark the element `data-hold`.

## Look

- Captures at 2× shown at 1920×1080 stay sharp up to about 2× zoom.
- Camera moves: 0.6 s `power2.inOut`. Arrivals: `expo.out`. Exits: `power3.in`.
- UI state changes are 0.2–0.3 s crossfades between captures of the same view.
- One accent color, used for the word that matters in each title.

## Commands

```bash
npx hyperframes check --json
npx hyperframes snapshot --at 1.5,7,13
npx hyperframes render -o demo.mp4 -q delivery
```

`check` warnings worth keeping on purpose: `film_silent` when a person will add
the voice, and `line_unread` for a long real message the narrator summarizes.
