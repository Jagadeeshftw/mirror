#!/bin/bash
# Stop only Mirror's emulators (mirror-a, mirror-b, mirror-dev). Never touches other AVDs.
ADB=/opt/homebrew/share/android-commandlinetools/platform-tools/adb
for d in $($ADB devices | awk '/emulator/{print $1}'); do
  name=$($ADB -s "$d" emu avd name 2>/dev/null | head -1 | tr -d '\r')
  case "$name" in mirror-a|mirror-b|mirror-dev) $ADB -s "$d" emu kill >/dev/null && echo "stopped $name ($d)";; esac
done
