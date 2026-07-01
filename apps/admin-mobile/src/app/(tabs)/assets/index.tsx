import { Redirect } from 'expo-router';

// Matches apps/admin-web/src/pages/assets/AssetsContext.tsx's default activeTab —
// the Assets section always opens on Garment Types, switched via the persistent
// AssetsTabBar rendered by each list screen (faces/backgrounds/garment-types/
// pose-assets/catalog), not a separate hub/tile screen.
export default function AssetsIndexRedirect() {
  return <Redirect href="/(tabs)/assets/garment-types" />;
}
