import { workerIsHealthy } from './health';

process.exitCode = await workerIsHealthy(process.env.WORKER_HEARTBEAT_FILE) ? 0 : 1;
