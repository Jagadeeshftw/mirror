#!/bin/bash
# Start Mirror's two sign-in emulators (mirror-a, mirror-b) for the one-time Google sign-in.
# Stop them afterwards with: devices/stop-mirror-emulators.sh
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools
for avd in mirror-a mirror-b; do
  nohup "$ANDROID_HOME/emulator/emulator" -avd "$avd" -no-boot-anim >/tmp/emu-$avd.log 2>&1 &
  sleep 2
done
echo "Booting mirror-a and mirror-b. Screen-lock PIN is 1234. Sign in via Settings > Passwords & accounts > Add account > Google."
