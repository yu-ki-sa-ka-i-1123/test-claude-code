// 状態遷移の純粋ロジック。
// SpreadsheetApp/UrlFetchApp 等の GAS 依存を一切持たず、Date を注入して
// 挙動を決定づけられる純粋関数として実装している(ユニットテスト用)。
// GAS 上では他の .js ファイルからグローバル関数として直接呼び出される。

var DAY_MS = 24 * 60 * 60 * 1000;

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

// UTC の Date を JST の日付・時刻要素に変換する。
// 日本は夏時間(DST)がないため、固定オフセット(+9h)で常に正しく計算できる。
function toJstParts(date) {
  var jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
    hour: jst.getUTCHours(),
    minute: jst.getUTCMinutes(),
    dayOfWeek: jst.getUTCDay(),
    dateKey:
      jst.getUTCFullYear() + '-' + pad2(jst.getUTCMonth() + 1) + '-' + pad2(jst.getUTCDate())
  };
}

function dateKeyOf(date) {
  return toJstParts(date).dateKey;
}

function latestDate(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

// state: { lastHumanMessageAt, lastReminderSentAt, reminderStage('A'|'B'), consecutiveReminders }
// settings: { enabled, supportStart, supportEnd, intervalDays, followupIntervalDays }
// context: { now, isWithinBusinessWindow, isQuotaAvailable }
// returns: { shouldSend, reason, templateKey }
function evaluateReminder(state, settings, context) {
  var now = context.now;
  var nowKey = dateKeyOf(now);

  if (!settings.enabled) {
    return { shouldSend: false, reason: 'DISABLED', templateKey: null };
  }

  var supportStartKey = dateKeyOf(settings.supportStart);
  var supportEndKey = dateKeyOf(settings.supportEnd);
  if (nowKey < supportStartKey || nowKey > supportEndKey) {
    return { shouldSend: false, reason: 'OUT_OF_SUPPORT_PERIOD', templateKey: null };
  }

  // 同一日の二重送信防止(トリガー重複などで同日中に2回判定が走った場合のガード)。
  if (state.lastReminderSentAt && dateKeyOf(state.lastReminderSentAt) === nowKey) {
    return { shouldSend: false, reason: 'ALREADY_SENT_TODAY', templateKey: null };
  }

  var base = latestDate(state.lastHumanMessageAt, state.lastReminderSentAt) || settings.supportStart;
  // 初回(consecutiveReminders===0)は interval_days、2通目以降は followup_interval_days を使う。
  var intervalDays = state.consecutiveReminders === 0 ? settings.intervalDays : settings.followupIntervalDays;
  var elapsedMs = now.getTime() - base.getTime();
  if (elapsedMs < intervalDays * DAY_MS) {
    return { shouldSend: false, reason: 'INTERVAL_NOT_ELAPSED', templateKey: null };
  }

  if (!context.isWithinBusinessWindow) {
    return { shouldSend: false, reason: 'OUTSIDE_BUSINESS_WINDOW', templateKey: null };
  }

  if (!context.isQuotaAvailable) {
    return { shouldSend: false, reason: 'QUOTA_EXCEEDED', templateKey: null };
  }

  return { shouldSend: true, reason: 'OK', templateKey: state.reminderStage };
}

// リマインド送信成功後の状態遷移。
// consecutiveReminders を +1 し、1通目送信直後(=2通目)だけ B、それ以外は A にする。
// (結果として A→B→A→A→A... と遷移する)
function applySentUpdate(state, now) {
  var consecutiveReminders = state.consecutiveReminders + 1;
  return {
    lastHumanMessageAt: state.lastHumanMessageAt,
    lastReminderSentAt: now,
    reminderStage: consecutiveReminders === 1 ? 'B' : 'A',
    consecutiveReminders: consecutiveReminders
  };
}

// 人間の発言(スタンプ・画像・ファイル等を含む)受信時の状態遷移。
function applyHumanMessageUpdate(state, now) {
  return {
    lastHumanMessageAt: now,
    lastReminderSentAt: state.lastReminderSentAt,
    reminderStage: 'A',
    consecutiveReminders: 0
  };
}

// windowConfig: { startHour, startMinute, endHour, endMinute, excludedWeekdays:[0-6], excludeHolidays }
// isHoliday は呼び出し側(GAS)が CalendarApp で計算済みの値を渡す。この関数自体は純粋関数。
function isWithinBusinessWindow(now, windowConfig, isHoliday) {
  var parts = toJstParts(now);

  if (windowConfig.excludedWeekdays.indexOf(parts.dayOfWeek) !== -1) {
    return false;
  }
  if (windowConfig.excludeHolidays && isHoliday) {
    return false;
  }
  var minutes = parts.hour * 60 + parts.minute;
  var startMinutes = windowConfig.startHour * 60 + windowConfig.startMinute;
  var endMinutes = windowConfig.endHour * 60 + windowConfig.endMinute;
  return minutes >= startMinutes && minutes < endMinutes;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DAY_MS: DAY_MS,
    pad2: pad2,
    toJstParts: toJstParts,
    dateKeyOf: dateKeyOf,
    latestDate: latestDate,
    evaluateReminder: evaluateReminder,
    applySentUpdate: applySentUpdate,
    applyHumanMessageUpdate: applyHumanMessageUpdate,
    isWithinBusinessWindow: isWithinBusinessWindow
  };
}
