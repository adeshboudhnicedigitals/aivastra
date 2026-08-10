# Progress Log

## [2026-07-30] Saree Styles API & Body + Pallu Separate Upload Integration

### Done
- **Saree Styles API**: Added `GET /v1/merchant/catalog/saree-styles` integration in `APIConstant.kt`, `MerchantCatalogModels.kt`, `MerchantCatalogRepository.kt`, and `ProductUploadViewModel.kt`.
- **Supports Two Input Filtering**: Filtered styles in Body + Pallu flow to only enable/display styles where `supportsTwoInput: true`.
- **Style Label Payload**: Updated generation request payload to resolve `sareeStyleId` using the style's `label` (e.g., `"Nivi"`, `"Seedha Pallu"`).
- **Photo Cropping Feature**: Added interactive UCrop image cropping buttons on `UploadPhotoDialog` preview cards (Single, Body, Pallu) and `"Crop Image"` option in `UploadVastraFragment` dialogs, configured with `setFreeStyleCropEnabled(true)` for freeform crop frame manipulation without forced zoom truncation.
- **Validation**: Added max 20 MB image size validation and dynamic content type detection (`image/jpeg`, `image/png`, `image/webp`).
- **Tests**: Created `SareeStyleTest.kt` unit test suite and verified Gradle build — `BUILD SUCCESSFUL`.

### Failed / Not Done
- None.

### Open Questions / Decisions
- None.

## [2026-07-29] Two-Input (Body + Pallu) Saree Generation API Integration

### Done
- **API Integration**: Integrated `secondFlatImageKey` into `MerchantCatalogRepository.generate()`, `ProductUploadViewModel.generateProduct()`, and `UploadPhotoDialog`.
- **Presign & Upload**: When both Body and Pallu photos are provided, the app presigns and uploads each image to R2 storage separately before issuing the `/v1/merchant/catalog/generate` request.

### Failed / Not Done
- None.

### Open Questions / Decisions
- None.

## [2026-07-29] Project Logo Replacement

### Done
- **Logo Replacement**: Updated all app layouts (`fragment_upload_vastra.xml`, `fragment_vastra_product_category.xml`, `activity_profile.xml`, `activity_splash_screen.xml`) to use `@drawable/av_new_logo_horizontal`.
- **Build Verification**: Ran `.\gradlew.bat assembleDebug` — `BUILD SUCCESSFUL`.

### Failed / Not Done
- None.

### Open Questions / Decisions
- None.
