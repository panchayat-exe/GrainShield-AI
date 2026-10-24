# Maps Setup for GrainShield AI Mobile

The live tracking screen (`app/(app)/tracking.tsx`) currently shows a placeholder in place of a map view.
To enable full map functionality, follow the steps below.

## 1. Install `react-native-maps`

```bash
cd mobile
npx expo install react-native-maps
```

## 2. Android — Google Maps API key

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Maps SDK for Android**.
3. Create an API key.
4. Add it to `mobile/app.json` inside the `android` section:

```json
"android": {
  "config": {
    "googleMaps": {
      "apiKey": "YOUR_ANDROID_GOOGLE_MAPS_API_KEY"
    }
  }
}
```

## 3. iOS — Apple Maps (default)

Apple Maps works out of the box on iOS with no API key.
If you prefer Google Maps on iOS:

1. Enable **Maps SDK for iOS** in Google Cloud Console.
2. Create an iOS API key.
3. Add it to `mobile/app.json` inside the `ios` section:

```json
"ios": {
  "config": {
    "googleMapsApiKey": "YOUR_IOS_GOOGLE_MAPS_API_KEY"
  }
}
```

## 4. Replace the MapPlaceholder in `tracking.tsx`

Find the comment `{/* MAP PLACEHOLDER */}` in `app/(app)/tracking.tsx` and replace:

```tsx
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

// Replace MapPlaceholder View with:
<MapView
  style={{ width: '100%', height: 240, borderRadius: 12 }}
  provider={PROVIDER_GOOGLE}           // Remove for iOS Apple Maps
  initialRegion={{
    latitude: latestLocation?.latitude ?? 23.0225,
    longitude: latestLocation?.longitude ?? 72.5714,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  }}
>
  {latestLocation && (
    <Marker
      coordinate={{
        latitude: latestLocation.latitude,
        longitude: latestLocation.longitude,
      }}
      title="Vehicle location"
    />
  )}
</MapView>
```

## 5. Environment variables

Add the following to `mobile/.env` (and never commit this file):

```
EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY=YOUR_ANDROID_GOOGLE_MAPS_API_KEY
```

Then reference it in `app.json` using the Expo config plugin pattern, or set it directly.

## Notes

- `react-native-maps` requires a **native build** — it will not work with Expo Go on Android if using Google Maps. Use a **development build** (`npx expo run:android`) or EAS Build.
- On iOS with Apple Maps, Expo Go works fine.
- The Supabase `trip_locations` table already stores latitude/longitude from the mobile app's GPS push — no schema changes needed for maps.
