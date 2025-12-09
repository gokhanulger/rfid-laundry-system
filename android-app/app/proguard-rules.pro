# Add project specific ProGuard rules here.
# Keep Chainway SDK classes
-keep class com.rscja.** { *; }
-keep class com.uhf.** { *; }

# Keep Retrofit
-keepattributes Signature
-keepattributes *Annotation*
-keep class retrofit2.** { *; }
-keepclasseswithmembers class * {
    @retrofit2.http.* <methods>;
}

# Keep Gson
-keep class com.google.gson.** { *; }
-keep class * implements com.google.gson.TypeAdapterFactory
-keep class * implements com.google.gson.JsonSerializer
-keep class * implements com.google.gson.JsonDeserializer

# Keep data classes
-keep class com.laundry.rfid.data.remote.dto.** { *; }
-keep class com.laundry.rfid.domain.model.** { *; }
