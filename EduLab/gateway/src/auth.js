/**
 * WebSocket auth — ticket-based authentication.
 * 
 * Flow:
 * 1. Student calls POST /labs/{id}/open → API generates ws_ticket (30s TTL in Redis)
 * 2. Browser connects to /ws/terminal?ticket=xxx
 * 3. Gateway validates ticket against Redis (one-time use)
 */
const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379/0';
const redis = new Redis(REDIS_URL);

/**
 * Validate a one-time WS ticket and return { studentId, labId } or null.
 */
async function validateTicket(ticket) {
    if (!ticket) return null;

    const key = `ws_ticket:${ticket}`;
    const data = await redis.hgetall(key);

    if (!data || !data.student_id) return null;

    // Delete ticket (one-time use)
    await redis.del(key);

    return {
        studentId: parseInt(data.student_id),
        labId: parseInt(data.lab_id),
    };
}

/**
 * Get container info from Redis (ТЗ §9.2).
 */
async function getContainerInfo(studentId, labId) {
    const key = `container:${studentId}:${labId}`;
    const data = await redis.hgetall(key);
    if (!data || !data.status) return null;
    return {
        containerId: data.container_id || '',
        port: data.port ? parseInt(data.port) : 0,
        status: data.status,
    };
}

/**
 * Increment run stats in Redis (ТЗ §9.2).
 */
async function incrementRunStats(studentId, labId, isError = false) {
    const key = `stats:${studentId}:${labId}`;
    await redis.hincrby(key, 'runs_count', 1);
    if (isError) {
        await redis.hincrby(key, 'errors_count', 1);
    }
    await redis.hset(key, 'last_run', new Date().toISOString());
}

module.exports = { validateTicket, getContainerInfo, incrementRunStats, redis };
