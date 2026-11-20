# MediaPipe canonical face source

The nano clinical scene derives its anonymous surface from MediaPipe's
`canonical_face_model.obj`:

- Source:
  <https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj>
- Raw source SHA-256:
  `8BAC80443397E113F41A8B565EA72C59390BC031D9DEFAB289DBA7BC0C54E618`
- Upstream project: Google MediaPipe
- Upstream license: Apache License 2.0

`scripts/generate-nano-scene-assets.mjs` normalizes the 468-vertex canonical
mesh and performs deterministic, area-weighted low-discrepancy barycentric
sampling. It generates:

- `canonicalFaceMesh.generated.js`, a compact typed source mesh used at runtime
  without parsing OBJ.
- `mediapipe-canonical-face-48k.glb`, a glTF 2.0 point primitive with 48,000
  ordered face positions plus lattice, seed, and flow attributes.
- `nano-face-light.webp` and `nano-face-dark.webp`, transparent first-paint
  posters rasterized from those same ordered face positions.

The first 24,000 and 12,000 samples are the medium and low LODs. The uploaded
visual reference bitmap is not included, parsed, traced, or distributed.

Poster regeneration requires FFmpeg with the `libwebp` encoder. Set
`FFMPEG_PATH` when `ffmpeg` is not available on `PATH`.
