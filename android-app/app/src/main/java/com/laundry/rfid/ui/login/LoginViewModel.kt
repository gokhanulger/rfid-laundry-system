package com.laundry.rfid.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.laundry.rfid.data.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LoginUiState(
    val email: String = "",
    val password: String = "",
    val role: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val isSuccess: Boolean = false
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    val isLoggedIn: Flow<Boolean> = authRepository.isLoggedIn

    // Şifre tanımları
    private val DRIVER_PASSWORD = "1234"
    private val ADMIN_PASSWORD = "145344"

    fun onEmailChange(email: String) {
        _uiState.update { it.copy(email = email, error = null) }
    }

    fun onPasswordChange(password: String) {
        _uiState.update { it.copy(password = password, error = null) }
    }

    fun onRoleChange(role: String) {
        _uiState.update { it.copy(role = role, error = null) }
    }

    fun login() {
        val state = _uiState.value

        if (state.role.isBlank()) {
            _uiState.update { it.copy(error = "Lütfen giriş türü seçin") }
            return
        }

        if (state.password.isBlank()) {
            _uiState.update { it.copy(error = "Şifre giriniz") }
            return
        }

        // Şifre doğrulama
        val isValid = when (state.role) {
            "DRIVER" -> state.password == DRIVER_PASSWORD
            "ADMIN" -> state.password == ADMIN_PASSWORD
            else -> false
        }

        if (!isValid) {
            _uiState.update { it.copy(error = "Yanlış şifre") }
            return
        }

        // Lokal giriş başarılı - backend'e de gönder
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            // Backend'e uygun email ile giriş yap
            val email = when (state.role) {
                "DRIVER" -> "driver@laundry.com"
                "ADMIN" -> "admin@laundry.com"
                else -> "driver@laundry.com"
            }
            val password = when (state.role) {
                "DRIVER" -> "driver123"
                "ADMIN" -> "admin123"
                else -> "driver123"
            }

            val result = authRepository.login(email, password)

            result.fold(
                onSuccess = { user ->
                    // Register device after successful login
                    authRepository.registerDevice()

                    _uiState.update {
                        it.copy(isLoading = false, isSuccess = true)
                    }
                },
                onFailure = { error ->
                    // Backend hatası olsa bile lokal şifre doğruysa giriş yap
                    // Offline mod desteği için
                    authRepository.setOfflineLogin(state.role)
                    _uiState.update {
                        it.copy(isLoading = false, isSuccess = true)
                    }
                }
            )
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
