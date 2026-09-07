// 日本の祝日判定。Googleが提供する「日本の祝日」公開カレンダーを参照する
// (共通設定シートの「祝日除外」がTRUEの場合のみ使用される)。

var JAPAN_HOLIDAY_CALENDAR_ID = 'ja.japanese#holiday@group.v.calendar.google.com';

function isJapaneseHoliday(date) {
  try {
    var calendar = CalendarApp.getCalendarById(JAPAN_HOLIDAY_CALENDAR_ID);
    if (!calendar) return false;
    // Date のローカル時刻操作はスクリプトのタイムゾーン(Asia/Tokyo)基準で行われる。
    var dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var dayEnd = new Date(dayStart.getTime());
    dayEnd.setDate(dayEnd.getDate() + 1);
    var events = calendar.getEvents(dayStart, dayEnd);
    return events.length > 0;
  } catch (err) {
    // カレンダー取得に失敗した場合は「祝日ではない」として判定を続行する(安全側に倒すなら
    // 共通設定シートで祝日除外をFALSEにして曜日除外のみで運用することも検討してください)。
    return false;
  }
}
