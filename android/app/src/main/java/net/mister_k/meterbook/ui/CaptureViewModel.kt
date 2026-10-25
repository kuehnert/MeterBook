package net.mister_k.meterbook.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import net.mister_k.meterbook.MeterBookApp
import net.mister_k.meterbook.data.ApiException
import net.mister_k.meterbook.data.InboxItem
import net.mister_k.meterbook.data.OcrResult
import net.mister_k.meterbook.data.OfflineException
import net.mister_k.meterbook.data.ReadingGroupIn
import net.mister_k.meterbook.data.ReadingValueIn
import net.mister_k.meterbook.data.RegisterWarnings
import net.mister_k.meterbook.data.UploadResult
import net.mister_k.meterbook.work.SyncWorker
import java.io.File
import java.time.Instant

data class CaptureState(
    /** null = Zähler noch nicht gewählt */
    val meterId: String? = null,
    /** Zähler wurde automatisch erkannt */
    val autoAssigned: Boolean = false,
    /** Foto zum Anzeigen (lokale Kopie oder vom Server geladen) */
    val photo: File? = null,
    val loadingPhoto: Boolean = false,
    val takenAt: Instant = Instant.now(),
    /** Neu-Erkennung nach Zählerwechsel läuft */
    val uploading: Boolean = false,
    val photoId: String? = null,
    val ocr: OcrResult? = null,
    val ocrError: String? = null,
    /** Foto ist schon auf die Ziffern zugeschnitten */
    val cropped: Boolean = false,
    /** ganzes Foto behalten statt Ausschnitt */
    val keepFull: Boolean = false,
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

/** Zustand beim Prüfen und Speichern einer Ablesung (aus dem Eingang oder ohne Foto). */
class CaptureViewModel(application: Application) : AndroidViewModel(application) {
    private val app = application as MeterBookApp
    private val _state = MutableStateFlow(CaptureState())
    val state: StateFlow<CaptureState> = _state.asStateFlow()
    private var checkJob: Job? = null

    /** Ablesung ohne Foto */
    fun startManual(meterId: String?) {
        _state.value = CaptureState(meterId = meterId, takenAt = Instant.now())
    }

    /** Foto aus dem Eingang prüfen */
    fun openInbox(item: InboxItem) {
        _state.value = CaptureState(
            meterId = item.meterId,
            autoAssigned = item.ocr?.meterId != null,
            takenAt = runCatching { Instant.parse(item.takenAt) }.getOrDefault(Instant.now()),
            photoId = item.photoId,
            ocr = item.ocr,
            ocrError = item.ocrError,
            cropped = item.cropped,
            inputs = inputsFor(item.meterId, item.ocr),
            loadingPhoto = true,
        )
        viewModelScope.launch {
            val file = app.photoInbox.localFileFor(item.photoId) ?: try {
                app.api.downloadPhoto(item.photoId, File(app.cacheDir, "review_${item.photoId}.jpg"))
            } catch (e: Exception) {
                null
            }
            _state.update { if (it.photoId == item.photoId) it.copy(photo = file, loadingPhoto = false) else it }
        }
        scheduleCheck()
    }

    private fun inputsFor(meterId: String?, ocr: OcrResult?): Map<String, String> {
        val meter = meterId?.let { app.repo.meter(it) }
        return ocr?.registers?.mapNotNull { r ->
            val decimals = meter?.registers?.firstOrNull { it.id == r.registerId }?.decimals ?: 1
            r.value?.let { r.registerId to inputValue(it, decimals) }
        }?.toMap().orEmpty()
    }

    private fun apply(res: UploadResult) {
        val meterId = res.meterId ?: _state.value.meterId
        _state.update {
            it.copy(
                meterId = meterId,
                uploading = false,
                photoId = res.photoId,
                ocr = res.ocr,
                ocrError = res.ocrError,
                warnings = res.warnings,
                inputs = inputsFor(meterId, res.ocr),
            )
        }
    }

    /** Anderen Zähler wählen; das Foto wird für diesen Zähler neu gelesen. */
    fun selectMeter(meterId: String) {
        val s = _state.value
        if (s.meterId == meterId && s.ocr != null) return
        _state.update { it.copy(meterId = meterId, autoAssigned = false, inputs = emptyMap(), warnings = emptyList(), ocr = null, error = null) }
        val photoId = s.photoId ?: return
        if (s.offline) return
        _state.update { it.copy(uploading = true) }
        viewModelScope.launch {
            try {
                apply(app.api.assignPhoto(photoId, meterId))
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
    fun setKeepFull(v: Boolean) = _state.update { it.copy(keepFull = v) }

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
            val meterId = s.meterId ?: return@launch
            val vals = values(s)
            if (vals.isEmpty() || s.offline) return@launch
            try {
                val w = app.api.check(meterId, ReadingGroupIn(s.takenAt.toString(), values = vals))
                _state.update { it.copy(warnings = w) }
            } catch (_: Exception) {
            }
        }
    }

    suspend fun save(): SaveOutcome? {
        val s = _state.value
        val meterId = s.meterId
        if (meterId == null) {
            _state.update { it.copy(error = "Bitte zuerst den Zähler wählen.") }
            return null
        }
        val meter = app.repo.meter(meterId)
        val vals = values(s)
        if (vals.isEmpty()) {
            _state.update { it.copy(error = "Bitte den Zählerstand eingeben.") }
            return null
        }
        if (s.inputs.any { (_, t) -> t.isNotBlank() && parseNumber(t) == null }) {
            _state.update { it.copy(error = "Bitte nur Zahlen eingeben, z. B. 29789,6") }
            return null
        }
        _state.update { it.copy(saving = true, error = null) }
        val group = ReadingGroupIn(
            s.takenAt.toString(),
            s.photoId,
            if (s.photoId != null) "PHOTO" else "MANUAL",
            s.note.ifBlank { null },
            vals,
            keepFullPhoto = if (s.keepFull) true else null,
        )
        return try {
            if (s.offline) throw OfflineException(Exception("offline"))
            app.api.saveReading(meterId, group)
            s.photoId?.let { app.photoInbox.markDone(it) }
            cleanup()
            SaveOutcome.Saved
        } catch (e: OfflineException) {
            // Ohne Netz: Werte merken und später senden (das Foto liegt schon auf dem Server).
            app.queue.add(meterId, meter?.name ?: "Zähler", s.takenAt.toString(), vals, s.note.ifBlank { null }, null, s.photoId)
            SyncWorker.enqueue(app)
            s.photoId?.let { app.photoInbox.markDone(it) }
            cleanup()
            SaveOutcome.Queued
        } catch (e: ApiException) {
            _state.update { it.copy(saving = false, error = e.message) }
            null
        }
    }

    /** Foto verwerfen: auf dem Server löschen, keine Ablesung */
    suspend fun discardPhoto(): Boolean {
        val id = _state.value.photoId ?: return true
        return try {
            app.api.deletePhoto(id)
            app.photoInbox.markDone(id)
            cleanup()
            true
        } catch (e: Exception) {
            _state.update { it.copy(error = e.message ?: "Löschen fehlgeschlagen") }
            false
        }
    }

    private fun cleanup() {
        // Nur heruntergeladene Kopien löschen – die lokale Kopie im Eingang räumt PhotoInbox auf
        _state.value.photo?.takeIf { it.name.startsWith("review_") }?.delete()
        _state.value = CaptureState()
    }

    fun discard() = cleanup()
}
