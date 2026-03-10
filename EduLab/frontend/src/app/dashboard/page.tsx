'use client';
/**
 * Teacher Dashboard — monitor student activity (ТЗ §8.4, Этап 2).
 * Shows active containers, student online status, real-time terminal view.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getAllContainers, getGroupStudents, isAuthenticated } from '@/lib/api';

interface Container {
    student_id: number;
    lab_id: number;
    container_id: string;
    started_at: string;
    status: string;
}

interface Student {
    id: number;
    name: string;
    email: string;
    is_online: boolean;
    active_container: {
        lab_id: number;
        container_id: string;
        started_at: string;
    } | null;
}

interface User {
    id: number;
    name: string;
    role: string;
}

export default function DashboardPage() {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [containers, setContainers] = useState<Container[]>([]);
    const [students, setStudents] = useState<Student[]>([]);
    const [groupName, setGroupName] = useState('');
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        if (!isAuthenticated()) {
            router.replace('/login');
            return;
        }
        loadData();
        // Auto-refresh every 10 seconds (ТЗ §4)
        const interval = setInterval(() => loadData(true), 10000);
        return () => clearInterval(interval);
    }, [router]);

    async function loadData(silent = false) {
        if (!silent) setLoading(true);
        else setRefreshing(true);
        try {
            const [userData, containersData, groupData] = await Promise.all([
                getMe(),
                getAllContainers(),
                getGroupStudents(1).catch(() => ({ group: { name: '' }, students: [] })),
            ]);

            if (userData.role !== 'teacher' && userData.role !== 'admin') {
                router.replace('/labs');
                return;
            }

            setUser(userData);
            setContainers(containersData.containers || []);
            setStudents(groupData.students || []);
            setGroupName(groupData.group?.name || 'Все группы');
        } catch {
            router.replace('/login');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }

    if (loading) {
        return (
            <div className="page">
                <div className="loading" style={{ flex: 1 }}>
                    <div className="spinner" />
                </div>
            </div>
        );
    }

    return (
        <div className="page">
            <nav className="navbar">
                <div className="navbar-logo" style={{ cursor: 'pointer' }} onClick={() => router.push('/labs')}>
                    <span style={{ color: 'var(--accent)' }}>Edu</span>Lab
                    <span style={{ color: 'var(--text-muted)', fontSize: 13, marginLeft: 12 }}>Дашборд</span>
                </div>
                <div className="navbar-user">
                    <span>{user?.name}</span>
                    {refreshing && <span style={{ fontSize: 12, color: 'var(--warning)' }}>↻</span>}
                    <button className="btn btn-ghost" onClick={() => router.push('/labs')} style={{ padding: '6px 12px', fontSize: 13 }}>
                        К лабам
                    </button>
                </div>
            </nav>

            <main className="labs-container">
                {/* Active Containers */}
                <div style={{ marginBottom: 32 }}>
                    <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
                        🟢 Активные контейнеры ({containers.length})
                    </h2>
                    {containers.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)', padding: '24px 0' }}>
                            Нет активных контейнеров
                        </div>
                    ) : (
                        <div className="labs-grid">
                            {containers.map((c, i) => (
                                <div key={i} className="lab-card" style={{ cursor: 'default' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontWeight: 600 }}>
                                            Студент #{c.student_id} → Лаба #{c.lab_id}
                                        </span>
                                        <span className="lab-card-lang">🟢 running</span>
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                                        Контейнер: {c.container_id?.slice(0, 12)}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                        Запущен: {c.started_at ? new Date(c.started_at).toLocaleTimeString('ru-RU') : '—'}
                                    </div>
                                    <button
                                        className="btn btn-ghost"
                                        style={{ marginTop: 8, padding: '4px 10px', fontSize: 12 }}
                                        onClick={() => window.open(
                                            `/observe/${c.student_id}/${c.lab_id}`,
                                            '_blank',
                                        )}
                                    >
                                        👁 Наблюдать
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Students */}
                <div>
                    <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
                        👥 Студенты — {groupName}
                    </h2>
                    {students.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)', padding: '24px 0' }}>
                            Нет студентов в группе
                        </div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                                    <th style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontSize: 13 }}>Статус</th>
                                    <th style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontSize: 13 }}>Имя</th>
                                    <th style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontSize: 13 }}>Email</th>
                                    <th style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontSize: 13 }}>Активная лаба</th>
                                </tr>
                            </thead>
                            <tbody>
                                {students.map((s) => (
                                    <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ padding: '10px 12px' }}>
                                            <span
                                                className={`status-dot ${s.is_online ? 'status-in_progress' : 'status-not_started'}`}
                                                style={{ display: 'inline-block', marginRight: 6 }}
                                            />
                                            {s.is_online ? 'Онлайн' : 'Оффлайн'}
                                        </td>
                                        <td style={{ padding: '10px 12px', fontWeight: 500 }}>{s.name}</td>
                                        <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{s.email}</td>
                                        <td style={{ padding: '10px 12px' }}>
                                            {s.active_container ? (
                                                <span style={{ color: 'var(--success)' }}>
                                                    Лаба #{s.active_container.lab_id}
                                                </span>
                                            ) : (
                                                <span style={{ color: 'var(--text-muted)' }}>—</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </main>
        </div>
    );
}
