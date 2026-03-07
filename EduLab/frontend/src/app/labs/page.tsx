'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getLabs, getMe, logout, isAuthenticated } from '@/lib/api';

interface Lab {
    id: number;
    title: string;
    language: string;
    deadline: string | null;
    status: string;
}

interface User {
    id: number;
    name: string;
    email: string;
    role: string;
}

const statusLabels: Record<string, string> = {
    not_started: 'Не начата',
    in_progress: 'В процессе',
    submitted: 'Сдана',
};

export default function LabsPage() {
    const router = useRouter();
    const [labs, setLabs] = useState<Lab[]>([]);
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isAuthenticated()) {
            router.replace('/login');
            return;
        }

        async function load() {
            try {
                const [userData, labsData] = await Promise.all([getMe(), getLabs()]);
                setUser(userData);
                setLabs(labsData);
            } catch {
                router.replace('/login');
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [router]);

    async function handleLogout() {
        await logout();
        router.replace('/login');
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
                <div className="navbar-logo">
                    <span style={{ color: 'var(--accent)' }}>Edu</span>Lab
                </div>
                <div className="navbar-user">
                    <span>{user?.name}</span>
                    <span style={{ color: 'var(--text-muted)' }}>({user?.role})</span>
                    <button className="btn btn-ghost" onClick={handleLogout} style={{ padding: '6px 12px', fontSize: '13px' }}>
                        Выйти
                    </button>
                </div>
            </nav>

            <main className="labs-container">
                <div className="labs-header">
                    <h1 className="labs-title">Лабораторные работы</h1>
                </div>

                <div className="labs-grid">
                    {labs.map((lab) => (
                        <div
                            key={lab.id}
                            className="lab-card"
                            onClick={() => router.push(`/labs/${lab.id}`)}
                        >
                            <div className="lab-card-title">{lab.title}</div>
                            <div className="lab-card-lang">{lab.language}</div>
                            <div className="lab-card-status">
                                <span className={`status-dot status-${lab.status}`} />
                                {statusLabels[lab.status] || lab.status}
                            </div>
                            {lab.deadline && (
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
                                    Дедлайн: {new Date(lab.deadline).toLocaleDateString('ru-RU')}
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {labs.length === 0 && (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '60px 0' }}>
                        Лабораторных работ пока нет
                    </div>
                )}
            </main>
        </div>
    );
}
