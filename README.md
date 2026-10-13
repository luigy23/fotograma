# Fotograma

[Open the editor](https://luigy23.github.io/fotograma/) · [Try the example](https://luigy23.github.io/fotograma/?ejemplo) · [Leer en español](README.es.md)

<p align="center"><img src="docs/demo.gif" width="320" alt="The bundled example: a pixel-art wizard breathes, casts a spell and celebrates"></p>

Fotograma is a Lottie animation editor that runs in the browser, built with pixel art in mind. You bring in a drawing (PNG layers or an SVG copied from Figma), animate it with keyframes on a timeline, and export a Lottie JSON that plays the same in Flutter, iOS, Android and on the web. It can also export a sprite sheet. No account and no paid plan.

![The editor with the wizard example: layers, canvas, properties, effects and a timeline with named segments](docs/editor.png)

The layout follows Lottie Creator: layers on the left, canvas in the middle, properties on the right and the timeline at the bottom. The interface is in Spanish for now; translations are welcome.

## Features

**Animate**

- A keyframe toggle on every property (position, scale, rotation, opacity, anchor, size, colors, stroke, trim path) and an Auto-keyframe mode that keys any change you make.
- Easing presets first: Linear, Smooth, Ease in, Ease out, Gentle bounce and Hold. A bezier curve editor sits behind them for fine tuning.
- One-click micro-animations from the playhead: Appear, Pop, Bounce and Heartbeat, all with low overshoot.
- Copy and paste layers and keyframes (`⌘C`, `⌘X`, `⌘V`). Pasted keyframes start at the playhead and keep their spacing, on the same layer or on another one.
- Scale and rotate several layers together without grouping them, from the canvas or the properties panel.
- Unlimited undo, autosave in the browser and a project file (`.fotograma.json`) to keep editing later.
- A right-click menu everywhere, with group, ungroup, pick a part inside a group, and split a compound path into pieces (letters keep their holes).

**Pixel art mode** (on by default)

- Import PNG parts as stacked layers (body, eyes, orb…) or as a frame-by-frame sequence.
- The canvas is measured in art pixels. Positions always land on whole pixels, including in the middle of a motion.
- Images only scale in whole multiples (×1, ×2, ×3) and you get a warning when rotating pixel art by angles that aren't multiples of 90°.
- Nearest-neighbor rendering everywhere, from the canvas to the preview and the sprite sheet.

**Effects** that export cleanly

- Glow: a pulsing radial gradient behind the layer.
- Pixel glow: a baked halo of pixel rings around the silhouette plus 4-point pixel sparkles.
- Sparkles: small 4-point stars that twinkle around the layer.
- Each effect has color, intensity and pulse speed. On export they become plain Lottie layers parented to their layer, never blurs, After Effects effects or expressions, which the Flutter `lottie` package doesn't render reliably.

**Named segments**

Mark ranges on the timeline (idle, thinking, celebrate). They are exported as Lottie markers and in the sprite sheet metadata, so a developer can play a segment by name without touching the motion.

## Export

![Export panel with quality checks and a real-size phone preview](docs/exportar.png)

Before writing the file, Fotograma takes care of the technical part:

- removes hidden layers, empty groups, unused images and keyframes that change nothing; keeps unanimated properties static and rounds numbers;
- trims still frames at the start and end (optional, and it shows the resulting range);
- bakes pixel art: whole-pixel positions on every frame, and the drawing upscaled with nearest neighbor (×8, ×16…) so it stays sharp on a phone;
- translates effects into regular layers.

The export panel shows a traffic-light check of file size (green under 50 KB), layer count, masks and gradients, a performance warning for low-end Android phones (Samsung A52 class) and validation against the Lottie 1.0 specification. The preview is played by lottie-web inside a phone frame at real size.

Outputs:

- Lottie JSON and `.lottie` (dotLottie).
- Sprite sheet: every frame rendered at the art's native resolution without smoothing, packed in a PNG grid, plus a JSON with frame size, frame count, fps and segments (first and last frame). Individual frames can be downloaded as a `.zip`.

### Using it in Flutter

```dart
Lottie.asset('assets/animations/wizard.json', filterQuality: FilterQuality.none)
```

Play a segment with `composition.getMarker('idle')`. A `.lottie` file opens with `LottieComposition.decodeZip`, picking the JSON inside `animations/`.

## How it was checked

- Every export is validated against the official Lottie 1.0 JSON schema from the Lottie Animation Community.
- What the canvas shows matches what lottie-web draws from the final JSON, effects and pixel art included: 0% pixel difference on the pixel-art tests and at most 0.01% on vector shapes. A control test with a shape moved 15 px does register a difference, so the comparison catches real changes.
- A 110-layer image-sequence animation from a production app opens and re-exports with no visible difference.
- Flutter's `lottie` 3.3.2 reads the test exports without warnings: parented layers, the scaling null layer, hold keyframes, radial gradients, markers and `.lottie`.

## Not supported yet

- Opening After Effects precompositions and parented layers (the importer warns and opens the rest).
- Editing path points (pen tool) and shape morphing.
- Text layers and masks. Gradients from an SVG come in as their first color.

## Run it locally

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # model, import/export and optimization tests
npm run build    # static site in dist/
```

Built with React, TypeScript and Vite. The logic is kept apart from the interface:

| Folder | What lives there |
| --- | --- |
| `src/model` | Document, keyframes and easing, geometry with lottie-web's vertex order, matrices, effects |
| `src/io` | Lottie import and export, SVG import, export optimization, rasterizing (halos, sprite sheets), validation |
| `src/store` | State with undo, editing actions, clipboard, micro-animation presets, halo baking |
| `src/ui` | Canvas, layers, inspector, timeline, menus and export panel |
| `src/dev/fidelity.ts` | Pixel-by-pixel comparison between the canvas and lottie-web, to run from the dev console |

Add `?ejemplo` to the URL to open the bundled example. It is built in code in `src/examples/wizard.ts`, with the pixel art written as text (one character per pixel), so it's easy to tweak or use as a reference for the API.

## Contributing

Issues and pull requests are welcome. Good places to help: an English interface, opening After Effects precompositions, a pen tool, and text layers.

## License

[MIT](LICENSE) © Luigy Leonardo
