// PM2 process file — copy to /home/dsr/dsr/ecosystem.config.cjs
//   pm2 start ~/dsr/ecosystem.config.cjs && pm2 save
// One instance only: claim reminders and scheduled jobs run in-process (L-02).
module.exports = {
    apps: [{
        name: 'dsr-api',
        cwd: '/home/dsr/dsr/apps/api',
        script: 'src/index.js',
        instances: 1,
        exec_mode: 'fork',
        max_memory_restart: '700M',      // fits a 1–2 GB VPS
        kill_timeout: 12000,             // graceful shutdown drains for 10 s
        env: { NODE_ENV: 'production' },
        out_file: '/var/log/pm2/dsr-api-out.log',
        error_file: '/var/log/pm2/dsr-api-err.log',
        merge_logs: true,
        log_date_format: 'YYYY-MM-DD HH:mm:ss',
    }],
};
