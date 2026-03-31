'use client';
/**
 * Workspace page — Monaco Editor + xterm.js Terminal (ТЗ §3.3).
 * Split view: editor left, terminal right.
 * WebSocket connections to Container Gateway (ТЗ §8.3).
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getLab, getLabRooms, createRoom, openRoom, getMe, isAuthenticated, pingRoom, stopRoomBeacon, triggerAIAnalysis, getAIPlaques } from '@/lib/api';
import { connectTerminal, sendTerminalInput } from '@/lib/ws';
import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import { useGamification } from '@/lib/GamificationContext';
import { grantAchievement } from '@/lib/api';

// Dynamic imports (Monaco and xterm don't support SSR)
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });


interface LabData {
    id: number;
    title: string;
    description: string;
    language: string;
    template_code: string;
}

export default function WorkspacePage() {
    const router = useRouter();
    const params = useParams();
    const labId = Number(params.id);

    const [lab, setLab] = useState<LabData | null>(null);
    const [code, setCode] = useState('');
    const [status, setStatus] = useState<'loading' | 'connecting' | 'ready' | 'error'>('loading');
    const [errorMsg, setErrorMsg] = useState('');
    const [userId, setUserId] = useState<number>(0);
    const [roomId, setRoomId] = useState<number>(0);
    
    // AI Plaques
    const [plaques, setPlaques] = useState<any[]>([]);

    const terminalRef = useRef<HTMLDivElement>(null);
    const terminalWsRef = useRef<WebSocket | null>(null);
    const xtermRef = useRef<any>(null);
    const providerRef = useRef<WebsocketProvider | null>(null);
    const bindingRef = useRef<MonacoBinding | null>(null);

    // Buffer for terminal data arriving before xterm is ready
    const terminalBufferRef = useRef<Uint8Array[]>([]);
    // Track initialization to prevent double-init (React StrictMode)
    const initRef = useRef(false);
    
    // Yjs shared document
    const ydocRef = useRef(new Y.Doc());

    // Gamification Hook
    const { triggerAchievement } = useGamification();

    // Load lab data and open container
    useEffect(() => {
        if (!isAuthenticated()) {
            router.replace('/login');
            return;
        }

        // Prevent double initialization in React StrictMode
        if (initRef.current) return;
        initRef.current = true;

        async function init() {
            try {
                // Get user info
                const user = await getMe();
                setUserId(user.id);

                // Get lab details
                const labData = await getLab(labId);
                setLab(labData);
                setCode(labData.template_code);

                // 1. Get Room (Fetch active, or create new)
                let currentRoomId = 0;
                const activeRooms = await getLabRooms(labId);
                if (activeRooms.length > 0) {
                    currentRoomId = activeRooms[0].id; // Just use first active room for MVP
                } else {
                    const room = await createRoom(labId, `Session for ${user.name}`);
                    currentRoomId = room.id;
                }
                setRoomId(currentRoomId);

                // Open lab for this room — triggers container.start via RabbitMQ
                setStatus('connecting');
                const openResult = await openRoom(currentRoomId);
                const openResult2 = await openRoom(currentRoomId); // 2nd ticket

                // Connect Terminal WS
                const termWs = connectTerminal(
                    currentRoomId, labId, openResult.ws_ticket,
                    (data) => {
                        // Buffer data until xterm is ready
                        if (xtermRef.current) {
                            if (data instanceof ArrayBuffer) {
                                xtermRef.current.write(new Uint8Array(data));
                            } else {
                                xtermRef.current.write(data);
                            }
                        } else {
                            // xterm not ready yet — buffer the data
                            if (data instanceof ArrayBuffer) {
                                terminalBufferRef.current.push(new Uint8Array(data));
                            } else {
                                terminalBufferRef.current.push(new TextEncoder().encode(data));
                            }
                        }

                        // Gamification: detect pytest success
                        let stringData = '';
                        if (data instanceof ArrayBuffer) {
                            stringData = new TextDecoder().decode(data);
                        } else {
                            stringData = data;
                        }

                        if (stringData && (stringData.includes('passed in') || stringData.includes('100%'))) {
                            // Trigger internal API
                            grantAchievement(user.id, 'test-master').then(res => {
                                if (res && res.status === 'granted') {
                                    triggerAchievement('Test Master 🏆', 50, '🧪', res.new_level > user.level);
                                }
                            }).catch(e => console.error('Failed to grant ach', e));
                        }
                    },
                    () => console.log('[Terminal WS] Closed'),
                );
                terminalWsRef.current = termWs;

                // Initialize Yjs WebSocket Provider
                // Need to import WS_URL from env or use fallback
                const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';
                // Note: use currentRoomId 
                const ywsUrl = `${WS_URL}/ws/editor/${currentRoomId}/${labId}?ticket=${openResult2.ws_ticket}`;
                
                const provider = new WebsocketProvider(
                    ywsUrl, // Pass full URL as the "server url"
                    `room-${currentRoomId}-lab-${labId}`, // Room name argument is ignored by our backend setup
                    ydocRef.current,
                    { connect: false } // Custom WS implementation bypasses normal config
                );
                
                // Hack: y-websocket doesn't natively support full URLs with query parameters easily.
                // We override the url manually or use a custom ws provider.
                // An easier way: Use WebsocketProvider with the full url as serverURL and an empty room name.
                // Let's create a custom function later. For now let's just use the provider:
                
                // Re-initialize provider with correct URL via setting ws.
                if (providerRef.current) providerRef.current.destroy();
                provider.connect();
                providerRef.current = provider;

                setStatus('ready');

                // Start active ping to keep container alive
                pingRoom(currentRoomId).catch(console.error);
                const pingInterval = setInterval(() => {
                    pingRoom(currentRoomId).catch(console.error);
                }, 30000); // 30s heartbeat
                
                // AI Reviewer Polling (Every 10 seconds)
                const aiInterval = setInterval(async () => {
                    try {
                        const codeContent = ydocRef.current.getText('monaco').toString();
                        if (codeContent.length > 20) {
                            await triggerAIAnalysis(currentRoomId, labId, codeContent);
                        }
                        
                        // Check for new plaques
                        const plaquesData = await getAIPlaques(currentRoomId, labId);
                        if (plaquesData && plaquesData.plaques && plaquesData.plaques.length > 0) {
                            setPlaques(plaquesData.plaques);
                            
                            // Gamification: grant AI assisted achievement
                            const userObj = await getMe();
                            const res = await grantAchievement(userObj.id, 'ai-assisted');
                            if (res && res.status === 'granted') {
                                triggerAchievement('AI Guided ✨', 30, '🤖', res.new_level > userObj.level);
                            }
                        }
                    } catch (e) {
                        console.error("AI Review error:", e);
                    }
                }, 10000);

                // Add graceful stop on unmount and beforeunload
                const handleUnload = () => stopRoomBeacon(currentRoomId);
                window.addEventListener('beforeunload', handleUnload);

                // Store cleanup data
                (window as any)._labCleanup = { pingInterval, aiInterval, handleUnload, currentRoomId };

            } catch (err: any) {
                setErrorMsg(err.message || 'Ошибка подключения');
                setStatus('error');
            }
        }

        init();

        return () => {
            if ((window as any)._labCleanup) {
                clearInterval((window as any)._labCleanup.pingInterval);
                clearInterval((window as any)._labCleanup.aiInterval);
                window.removeEventListener('beforeunload', (window as any)._labCleanup.handleUnload);
                stopRoomBeacon((window as any)._labCleanup.currentRoomId);
            }
            if (providerRef.current) {
                providerRef.current.destroy();
            }
            if (bindingRef.current) {
                bindingRef.current.destroy();
            }
            terminalWsRef.current?.close();
        };
    }, [labId, router]);

    // Setup xterm.js
    useEffect(() => {
        if (status !== 'ready' || !terminalRef.current) return;

        async function setupTerminal() {
            const { Terminal } = await import('@xterm/xterm');
            const { FitAddon } = await import('@xterm/addon-fit');
            await import('@xterm/xterm/css/xterm.css');

            const term = new Terminal({
                theme: {
                    background: '#0a0e17',
                    foreground: '#e2e8f0',
                    cursor: '#3b82f6',
                    selectionBackground: '#3b82f640',
                },
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontSize: 14,
                cursorBlink: true,
            });

            const fitAddon = new FitAddon();
            term.loadAddon(fitAddon);
            term.open(terminalRef.current!);
            
            // Initial fit with a small delay to ensure container size is computed
            setTimeout(() => fitAddon.fit(), 200);

            // Terminal input → WebSocket → container (ТЗ §3.3)
            term.onData((data) => {
                if (terminalWsRef.current && terminalWsRef.current.readyState === WebSocket.OPEN) {
                    sendTerminalInput(terminalWsRef.current, data);
                }
            });

            xtermRef.current = term;

            // Handle incoming data if WS already had buffered chunks
            if (terminalBufferRef.current.length > 0) {
                console.log(`[Terminal] Flushing ${terminalBufferRef.current.length} buffered chunks`);
                for (const chunk of terminalBufferRef.current) {
                    term.write(chunk);
                }
                terminalBufferRef.current = [];
            }

            // Error handling for WS close
            if (terminalWsRef.current) {
                const originalOnClose = terminalWsRef.current.onclose;
                terminalWsRef.current.onclose = (ev) => {
                    if (originalOnClose) originalOnClose.call(terminalWsRef.current!, ev);
                    term.write('\r\n\x1b[31m[Соединение разорвано]\x1b[0m\r\n');
                    if (ev.reason) term.write(`Причина: ${ev.reason}\r\n`);
                };
            }

            // Resize on window resize
            const handleResize = () => {
                try { fitAddon.fit(); } catch(e) {}
            };
            window.addEventListener('resize', handleResize);
            return () => window.removeEventListener('resize', handleResize);
        }

        setupTerminal();
    }, [status]);

    // Handle Monaco Mount and Bind Yjs
    const handleEditorMount = useCallback((editor: any) => {
        // Create Yjs binding
        const ytext = ydocRef.current.getText('monaco');
        
        // Use random color and username for awareness (remote cursors)
        const awareness = providerRef.current?.awareness;
        if (awareness) {
            const colors = ['#f56565', '#ed8936', '#ecc94b', '#48bb78', '#38b2ac', '#4299e1', '#667eea', '#9f7aea', '#ed64a6'];
            const color = colors[Math.floor(Math.random() * colors.length)];
            awareness.setLocalStateField('user', {
                name: `User ${userId}`,
                color: color
            });
        }
        
        bindingRef.current = new MonacoBinding(ytext, editor.getModel(), new Set([editor]), providerRef.current?.awareness);
    }, [userId]);

    // Handle code changes
    const handleCodeChange = useCallback((value: string | undefined) => {
        if (!value) return;
        setCode(value);
    }, []);

    // Run code in terminal
    const handleRunCode = useCallback(() => {
        if (terminalWsRef.current) {
            sendTerminalInput(terminalWsRef.current, 'python main.py\n');
        }
    }, []);

    // Run tests in terminal
    const handleRunTests = useCallback(() => {
        if (terminalWsRef.current) {
            sendTerminalInput(terminalWsRef.current, 'python -m pytest /workspace/ -v\n');
        }
    }, []);

    if (status === 'loading' || status === 'connecting') {
        return (
            <div className="page">
                <nav className="navbar">
                    <div className="navbar-logo">
                        <span style={{ color: 'var(--accent)' }}>Edu</span>Lab
                    </div>
                </nav>
                <div className="loading" style={{ flex: 1 }}>
                    <div style={{ textAlign: 'center' }}>
                        <div className="spinner" style={{ margin: '0 auto 16px' }} />
                        <div style={{ color: 'var(--text-muted)' }}>
                            {status === 'loading' ? 'Загрузка лабы...' : 'Запуск контейнера...'}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (status === 'error') {
        return (
            <div className="page">
                <nav className="navbar">
                    <div className="navbar-logo">
                        <span style={{ color: 'var(--accent)' }}>Edu</span>Lab
                    </div>
                </nav>
                <div className="loading" style={{ flex: 1 }}>
                    <div style={{ textAlign: 'center', color: 'var(--error)' }}>
                        <div style={{ fontSize: 18, marginBottom: 8 }}>Ошибка</div>
                        <div style={{ color: 'var(--text-muted)', marginBottom: 16 }}>{errorMsg}</div>
                        <button className="btn btn-primary" onClick={() => router.push('/labs')}>
                            ← Назад к лабам
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="page">
            {/* Navbar */}
            <nav className="navbar">
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div
                        className="navbar-logo"
                        style={{ cursor: 'pointer' }}
                        onClick={() => router.push('/labs')}
                    >
                        <span style={{ color: 'var(--accent)' }}>Edu</span>Lab
                    </div>
                    <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                        / {lab?.title}
                    </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-ghost" onClick={() => router.push('/labs')} style={{ padding: '6px 12px', fontSize: 13 }}>
                        ← К лабам
                    </button>
                </div>
            </nav>

            {/* Workspace: Editor + Terminal */}
            <div className="workspace">
                {/* Editor Panel */}
                <div className="workspace-editor">
                    <div className="workspace-panel-header">
                        <span>📝 Редактор — main.py (Room #{roomId || '-'})</span>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <button
                                className="btn btn-primary"
                                onClick={handleRunCode}
                                style={{ padding: '4px 12px', fontSize: 12 }}
                            >
                                ▶ Запустить
                            </button>
                            <button
                                className="btn btn-ghost"
                                onClick={handleRunTests}
                                style={{ padding: '4px 12px', fontSize: 12 }}
                            >
                                🧪 Тесты
                            </button>
                            <span style={{ color: 'var(--success)', fontSize: 12, marginLeft: 4 }}>● Подключено</span>
                        </div>
                    </div>
                    <div className="workspace-panel-body">
                        {/* AI Plaques Overlay */}
                        {plaques.length > 0 && (
                            <div style={{
                                position: 'absolute',
                                right: 16,
                                top: 16,
                                width: 300,
                                zIndex: 10,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 8
                            }}>
                                {plaques.map((plaque, idx) => (
                                    <div key={idx} style={{
                                        background: 'var(--panel-bg)',
                                        border: `1px solid var(--${plaque.type === 'error' ? 'error' : plaque.type === 'success' ? 'success' : 'accent'})`,
                                        padding: 12,
                                        borderRadius: 8,
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
                                    }}>
                                        <div style={{fontWeight: 500, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6}}>
                                            <span style={{fontSize: 16}}>🤖</span> AI Reviewer
                                        </div>
                                        <div style={{fontSize: 13, color: 'var(--text-muted)'}}>{plaque.message}</div>
                                        {plaque.recommendation && (
                                            <div style={{
                                                marginTop: 8,
                                                padding: 8,
                                                background: '#000',
                                                borderRadius: 4,
                                                fontSize: 12,
                                                fontFamily: 'monospace'
                                            }}>
                                                {plaque.recommendation}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                        <MonacoEditor
                            height="100%"
                            language="python"
                            theme="vs-dark"
                            value={code}
                            onChange={handleCodeChange}
                            onMount={handleEditorMount}
                            options={{
                                minimap: { enabled: false },
                                fontSize: 14,
                                fontFamily: "'JetBrains Mono', monospace",
                                lineNumbers: 'on',
                                scrollBeyondLastLine: false,
                                automaticLayout: true,
                                padding: { top: 12 },
                            }}
                        />
                    </div>
                </div>

                {/* Terminal Panel */}
                <div className="workspace-terminal">
                    <div className="workspace-panel-header" style={{ background: '#111' }}>
                        <span>⬛ Терминал</span>
                        <span style={{ color: 'var(--success)', fontSize: 12 }}>● Подключено</span>
                    </div>
                    <div
                        className="workspace-panel-body"
                        ref={terminalRef}
                        style={{ padding: 8 }}
                    />
                </div>
            </div>
        </div>
    );
}
