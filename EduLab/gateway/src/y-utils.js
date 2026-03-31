/**
 * Standalone Yjs WebSocket Server Implementation (based on y-websocket/bin/utils.js).
 * Removes dependency on internal package structure.
 */
const Y = require('yjs');
const sync = require('y-protocols/dist/sync.cjs');
const awareness = require('y-protocols/dist/awareness.cjs');
const encoding = require('lib0/dist/encoding.cjs');
const decoding = require('lib0/dist/decoding.cjs');
const map = require('lib0/dist/map.cjs');

const messageSync = 0;
const messageAwareness = 1;

const docs = new Map();

const updateHandler = (update, origin, doc) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    sync.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    doc.conns.forEach((_, conn) => send(doc, conn, message));
};

class WSSharedDoc extends Y.Doc {
    constructor(name) {
        super({ gc: true });
        this.name = name;
        this.conns = new Map();
        this.on('update', updateHandler);
    }
}

const send = (doc, conn, m) => {
    if (conn.readyState !== 1 || conn.readyState === 2 || conn.readyState === 3) {
        closeConn(doc, conn);
    }
    try {
        // Ensure m is a Buffer as some Node.js 'ws' versions are picky with Uint8Array
        conn.send(Buffer.from(m), (err) => {
            if (err) closeConn(doc, conn);
        });
    } catch (e) {
        closeConn(doc, conn);
    }
};

const closeConn = (doc, conn) => {
    if (doc.conns.has(conn)) {
        const controlledIds = doc.conns.get(conn);
        doc.conns.delete(conn);
        awareness.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);
        if (doc.conns.size === 0) {
            // docs.delete(doc.name); // Keep doc for now to prevent session loss
        }
    }
    conn.close();
};

const setupWSConnection = (conn, req, { docName = req.url.slice(1).split('?')[0], gc = true } = {}) => {
    conn.binaryType = 'arraybuffer';
    const doc = map.setIfUndefined(docs, docName, () => {
        const doc = new WSSharedDoc(docName);
        doc.gc = gc;
        doc.awareness = new awareness.Awareness(doc);
        doc.awareness.setLocalState(null);
        doc.awareness.on('update', ({ added, updated, removed }, origin) => {
            const changedClients = added.concat(updated, removed);
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, messageAwareness);
            encoding.writeVarUint8Array(encoder, awareness.encodeAwarenessUpdate(doc.awareness, changedClients));
            const buff = encoding.toUint8Array(encoder);
            doc.conns.forEach((_, c) => send(doc, c, buff));
        });
        return doc;
    });

    doc.conns.set(conn, new Set());

    conn.on('message', (message) => {
        const encoder = encoding.createEncoder();
        const decoder = decoding.createDecoder(new Uint8Array(message));
        const messageType = decoding.readVarUint(decoder);

        switch (messageType) {
            case messageSync:
                encoding.writeVarUint(encoder, messageSync);
                sync.readSyncMessage(decoder, encoder, doc, null);
                if (encoding.length(encoder) > 1) {
                    send(doc, conn, encoding.toUint8Array(encoder));
                }
                break;
            case messageAwareness:
                awareness.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), conn);
                break;
        }
    });

    conn.on('close', () => {
        closeConn(doc, conn);
    });

    // Send initial sync step 1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    sync.writeSyncStep1(encoder, doc);
    send(doc, conn, encoding.toUint8Array(encoder));

    // Send awareness state
    const awarenessStates = doc.awareness.getStates();
    if (awarenessStates.size > 0) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageAwareness);
        encoding.writeVarUint8Array(encoder, awareness.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys())));
        send(doc, conn, encoding.toUint8Array(encoder));
    }
};

module.exports = {
    setupWSConnection,
    docs
};
