package com.laundry.tablet.di

import android.content.Context
import androidx.room.Room
import com.laundry.tablet.BuildConfig
import com.laundry.tablet.data.ApiService
import com.laundry.tablet.data.local.AppDatabase
import com.laundry.tablet.data.local.DeliveryDao
import com.laundry.tablet.data.local.ItemDao
import com.laundry.tablet.data.local.PendingOperationDao
import com.laundry.tablet.data.local.TenantDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    // Simple token holder - set after login
    var authToken: String? = null

    @Provides
    @Singleton
    fun provideOkHttpClient(): OkHttpClient {
        val authInterceptor = Interceptor { chain ->
            val request = chain.request().newBuilder().apply {
                authToken?.let { token ->
                    addHeader("Authorization", "Bearer $token")
                }
            }.build()
            chain.proceed(request)
        }

        val loggingInterceptor = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.HEADERS
                    else HttpLoggingInterceptor.Level.NONE
        }

        return OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(loggingInterceptor)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    @Provides
    @Singleton
    fun provideRetrofit(client: OkHttpClient): Retrofit {
        return Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(client)
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
    fun provideDatabase(@ApplicationContext context: Context): AppDatabase {
        return Room.databaseBuilder(
            context,
            AppDatabase::class.java,
            "laundry_tablet.db"
        ).fallbackToDestructiveMigration().build()
    }

    @Provides
    @Singleton
    fun provideItemDao(db: AppDatabase): ItemDao {
        return db.itemDao()
    }

    @Provides
    @Singleton
    fun provideTenantDao(db: AppDatabase): TenantDao {
        return db.tenantDao()
    }

    @Provides
    @Singleton
    fun provideDeliveryDao(db: AppDatabase): DeliveryDao {
        return db.deliveryDao()
    }

    @Provides
    @Singleton
    fun providePendingOperationDao(db: AppDatabase): PendingOperationDao {
        return db.pendingOperationDao()
    }
}
