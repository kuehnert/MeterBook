package net.mister_k.meterbook

import android.app.Application
import net.mister_k.meterbook.data.Api
import net.mister_k.meterbook.data.Repository
import net.mister_k.meterbook.data.Session
import net.mister_k.meterbook.data.UploadQueue
import net.mister_k.meterbook.work.ReminderWorker
import net.mister_k.meterbook.work.SyncWorker

class MeterBookApp : Application() {
    lateinit var session: Session
        private set
    lateinit var api: Api
        private set
    lateinit var queue: UploadQueue
        private set
    lateinit var repo: Repository
        private set

    override fun onCreate() {
        super.onCreate()
        session = Session(this)
        api = Api(session)
        queue = UploadQueue(this, api)
        repo = Repository(this, api)
        ReminderWorker.createChannel(this)
        ReminderWorker.schedule(this)
        if (queue.items.value.isNotEmpty()) SyncWorker.enqueue(this)
    }
}
