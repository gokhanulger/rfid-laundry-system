# Add project specific ProGuard rules here.

# Optimization flags
-optimizationpasses 5
-allowaccessmodification
-repackageclasses ''

# Keep Chainway/RFID SDK classes (JNI)
-keep class com.rscja.** { *; }
-keep class com.uhf.** { *; }
-keep class cn.pda.** { *; }
-dontwarn android.os.SystemProperties
-dontwarn com.rscja.**
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep Retrofit
-keepattributes Signature
-keepattributes *Annotation*
-keep class retrofit2.** { *; }
-keepclasseswithmembers class * {
    @retrofit2.http.* <methods>;
}

# Keep OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }

# Keep Gson
-keep class com.google.gson.** { *; }
-keep class * implements com.google.gson.TypeAdapterFactory
-keep class * implements com.google.gson.JsonSerializer
-keep class * implements com.google.gson.JsonDeserializer
-keepattributes Signature
-keepattributes EnclosingMethod
-keepattributes InnerClasses
-keepattributes Annotation

# Keep data classes with full type information for Gson
-keep class com.laundry.rfid.data.remote.dto.** { *; }
-keepclassmembers class com.laundry.rfid.data.remote.dto.** { *; }
-keep class com.laundry.rfid.domain.model.** { *; }
-keepclassmembers class com.laundry.rfid.domain.model.** { *; }
-keep class com.laundry.rfid.data.local.entity.** { *; }
-keepclassmembers class com.laundry.rfid.data.local.entity.** { *; }

# Keep generic type info for API responses
-keep,allowobfuscation,allowshrinking class retrofit2.Response

# Keep Room
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Entity class *
-dontwarn androidx.room.paging.**

# Keep Hilt
-keep class dagger.hilt.** { *; }
-keep class javax.inject.** { *; }
-keep class * extends dagger.hilt.android.internal.managers.ComponentSupplier { *; }
-keep class * implements dagger.hilt.internal.GeneratedComponent { *; }
-keepclasseswithmembers class * {
    @dagger.* <fields>;
}
-keepclasseswithmembers class * {
    @javax.inject.* <fields>;
}

# Keep Compose
-dontwarn androidx.compose.**
