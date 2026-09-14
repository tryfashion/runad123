'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  Layout,
  List,
  Modal,
  Menu,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  AppstoreOutlined,
  AuditOutlined,
  BarChartOutlined,
  BookOutlined,
  BulbOutlined,
  ControlOutlined,
  KeyOutlined,
  LinkOutlined,
  LogoutOutlined,
  ProductOutlined,
  ReloadOutlined,
  RobotOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { AiManagementCard } from './ai-management-card';
import { aiManagementText } from '@runad123/contracts';
import { MemberReviewCard } from './member-review-card';
import { ThemeLinksCard } from './theme-links-card';
import { adminApi, ApiFailure } from './admin-api';
import { adminText, adminDictionaries } from '@runad123/contracts/admin-i18n';
import { authText } from '@runad123/contracts/auth-i18n';
import { meSchema, type Me } from '@runad123/contracts/auth';
import {
  limitsResponseSchema,
  tutorialInputSchema,
  tutorialListSchema,
  type Limits,
  type Tutorial,
  type TutorialInput,
} from '@runad123/contracts/admin';
import type { UiLocale } from '@runad123/contracts/i18n';

const { Header, Sider, Content } = Layout;
const { Title, Text, Paragraph } = Typography;

type Section =
  | 'ai-config'
  | 'overview'
  | 'products'
  | 'accounts'
  | 'admins'
  | 'roles'
  | 'themes'
  | 'tutorials'
  | 'ai'
  | 'settings'
  | 'audits';

type DataRow = Record<string, unknown>;

const sectionIcons: Record<Section, ReactNode> = {
  'ai-config': <RobotOutlined />,
  overview: <AppstoreOutlined />,
  products: <ProductOutlined />,
  accounts: <TeamOutlined />,
  admins: <KeyOutlined />,
  roles: <ControlOutlined />,
  themes: <LinkOutlined />,
  tutorials: <BookOutlined />,
  ai: <RobotOutlined />,
  settings: <SettingOutlined />,
  audits: <AuditOutlined />,
};

const sections: Section[] = [
  'overview',
  'products',
  'accounts',
  'admins',
  'roles',
  'themes',
  'tutorials',
  'ai',
  'settings',
  'audits',
];

const blankAdmin = { login: '', email: '', password: '' };
const blankSelfAccountForm = {
  login: '',
  email: '',
  currentPassword: '',
  newPassword: '',
  confirmNewPassword: '',
};

const blankTutorial: TutorialInput = {
  title: '',
  summary: '',
  url: '',
  contentLocale: 'en',
  category: 'getting-started',
  placement: 'both',
  sortOrder: 0,
  enabled: false,
};

function formatValue(locale: UiLocale, value: unknown) {
  if (value === null || value === undefined || value === '') return adminText(locale, 'unknown');
  return adminDictionaries[locale]['value.' + String(value)] ?? String(value);
}

function errorMessage(locale: UiLocale, error: string) {
  return adminDictionaries[locale][error] ?? error;
}

export function AdminSystem({
  locale,
  onLocaleChange,
}: {
  locale: UiLocale;
  onLocaleChange: (value: string) => void;
}) {
  const t = (key: string) => adminText(locale, key);
  const [me, setMe] = useState<Me | null>(null);
  const [section, setSection] = useState<Section>('overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [login, setLogin] = useState(() => (process.env.NODE_ENV === 'production' ? '' : 'admin'));
  const [password, setPassword] = useState(() =>
    process.env.NODE_ENV === 'production' ? '' : '12345678',
  );
  const [overview, setOverview] = useState<DataRow | null>(null);
  const [trend, setTrend] = useState<DataRow[] | null>(null);
  const [users, setUsers] = useState<DataRow[] | null>(null);
  const [installations, setInstallations] = useState<DataRow[] | null>(null);
  const [admins, setAdmins] = useState<DataRow[] | null>(null);
  const [permissions, setPermissions] = useState<DataRow[] | null>(null);
  const [jobs, setJobs] = useState<DataRow[] | null>(null);
  const [audits, setAudits] = useState<DataRow[] | null>(null);
  const [settings, setSettings] = useState<{
    accessMode: string;
    configVersion: number;
    emailConfigured: boolean;
  } | null>(null);
  const [selfAccount, setSelfAccount] = useState<DataRow | null>(null);
  const [selfAccountForm, setSelfAccountForm] = useState({ ...blankSelfAccountForm });
  const [accountSaved, setAccountSaved] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [articles, setArticles] = useState<Tutorial[]>([]);
  const [editing, setEditing] = useState<Tutorial | null>(null);
  const [tutorialForm, setTutorialForm] = useState<TutorialInput>({ ...blankTutorial });
  const [windowValue, setWindowValue] = useState('7d');
  const [metric, setMetric] = useState('export');
  const [adminForm, setAdminForm] = useState({ ...blankAdmin });
  const [passwordReset, setPasswordReset] = useState({ userId: '', password: '' });

  const menuItems = useMemo(
    () => [
      ...sections.map((item) => ({
        key: item,
        icon: sectionIcons[item],
        label: t('nav.' + item),
      })),
      {
        key: 'system',
        icon: <SettingOutlined />,
        label: aiManagementText(locale, 'system'),
        children: [
          { key: 'ai-config', icon: <RobotOutlined />, label: aiManagementText(locale, 'title') },
        ],
      },
    ],
    [locale],
  );

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (err) {
      setError(
        err instanceof ApiFailure ? err.code : err instanceof Error ? err.message : 'UNKNOWN',
      );
    } finally {
      setBusy(false);
    }
  }

  async function refreshMe() {
    const result = meSchema.parse(await adminApi('/me'));
    setMe(result);
    if (result.user?.role === 'admin') await loadSection(section);
  }

  async function loadSection(target: Section) {
    if (target === 'overview') setOverview(await adminApi('/admin/overview'));
    if (target === 'products') {
      const data = await adminApi(
        '/admin/products/trending?' + new URLSearchParams({ window: windowValue, metric }),
      );
      setTrend(data.items);
    }
    if (target === 'accounts') {
      const [u, i] = await Promise.all([
        adminApi('/admin/users'),
        adminApi('/admin/installations'),
      ]);
      setUsers(u.items);
      setInstallations(i.items);
    }
    if (target === 'admins') setAdmins((await adminApi('/admin/admins')).items);
    if (target === 'roles') {
      const data = await adminApi('/admin/permissions');
      setPermissions((data.roles as DataRow[] | undefined) ?? []);
    }
    if (target === 'ai') setJobs((await adminApi('/admin/jobs')).items);
    if (target === 'audits') setAudits((await adminApi('/admin/audits')).items);
    if (target === 'settings') {
      const [s, l] = await Promise.all([adminApi('/admin/settings'), adminApi('/admin/limits')]);
      setSettings(s);
      setLimits(limitsResponseSchema.parse(l));
    }
    if (target === 'tutorials') await loadTutorials();
  }

  async function loadTutorials() {
    const data = await adminApi('/admin/tutorials?' + new URLSearchParams({ locale }));
    setArticles(tutorialListSchema.parse(data).items);
  }

  useEffect(() => {
    void run(refreshMe);
  }, []);

  useEffect(() => {
    if (me?.user?.role === 'admin') void run(() => loadSection(section));
  }, [section, windowValue, metric, locale]);

  async function signIn() {
    await adminApi('/auth/admin/login', { login, password });
    if (process.env.NODE_ENV === 'production') setPassword('');
    await refreshMe();
  }

  async function signOut() {
    await adminApi('/auth/logout', {});
    setMe(null);
    setOverview(null);
  }

  async function openAccountSettings() {
    const account = await adminApi('/admin/me/account');
    setSelfAccount(account);
    setSelfAccountForm({
      login: String(account.login ?? ''),
      email: String(account.email ?? ''),
      currentPassword: '',
      newPassword: '',
      confirmNewPassword: '',
    });
    setAccountSaved(false);
    setAccountModalOpen(true);
  }

  async function saveSelfAccount() {
    const updated = await adminApi(
      '/admin/me/account',
      {
        currentPassword: selfAccountForm.currentPassword,
        login:
          selfAccountForm.login.trim().toLowerCase() === String(selfAccount?.login ?? '')
            ? undefined
            : selfAccountForm.login,
        email:
          selfAccountForm.email.trim().toLowerCase() === String(selfAccount?.email ?? '')
            ? undefined
            : selfAccountForm.email,
        newPassword: selfAccountForm.newPassword || undefined,
        confirmNewPassword: selfAccountForm.newPassword
          ? selfAccountForm.confirmNewPassword
          : undefined,
      },
      'PATCH',
    );
    setSelfAccount(updated);
    setSelfAccountForm({
      login: String(updated.login ?? ''),
      email: String(updated.email ?? ''),
      currentPassword: '',
      newPassword: '',
      confirmNewPassword: '',
    });
    setAccountSaved(true);
    await refreshMe();
  }

  const signedIn = me?.user?.role === 'admin';
  if (!signedIn) {
    return (
      <main className="admin-login-page">
        <Card className="admin-login-card" variant="borderless">
          <Space direction="vertical" size={22} style={{ width: '100%' }}>
            <a className="admin-brand" href="/">
              <span className="admin-brand-logo">r</span>
              <span>
                runad<span>123</span>
              </span>
            </a>
            <div>
              <Text type="secondary">runad123 admin</Text>
              <Title level={2}>{t('adminSystem')}</Title>
            </div>
            {error && <Alert type="error" showIcon message={errorMessage(locale, error)} />}
            <Form layout="vertical" onFinish={() => void run(signIn)} requiredMark={false}>
              <Form.Item label={t('adminLogin')} required>
                <Input
                  size="large"
                  autoComplete="username"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                />
              </Form.Item>
              <Form.Item label={t('adminPassword')} required>
                <Input.Password
                  size="large"
                  autoComplete="current-password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Form.Item>
              <Button type="primary" htmlType="submit" size="large" block loading={busy}>
                {t('signIn')}
              </Button>
            </Form>
          </Space>
        </Card>
      </main>
    );
  }

  return (
    <Layout className="admin-system">
      <Sider width={252} className="admin-sidebar" theme="light">
        <a className="admin-brand admin-brand-sidebar" href="/admin">
          <span className="admin-brand-logo">r</span>
          <span>
            runad<span>123</span>
          </span>
        </a>
        <Menu
          theme="light"
          mode="inline"
          selectedKeys={[section]}
          items={menuItems}
          onClick={(item: { key: string }) => setSection(item.key as Section)}
        />
      </Sider>
      <Layout className="admin-main">
        <Header className="admin-topbar">
          <Title level={3} className="admin-page-title">
            {section === 'ai-config' ? aiManagementText(locale, 'title') : t('nav.' + section)}
          </Title>
          <Space size={12} wrap>
            <Select
              aria-label="Language"
              value={locale}
              onChange={onLocaleChange}
              options={[
                { value: 'zh-Hans', label: '简体中文' },
                { value: 'zh-Hant', label: '繁體中文' },
                { value: 'en', label: 'English' },
              ]}
              style={{ width: 132 }}
            />
            <Badge status="success" text={t('localReady')} />
            <Button
              className="admin-account"
              type="text"
              icon={<Avatar icon={<UserOutlined />} />}
              onClick={() => void run(openAccountSettings)}
            >
              {me.user?.email}
            </Button>
            <Button icon={<LogoutOutlined />} onClick={() => void run(signOut)} disabled={busy}>
              {authText(locale, 'logout')}
            </Button>
          </Space>
        </Header>
        <Content className="admin-workspace">
          <AccountSettingsModal
            locale={locale}
            open={accountModalOpen}
            busy={busy}
            account={selfAccount}
            form={selfAccountForm}
            setForm={setSelfAccountForm}
            saved={accountSaved}
            onSave={() => void run(saveSelfAccount)}
            onClose={() => setAccountModalOpen(false)}
          />
          {error && (
            <Alert
              className="admin-error"
              type="error"
              showIcon
              message={errorMessage(locale, error)}
            />
          )}
          <Spin spinning={busy}>{renderSection()}</Spin>
        </Content>
      </Layout>
    </Layout>
  );

  function renderSection() {
    if (section === 'ai-config') return <AiManagementCard locale={locale} />;
    if (section === 'overview')
      return (
        <Overview
          locale={locale}
          overview={overview}
          refresh={() => void run(() => loadSection('overview'))}
        />
      );
    if (section === 'products')
      return (
        <Products
          locale={locale}
          items={trend}
          metric={metric}
          setMetric={setMetric}
          windowValue={windowValue}
          setWindowValue={setWindowValue}
        />
      );
    if (section === 'accounts')
      return (
        <>
          <MemberReviewCard locale={locale} onReviewed={() => loadSection('accounts')} />
          <Accounts
            locale={locale}
            users={users}
            installations={installations}
            changeStatus={(userId, status) =>
              run(async () => {
                await adminApi('/admin/users/' + userId + '/status', { status }, 'PATCH');
                await loadSection('accounts');
              })
            }
          />
        </>
      );
    if (section === 'admins')
      return (
        <AdminAccounts
          locale={locale}
          admins={admins}
          form={adminForm}
          setForm={setAdminForm}
          reset={passwordReset}
          setReset={setPasswordReset}
          create={() =>
            run(async () => {
              await adminApi('/admin/admins', adminForm, 'POST');
              setAdminForm({ ...blankAdmin });
              await loadSection('admins');
            })
          }
          resetPassword={() =>
            run(async () => {
              await adminApi(
                '/admin/admins/' + passwordReset.userId + '/password',
                { password: passwordReset.password },
                'PATCH',
              );
              setPasswordReset({ userId: '', password: '' });
              await loadSection('admins');
            })
          }
        />
      );
    if (section === 'roles') return <RolesPermissions locale={locale} roles={permissions} />;
    if (section === 'themes') return <ThemeLinksCard locale={locale} />;
    if (section === 'tutorials')
      return (
        <Tutorials
          locale={locale}
          articles={articles}
          form={tutorialForm}
          setForm={setTutorialForm}
          editing={editing}
          setEditing={setEditing}
          save={() =>
            run(async () => {
              await adminApi(
                '/admin/tutorials' + (editing ? '/' + editing.id : ''),
                { ...tutorialForm, ...(editing ? { expectedVersion: editing.version } : {}) },
                editing ? 'PATCH' : 'POST',
              );
              setEditing(null);
              setTutorialForm({ ...blankTutorial });
              await loadTutorials();
            })
          }
        />
      );
    if (section === 'ai') return <RecordTable locale={locale} title={t('nav.ai')} rows={jobs} />;
    if (section === 'audits')
      return <RecordTable locale={locale} title={t('nav.audits')} rows={audits} />;
    return (
      <Settings
        locale={locale}
        settings={settings}
        setSettings={setSettings}
        limits={limits}
        setLimits={setLimits}
        save={() =>
          run(async () => {
            if (settings)
              await adminApi(
                '/admin/settings',
                { accessMode: settings.accessMode, expectedVersion: settings.configVersion },
                'PATCH',
              );
            if (limits)
              setLimits(
                limitsResponseSchema.parse(
                  await adminApi(
                    '/admin/limits',
                    {
                      ...limits,
                      allowedTutorialHosts: limits.allowedTutorialHosts
                        .map((h) => h.trim().toLowerCase())
                        .filter(Boolean),
                    },
                    'PATCH',
                  ),
                ),
              );
            await loadSection('settings');
          })
        }
      />
    );
  }
}

function Overview({
  locale,
  overview,
  refresh,
}: {
  locale: UiLocale;
  overview: DataRow | null;
  refresh: () => void;
}) {
  const t = (k: string) => adminText(locale, k);
  const keys = [
    'users',
    'installations',
    'captures',
    'downloads',
    'failedJobs',
    'knownCost',
    'reservedCost',
    'unknownCostCount',
  ];
  return (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <Card variant="borderless" className="admin-hero-card">
        <Row align="middle" justify="space-between" gutter={[16, 16]}>
          <Col>
            <Space>
              <Avatar size={48} icon={<BarChartOutlined />} />
              <div>
                <Title level={3}>{t('nav.overview')}</Title>
                <Text type="secondary">{t('definition')}</Text>
              </div>
            </Space>
          </Col>
          <Col>
            <Button icon={<ReloadOutlined />} onClick={refresh}>
              {t('refresh')}
            </Button>
          </Col>
        </Row>
      </Card>
      {!overview ? (
        <Card variant="borderless">
          <Empty description={t('loading')} />
        </Card>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            {keys.map((k) => (
              <Col key={k} xs={24} sm={12} lg={6}>
                <Card variant="borderless" className="admin-stat-card">
                  <Statistic title={t(k)} value={formatValue(locale, overview[k])} />
                </Card>
              </Col>
            ))}
          </Row>
          <RecordTable
            locale={locale}
            title={t('heartbeats')}
            rows={(overview.heartbeats as DataRow[] | undefined) ?? []}
            compact
          />
          <RecordTable
            locale={locale}
            title={t('daily')}
            rows={(overview.daily as DataRow[] | undefined) ?? []}
            compact
          />
        </>
      )}
    </Space>
  );
}

function Products({
  locale,
  items,
  metric,
  setMetric,
  windowValue,
  setWindowValue,
}: {
  locale: UiLocale;
  items: DataRow[] | null;
  metric: string;
  setMetric: (value: string) => void;
  windowValue: string;
  setWindowValue: (value: string) => void;
}) {
  const t = (k: string) => adminText(locale, k);
  const columns = [
    {
      title: t('title'),
      dataIndex: 'handle',
      render: (_: unknown, row: DataRow) => (
        <Space direction="vertical" size={0}>
          <a href={String(row.url)} target="_blank" rel="noreferrer">
            {String(row.handle ?? row.productId)}
          </a>
          <Text type="secondary">{String(row.productId ?? '')}</Text>
        </Space>
      ),
    },
    { title: t('capture'), dataIndex: 'captureCount' },
    { title: t('export'), dataIndex: 'exportCount' },
    {
      title: t('anonymous'),
      render: (_: unknown, row: DataRow) =>
        `${row.anonymousCaptureActors ?? 0} / ${row.anonymousExportActors ?? 0}`,
    },
    {
      title: t('accounts'),
      render: (_: unknown, row: DataRow) =>
        `${row.accountCaptureActors ?? 0} / ${row.accountExportActors ?? 0}`,
    },
  ];
  return (
    <Card
      variant="borderless"
      title={t('nav.products')}
      extra={
        <Space wrap>
          <Select
            value={windowValue}
            onChange={setWindowValue}
            options={['24h', '7d', '30d'].map((v) => ({ value: v, label: t(v) }))}
            style={{ width: 110 }}
          />
          <Select
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'export', label: t('export') },
              { value: 'capture', label: t('capture') },
            ]}
            style={{ width: 120 }}
          />
        </Space>
      }
    >
      <Paragraph type="secondary">{t('definition')}</Paragraph>
      <Table
        rowKey={(row) => String(row.productId ?? row.url ?? row.handle)}
        columns={columns}
        dataSource={items ?? []}
        locale={{ emptyText: <Empty description={t('noData')} /> }}
        pagination={{ pageSize: 10 }}
      />
    </Card>
  );
}

function Accounts({
  locale,
  users,
  installations,
  changeStatus,
}: {
  locale: UiLocale;
  users: DataRow[] | null;
  installations: DataRow[] | null;
  changeStatus: (userId: string, status: 'active' | 'disabled') => void;
}) {
  const t = (k: string) => adminText(locale, k);
  const columns = [
    { title: t('id'), dataIndex: 'id' },
    { title: t('email'), dataIndex: 'email' },
    { title: t('role'), dataIndex: 'role', render: (value: unknown) => formatValue(locale, value) },
    {
      title: t('status'),
      dataIndex: 'status',
      render: (value: unknown) => (
        <Tag color={value === 'active' ? 'green' : 'red'}>{formatValue(locale, value)}</Tag>
      ),
    },
    { title: t('createdAt'), dataIndex: 'createdAt' },
    {
      title: t('action'),
      render: (_: unknown, row: DataRow) => {
        const id = String(row.id ?? '');
        const disabled = row.status === 'disabled';
        return (
          <Button size="small" onClick={() => changeStatus(id, disabled ? 'active' : 'disabled')}>
            {disabled ? t('enable') : t('disable')}
          </Button>
        );
      },
    },
  ];
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert type="info" showIcon message={t('accountHelp')} />
      <Card variant="borderless" title={t('frontendAccounts')}>
        <Table
          rowKey={(row) => String(row.id)}
          columns={columns}
          dataSource={users ?? []}
          pagination={{ pageSize: 10 }}
        />
      </Card>
      <RecordTable locale={locale} title={t('installations')} rows={installations} />
    </Space>
  );
}

function AdminAccounts({
  locale,
  admins,
  form,
  setForm,
  reset,
  setReset,
  create,
  resetPassword,
}: {
  locale: UiLocale;
  admins: DataRow[] | null;
  form: { login: string; email: string; password: string };
  setForm: (value: { login: string; email: string; password: string }) => void;
  reset: { userId: string; password: string };
  setReset: (value: { userId: string; password: string }) => void;
  create: () => void;
  resetPassword: () => void;
}) {
  const t = (k: string) => adminText(locale, k);
  const columns = [
    { title: t('login'), dataIndex: 'login' },
    { title: t('email'), dataIndex: 'email' },
    {
      title: t('status'),
      dataIndex: 'status',
      render: (value: unknown) => formatValue(locale, value),
    },
    {
      title: t('lastSeenAt'),
      dataIndex: 'lastLoginAt',
      render: (value: unknown) => formatValue(locale, value),
    },
    { title: t('createdAt'), dataIndex: 'createdAt' },
  ];
  const adminOptions = (admins ?? []).map((item) => ({
    value: String(item.id),
    label: String(item.login ?? item.email ?? item.id),
  }));
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={14}>
        <Card variant="borderless" title={t('adminAccounts')}>
          <Paragraph type="secondary">{t('adminHelp')}</Paragraph>
          <Table
            rowKey={(row) => String(row.id)}
            columns={columns}
            dataSource={admins ?? []}
            pagination={{ pageSize: 10 }}
          />
        </Card>
      </Col>
      <Col xs={24} xl={10}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card variant="borderless" title={t('createAdmin')}>
            <Form layout="vertical" onFinish={create} requiredMark={false}>
              <Form.Item label={t('login')} required>
                <Input
                  value={form.login}
                  onChange={(e) => setForm({ ...form, login: e.target.value })}
                />
              </Form.Item>
              <Form.Item label={t('email')} required>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Form.Item>
              <Form.Item label={t('password')} required>
                <Input.Password
                  minLength={8}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </Form.Item>
              <Button type="primary" htmlType="submit">
                {t('createAdmin')}
              </Button>
            </Form>
          </Card>
          <Card variant="borderless" title={t('resetPassword')}>
            <Form layout="vertical" onFinish={resetPassword} requiredMark={false}>
              <Form.Item label={t('adminAccounts')} required>
                <Select
                  value={reset.userId || undefined}
                  onChange={(userId) => setReset({ ...reset, userId })}
                  options={adminOptions}
                />
              </Form.Item>
              <Form.Item label={t('newPassword')} required>
                <Input.Password
                  minLength={8}
                  value={reset.password}
                  onChange={(e) => setReset({ ...reset, password: e.target.value })}
                />
              </Form.Item>
              <Button htmlType="submit" disabled={!reset.userId}>
                {t('resetPassword')}
              </Button>
            </Form>
          </Card>
        </Space>
      </Col>
    </Row>
  );
}

function RolesPermissions({ locale, roles }: { locale: UiLocale; roles: DataRow[] | null }) {
  const t = (k: string) => adminText(locale, k);
  const items = roles ?? [];
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert type="info" showIcon message={t('rolesHelp')} />
      {items.map((role) => (
        <Card
          key={String(role.key)}
          variant="borderless"
          title={String(role.name ?? role.key)}
          extra={<Tag color="blue">{t('builtInRole')}</Tag>}
        >
          <Paragraph type="secondary">{String(role.description ?? '')}</Paragraph>
          <Table
            rowKey={(row) => String(row.module)}
            columns={[
              {
                title: t('module'),
                dataIndex: 'module',
                render: (value: unknown) => t('nav.' + String(value)),
              },
              {
                title: t('permissionLevel'),
                dataIndex: 'level',
                render: (value: unknown) =>
                  t(
                    'permission' + String(value).slice(0, 1).toUpperCase() + String(value).slice(1),
                  ),
              },
            ]}
            dataSource={(role.modules as DataRow[] | undefined) ?? []}
            pagination={false}
          />
        </Card>
      ))}
    </Space>
  );
}

function Tutorials({
  locale,
  articles,
  form,
  setForm,
  editing,
  setEditing,
  save,
}: {
  locale: UiLocale;
  articles: Tutorial[];
  form: TutorialInput;
  setForm: (value: TutorialInput) => void;
  editing: Tutorial | null;
  setEditing: (value: Tutorial | null) => void;
  save: () => void;
}) {
  const t = (k: string) => adminText(locale, k);
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={13}>
        <Card variant="borderless" title={t('nav.tutorials')}>
          <List
            dataSource={articles}
            locale={{ emptyText: t('noData') }}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button
                    key="edit"
                    onClick={() => {
                      setEditing(item);
                      setForm(tutorialInputSchema.strip().parse(item));
                    }}
                  >
                    {t('edit')}
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      {item.title}
                      <Tag>{item.contentLocale}</Tag>
                      {item.enabled && <Tag color="green">{t('enabled')}</Tag>}
                    </Space>
                  }
                  description={item.summary || item.url}
                />
              </List.Item>
            )}
          />
        </Card>
      </Col>
      <Col xs={24} lg={11}>
        <Card variant="borderless" title={editing ? t('edit') : t('save')}>
          <Form layout="vertical" onFinish={save} requiredMark={false}>
            <Form.Item label={t('title')} required>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Form.Item>
            <Form.Item label={t('summary')}>
              <Input.TextArea
                rows={3}
                value={form.summary}
                onChange={(e) => setForm({ ...form, summary: e.target.value })}
              />
            </Form.Item>
            <Form.Item label={t('url')} required>
              <Input
                type="url"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item label={t('contentLocale')}>
                  <Select
                    value={form.contentLocale}
                    onChange={(value) => setForm({ ...form, contentLocale: value as UiLocale })}
                    options={[
                      { value: 'en', label: 'English' },
                      { value: 'zh-Hans', label: '简体中文' },
                      { value: 'zh-Hant', label: '繁體中文' },
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label={t('sortOrder')}>
                  <InputNumber
                    style={{ width: '100%' }}
                    value={form.sortOrder}
                    onChange={(value) => setForm({ ...form, sortOrder: Number(value ?? 0) })}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item label={t('category')}>
                  <Select
                    value={form.category}
                    onChange={(value) =>
                      setForm({ ...form, category: value as TutorialInput['category'] })
                    }
                    options={['getting-started', 'shopify', 'advertising'].map((v) => ({
                      value: v,
                      label: t(v),
                    }))}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label={t('placement')}>
                  <Select
                    value={form.placement}
                    onChange={(value) =>
                      setForm({ ...form, placement: value as TutorialInput['placement'] })
                    }
                    options={['website', 'extension', 'both'].map((v) => ({
                      value: v,
                      label: t(v),
                    }))}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label={t('enabled')}>
              <Switch
                checked={form.enabled}
                onChange={(checked) => setForm({ ...form, enabled: checked })}
              />
            </Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                {t('save')}
              </Button>
              {editing && (
                <Button
                  onClick={() => {
                    setEditing(null);
                    setForm({ ...blankTutorial });
                  }}
                >
                  {t('cancel')}
                </Button>
              )}
            </Space>
          </Form>
        </Card>
      </Col>
    </Row>
  );
}

function AccountSettingsModal({
  locale,
  open,
  busy,
  account,
  form,
  setForm,
  saved,
  onSave,
  onClose,
}: {
  locale: UiLocale;
  open: boolean;
  busy: boolean;
  account: DataRow | null;
  form: {
    login: string;
    email: string;
    currentPassword: string;
    newPassword: string;
    confirmNewPassword: string;
  };
  setForm: (value: {
    login: string;
    email: string;
    currentPassword: string;
    newPassword: string;
    confirmNewPassword: string;
  }) => void;
  saved: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const t = (k: string) => adminText(locale, k);
  const passwordMismatch = Boolean(
    form.newPassword && form.confirmNewPassword && form.newPassword !== form.confirmNewPassword,
  );
  return (
    <Modal
      title={t('currentAdminAccount')}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      {!account ? (
        <Empty description={t('loading')} />
      ) : (
        <Form layout="vertical" onFinish={onSave} requiredMark={false}>
          {saved && (
            <Alert
              type="success"
              showIcon
              message={t('accountSavedReloginHint')}
              style={{ marginBottom: 16 }}
            />
          )}
          <Form.Item label={t('currentPassword')} required>
            <Input.Password
              value={form.currentPassword}
              autoComplete="current-password"
              onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
            />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={t('login')}>
                <Input value={String(account.login ?? '')} disabled />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={t('email')}>
                <Input value={String(account.email ?? '')} disabled />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label={t('newLogin')}>
            <Input
              value={form.login}
              placeholder={t('leaveBlankNoChange')}
              autoComplete="username"
              onChange={(e) => setForm({ ...form, login: e.target.value })}
            />
          </Form.Item>
          <Form.Item label={t('newEmail')}>
            <Input
              type="email"
              value={form.email}
              placeholder={t('leaveBlankNoChange')}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Form.Item>
          <Form.Item label={t('newPassword')}>
            <Input.Password
              minLength={8}
              value={form.newPassword}
              placeholder={t('leaveBlankNoChange')}
              autoComplete="new-password"
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
            />
          </Form.Item>
          <Form.Item
            label={t('confirmNewPassword')}
            validateStatus={passwordMismatch ? 'error' : undefined}
            help={passwordMismatch ? t('passwordConfirmMismatch') : undefined}
          >
            <Input.Password
              minLength={8}
              value={form.confirmNewPassword}
              placeholder={t('leaveBlankNoChange')}
              autoComplete="new-password"
              onChange={(e) => setForm({ ...form, confirmNewPassword: e.target.value })}
            />
          </Form.Item>
          <Space>
            <Button
              type="primary"
              htmlType="submit"
              loading={busy}
              disabled={
                !form.currentPassword ||
                passwordMismatch ||
                Boolean(form.newPassword && !form.confirmNewPassword)
              }
            >
              {t('saveAccount')}
            </Button>
            <Button onClick={onClose}>{t('cancel')}</Button>
          </Space>
        </Form>
      )}
    </Modal>
  );
}

function Settings({
  locale,
  settings,
  setSettings,
  limits,
  setLimits,
  save,
}: {
  locale: UiLocale;
  settings: { accessMode: string; configVersion: number; emailConfigured: boolean } | null;
  setSettings: (value: {
    accessMode: string;
    configVersion: number;
    emailConfigured: boolean;
  }) => void;
  limits: Limits | null;
  setLimits: (value: Limits) => void;
  save: () => void;
}) {
  const t = (k: string) => adminText(locale, k);
  if (!settings || !limits)
    return (
      <Card variant="borderless">
        <Empty description={t('loading')} />
      </Card>
    );
  return (
    <Card variant="borderless" title={t('nav.settings')}>
      <Form layout="vertical" onFinish={save} requiredMark={false} className="admin-settings-form">
        <Form.Item label={authText(locale, 'mode')}>
          <Select
            value={settings.accessMode}
            onChange={(value) => setSettings({ ...settings, accessMode: value })}
            options={[
              { value: 'anonymous_allowed', label: authText(locale, 'anonymousAllowed') },
              { value: 'login_required', label: authText(locale, 'required') },
            ]}
          />
        </Form.Item>
        <Divider />
        <Row gutter={16}>
          {(
            [
              'dailyBudget',
              'riskAnonymous',
              'riskAccount',
              'rewriteAnonymous',
              'rewriteAccount',
            ] as const
          ).map((key) => (
            <Col key={key} xs={24} md={12} xl={8}>
              <Form.Item label={t(key)}>
                <InputNumber
                  style={{ width: '100%' }}
                  min={key === 'dailyBudget' ? 0 : 1}
                  step={key === 'dailyBudget' ? 0.000001 : 1}
                  value={key === 'dailyBudget' ? Number(limits[key]) : limits[key]}
                  onChange={(value) =>
                    setLimits({
                      ...limits,
                      [key]: key === 'dailyBudget' ? String(value ?? 0) : Number(value ?? 1),
                    })
                  }
                />
              </Form.Item>
            </Col>
          ))}
        </Row>
        <Form.Item label={t('allowedTutorialHosts')}>
          <Input.TextArea
            rows={5}
            value={limits.allowedTutorialHosts.join('\n')}
            onChange={(e) =>
              setLimits({ ...limits, allowedTutorialHosts: e.target.value.split('\n') })
            }
          />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          {t('save')}
        </Button>
      </Form>
    </Card>
  );
}

function RecordTable({
  locale,
  rows,
  title,
  compact = false,
}: {
  locale: UiLocale;
  rows: DataRow[] | null;
  title?: string;
  compact?: boolean;
}) {
  const t = (k: string) => adminText(locale, k);
  const keys = Array.from(new Set((rows ?? []).flatMap((row) => Object.keys(row)))).slice(
    0,
    compact ? 4 : 7,
  );
  const columns = keys.map((key) => ({
    title: adminDictionaries[locale][key] ?? key,
    dataIndex: key,
    render: (value: unknown) => formatValue(locale, value),
    ellipsis: true,
  }));
  return (
    <Card variant="borderless" title={title}>
      <Table
        size={compact ? 'small' : 'middle'}
        rowKey={(row, index) => String(row.id ?? row.name ?? row.key ?? index)}
        columns={columns}
        dataSource={rows ?? []}
        locale={{ emptyText: <Empty description={t('noData')} /> }}
        pagination={compact ? false : { pageSize: 10 }}
        scroll={{ x: true }}
      />
    </Card>
  );
}
