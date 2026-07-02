# Changelog

All notable changes to the Ai Vastra Admin Mobile App will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-06-30
### Added
- Dynamic tab bar padding for safe areas on the dashboard.
- Proper role guard for catalog category edits (`SUPER_ADMIN` and `ADMIN` only).
- `BUILD_NUMBER` support for EAS CI version tracking.

### Fixed
- UUID regex validation in Smart Search to strictly match v4 structure.
- `useApi` cache clearing when route path changes, eliminating stale data flashes.
- Silent background polling causing visual pull-to-refresh spinner jitter.
- Unmounted component state update warnings in Login and User deletion flows.
- Memory leak issue with search input debouncing in the Users list.
- Skeleton loader layout bugs on widget client details page.
- Keyboard overlapping inputs on Android devices (`KeyboardAvoidingView` fix).
- Copy to clipboard functionality in widget details.

### Changed
- Refactored `WorkerCard` into a centralized, robust component replacing ad-hoc inline versions.
- Disabled `appVersionSource: "local"` in EAS in favor of `remote`.
