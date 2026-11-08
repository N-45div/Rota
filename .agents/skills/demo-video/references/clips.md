# Publishing on Clips

Clips (https://clips.agent-native.com) is Agent-Native's screen-recording app.
Its MCP server lets an agent upload a video, add chapters and a transcript,
look at frames, and change who can open it.

## Connect

- Claude (web or desktop): Customize → Connectors → Add custom connector,
  URL `https://clips.agent-native.com/mcp`, then authorize. Connectors load
  when a session starts.
- Claude Code: `claude mcp add --transport http clips https://clips.agent-native.com/mcp`.
- Scripts or a cloud sandbox: create a static token at
  `https://clips.agent-native.com/mcp/connect` and pass it as `CLIPS_TOKEN`
  (or save it as the sandbox's credential for `clips.agent-native.com`).
  Never paste it into chat or commit it.

`scripts/clips-mcp.mjs` is a dependency-free client:

```bash
node clips-mcp.mjs tools                      # what the server offers
node clips-mcp.mjs describe create-recording-upload
node clips-mcp.mjs call search-recordings '{"query":"demo"}'
```

Behind an HTTPS proxy, run Node with `NODE_USE_ENV_PROXY=1`.

## Steps

1. **Upload, private.**
   `create-recording-upload` with `title`, `visibility: "private"`,
   `mimeType: "video/mp4"`, `sizeBytes`, `durationMs`, `width`, `height`.
   It returns `recordingId`, `shareUrl` and an upload plan. Save the result as
   `plan.json` and run `node clips-upload.mjs plan.json demo.mp4`. It posts
   3 MB chunks in order, and the last one finalizes the clip. Hosted storage
   takes files up to 250 MB.
   - From a public link instead: `import-loom-recording` with `url` (a direct
     MP4/WebM, Loom, or YouTube link) and `visibility`.
   - If every chunk gets 401 "Invalid or expired upload ticket", a proxy is
     replacing the upload's own `Authorization` header with your Clips token
     (this happens in cloud sandboxes with a saved credential). Ask the person
     to upload the file in Clips (Import → Upload a video file) and give you
     the link. Its id is the part after `/share/` or `/r/`. Then continue below.
2. **Read it.** `get-recording-player-data` with `recordingId` gives status,
   `mediaUpdatedAt`, the current chapters, and the transcript.
3. **Chapters.** `set-chapters` with `recordingId`, `chapters`
   (`[{startMs, title}]`, one per scene from `timing.json`),
   `expectedChapters` (the current ones, `[]` when none) and
   `expectedMediaUpdatedAt` from step 2.
4. **Transcript.** Clips transcribes the audio on its own. For a silent cut,
   or to use the script's exact words, `import-transcript` with `recordingId`,
   `text` (the `.srt` contents), `format: "srt"`, `language: "en"`. Add
   `replace: true` (and `replaceImportId` from step 2) to replace one.
5. **Look.** `get-recording-frames` with `recordingId` and up to four `atMs`
   values returns the frames as images. Check the start of each chapter.
6. **Share, when the person says so.** `set-resource-visibility` with
   `resourceType: "recording"`, `resourceId`, `visibility: "public"`. The share
   link is `https://clips.agent-native.com/share/<recordingId>`.
7. **Anything else** (rename, trash, move to a folder): `ask_app` with a plain
   message, then poll `ask_app_status` with the returned `taskHandle`. Confirm
   the result with `search-recordings`, which also lists trashed clips.
