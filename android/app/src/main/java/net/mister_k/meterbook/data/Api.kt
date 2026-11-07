package net.mister_k.meterbook.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

@kotlinx.serialization.Serializable
private data class LoginIn(val email: String, val password: String)

class ApiException(val status: Int, message: String) : Exception(message)

/** Kein Netz oder Server nicht erreichbar – die Ablesung kann später nachgeholt werden. */
class OfflineException(cause: Throwable) : Exception("Server nicht erreichbar", cause)

class Api(private val session: Session) {
    val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }
    private val jsonType = "application/json".toMediaType()
    private val refreshLock = Mutex()

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        // Die Erkennung eines Fotos kann eine Weile dauern.
        .readTimeout(150, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    private fun url(path: String) = "${session.serverUrl}/api$path"

    private suspend fun execute(build: () -> Request.Builder, auth: Boolean = true, retry: Boolean = true): String =
        withContext(Dispatchers.IO) {
            val token = session.accessToken
            val req = build().apply { if (auth && token != null) header("Authorization", "Bearer $token") }.build()
            val res: Response = try {
                client.newCall(req).execute()
            } catch (e: IOException) {
                throw OfflineException(e)
            }
            res.use {
                val body = it.body.string()
                if (it.code == 401 && auth && retry && refresh(token)) return@withContext execute(build, auth, false)
                if (it.code == 401 && auth) session.clear()
                if (!it.isSuccessful) throw ApiException(it.code, errorMessage(body, it.code))
                body
            }
        }

    private fun errorMessage(body: String, code: Int): String = try {
        json.parseToJsonElement(body).jsonObject["message"]?.jsonPrimitive?.content ?: "Fehler $code"
    } catch (_: Exception) {
        "Fehler $code"
    }

    /** Erneuert den Zugangs-Token; gleichzeitige Aufrufe warten auf denselben Refresh. */
    private suspend fun refresh(usedToken: String?): Boolean = refreshLock.withLock {
        if (session.accessToken != usedToken) return@withLock true
        val rt = session.refreshToken ?: return@withLock false
        try {
            val body = execute(
                { Request.Builder().url(url("/auth/refresh")).post("""{"refreshToken":${json.encodeToString(rt)}}""".toRequestBody(jsonType)) },
                auth = false,
            )
            session.store(json.decodeFromString<TokenPair>(body))
            true
        } catch (e: ApiException) {
            session.clear()
            false
        }
    }

    private suspend inline fun <reified T> get(path: String): T =
        json.decodeFromString(execute({ Request.Builder().url(url(path)).get() }))

    private suspend inline fun <reified I, reified T> post(path: String, body: I): T =
        json.decodeFromString(execute({ Request.Builder().url(url(path)).post(json.encodeToString(body).toRequestBody(jsonType)) }))

    // --- Endpunkte -----------------------------------------------------------

    suspend fun health(serverUrl: String): Health = withContext(Dispatchers.IO) {
        val req = Request.Builder().url("${serverUrl.trimEnd('/')}/api/health").get().build()
        try {
            client.newCall(req).execute().use {
                if (!it.isSuccessful) throw ApiException(it.code, "Unter dieser Adresse läuft kein MeterBook-Server (Fehler ${it.code})")
                json.decodeFromString<Health>(it.body.string())
            }
        } catch (e: IOException) {
            throw OfflineException(e)
        }
    }

    suspend fun health(): Health = health(session.serverUrl)

    suspend fun login(email: String, password: String) {
        val body = execute(
            { Request.Builder().url(url("/auth/login")).post(json.encodeToString(LoginIn(email.trim(), password)).toRequestBody(jsonType)) },
            auth = false,
        )
        session.store(json.decodeFromString<TokenPair>(body))
    }

    suspend fun logout() {
        val rt = session.refreshToken
        session.clear()
        if (rt != null) runCatching {
            execute({ Request.Builder().url(url("/auth/logout")).post("""{"refreshToken":${json.encodeToString(rt)}}""".toRequestBody(jsonType)) }, auth = false)
        }
    }

    suspend fun overview(): List<Overview> = get("/stats/overview")
    suspend fun meters(): List<Meter> = get("/meters")
    suspend fun meter(id: String): Meter = get("/meters/$id")
    suspend fun readings(meterId: String): List<ReadingGroup> = get("/meters/$meterId/readings")
    suspend fun series(meterId: String, granularity: String = "month"): Series = get("/stats/meters/$meterId/series?granularity=$granularity")

    suspend fun check(meterId: String, group: ReadingGroupIn): List<RegisterWarnings> = post("/meters/$meterId/readings/check", group)
    suspend fun saveReading(meterId: String, group: ReadingGroupIn): SaveResult =
        post<ReadingGroupIn, SaveResult>("/meters/$meterId/readings", group).also { onReadingSaved?.invoke() }

    /** Wird nach jeder gespeicherten Ablesung aufgerufen (Erinnerung neu prüfen) */
    var onReadingSaved: (() -> Unit)? = null

    suspend fun reminder(): ReminderState = get("/me/reminder")

    /** Eigener Rhythmus für einen Zähler; null = Standard */
    suspend fun setMeterReminder(meterId: String, interval: String?): ReminderState =
        json.decodeFromString(
            execute({
                // null ausdrücklich mitschicken, damit der Server „Standard“ setzt
                val body = if (interval == null) "{\"interval\":null}" else json.encodeToString(MeterReminderIn(interval))
                Request.Builder().url(url("/me/reminder/meters/$meterId")).put(body.toRequestBody(jsonType))
            }),
        )

    suspend fun updateReminder(settings: ReminderSettingsIn): ReminderState =
        json.decodeFromString(execute({ Request.Builder().url(url("/me/reminder")).put(json.encodeToString(settings).toRequestBody(jsonType)) }))

    /** which: current | next | none */
    suspend fun skipReminder(which: String): ReminderState = post("/me/reminder/skip", ReminderSkipIn(which))

    /** „Passwort vergessen“: der Server schickt einen Link per E-Mail. */
    suspend fun forgotPassword(email: String) {
        execute(
            { Request.Builder().url(url("/auth/forgot")).post("""{"email":${json.encodeToString(email.trim())}}""".toRequestBody(jsonType)) },
            auth = false,
        )
    }

    /**
     * Foto in den Eingang hochladen; die Erkennung läuft auf dem Server im Hintergrund.
     * Ohne meterId erkennt der Server auch, welcher Zähler es ist.
     */
    suspend fun uploadToInbox(file: File, meterId: String?, takenAtIso: String): UploadResult {
        val body: RequestBody = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("takenAt", takenAtIso)
            .addFormDataPart("file", file.name, file.asRequestBody("image/jpeg".toMediaType()))
            .build()
        val path = if (meterId != null) "/meters/$meterId/photos?async=true" else "/photos?async=true"
        return json.decodeFromString(execute({ Request.Builder().url(url(path)).post(body) }))
    }

    suspend fun inbox(): List<InboxItem> = get("/photos/inbox")

    suspend fun photoInfo(photoId: String): InboxItem = get("/photos/$photoId/info")

    /** Foto (bzw. Vorschaubild) vom Server in eine Datei laden */
    suspend fun downloadPhoto(photoId: String, target: File, thumb: Boolean = false): File = withContext(Dispatchers.IO) {
        val token = session.accessToken
        val req = Request.Builder().url(url("/photos/$photoId" + if (thumb) "?size=thumb" else ""))
            .apply { if (token != null) header("Authorization", "Bearer $token") }
            .get().build()
        try {
            client.newCall(req).execute().use {
                if (!it.isSuccessful) throw ApiException(it.code, "Foto nicht verfügbar")
                target.outputStream().use { out -> it.body.byteStream().copyTo(out) }
            }
        } catch (e: IOException) {
            throw OfflineException(e)
        }
        target
    }

    suspend fun deletePhoto(photoId: String) {
        execute({ Request.Builder().url(url("/photos/$photoId")).delete() })
    }

    /** Foto ohne Zähler hochladen – der Server erkennt, welcher Zähler es ist. */
    suspend fun uploadPhotoAuto(file: File, takenAtIso: String): UploadResult {
        val body: RequestBody = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("takenAt", takenAtIso)
            .addFormDataPart("file", file.name, file.asRequestBody("image/jpeg".toMediaType()))
            .build()
        return json.decodeFromString(execute({ Request.Builder().url(url("/photos")).post(body) }))
    }

    /** Foto einem (anderen) Zähler zuordnen und neu erkennen lassen. */
    suspend fun assignPhoto(photoId: String, meterId: String): UploadResult =
        json.decodeFromString(
            execute({
                Request.Builder().url(url("/photos/$photoId/assign"))
                    .post("""{"meterId":${json.encodeToString(meterId)}}""".toRequestBody(jsonType))
            }),
        )

    suspend fun uploadPhoto(meterId: String, file: File, takenAtIso: String, recognize: Boolean): UploadResult {
        val body: RequestBody = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("takenAt", takenAtIso)
            .addFormDataPart("recognize", recognize.toString())
            .addFormDataPart("file", file.name, file.asRequestBody("image/jpeg".toMediaType()))
            .build()
        return json.decodeFromString(execute({ Request.Builder().url(url("/meters/$meterId/photos")).post(body) }))
    }
}
