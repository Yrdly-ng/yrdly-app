# Video editing and feed media

Selecting a video in post creation, event creation or chat opens a local editor.
Users can trim its start/end, select an original, square, portrait, vertical,
landscape or custom frame ratio, zoom and reposition the crop. Apply edits
creates a new file for the existing uploader. Keep original preserves the input;
Cancel adds or sends nothing. Attached clips can be edited again before posting.

Mediabunny is loaded only when the editor needs media processing. WebCodecs
encodes MP4 with AVC/AAC where supported, otherwise WebM with VP9/VP8 and Opus.
Exports preserve the primary audio track and reject conversions that would
silently discard it. Browser codec support varies; unsupported files can still
be kept in their original form. Exported frames are limited to 1080 pixels on
the longer edge, without upscaling. The original upload limits remain 40 MB per
post/event video (three videos) and 15 MB for chat. No editing server, credentials
or database migration is required.

Home-feed media uses contain fitting. Each image/video keeps its entire frame;
the web card reads its aspect ratio and caps the media height at 480 pixels.
Letterboxing is expected where the frame and card dimensions differ. User-made
crops remain part of the saved video and cannot be restored by feed display.

## Verification and release

The eight browser-helper unit tests passed before the user asked to skip further
testing on 13 October 2026. These exercise geometry, mocked conversion, audio
retention checks, limits and cancellation; they do not prove real codec export.
Further browser, responsive and real-media export checks were skipped at the
user's request. Typecheck and lint results are recorded with the release work.
The tests are included in the existing QA workflow for subsequent runs.

For future visual verification, use portrait, landscape and panoramic images
with visible corner markers; test mixed-media carousels at phone, tablet and
desktop widths. For export verification, inspect saved duration, dimensions,
crop position and audio for MP4, MOV and WebM inputs, including rotated clips.
