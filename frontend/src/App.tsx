import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import Layout from './components/Layout';
import P00Home from './pages/P00Home';
import P01PlanList from './pages/P01PlanList';
import P02PlanForm from './pages/P02PlanForm';
import P03Upload from './pages/P03Upload';
import P04Sheets from './pages/P04Sheets';
import P05Mapping from './pages/P05Mapping';
import P06Validation from './pages/P06Validation';
import P07CommitConfirm from './pages/P07CommitConfirm';
import P08TaskDetail from './pages/P08TaskDetail';
import P09TaskList from './pages/P09TaskList';
import P10ManualTables from './pages/P10ManualTables';
import P11UserAdmin from './pages/P11UserAdmin';
import P12OperationCenter from './pages/P12OperationCenter';
import P13ApprovalCenter from './pages/P13ApprovalCenter';
import P14ApprovalFlowTemplates from './pages/P14ApprovalFlowTemplates';
import P15DataMaintenance from './pages/P15DataMaintenance';
import P99Auth from './pages/P99Auth';
import { authApi } from './services/api';

type CurrentUser = {
  id: number;
  username: string;
  display_name: string;
  role_key: 'super_admin' | 'domain_admin' | 'analyst';
  permissions: string[];
};

const App: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  const loadCurrentUser = async () => {
    const token = localStorage.getItem('dcp_token');
    if (!token) {
      setCurrentUser(null);
      return;
    }

    try {
      const user = await authApi.me();
      setCurrentUser(user);
    } catch (err) {
      localStorage.removeItem('dcp_token');
      setCurrentUser(null);
    }
  };

  useEffect(() => {
    const boot = async () => {
      await loadCurrentUser();
      setLoading(false);
    };
    boot();
  }, []);

  const handleAuthSuccess = (token: string, user: CurrentUser) => {
    localStorage.setItem('dcp_token', token);
    setCurrentUser(user);
  };

  const handleLogout = () => {
    localStorage.removeItem('dcp_token');
    setCurrentUser(null);
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#1677ff' } }}>
      <BrowserRouter>
        <Routes>
          {!currentUser ? (
            <>
              <Route path="/login" element={<P99Auth onAuthSuccess={handleAuthSuccess} />} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </>
          ) : (
            <>
              <Route
                path="/"
                element={<Layout currentUser={currentUser} onLogout={handleLogout} />}
              >
                <Route index element={<Navigate to="/home" replace />} />
                <Route path="home" element={<P00Home />} />
                <Route path="import-plans" element={<P01PlanList />} />
                <Route path="import-plans/new" element={<P02PlanForm />} />
                <Route path="import-plans/:planId/edit" element={<P02PlanForm />} />
                <Route path="import-tasks" element={<P09TaskList />} />
                <Route path="manual-tables" element={<P10ManualTables />} />
                <Route path="import-tasks/:taskId/upload" element={<P03Upload />} />
                <Route path="import-tasks/:taskId/sheets" element={<P04Sheets />} />
                <Route path="import-tasks/:taskId/mapping" element={<P05Mapping />} />
                <Route path="import-tasks/:taskId/validation" element={<P06Validation />} />
                <Route path="import-tasks/:taskId/commit-confirm" element={<P07CommitConfirm />} />
                <Route path="import-tasks/:taskId" element={<P08TaskDetail />} />
                {currentUser.role_key === 'super_admin' ? (
                  <Route
                    path="user-admin"
                    element={
                      <P11UserAdmin
                        currentUserId={currentUser.id}
                        onRefreshCurrentUser={loadCurrentUser}
                      />
                    }
                  />
                ) : null}
                {currentUser.role_key === 'super_admin' ? (
                  <Route path="ops-center" element={<P12OperationCenter />} />
                ) : null}
                {currentUser.role_key === 'super_admin' || currentUser.role_key === 'domain_admin' ? (
                  <Route path="approval-center" element={<P13ApprovalCenter />} />
                ) : null}
                {currentUser.role_key === 'super_admin' ? (
                  <Route path="approval-templates" element={<P14ApprovalFlowTemplates />} />
                ) : null}
                {currentUser.role_key === 'super_admin' ? (
                  <Route path="data-maintenance/domains" element={<P15DataMaintenance />} />
                ) : null}
              </Route>
              <Route path="/login" element={<Navigate to="/home" replace />} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </>
          )}
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
};

export default App;
