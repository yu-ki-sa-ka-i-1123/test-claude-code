// 全体で共有する定数定義。
// スクリプトプロパティに保存するキー、シート名・列名などをここに集約する。

var SHEET_NAMES = {
  CLIENTS: 'クライアント設定',
  TEMPLATES: 'メッセージ文言',
  SETTINGS: '共通設定',
  LOGS: '送信ログ'
};

// 「クライアント設定」シートの列名(1行目のヘッダーとして使う)。
// 依頼仕様の項目名をそのままヘッダーに使い、内部的にもこのキーで参照する。
var CLIENT_HEADERS = [
  'client_name',
  'group_id',
  'enabled',
  'support_start',
  'support_end',
  'interval_days',
  'followup_interval_days',
  'template_A_key',
  'template_B_key',
  'last_human_message_at',
  'last_reminder_sent_at',
  'reminder_stage',
  'consecutive_reminders',
  'memo'
];

var TEMPLATE_HEADERS = ['key', '本文'];

// 「共通設定」は 設定項目/値 の縦持ち(key-value)シート。
// SETTINGS_KEYS の値がそのままA列に入るラベルになる。
var SETTINGS_KEYS = {
  START_TIME: '送信可能開始時刻',
  END_TIME: '送信可能終了時刻',
  EXCLUDED_WEEKDAYS: '曜日除外',
  EXCLUDE_HOLIDAYS: '祝日除外',
  MONTHLY_LIMIT: '月間送信上限',
  ADMIN_EMAIL: '管理者通知先メールアドレス'
};

var LOG_HEADERS = ['日時', 'client', 'group_id', 'テンプレkey', '通数', '結果', 'エラー内容'];

// 曜日ラベル(日本語)→ JSの getDay() 相当の数値(0=日,...,6=土)
var WEEKDAY_LABEL_TO_NUMBER = {
  '日': 0,
  '月': 1,
  '火': 2,
  '水': 3,
  '木': 4,
  '金': 5,
  '土': 6
};

// スクリプトプロパティのキー(トークン等の秘匿情報はここに保存し、シートには置かない)。
var SCRIPT_PROPERTY_KEYS = {
  LINE_CHANNEL_ACCESS_TOKEN: 'LINE_CHANNEL_ACCESS_TOKEN',
  WEBHOOK_SHARED_TOKEN: 'WEBHOOK_SHARED_TOKEN'
};

var DEFAULT_MONTHLY_LIMIT = 180;

function getScriptProperty(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}
