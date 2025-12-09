# Laundry RFID Android App

Android application for Chainway C72 RFID scanner to track laundry items.

## Features

- **Login** - Authenticate with backend
- **4 Workflow Modes** - Pickup, Process, Package, Deliver
- **Bulk RFID Scanning** - Scan hundreds of tags per session
- **Offline Mode** - Works without internet, syncs when connected
- **Auto-Sync** - Background sync with WorkManager

## Setup Instructions

### 1. Open in Android Studio

1. Open Android Studio
2. File → Open → Select `android-app` folder
3. Wait for Gradle sync to complete

### 2. Download Chainway SDK

1. Go to [Chainway Support](https://www.chainway.net/Support/Info/10)
2. Download "UHF for Android Studio" SDK
3. Extract the `.aar` file
4. Copy to `app/libs/` folder

### 3. Configure Backend URL

Edit `app/build.gradle.kts`:

```kotlin
buildConfigField("String", "API_BASE_URL", "\"https://YOUR-BACKEND-URL.railway.app/api/\"")
```

### 4. Build & Run

1. Connect Chainway C72 device via USB
2. Enable USB debugging on device
3. Click Run in Android Studio

## Project Structure

```
app/src/main/java/com/laundry/rfid/
├── LaundryRFIDApp.kt          # Application class
├── data/
│   ├── local/                 # Room database
│   │   ├── AppDatabase.kt
│   │   ├── dao/               # Data Access Objects
│   │   └── entity/            # Database entities
│   ├── remote/                # Retrofit API
│   │   ├── api/ApiService.kt
│   │   └── dto/               # Data Transfer Objects
│   └── repository/            # Repositories
├── di/                        # Hilt dependency injection
├── domain/model/              # Domain models
├── rfid/                      # RFID SDK wrapper
│   └── RfidManager.kt
├── sync/                      # Background sync
│   ├── SyncWorker.kt
│   └── BootReceiver.kt
├── ui/
│   ├── MainActivity.kt
│   ├── LaundryRFIDApp.kt      # Navigation
│   ├── login/                 # Login screen
│   ├── home/                  # Home screen
│   ├── scan/                  # Scanning screen
│   └── theme/                 # App theme
└── util/
    └── PreferencesManager.kt  # DataStore preferences
```

## SDK Integration

The `RfidManager.kt` file contains the Chainway SDK integration. Currently in simulation mode for testing.

To enable real RFID scanning:

1. Add SDK `.aar` to `app/libs/`
2. Uncomment SDK code in `RfidManager.kt`
3. Remove simulation methods

## Testing Without Device

The app includes simulation mode:
- Press "+" button on scan screen to simulate tag reads
- Useful for testing UI without physical device

## API Endpoints Used

| Endpoint | Description |
|----------|-------------|
| `POST /auth/login` | User login |
| `POST /devices/register` | Register device |
| `POST /scan/session/start` | Start scan session |
| `POST /scan/session/:id/end` | End session |
| `POST /scan/sync` | Sync offline sessions |

## Building APK

```bash
./gradlew assembleRelease
```

APK will be at: `app/build/outputs/apk/release/app-release.apk`

## Troubleshooting

### SDK Not Found
- Ensure `.aar` file is in `app/libs/`
- Sync Gradle after adding

### Can't Connect to Device
- Enable USB debugging
- Accept USB debugging prompt on device
- Try different USB cable

### Sync Not Working
- Check internet connection
- Verify backend URL is correct
- Check backend logs for errors
