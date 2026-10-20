package net.mister_k.meterbook.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import net.mister_k.meterbook.MeterBookApp
import net.mister_k.meterbook.data.ApiException
import net.mister_k.meterbook.data.OfflineException
import net.mister_k.meterbook.data.OcrResult
import net.mister_k.meterbook.data.ReadingGroupIn
import net.mister_k.meterbook.data.ReadingValueIn
import net.mister_k.meterbook.data.RegisterWarnings
import net.mister_k.meterbook.data.prepareForUpload
import net.mister_k.meterbook.work.SyncWorker
import java.io.File
import java.time.Instant

data class CaptureState(
    val meterId: String = "",
    val photo: File? = null,
    val takenAt: Instant = Instant.now(),
    val uploading: Boolean = false,
    val photoId: String? = null,
    val ocr: OcrResult? = null,
    val ocrError: String? = null,
    val offline: Boolean = false,
    /** Eingabetexte je Zählwerk */
    val inputs: Map<String, String> = emptyMap(),
    val note: String = "",
    val warnings: List<RegisterWarnings> = emptyList(),
    val saving: Boolean = false,
    val error: String? = null,
)

sealed interface SaveOutcome {
    data object Saved : SaveOutcome
    data object Queued : SaveOutcome
}

/** Zustand von der Aufnahme bis zum Speichern einer Ablesung. */
class CaptureViewModel(application: Application) : AndroidViewModel(application) {
    private val app = application as MeterBookApp
    private val _state = MutableStateFlow(CaptureState())
    val state: StateFlow<CaptureState> = _state.asStateFlow()
    private var checkJob: Job? = null

    fun start(meterId: String, rawPhoto: File?) {
        _state.value = CaptureState(meterId = meterId, takenAt = Instant.now())
        if (rawPhoto == null) return
        viewModelScope.launch {
            val prepared = withContext(Dispatchers.IO) {
                prepareForUpload(rawPhoto, File(app.cacheDir, "upload_${System.currentTimeMillis()}.jpg")).also {
                    if (it != rawPhoto) rawPhoto.delete()
                }
            }
            _state.update { it.copy(photo = prepared, uploading = true) }
            try {
                val res = app.api.uploadPhoto(meterId, prepared, _state.value.takenAt.toString(), recognize = true)
                val meter = app.repo.meter(meterId)
                val inputs = res.ocr?.registers?.mapNotNull { r ->
                    val decimals = meter?.registers?.firstOrNull { it.id == r.registerId }?.decimals ?: 1
                    r.value?.let { r.registerId to inputValue(it, decimals) }
                }?.toMap().orEmpty()
                _state.update {
                    it.copy(uploading = false, photoId = res.photoId, ocr = res.ocr, ocrError = res.ocrError, warnings = res.warnings, inputs = it.inputs + inputs)
                }
            } catch (e: OfflineException) {
                _state.update { it.copy(uploading = false, offline = true) }
            } catch (e: ApiException) {
                _state.update { it.copy(uploading = false, ocrError = e.message) }
            }
        }
    }

    fun setInput(registerId: String, text: String) {
        _state.update { it.copy(inputs = it.inputs + (registerId to text), error = null) }
        scheduleCheck()
    }

    fun setNote(text: String) = _state.update { it.copy(note = text) }

    private fun values(s: CaptureState): List<ReadingValueIn> = s.inputs.mapNotNull { (id, text) ->
        val v = parseNumber(text) ?: return@mapNotNull null
        val ocr = s.ocr?.registers?.firstOrNull { it.registerId == id }
        ReadingValueIn(id, v, ocr?.value, ocr?.confidence)
    }

    private fun scheduleCheck() {
        checkJob?.cancel()
        checkJob = viewModelScope.launch {
            delay(500)
            val s = _state.value
            val vals = values(s)
            if (vals.isEmpty() || s.offline) return@launch
            try {
                val w = app.api.check(s.meterId, ReadingGroupIn(s.takenAt.toString(), values = vals))
                _state.update { it.copy(warnings = w) }
            } catch (_: Exception) {
            }
        }
    }

    suspend fun save(): SaveOutcome? {
        val s = _state.value
        val meter = app.repo.meter(s.meterId)
        val vals = values(s)
        if (vals.isEmpty()) {
            _state.update { it.copy(error = "Bitte den Zählerstand eingeben.") }
            return null
        }
        if (meter != null && s.inputs.any { (_, t) -> t.isNotBlank() && parseNumber(t) == null }) {
            _state.update { it.copy(error = "Bitte nur Zahlen eingeben, z. B. 29789,6") }
            return null
        }
        _state.update { it.copy(saving = true, error = null) }
        val group = ReadingGroupIn(s.takenAt.toString(), s.photoId, if (s.photoId != null) "PHOTO" else "MANUAL", s.note.ifBlank { null }, vals)
        return try {
            if (s.offline) throw OfflineException(Exception("offline"))
            app.api.saveReading(s.meterId, group)
            cleanup()
            SaveOutcome.Saved
        } catch (e: OfflineException) {
            // Ohne Netz: Foto und Werte merken, später senden.
            app.queue.add(s.meterId, meter?.name ?: "Zähler", s.takenAt.toString(), vals, s.note.ifBlank { null }, if (s.photoId == null) s.photo else null)
            SyncWorker.enqueue(app)
            cleanup()
            SaveOutcome.Queued
        } catch (e: ApiException) {
            _state.update { it.copy(saving = false, error = e.message) }
            null
        }
    }

    private fun cleanup() {
        _state.value.photo?.delete()
        _state.value = CaptureState()
    }

    fun discard() = cleanup()
}
