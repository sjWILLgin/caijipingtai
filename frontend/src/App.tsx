import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import Layout from './components/Layout';
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

const App: React.FC = () => {
  return (
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#1677ff' } }}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/import-plans" replace />} />
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
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
};

export default App;
