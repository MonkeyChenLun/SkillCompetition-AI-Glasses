# AI Glasses front end

| What you need | Windows management console | Android companion |
| --- | --- | --- |
| Setup and demo guide | [Windows guide](windows/README.md) | [Android guide](android/README.md) |
| Application source | [React console](windows/src/) | [React companion](android/src/) and [native Android project](android/android/) |
| Runtime images | [Icons and branding](windows/public/) | [Web illustrations](android/public/) and [native app resources](android/android/app/src/main/res/) |
| UI screenshots | [Console screenshots](windows/media/screenshots/) | [Phone screenshots](android/media/screenshots/) |
| Demo | [Console videos](windows/media/demos/) | [Download the debug APK](android/downloads/AI-Glasses-Android-User-debug.apk) |

The Windows console runs in a desktop browser. Both apps use demo data. From either platform directory, run `npm ci` followed by `npm run dev`. The Windows launcher is [start-windows.bat](windows/start-windows.bat).

## Design and documentation

- [V0.1.7 UI specification, NoahVision logo rationale & work log (`GminiSuggesion`)](windows/GminiSuggesion/)
- [UI mockups](windows/design/mockups/) and [original logo, animation and brand rationale](windows/design/brand-originals/)
- [Console user guide](windows/docs/guides/console-user-guide.docx), [development guidelines](windows/docs/development/) and [design reviews](windows/docs/reviews/)

## Earlier versions

The [archive](archive/) holds the [v0.1.4 console](archive/windows/v0.1.4/), the [v0.1.3 console](archive/windows/v0.1.3/), the [team console snapshot](archive/windows/team-console/), [intermediate design files](archive/windows/design-iterations/) and the [previous Android build and source](archive/android/previous/). Each design iteration contains only the files captured at that stage.
