# Project-specific R8 rules for the release build (isMinifyEnabled in
# build.gradle.kts). Empty for now: Flutter's own Gradle plugin already keeps
# everything the engine and platform channels need, and every plugin this app
# uses (google_sign_in, video_player, image_picker, share_plus, flutter_secure_storage,
# hive, etc.) ships its own consumer ProGuard rules inside its AAR, applied
# automatically. Add app-specific keep rules here only if a release build
# (not debug — R8 only runs in release) crashes with a
# ClassNotFoundException/NoSuchMethodError that a debug build doesn't.
