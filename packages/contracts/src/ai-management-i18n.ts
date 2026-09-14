import type { UiLocale } from './i18n.js';
const words = {
  system: ['系统管理', '系統管理', 'System management'],
  title: ['AI 配置管理', 'AI 設定管理', 'AI configuration'],
  intro: [
    '配置兼容 Chat Completions 的 API，用于商品标题、描述风险检查和改写。图片检测暂不启用。',
    '設定相容 Chat Completions 的 API，用於商品標題、描述風險檢查及改寫。圖片檢測暫不啟用。',
    'Configure Chat Completions compatible APIs for product text risk checks and rewriting. Image checks are not enabled.',
  ],
  add: ['新增配置', '新增設定', 'Add configuration'],
  name: ['配置名称', '設定名稱', 'Configuration name'],
  enabled: ['启用配置', '啟用設定', 'Enable configuration'],
  endpoint: ['接口地址', '介面位址', 'API base URL'],
  model: ['模型', '模型', 'Model'],
  key: ['API Key', 'API Key', 'API Key'],
  keyHint: [
    '已加密保存；留空保持不变',
    '已加密儲存；留空保持不變',
    'Encrypted; leave blank to keep unchanged',
  ],
  newKey: ['输入 API Key', '輸入 API Key', 'Enter API key'],
  risk: [
    '用于标题 / 描述风险检查',
    '用於標題 / 描述風險檢查',
    'Use for title / description risk checks',
  ],
  rewrite: ['用于标题 / 描述改写', '用於標題 / 描述改寫', 'Use for title / description rewriting'],
  riskRules: ['风险检查规则', '風險檢查規則', 'Risk check instructions'],
  rewriteRules: ['改写规则', '改寫規則', 'Rewrite instructions'],
  rulesHint: [
    '可填写补充规则；留空使用内置规则。系统始终保留结构化结果、事实保真及风险边界要求。',
    '可填寫補充規則；留空使用內建規則。系統保留結構化結果、事實保真及風險邊界要求。',
    'Optional additional instructions. Built-in output, factual accuracy and risk boundaries always apply.',
  ],
  advanced: ['高级设置', '進階設定', 'Advanced settings'],
  path: ['接口路径', '介面路徑', 'API path'],
  requestUrl: ['请求地址', '請求位址', 'Request URL'],
  timeout: ['请求超时（秒）', '請求逾時（秒）', 'Timeout (seconds)'],
  attempts: [
    '最大尝试次数（含首次）',
    '最大嘗試次數（含首次）',
    'Maximum attempts (including first)',
  ],
  retry: ['重试基础等待（秒）', '重試基礎等待（秒）', 'Retry base delay (seconds)'],
  temperature: ['Temperature', 'Temperature', 'Temperature'],
  output: ['最大输出 Token', '最大輸出 Token', 'Maximum output tokens'],
  input: ['输入 Token 预算', '輸入 Token 預算', 'Input token budget'],
  context: ['模型上下文 Token 上限', '模型上下文 Token 上限', 'Model context token limit'],
  priceInput: [
    '每百万输入 Token 价格（USD）',
    '每百萬輸入 Token 價格（USD）',
    'Input price per million tokens (USD)',
  ],
  priceOutput: [
    '每百万输出 Token 价格（USD）',
    '每百萬輸出 Token 價格（USD）',
    'Output price per million tokens (USD)',
  ],
  budget: ['每日总预算（USD）', '每日總預算（USD）', 'Daily total budget (USD)'],
  budgetHint: [
    '启用前填写真实模型价格。检查与改写共用风险检查配置的每日预算。',
    '啟用前填寫實際模型價格。檢查與改寫共用風險檢查設定的每日預算。',
    'Enter actual model pricing before enabling. Both tasks share the risk configuration daily budget.',
  ],
  save: ['保存配置', '儲存設定', 'Save configuration'],
  check: ['检查配置', '檢查設定', 'Check configuration'],
  checkHint: [
    '先保存再检查；仅读取模型列表，不发送商品、不发起生成。',
    '先儲存再檢查；僅讀取模型列表，不傳送商品、不發起生成。',
    'Save before checking. Only reads the model list; no product or generation request is sent.',
  ],
  checked: [
    '认证通过，模型已找到；实际生成仍需验证。',
    '認證通過，已找到模型；實際生成仍需驗證。',
    'Authenticated and model found; generation still requires validation.',
  ],
  missingModel: [
    '认证通过，但模型列表未找到该模型，请核对名称。',
    '認證通過，但模型清單未找到此模型，請核對名稱。',
    'Authenticated, but model not found in the list. Check its name.',
  ],
  saved: ['已保存', '已儲存', 'Saved'],
  dirty: ['有未保存修改', '有未儲存修改', 'Unsaved changes'],
  updated: ['最近保存', '最近儲存', 'Last saved'],
  empty: ['尚未配置 AI API', '尚未設定 AI API', 'No AI API configured'],
  failed: ['操作失败，请重试', '操作失敗，請重試', 'Request failed; try again'],
  INVALID_INPUT: ['请检查配置字段', '請檢查設定欄位', 'Check configuration fields'],
  REVISION_CONFLICT: [
    '配置已被其他管理员修改，请刷新后重试',
    '設定已被其他管理員修改，請重新整理',
    'Configuration changed; refresh and try again',
  ],
  AI_KEY_REQUIRED: [
    '请填写 API Key；修改接口地址或路径后必须重新填写密钥',
    '請填寫 API Key；修改介面位址或路徑後必須重新填寫金鑰',
    'Enter an API key; changing the endpoint or path requires re-entering it',
  ],
  AI_BUDGET_REQUIRED: [
    '启用前请填写大于零的价格和每日预算',
    '啟用前請填寫大於零的價格與每日預算',
    'Positive prices and daily budget are required',
  ],
  AI_CHECK_FAILED: [
    '连接检查失败，请核对公网 HTTPS 地址、密钥及模型列表接口',
    '連線檢查失敗，請核對公網 HTTPS 位址、金鑰及模型清單介面',
    'Connection check failed. Verify public HTTPS URL, key and model list endpoint',
  ],
  AI_CHECK_UNSUPPORTED: [
    '此自定义路径不支持模型列表检查',
    '此自訂路徑不支援模型清單檢查',
    'Model listing is unsupported for this custom path',
  ],
  refresh: ['刷新', '重新整理', 'Refresh'],
} as const;
export function aiManagementText(locale: UiLocale, key: string) {
  const value = words[key as keyof typeof words];
  return (
    value?.[locale === 'zh-Hans' ? 0 : locale === 'zh-Hant' ? 1 : 2] ??
    words.failed[locale === 'en' ? 2 : locale === 'zh-Hant' ? 1 : 0]
  );
}
