import type { Metadata } from 'next';
import { AdminStudio } from '@/front_end/components/admin/AdminStudio';

export const metadata: Metadata = { title: 'Website studio | ECHO', robots: { index: false, follow: false } };

// Public static login shell. Every repository read/write is authenticated by
// GitHub; there is no publicly writable backend or access to persona records.
export default function AdminPage() { return <AdminStudio />; }
