import '@/styles/globals.css';
import type { Metadata } from 'next';
import { GamificationProvider } from '@/lib/GamificationContext';
export const metadata: Metadata = {
    title: 'EduLab — Лабораторные работы',
    description: 'Платформа для проведения лабораторных работ по программированию в изолированных контейнерах',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="ru">
            <head>
                <link
                    href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
                    rel="stylesheet"
                />
            </head>
            <body>
                <GamificationProvider>
                    {children}
                </GamificationProvider>
            </body>
        </html>
    );
}
