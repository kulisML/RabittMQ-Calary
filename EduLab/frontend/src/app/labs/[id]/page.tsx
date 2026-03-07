'use client';
/**
 * Workspace page — Monaco Editor + xterm.js Terminal (ТЗ §3.3).
 * Split view: editor left, terminal right.
 * WebSocket connections to Container Gateway (ТЗ §8.3).
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getLab, openLab, getMe, isAuthenticated } from '@/lib/api';
import { connectEditor, connectTerminal, sendFileChange, sendTerminalInput } from '@/lib/ws';
import dynamic from 'next/dynamic';

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

    const terminalRef = useRef<HTMLDivElement>(null);
    const editorWsRef = useRef<WebSocket | null>(null);
    const terminalWsRef = useRef<WebSocket | null>(null);
    const xtermRef = useRef<any>(null);

    // Load lab data and open container
    useEffect(() => {
        if (!isAuthenticated()) {
            router.replace('/login');
            return;
        }

        async function init() {
            try {
                // Get user info
                const user = await getMe();
                setUserId(user.id);

                // Get lab details
                const labData = await getLab(labId);
                setLab(labData);
                setCode(labData.template_code);

                // Open lab — triggers container.start via RabbitMQ (ТЗ §3.2)
                setStatus('connecting');
                const openResult = await openLab(labId);

                // Wait a bit for container to start
                await new Promise(r => setTimeout(r, 3000));

                // Connect WebSockets (ТЗ §8.3)
                // Editor WS
                const editorWs = connectEditor(
                    user.id, labId, openResult.ws_ticket,
                    (filename, content) => {
                        if (filename === 'main.py' && content) {
                            setCode(content);
                        }
                    },
                    () => console.log('[Editor WS] Closed'),
                );
                editorWsRef.current = editorWs;

                // Terminal WS — needs a second ticket
                const openResult2 = await openLab(labId);
                const termWs = connectTerminal(
                    user.id, labId, openResult2.ws_ticket,
                    (data) => {
                        if (xtermRef.current) {
                            if (data instanceof ArrayBuffer) {
                                xtermRef.current.write(new Uint8Array(data));
                            } else {
                                xtermRef.current.write(data);
                            }
                        }
                    },
                    () => console.log('[Terminal WS] Closed'),
                );
                terminalWsRef.current = termWs;

                setStatus('ready');
            } catch (err: any) {
                setErrorMsg(err.message || 'Ошибка подключения');
                setStatus('error');
            }
        }

        init();

        return () => {
            editorWsRef.current?.close();
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
            fitAddon.fit();

            // Terminal input → WebSocket → container (ТЗ §3.3)
            term.onData((data) => {
                if (terminalWsRef.current) {
                    sendTerminalInput(terminalWsRef.current, data);
                }
            });

            xtermRef.current = term;

            // Resize on window resize
            window.addEventListener('resize', () => fitAddon.fit());
        }

        setupTerminal();
    }, [status]);

    // Handle code changes — sync via WebSocket (ТЗ §3.3)
    const handleCodeChange = useCallback((value: string | undefined) => {
        if (!value) return;
        setCode(value);
        if (editorWsRef.current) {
            sendFileChange(editorWsRef.current, 'main.py', value);
        }
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
                        <span>📝 Редактор — main.py</span>
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
                        <MonacoEditor
                            height="100%"
                            language="python"
                            theme="vs-dark"
                            value={code}
                            onChange={handleCodeChange}
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
