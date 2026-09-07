// スプレッドシート(設定画面兼DB)への読み書きをまとめたサービス層。
// GAS依存(SpreadsheetApp)を持つため、ユニットテストの対象外(ReminderLogic.jsの純粋関数側でロジックを検証する)。

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet(name) {
  var sheet = getSpreadsheet().getSheetByName(name);
  if (!sheet) {
    throw new Error('シートが見つかりません: ' + name + '。メニューの「初期セットアップ」を実行してください。');
  }
  return sheet;
}

function getHeaderMap(sheet) {
  var numCols = Math.max(sheet.getLastColumn(), 1);
  var headerRow = sheet.getRange(1, 1, 1, numCols).getValues()[0];
  var map = {};
  headerRow.forEach(function (name, i) {
    if (name) map[name] = i + 1;
  });
  return map;
}

function normalizeDate(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  return null;
}

function normalizeBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.trim().toUpperCase() === 'TRUE';
  return false;
}

function normalizeNumber(v, def) {
  if (v === '' || v === null || v === undefined) return def;
  var n = Number(v);
  return isNaN(n) ? def : n;
}

// ==== クライアント設定シート ====

function getClientRows() {
  var sheet = getSheet(SHEET_NAMES.CLIENTS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var headerMap = getHeaderMap(sheet);
  var numCols = sheet.getLastColumn();
  var values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var raw = values[i];
    var rowIndex = i + 2;
    var groupIdRaw = raw[headerMap['group_id'] - 1];
    if (!groupIdRaw) continue; // group_id未設定行(空行等)はスキップ
    rows.push({
      rowIndex: rowIndex,
      clientName: raw[headerMap['client_name'] - 1] || '',
      groupId: String(groupIdRaw),
      enabled: normalizeBool(raw[headerMap['enabled'] - 1]),
      supportStart: normalizeDate(raw[headerMap['support_start'] - 1]),
      supportEnd: normalizeDate(raw[headerMap['support_end'] - 1]),
      intervalDays: normalizeNumber(raw[headerMap['interval_days'] - 1], 3),
      followupIntervalDays: normalizeNumber(raw[headerMap['followup_interval_days'] - 1], 2),
      templateAKey: raw[headerMap['template_A_key'] - 1] || 'A',
      templateBKey: raw[headerMap['template_B_key'] - 1] || 'B',
      lastHumanMessageAt: normalizeDate(raw[headerMap['last_human_message_at'] - 1]),
      lastReminderSentAt: normalizeDate(raw[headerMap['last_reminder_sent_at'] - 1]),
      reminderStage: raw[headerMap['reminder_stage'] - 1] === 'B' ? 'B' : 'A',
      consecutiveReminders: normalizeNumber(raw[headerMap['consecutive_reminders'] - 1], 0)
    });
  }
  return rows;
}

function findClientRowByGroupId(groupId) {
  var rows = getClientRows();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].groupId === groupId) return rows[i];
  }
  return null;
}

// 定期判定後の状態更新。渡されたフィールドのみ書き込む。
function updateClientState(rowIndex, state) {
  var sheet = getSheet(SHEET_NAMES.CLIENTS);
  var headerMap = getHeaderMap(sheet);
  if (Object.prototype.hasOwnProperty.call(state, 'lastHumanMessageAt')) {
    sheet.getRange(rowIndex, headerMap['last_human_message_at']).setValue(state.lastHumanMessageAt);
  }
  if (Object.prototype.hasOwnProperty.call(state, 'lastReminderSentAt')) {
    sheet.getRange(rowIndex, headerMap['last_reminder_sent_at']).setValue(state.lastReminderSentAt);
  }
  if (Object.prototype.hasOwnProperty.call(state, 'reminderStage')) {
    sheet.getRange(rowIndex, headerMap['reminder_stage']).setValue(state.reminderStage);
  }
  if (Object.prototype.hasOwnProperty.call(state, 'consecutiveReminders')) {
    sheet.getRange(rowIndex, headerMap['consecutive_reminders']).setValue(state.consecutiveReminders);
  }
}

// join イベントで新規グループが検出された際、クライアント設定シートに自動追記する。
// 既に同じgroup_idの行があれば何もしない(二重追加防止)。
function appendClientRowForJoin(groupId) {
  var existing = findClientRowByGroupId(groupId);
  if (existing) return existing;

  var sheet = getSheet(SHEET_NAMES.CLIENTS);
  var headerMap = getHeaderMap(sheet);
  var newRow = new Array(CLIENT_HEADERS.length).fill('');
  newRow[headerMap['client_name'] - 1] = '(未設定:クライアント名を入力してください)';
  newRow[headerMap['group_id'] - 1] = groupId;
  newRow[headerMap['enabled'] - 1] = false; // 安全のためデフォルトOFF。担当者が設定後にONにする。
  newRow[headerMap['interval_days'] - 1] = 3;
  newRow[headerMap['followup_interval_days'] - 1] = 2;
  newRow[headerMap['template_A_key'] - 1] = 'A';
  newRow[headerMap['template_B_key'] - 1] = 'B';
  newRow[headerMap['reminder_stage'] - 1] = 'A';
  newRow[headerMap['consecutive_reminders'] - 1] = 0;
  newRow[headerMap['memo'] - 1] = '自動追加(グループ参加イベント)。support_start/support_end等を設定し、enabledをTRUEにしてください。';
  sheet.appendRow(newRow);
  return { rowIndex: sheet.getLastRow(), groupId: groupId };
}

// ==== メッセージ文言シート ====

function getTemplates() {
  var sheet = getSheet(SHEET_NAMES.TEMPLATES);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  var values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  var map = {};
  values.forEach(function (row) {
    if (row[0]) map[row[0]] = row[1];
  });
  return map;
}

// {client_name} のような差し込み変数を置換する。
function renderTemplate(body, vars) {
  return String(body || '').replace(/\{(\w+)\}/g, function (match, key) {
    return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match;
  });
}

// ==== 共通設定シート ====

function parseTimeString(v, defHour, defMinute) {
  // スプレッドシートの時刻セルはDateとして返る(スクリプトのタイムゾーン=Asia/Tokyoで解釈される)。
  if (v instanceof Date) {
    return { hour: v.getHours(), minute: v.getMinutes() };
  }
  if (typeof v === 'string' && v.indexOf(':') !== -1) {
    var parts = v.split(':');
    return { hour: Number(parts[0]), minute: Number(parts[1]) };
  }
  return { hour: defHour, minute: defMinute };
}

function getCommonSettings() {
  var sheet = getSheet(SHEET_NAMES.SETTINGS);
  var lastRow = sheet.getLastRow();
  var values = sheet.getRange(1, 1, lastRow, 2).getValues();
  var map = {};
  values.forEach(function (row) {
    if (row[0]) map[row[0]] = row[1];
  });

  var startTime = parseTimeString(map[SETTINGS_KEYS.START_TIME], 10, 0);
  var endTime = parseTimeString(map[SETTINGS_KEYS.END_TIME], 18, 0);
  var excludedWeekdaysRaw = String(map[SETTINGS_KEYS.EXCLUDED_WEEKDAYS] || '土,日');
  var excludedWeekdays = excludedWeekdaysRaw
    .split(/[、,\s]+/)
    .filter(function (s) {
      return s;
    })
    .map(function (label) {
      return WEEKDAY_LABEL_TO_NUMBER[label];
    })
    .filter(function (n) {
      return n !== undefined;
    });

  return {
    startHour: startTime.hour,
    startMinute: startTime.minute,
    endHour: endTime.hour,
    endMinute: endTime.minute,
    excludedWeekdays: excludedWeekdays,
    excludeHolidays: normalizeBool(map[SETTINGS_KEYS.EXCLUDE_HOLIDAYS]),
    monthlyLimit: normalizeNumber(map[SETTINGS_KEYS.MONTHLY_LIMIT], DEFAULT_MONTHLY_LIMIT),
    adminEmail: map[SETTINGS_KEYS.ADMIN_EMAIL] || ''
  };
}

// ==== 送信ログシート ====

function appendLog(entry) {
  var sheet = getSheet(SHEET_NAMES.LOGS);
  sheet.appendRow([
    entry.datetime,
    entry.client || '',
    entry.groupId || '',
    entry.templateKey || '',
    entry.count || 0,
    entry.result,
    entry.error || ''
  ]);
}

// 指定した年月(JST, 'YYYY-MM')の「成功」送信の通数合計を返す。
// 通数は成功時のみカウントする(送信リクエストが実際にLINE側へ到達し課金対象になったもの)。
function getMonthlySentTotal(yearMonthKey) {
  var sheet = getSheet(SHEET_NAMES.LOGS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var values = sheet.getRange(2, 1, lastRow - 1, LOG_HEADERS.length).getValues();
  var total = 0;
  values.forEach(function (row) {
    var dt = row[0];
    var count = row[4];
    var result = row[5];
    if (!(dt instanceof Date)) return;
    if (result !== '成功') return;
    var parts = toJstParts(dt); // ReminderLogic.js のグローバル関数
    var key = parts.year + '-' + pad2(parts.month);
    if (key === yearMonthKey) {
      total += Number(count) || 0;
    }
  });
  return total;
}

// ==== 初期セットアップ ====

function ensureSheetWithHeaders(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  var current = headerRange.getValues()[0];
  var needsHeader = headers.some(function (h, i) {
    return current[i] !== h;
  });
  if (needsHeader) {
    headerRange.setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function setupSettingsSheet(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.SETTINGS);
  }
  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 6, 2).setValues([
      [SETTINGS_KEYS.START_TIME, '10:00'],
      [SETTINGS_KEYS.END_TIME, '18:00'],
      [SETTINGS_KEYS.EXCLUDED_WEEKDAYS, '土,日'],
      [SETTINGS_KEYS.EXCLUDE_HOLIDAYS, true],
      [SETTINGS_KEYS.MONTHLY_LIMIT, DEFAULT_MONTHLY_LIMIT],
      [SETTINGS_KEYS.ADMIN_EMAIL, '']
    ]);
  }
}

function seedDefaultTemplates(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.TEMPLATES);
  if (sheet.getLastRow() < 2) {
    sheet.getRange(2, 1, 2, 2).setValues([
      [
        'A',
        '{client_name}様\n\nいつもお世話になっております。\nその後のご状況はいかがでしょうか。ご都合の良いタイミングでご返信いただけますと幸いです。'
      ],
      [
        'B',
        '{client_name}様\n\n度々のご連絡失礼いたします。\n何かお困りごとやご不明点がございましたら、いつでもこちらのトークにご連絡ください。'
      ]
    ]);
  }
}

// メニューや初回セットアップから呼び出す。何度実行しても安全(冪等)。
function setupSheets() {
  var ss = getSpreadsheet();
  ensureSheetWithHeaders(ss, SHEET_NAMES.CLIENTS, CLIENT_HEADERS);
  ensureSheetWithHeaders(ss, SHEET_NAMES.TEMPLATES, TEMPLATE_HEADERS);
  ensureSheetWithHeaders(ss, SHEET_NAMES.LOGS, LOG_HEADERS);
  setupSettingsSheet(ss);
  seedDefaultTemplates(ss);
  return 'セットアップが完了しました。';
}
