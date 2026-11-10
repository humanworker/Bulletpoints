# Point

A minimal, gesture-only companion to Bulletpoints for Android. It reads and writes the same
Firestore document as the main app, so both stay in sync; it just shows the outline one list at a
time, with no buttons, toolbars or menus.

## How it works

Each screen is one list: the children of one bullet. Open items sit on top, completed ones sink to
the bottom.

| Do this | To |
| --- | --- |
| Tap a line | Edit it. If it has items inside, open it instead |
| Tap the right edge of a line | Open it, even if it's empty (this is how you start a sub-list) |
| Tap the title | Rename the list you're in |
| Swipe right | Complete (again to un-complete) |
| Swipe left | Delete, with everything inside it |
| Pull down | New line at the top. Pull as far again to go up a level |
| Tap below the list | New line at the end |
| Pinch apart | New line between two others |
| Pinch together, or Back | Go up a level |
| Hold a line | Pick it up and move it. Slide right to tuck it into the line above; slide left to move it out a level |
| Pull up at the bottom | Clear the completed lines |

While typing a new line, Enter starts the next one; Enter on an empty line (or Backspace) stops.
Pasting several lines makes several items. Emptying a line deletes it. Deleting and clearing show
an Undo for a few seconds.

Things Point deliberately leaves out: search, formatting, font sizes, tasks, shortcuts, collapse
state, settings. It keeps whatever the main app stored for those and never changes them. The theme
follows the system.

## Data

Same Firebase project, collection and document as the main app (`src/firebase.ts`), same
item shape, and the same per-item three-way merge when changes arrive from another device.
Completing sets `isCompleted` and moves the item below the open ones; the main app shows those
struck through.

A dot in the top-right corner appears only when saving is slow (grey) or failing (red).

## Build

```sh
npm install
npm run dev          # browser; add ?local to the URL for a sample outline that never touches Firebase
npm run apk          # android/app/build/outputs/apk/debug/app-debug.apk
```

Building the APK needs a JDK (17+) and the Android SDK (platform 34), with `ANDROID_HOME` set or
`sdk.dir` in `android/local.properties`. The app id is `com.bulletpoints.point`, so it installs
alongside the main Bulletpoints app.
