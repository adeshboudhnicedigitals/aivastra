#!/usr/bin/env bash
# Builds the WordPress plugin into two release zips from the same source tree
# in wordpress-plugin/:
#
#   dist/wordpress-plugin/aivastra-tryon-wporg-<version>.zip
#     For WordPress.org submission/SVN. Excludes the self-hosted update
#     checker entirely -- a wp.org-listed plugin must not carry its own
#     update mechanism (WordPress core owns updates for a listed slug via the
#     SVN Stable tag). See wordpress-plugin/includes/class-update-checker.php.
#
#   dist/wordpress-plugin/aivastra-tryon-direct-<version>.zip
#     For direct distribution (pilot merchants, self-hosted download link).
#     Includes the update checker so installs get a normal wp-admin "Update
#     available" row via GET /v1/wordpress-plugin/update-info.
#
# Both exclude dev-only content: local-wp/, tests/, composer.json/lock, the
# root vendor/ (composer's PHPUnit dev dependencies -- not to be confused
# with includes/vendor/plugin-update-checker/, which IS shipped code),
# phpunit.xml.dist, and .DS_Store cruft.
#
# Usage: scripts/wordpress-plugin/build-zip.sh [version]
#   version defaults to the Version: header in aivastra-tryon.php.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$REPO_ROOT/wordpress-plugin"
DIST="$REPO_ROOT/dist/wordpress-plugin"
SLUG="aivastra-tryon"

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  VERSION="$(grep -m1 -oP '^\s*\*\s*Version:\s*\K[0-9][0-9.]*' "$SRC/aivastra-tryon.php")"
fi
if [ -z "$VERSION" ]; then
  echo "Could not determine plugin version from aivastra-tryon.php; pass it explicitly." >&2
  exit 1
fi

echo "Building $SLUG zips for version $VERSION"

rm -rf "$DIST/stage"
mkdir -p "$DIST/stage"

# Common exclusions for both variants: dev-only content that never ships.
# rsync excludes matched directories recursively, so no trailing "/**" needed.
# The leading "/" on /vendor anchors it to the plugin root -- composer's own
# PHPUnit dev deps live at wordpress-plugin/vendor/, but an unanchored
# "vendor" would also match (and wrongly strip) the shipped
# includes/vendor/plugin-update-checker/ directory.
#
# These are on top of wordpress-plugin/.gitignore (applied below via
# --filter=':- .gitignore') -- a PHPUnit run against the working tree drops
# a .phpunit.result.cache file that .gitignore already excludes from git,
# but an rsync-based copy of the working tree doesn't consult .gitignore on
# its own, so a stray cache file has previously ended up inside a built zip.
COMMON_EXCLUDES=(
  --exclude "/local-wp"
  --exclude "/tests"
  --exclude "/composer.json"
  --exclude "/composer.lock"
  --exclude "/vendor"
  --exclude "/phpunit.xml.dist"
  --exclude ".DS_Store"
)

build_variant() {
  local variant="$1" # "wporg" | "direct"
  local stage="$DIST/stage/$variant/$SLUG"
  mkdir -p "$stage"

  rsync -a --filter=":- .gitignore" "${COMMON_EXCLUDES[@]}" "$SRC/" "$stage/"

  if [ "$variant" = "wporg" ]; then
    # A wp.org-listed plugin must not carry its own update mechanism.
    # includes/vendor/ exists only to hold the update-checker library, so
    # drop the whole directory, not just its one subfolder.
    rm -f "$stage/includes/class-update-checker.php"
    rm -rf "$stage/includes/vendor"
  fi

  local zip_path="$DIST/${SLUG}-${variant}-${VERSION}.zip"
  rm -f "$zip_path"
  (cd "$DIST/stage/$variant" && zip -rq "$zip_path" "$SLUG")
  echo "  wrote $zip_path"
}

build_variant wporg
build_variant direct

rm -rf "$DIST/stage"
echo "Done. Zips in $DIST/"
