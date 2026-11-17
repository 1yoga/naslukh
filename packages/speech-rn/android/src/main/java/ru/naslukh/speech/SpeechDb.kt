package ru.naslukh.speech

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.os.Build

/**
 * Нативный порт @naslukh/speech-store: миграция 001, jobs / vad_intervals / segments / journal.
 */
class SpeechDb private constructor(context: Context) :
  SQLiteOpenHelper(context.applicationContext, DB_NAME, null, DB_VERSION) {

  data class Job(
    val id: String,
    val state: String,
    val modelId: String,
    val modelVersion: String,
    val pipelineVersion: Int,
    val checkpointFormat: Int,
    val audioPath: String?,
    val fingerprintSize: Long?,
    val fingerprintSha256: String?,
    val vadCursorSample: Int,
    val lastCommittedSample: Int,
  )

  data class Device(
    val deviceModel: String = Build.MODEL ?: "android",
    val osName: String = "android",
    val osVersion: String = Build.VERSION.RELEASE ?: "?",
  )

  data class SegmentRow(
    val startSample: Int,
    val endSample: Int,
    val text: String,
  )

  private fun db(): SQLiteDatabase = writableDatabase

  override fun onCreate(db: SQLiteDatabase) {
    applySchema(db)
    upsertMeta(db, "migration", "1")
    upsertMeta(db, "pipeline_version", Checkpoint.PIPELINE_VERSION.toString())
    upsertMeta(db, "checkpoint_format", Checkpoint.CHECKPOINT_FORMAT.toString())
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    applySchema(db)
  }

  fun migrate() {
    val database = db()
    // SQLiteDatabase.execSQL выполняет только один statement — всегда
    // догоняем IF NOT EXISTS (чинит БД, где успел создаться только jobs).
    applySchema(database)
    upsertMeta(database, "migration", "1")
    upsertMeta(database, "pipeline_version", Checkpoint.PIPELINE_VERSION.toString())
    upsertMeta(database, "checkpoint_format", Checkpoint.CHECKPOINT_FORMAT.toString())
  }

  private fun applySchema(db: SQLiteDatabase) {
    db.execSQL(META)
    for (sql in TABLES) {
      db.execSQL(sql)
    }
  }

  fun createJob(
    id: String,
    modelId: String,
    modelVersion: String,
    audioPath: String?,
    device: Device = Device(),
  ): Job {
    val now = System.currentTimeMillis()
    val database = db()
    database.insertOrThrow(
      "jobs",
      null,
      ContentValues().apply {
        put("id", id)
        put("state", "queued")
        put("source", "file")
        put("model_id", modelId)
        put("model_version", modelVersion)
        put("pipeline_version", Checkpoint.PIPELINE_VERSION)
        put("checkpoint_format", Checkpoint.CHECKPOINT_FORMAT)
        put("language", "ru")
        put("audio_path", audioPath)
        put("vad_cursor_sample", 0)
        put("last_committed_sample", 0)
        put("created_at", now)
        put("updated_at", now)
      },
    )
    writeJournal(database, now, "start", id, null, "queued", modelVersion, device)
    return getJob(id)
  }

  fun getJob(jobId: String): Job {
    db().rawQuery("SELECT * FROM jobs WHERE id = ?", arrayOf(jobId)).use { c ->
      if (!c.moveToFirst()) throw IllegalArgumentException("Задание $jobId не найдено")
      return mapJob(c)
    }
  }

  fun findJobByFingerprint(size: Long, sha256: String): Job? {
    db().rawQuery(
      "SELECT * FROM jobs WHERE fingerprint_size = ? AND fingerprint_sha256 = ? LIMIT 1",
      arrayOf(size.toString(), sha256),
    ).use { c ->
      return if (c.moveToFirst()) mapJob(c) else null
    }
  }

  fun setJobAudio(
    jobId: String,
    path: String,
    container: String,
    fingerprintSize: Long,
    fingerprintSha256: String,
  ): Job {
    getJob(jobId)
    val now = System.currentTimeMillis()
    db().execSQL(
      """UPDATE jobs SET
        audio_path = ?, audio_container = ?,
        fingerprint_size = ?, fingerprint_sha256 = ?, updated_at = ?
       WHERE id = ?""",
      arrayOf(path, container, fingerprintSize, fingerprintSha256, now, jobId),
    )
    return getJob(jobId)
  }

  fun setJobState(jobId: String, to: String, event: String, device: Device = Device()): Job {
    val job = getJob(jobId)
    Checkpoint.assertTransition(job.state, to)
    val now = System.currentTimeMillis()
    val database = db()
    database.execSQL(
      "UPDATE jobs SET state = ?, updated_at = ? WHERE id = ?",
      arrayOf(to, now, jobId),
    )
    writeJournal(database, now, event, jobId, job.state, to, job.modelVersion, device)
    return getJob(jobId)
  }

  fun resumeVadJob(jobId: String, modelVersion: String): Job {
    val job = getJob(jobId)
    if (!Checkpoint.canResume(
        Checkpoint.Identity(job.modelVersion, job.pipelineVersion, job.checkpointFormat),
        modelVersion,
      )
    ) {
      throw IllegalStateException("Чекпоинт нельзя продолжить: другая модель или версия пайплайна")
    }
    if (job.state != "recognizing" && job.state != "paused" && job.state != "sealed") {
      throw IllegalStateException("VAD не продолжается из состояния ${job.state}")
    }
    return job
  }

  fun commitVad(jobId: String, intervals: List<Chunking.Range>, cursorSample: Int): Job {
    val job = getJob(jobId)
    if (cursorSample < job.vadCursorSample) {
      throw IllegalStateException("Курсор VAD не может идти назад")
    }
    val now = System.currentTimeMillis()
    val database = db()
    database.beginTransaction()
    try {
      for (interval in intervals) {
        if (interval.endSample <= job.vadCursorSample) {
          throw IllegalStateException("Интервал левее курсора уже должен быть в базе")
        }
        val start = maxOf(interval.startSample, job.vadCursorSample)
        database.execSQL(
          "INSERT INTO vad_intervals (job_id, start_sample, end_sample) VALUES (?, ?, ?)",
          arrayOf(jobId, start, interval.endSample),
        )
      }
      database.execSQL(
        "UPDATE jobs SET vad_cursor_sample = ?, updated_at = ? WHERE id = ?",
        arrayOf(cursorSample, now, jobId),
      )
      database.setTransactionSuccessful()
    } finally {
      database.endTransaction()
    }
    return getJob(jobId)
  }

  fun listVadIntervals(jobId: String): List<Chunking.Range> {
    val out = mutableListOf<Chunking.Range>()
    db().rawQuery(
      "SELECT start_sample, end_sample FROM vad_intervals WHERE job_id = ? ORDER BY start_sample",
      arrayOf(jobId),
    ).use { c ->
      while (c.moveToNext()) {
        out.add(Chunking.Range(c.getInt(0), c.getInt(1)))
      }
    }
    return out
  }

  fun commitSegment(
    jobId: String,
    startSample: Int,
    endSample: Int,
    text: String,
    modelVersion: String,
    committedSample: Int,
  ) {
    val job = getJob(jobId)
    if (committedSample < job.lastCommittedSample) {
      throw IllegalStateException("Курсор распознавания не может идти назад")
    }
    if (endSample <= startSample) {
      throw IllegalStateException("Сегмент пустой")
    }
    val now = System.currentTimeMillis()
    val database = db()
    database.beginTransaction()
    try {
      database.execSQL(
        """INSERT INTO segments (
          job_id, vad_interval_id, start_sample, end_sample, text, status, model_version
        ) VALUES (?, NULL, ?, ?, ?, 'done', ?)""",
        arrayOf(jobId, startSample, endSample, text, modelVersion),
      )
      database.execSQL(
        "UPDATE jobs SET last_committed_sample = ?, updated_at = ? WHERE id = ?",
        arrayOf(committedSample, now, jobId),
      )
      database.setTransactionSuccessful()
    } finally {
      database.endTransaction()
    }
  }

  fun listSegments(jobId: String): List<SegmentRow> {
    val out = mutableListOf<SegmentRow>()
    db().rawQuery(
      """SELECT start_sample, end_sample, text FROM segments
         WHERE job_id = ? ORDER BY start_sample""",
      arrayOf(jobId),
    ).use { c ->
      while (c.moveToNext()) {
        out.add(SegmentRow(c.getInt(0), c.getInt(1), c.getString(2) ?: ""))
      }
    }
    return out
  }

  fun pendingChunkStart(jobId: String): Int = getJob(jobId).lastCommittedSample

  private fun mapJob(c: Cursor): Job {
    fun idx(name: String) = c.getColumnIndexOrThrow(name)
    fun strOrNull(name: String): String? {
      val i = idx(name)
      return if (c.isNull(i)) null else c.getString(i)
    }
    fun longOrNull(name: String): Long? {
      val i = idx(name)
      return if (c.isNull(i)) null else c.getLong(i)
    }
    return Job(
      id = c.getString(idx("id")),
      state = c.getString(idx("state")),
      modelId = c.getString(idx("model_id")),
      modelVersion = c.getString(idx("model_version")),
      pipelineVersion = c.getInt(idx("pipeline_version")),
      checkpointFormat = c.getInt(idx("checkpoint_format")),
      audioPath = strOrNull("audio_path"),
      fingerprintSize = longOrNull("fingerprint_size"),
      fingerprintSha256 = strOrNull("fingerprint_sha256"),
      vadCursorSample = c.getInt(idx("vad_cursor_sample")),
      lastCommittedSample = c.getInt(idx("last_committed_sample")),
    )
  }

  private fun meta(database: SQLiteDatabase, key: String): String? {
    database.rawQuery("SELECT value FROM schema_meta WHERE key = ?", arrayOf(key)).use { c ->
      return if (c.moveToFirst()) c.getString(0) else null
    }
  }

  private fun upsertMeta(database: SQLiteDatabase, key: String, value: String) {
    database.execSQL(
      """INSERT INTO schema_meta(key, value) VALUES(?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
      arrayOf(key, value),
    )
  }

  private fun writeJournal(
    database: SQLiteDatabase,
    ts: Long,
    event: String,
    jobId: String?,
    stateFrom: String?,
    stateTo: String?,
    modelVersion: String,
    device: Device,
  ) {
    database.execSQL(
      """INSERT INTO journal (
        ts, event, job_id, state_from, state_to, model_version, pipeline_version,
        checkpoint_format, device_model, os_name, os_version, library_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
      arrayOf(
        ts,
        event,
        jobId,
        stateFrom,
        stateTo,
        modelVersion,
        Checkpoint.PIPELINE_VERSION,
        Checkpoint.CHECKPOINT_FORMAT,
        device.deviceModel,
        device.osName,
        device.osVersion,
        Checkpoint.LIBRARY_VERSION,
      ),
    )
  }

  companion object {
    private const val DB_NAME = "naslukh-speech.db"
    private const val DB_VERSION = 1

    private val META = """
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
""".trimIndent()

    /** По одному statement — Android execSQL не принимает пачку. */
    private val TABLES = listOf(
      """
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  source TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  pipeline_version INTEGER NOT NULL,
  checkpoint_format INTEGER NOT NULL,
  language TEXT NOT NULL,
  audio_path TEXT,
  audio_container TEXT,
  fingerprint_size INTEGER,
  fingerprint_sha256 TEXT,
  vad_cursor_sample INTEGER NOT NULL DEFAULT 0,
  last_committed_sample INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
""".trimIndent(),
      """
CREATE TABLE IF NOT EXISTS vad_intervals (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  start_sample INTEGER NOT NULL,
  end_sample INTEGER NOT NULL
)
""".trimIndent(),
      """
CREATE TABLE IF NOT EXISTS segments (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  vad_interval_id INTEGER REFERENCES vad_intervals(id),
  start_sample INTEGER NOT NULL,
  end_sample INTEGER NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  model_version TEXT NOT NULL,
  UNIQUE (job_id, start_sample)
)
""".trimIndent(),
      """
CREATE TABLE IF NOT EXISTS journal (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  event TEXT NOT NULL,
  job_id TEXT,
  state_from TEXT,
  state_to TEXT,
  model_version TEXT NOT NULL,
  pipeline_version INTEGER NOT NULL,
  checkpoint_format INTEGER NOT NULL,
  device_model TEXT NOT NULL,
  os_name TEXT NOT NULL,
  os_version TEXT NOT NULL,
  library_version TEXT NOT NULL
)
""".trimIndent(),
    )

    @Volatile
    private var instance: SpeechDb? = null

    fun get(context: Context): SpeechDb {
      return instance ?: synchronized(this) {
        instance ?: SpeechDb(context).also { instance = it }
      }
    }
  }
}
