# Improve Annotations

Text annotation boxes should automatically size based on text-entry.
Text annotation dragging is awkward.

Check key shortcuts for annotations work.


## Server (local + online)

X implemented phase 1
TODO implement phase 2

## Electron Build Resources

Missing resources for complete macOS build:

- [ ] Add `resources/icon.icns` - App icon for macOS
- [ ] Add `resources/cascade-doc.icns` - Document icon for .cascade files
- [ ] Add `resources/dmg-background.png` - Background image for DMG installer
- [ ] Add `resources/icon.ico` - App icon for Windows
- [ ] Add `resources/cascade-doc.ico` - Document icon for Windows
- [ ] Configure Apple Developer ID code signing for distribution
- [ ] Enable notarization for macOS Gatekeeper

## QUILL Chat Flow

- UI bugfixes
- cables
- model auto select



## Command Line Interface

- implement CASCADE_CLI_SPEC.md





### Command-line file opening

Opening a specific .cascade file works when running electron directly:

```bash
NODE_ENV=development ./node_modules/.bin/electron . '/path/to/file.cascade'
```

Note: `npm run electron:dev /path/to/file.cascade` doesn't work because concurrently doesn't forward extra arguments to electron. Options:

- [ ] Add a separate `electron:open` script that accepts file path
- [ ] Or use the direct electron command as shown above


----------------------------------------------------------------------------

- move server to src/server
- Update VERSION.md
- Update ARCHITECTURE.md
- Update README.md
- review specs with what was actually implemented and what is still to be implemented