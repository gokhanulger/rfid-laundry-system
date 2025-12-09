package com.laundry.rfid.di

import android.content.Context
import androidx.room.Room
import com.laundry.rfid.BuildConfig
import com.laundry.rfid.data.local.AppDatabase
import com.laundry.rfid.data.local.dao.CachedItemDao
import com.laundry.rfid.data.local.dao.ScanEventDao
import com.laundry.rfid.data.local.dao.ScanSessionDao
import com.laundry.rfid.data.local.dao.SyncQueueDao
import com.laundry.rfid.data.remote.api.ApiService
import com.laundry.rfid.rfid.RfidManager
import com.laundry.rfid.util.PreferencesManager
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun providePreferencesManager(
        @ApplicationContext context: Context
    ): PreferencesManager = PreferencesManager(context)

    @Provides
    @Singleton
    fun provideOkHttpClient(
        preferencesManager: PreferencesManager
    ): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }

        return OkHttpClient.Builder()
            .addInterceptor(logging)
            .addInterceptor { chain ->
                val token = preferencesManager.getAuthTokenSync()
                val request = if (token != null) {
                    chain.request().newBuilder()
                        .addHeader("Authorization", "Bearer $token")
                        .build()
                } else {
                    chain.request()
                }
                chain.proceed(request)
            }
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    @Provides
    @Singleton
    fun provideRetrofit(okHttpClient: OkHttpClient): Retrofit {
        return Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    @Provides
    @Singleton
    fun provideApiService(retrofit: Retrofit): ApiService {
        return retrofit.create(ApiService::class.java)
    }

    @Provides
    @Singleton
    fun provideDatabase(
        @ApplicationContext context: Context
    ): AppDatabase {
        return Room.databaseBuilder(
            context,
            AppDatabase::class.java,
            "laundry_rfid_db"
        )
            .fallbackToDestructiveMigration()
            .build()
    }

    @Provides
    @Singleton
    fun provideScanSessionDao(database: AppDatabase): ScanSessionDao {
        return database.scanSessionDao()
    }

    @Provides
    @Singleton
    fun provideScanEventDao(database: AppDatabase): ScanEventDao {
        return database.scanEventDao()
    }

    @Provides
    @Singleton
    fun provideCachedItemDao(database: AppDatabase): CachedItemDao {
        return database.cachedItemDao()
    }

    @Provides
    @Singleton
    fun provideSyncQueueDao(database: AppDatabase): SyncQueueDao {
        return database.syncQueueDao()
    }

    @Provides
    @Singleton
    fun provideRfidManager(
        @ApplicationContext context: Context
    ): RfidManager {
        return RfidManager(context)
    }
}
