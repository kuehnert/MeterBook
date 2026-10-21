package net.mister_k.meterbook.data

import kotlinx.serialization.Serializable

@Serializable
data class User(val id: String, val email: String, val name: String, val role: String)

@Serializable
data class TokenPair(val accessToken: String, val refreshToken: String, val expiresIn: Int, val user: User)

@Serializable
data class Health(val status: String, val version: String, val ocr: Boolean, val env: String? = null)

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
    val daysSinceLastReading: Int? = null,
)

@Serializable
data class SeriesBucket(
    val start: String,
    val label: String,
    val registers: Map<String, RegisterValue> = emptyMap(),
    val total: Double? = null,
    val previousYearTotal: Double? = null,
    val cost: Double? = null,
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
)

@Serializable
data class SaveResult(val warnings: List<RegisterWarnings> = emptyList())
