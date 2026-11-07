package net.mister_k.meterbook.data

import kotlinx.serialization.Serializable

@Serializable
data class User(val id: String, val email: String, val name: String, val role: String)

@Serializable
data class TokenPair(val accessToken: String, val refreshToken: String, val expiresIn: Int, val user: User)

@Serializable
data class Health(val status: String, val version: String, val ocr: Boolean, val env: String? = null, val mail: String? = null)

/** Erinnerung ans Ablesen – auf dem Server gespeichert, gilt für E-Mail, App und Web. */
@Serializable
data class ReminderState(
    /** Standard für alle Zähler: OFF | WEEKLY | MONTHLY | QUARTERLY | YEARLY */
    val interval: String = "OFF",
    val email: Boolean = true,
    val skipUntil: String? = null,
    /** Aktueller Termin (ISO), null = aus */
    val current: String? = null,
    val next: String? = null,
    val skipped: Boolean = false,
    val due: List<ReminderDue> = emptyList(),
    /** Termin da, nicht übersprungen und noch etwas abzulesen */
    val active: Boolean = false,
    /** Mindestens ein Zähler wird erinnert */
    val enabled: Boolean = false,
    val meters: List<MeterReminder> = emptyList(),
)

/** Rhythmus eines Zählers; interval = null heißt Standard */
@Serializable
data class MeterReminder(
    val id: String,
    val name: String,
    val interval: String? = null,
    val effective: String = "OFF",
    val current: String? = null,
    val next: String? = null,
)

@Serializable
data class MeterReminderIn(val interval: String?)

@Serializable
data class ReminderDue(val id: String, val name: String)

@Serializable
data class ReminderSettingsIn(val interval: String? = null, val email: Boolean? = null)

@Serializable
data class ReminderSkipIn(val which: String)

@Serializable
data class LastReading(val readAt: String, val value: Double)

@Serializable
data class Register(
    val id: String,
    val name: String,
    val code: String? = null,
    val decimals: Int = 1,
    val lastReading: LastReading? = null,
)

@Serializable
data class Meter(
    val id: String,
    val name: String,
    val medium: String,
    /** Eigenes Symbol (z. B. HEATING), sonst null = wie medium */
    val icon: String? = null,
    val unit: String,
    val serialNumber: String? = null,
    val location: String? = null,
    val billingStartMonth: Int = 1,
    val billingStartDay: Int = 1,
    val lastReadAt: String? = null,
    val registers: List<Register>,
)

@Serializable
data class RegisterValue(
    val value: Double? = null,
    val estimated: Boolean = false,
    val partial: Boolean = false,
    val forecast: Boolean = false,
)

@Serializable
data class PeriodCost(val energy: Double, val base: Double, val total: Double, val missingTariff: Boolean)

@Serializable
data class BillingPeriod(
    val start: String,
    val end: String,
    val label: String,
    val current: Boolean,
    val total: Double? = null,
    val forecastTotal: Double? = null,
    val cost: PeriodCost? = null,
    val forecastCost: Double? = null,
    val advances: Double = 0.0,
    val balance: Double? = null,
)

@Serializable
data class RecentReading(val readAt: String, val values: Map<String, Double> = emptyMap())

@Serializable
data class Overview(
    val meter: Meter,
    /** Die letzten Ablesetermine, neueste zuerst */
    val recent: List<RecentReading> = emptyList(),
    val perDayLast30: Map<String, Double?> = emptyMap(),
    val perDayLastYear: Map<String, Double?> = emptyMap(),
    val currentPeriod: BillingPeriod? = null,
    val previousPeriod: BillingPeriod? = null,
    /** Verbrauch der letzten Woche, des letzten Monats, Vierteljahres und Jahres */
    val recentConsumption: List<RecentConsumption> = emptyList(),
    val daysSinceLastReading: Int? = null,
)

@Serializable
data class RecentConsumption(
    /** Woche | Monat | Vierteljahr | Jahr */
    val label: String,
    val from: String,
    val to: String,
    val total: Double? = null,
    val estimated: Boolean = false,
)

@Serializable
data class SeriesBucket(
    val start: String,
    val label: String,
    val registers: Map<String, RegisterValue> = emptyMap(),
    val total: Double? = null,
    val previousYearTotal: Double? = null,
    val cost: Double? = null,
    /** Laufende Periode */
    val current: Boolean = false,
    /** Hochrechnung auf die volle laufende Periode */
    val forecastTotal: Double? = null,
    /** Farbgruppe 0/1, wechselt mit Woche/Monat/Abrechnungsjahr */
    val band: Int = 0,
    /** Nur Monate: Abrechnungsjahr („2025“ oder „2025/26“) */
    val period: String? = null,
)

@Serializable
data class Series(val buckets: List<SeriesBucket>)

@Serializable
data class GroupValue(val id: String, val value: Double, val ocrValue: Double? = null, val ocrConfidence: Double? = null)

@Serializable
data class ReadingGroup(
    val readAt: String,
    val photoId: String? = null,
    val source: String,
    val note: String? = null,
    val values: Map<String, GroupValue>,
)

@Serializable
data class Warning(val code: String, val message: String)

@Serializable
data class RegisterWarnings(val registerId: String, val warnings: List<Warning>)

@Serializable
data class OcrRegister(
    val registerId: String,
    val value: Double? = null,
    val confidence: Double,
    val digits: String = "",
    /** Lage der Ziffern im Bild als [links, oben, Breite, Höhe], Anteile 0–1 */
    val box: List<Double>? = null,
)

@Serializable
data class OcrResult(
    val model: String,
    val meterId: String? = null,
    val meterConfidence: Double = 0.0,
    val registers: List<OcrRegister>,
    val serialNumberSeen: String? = null,
    val serialNumberMatches: Boolean? = null,
    val issues: List<String> = emptyList(),
)

@Serializable
data class UploadResult(
    val photoId: String,
    val meterId: String? = null,
    val takenAt: String,
    val ocrStatus: String = "NONE",
    val ocr: OcrResult? = null,
    val ocrError: String? = null,
    val warnings: List<RegisterWarnings> = emptyList(),
)

@Serializable
data class ReadingValueIn(
    val registerId: String,
    val value: Double,
    val ocrValue: Double? = null,
    val ocrConfidence: Double? = null,
)

@Serializable
data class ReadingGroupIn(
    val readAt: String,
    val photoId: String? = null,
    val source: String? = null,
    val note: String? = null,
    val values: List<ReadingValueIn>,
    /** Foto nicht auf die Ziffern zuschneiden */
    val keepFullPhoto: Boolean? = null,
)

/** Foto im Eingang auf dem Server: hochgeladen, aber noch keine Ablesung gespeichert */
@Serializable
data class InboxItem(
    val photoId: String,
    val meterId: String? = null,
    val takenAt: String,
    val createdAt: String,
    /** NONE | PENDING (wird erkannt) | DONE | FAILED */
    val ocrStatus: String,
    val ocr: OcrResult? = null,
    val ocrError: String? = null,
    /** schon auf die Ziffern zugeschnitten */
    val cropped: Boolean = false,
)

@Serializable
data class SaveResult(val warnings: List<RegisterWarnings> = emptyList())
