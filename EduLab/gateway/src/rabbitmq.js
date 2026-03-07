/**
 * RabbitMQ integration for Container Gateway (ТЗ §2.2).
 * 
 * Gateway publishes:
 * - container.stop when WebSocket disconnects (ТЗ §3.5)
 * - container.events for observer service (Этап 2)
 */
const amqplib = require('amqplib');

let connection = null;
let channel = null;

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://edulab:edulab_secret@rabbitmq:5672//';

async function connect() {
    try {
        connection = await amqplib.connect(RABBITMQ_URL);
        channel = await connection.createChannel();

        // Assert exchanges exist (they are declared by backend, but assert for safety)
        await channel.assertExchange('edulab.direct', 'direct', { durable: true });
        await channel.assertExchange('edulab.topic', 'topic', { durable: true });

        console.log('[RabbitMQ] Connected and exchanges asserted');
    } catch (err) {
        console.error('[RabbitMQ] Connection failed:', err.message);
        // Retry in 5 seconds
        setTimeout(connect, 5000);
    }
}

/**
 * Publish container.stop when student closes browser (ТЗ §3.5).
 * Container Gateway → container.stop → Container Manager
 */
async function publishContainerStop(studentId, labId, reason = 'browser_closed') {
    if (!channel) {
        console.error('[RabbitMQ] Not connected, cannot publish container.stop');
        return;
    }

    const message = {
        student_id: studentId,
        lab_id: labId,
        reason: reason,
        timestamp: new Date().toISOString(),
    };

    channel.publish(
        'edulab.direct',
        'container.stop',
        Buffer.from(JSON.stringify(message)),
        { persistent: true, contentType: 'application/json' }
    );

    console.log(`[RabbitMQ] Published container.stop for student=${studentId} lab=${labId}`);
}

/**
 * Publish container event for Observer Service (Этап 2).
 * Container Gateway → container.events.{groupId} → Observer
 */
async function publishContainerEvent(groupId, studentId, labId, event) {
    if (!channel) return;

    const message = {
        student_id: studentId,
        lab_id: labId,
        event: event,
        timestamp: new Date().toISOString(),
    };

    channel.publish(
        'edulab.topic',
        `container.events.${groupId}`,
        Buffer.from(JSON.stringify(message)),
        { persistent: true, contentType: 'application/json' }
    );
}

module.exports = { connect, publishContainerStop, publishContainerEvent };
