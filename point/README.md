# Point

A minimal, gesture-only companion to Bulletpoints for Android. It reads and writes the same
Firestore document as the main app, so both stay in sync; it just shows the outline one list at a
time, with no buttons, toolbars or menus.

## How it works

Each screen is one list: the children of one bullet. Open items sit on top, struck-through ones
sink to the bottom. Any line with items inside can be unfolded in place, showing them indented
beneath it; every gesture works on those lines too.

| Do this | To |
| --- | --- |
| Tap a line | Edit it. If it has items inside, open it instead |
| Tap the right edge of a line | Open it, even if it's empty (this is how you start a sub-list) |
| Tap the title | Rename the list you're in |
| Swipe left | Strike it through (again to restore it) |
| Swipe right | Unfold what's inside it, in place; again to fold it away |
| Swipe right, as far again | Send it to Todoist, due today; again to take it back out |
| Pull down | New line at the top. Pull as far again to go up a level |
| Tap below the list | New line at the end |
| Pinch apart | New line between two others. Pinch much further for a divider line instead |
| Pinch together, or Back | Go up a level |
| Hold a line | Pick it up and move it. Slide right to tuck it into the line above; slide left to move it out a level |
| Pull up at the bottom | Clear every struck-through line on screen |

While typing a new line, Enter starts the next one; Enter on an empty line (or Backspace) stops.
Pasting several lines makes several items.

Nothing is deleted by a swipe, except a divider (swipe it left: it has nothing to strike through). To remove a line, strike it through and then clear; clearing shows
an Undo for a few seconds. (Erasing all of a line's text and leaving it also removes it, with the
same Undo.)

Which lines are unfolded is remembered on the phone only. It is separate from the main app's
collapse state, which Point never changes.

Things Point deliberately leaves out: search, formatting, font sizes, tasks, shortcuts, collapse
state, settings. It keeps whatever the main app stored for those and never changes them. The theme
follows the system.

## Todoist

Swiping a line right past the first stop, the same distance again, sends it to your Todoist Inbox
due today. The line gets a small point at its right edge: hollow while it is waiting to reach
Todoist (offline, say), solid once the task exists. The same swipe again takes the line back out
and deletes the task.

- Completing the task in Todoist strikes the line through in Point; striking the line in Point
  completes the task. Restoring works both ways too.
- Rewording the line in Point renames the task. Renaming the task in Todoist is not copied back.
- Deleting the task in Todoist just removes the point; the line stays. Clearing or deleting the
  line in Point leaves the task in Todoist as it is.
- Only the line itself is sent, not the items inside it. A struck-through line can't be sent.

The first time, Point asks for your Todoist API token (Todoist → Settings → Integrations →
Developer); pasting it is enough. The token stays on the phone and is never written to the shared
outline; only the task's id is stored on the item. If Todoist stops accepting the token, Point
forgets it and asks again the next time a line is sent.

There is no server involved, so changes made in Todoist are picked up when Point is opened, when
it comes back to the foreground, and about once a minute while it is open.

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
