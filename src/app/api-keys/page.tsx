import { ApiKeysDashboard } from '@/components/api-keys-dashboard';

export default function ApiKeysPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">API 키 관리</h2>
      <ApiKeysDashboard />
    </div>
  );
}
