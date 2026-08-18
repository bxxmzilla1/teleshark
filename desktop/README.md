# MultiGram Desktop (C++ / Qt)

A native C++ desktop app for Windows built with the Qt framework. It hosts
your deployed MultiGram web app in an embedded Chromium view (Qt WebEngine),
so every feature — accounts, vault, voice notes, drag-and-drop sending —
works exactly like in the browser, but as a real desktop program with its own
window, icon and taskbar entry. Login and the local vault persist between
launches.

## Prerequisites (one-time setup)

Qt WebEngine on Windows **requires the MSVC build of Qt** (MinGW is not
supported).

1. **Visual Studio 2022 Build Tools** (the C++ compiler):

   ```powershell
   winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
   ```

2. **Qt 6 (MSVC 64-bit) with WebEngine**, using the Qt Online Installer from
   <https://www.qt.io/download-qt-installer> (free account). In the installer
   select, under the latest Qt 6.x:
   - `MSVC 2022 64-bit`
   - `Qt WebEngine` (under *Additional Libraries*)
   - Under *Build Tools*: `CMake` and `Ninja`

   Default install location is `C:\Qt`.

## Build

Open **"x64 Native Tools Command Prompt for VS 2022"** (installed by step 1),
go to the repository folder and run (adjust `6.7.3` to the Qt version you
installed):

```bat
set PATH=C:\Qt\Tools\CMake_64\bin;C:\Qt\Tools\Ninja;%PATH%
cmake -S desktop -B desktop\build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH=C:\Qt\6.7.3\msvc2022_64
cmake --build desktop\build
```

The executable is `desktop\build\MultiGram.exe`.

## Run

On first launch the app asks for your MultiGram URL — enter your Vercel
deployment address (e.g. `https://your-app.vercel.app`). It's remembered; you
can change it any time via **App → Set app URL…**.

To run the exe outside the build environment (or copy it to another PC),
bundle the Qt runtime next to it once:

```bat
C:\Qt\6.7.3\msvc2022_64\bin\windeployqt.exe desktop\build\MultiGram.exe
```

Then the whole `desktop\build` folder is self-contained — you can create a
shortcut to `MultiGram.exe`, pin it to the taskbar, or zip the folder and use
it on any Windows PC without installing Qt.
